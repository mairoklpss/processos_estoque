import pg from 'pg';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrationTables, inspectSnapshot, identifier, type TableCheck } from './migration-snapshot.ts';
import { localMigrationUrl } from './postgres-migration.ts';

// No dotenv loading: credentials must be injected into this process environment.
export function sourceArgument(args: string[]): string {
  if (args.length !== 2 || args[0] !== '--source' || !args[1] || args[1].startsWith('--')) {
    throw new Error('Informe somente --source CAMINHO_DO_BACKUP_SQLITE.');
  }
  return path.resolve(args[1]);
}
export function openBackup(source: string): Database.Database {
  const resolved = fs.realpathSync(source);
  const operational = path.resolve(process.env.SQLITE_PATH ?? 'data/brasilink_separacao.sqlite');
  if (fs.existsSync(operational)) {
    const a = fs.statSync(resolved); const b = fs.statSync(operational);
    if (fs.realpathSync(operational).toLowerCase() === resolved.toLowerCase() || (a.ino === b.ino && a.dev === b.dev)) {
      throw new Error('A fonte deve ser backup, nunca o SQLite operacional.');
    }
  }
  const db = new Database(resolved, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON');
    db.defaultSafeIntegers(true);
    db.exec('BEGIN'); // Pin one consistent read snapshot including integrity checks.
    const actual = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
    const allowed = new Set<string>([...migrationTables, 'sessoes']);
    if (actual.some(t => !allowed.has(t.name))) throw new Error('Backup contém tabelas não previstas; revise o mapeamento antes de migrar.');
    return db;
  } catch (e) { if (db.inTransaction) db.exec('ROLLBACK'); db.close(); throw e; }
}

// Read SQLite integers as bigint first so unsafe integers cannot be silently rounded.
export function safeValue(value: unknown, integer: boolean): string | number | null {
  if (typeof value === 'bigint') {
    if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Inteiro fora da precisão segura.');
    value = Number(value);
  }
  if (value === null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (integer && (!Number.isSafeInteger(value) || value < -2147483648 || value > 2147483647))) {
      throw new Error('Número fora do domínio PostgreSQL INTEGER/DOUBLE PRECISION.');
    }
    return value;
  }
  if (typeof value === 'string' && !value.includes('\0')) return value;
  throw new Error('Valor incompatível com PostgreSQL.');
}
export function inspectBackup(db: Database.Database): TableCheck[] {
  // Validate before allowing the shared snapshot helper to read JS numbers.
  for (const table of migrationTables) {
    const fields = db.prepare(`PRAGMA table_info(${identifier(table)})`).all() as { name: string; type: string }[];
    if (!fields.length) continue;
    for (const row of db.prepare(`SELECT * FROM ${identifier(table)}`).iterate() as Iterable<Record<string, unknown>>) {
      for (const f of fields) safeValue(row[f.name], /INT/i.test(f.type));
    }
  }
  db.defaultSafeIntegers(false);
  return inspectSnapshot(db);
}
export async function compareBackup(client: pg.PoolClient, expected: TableCheck[]) {
  const checks: { table: string; count: number; sha256: string }[] = [];
  for (const table of expected) {
    const count = Number((await client.query(`SELECT COUNT(*) AS count FROM ${identifier(table.table)}`)).rows[0].count);
    if (!Number.isSafeInteger(count) || count !== table.count) throw new Error(`Contagem divergente: ${table.table}.`);
    const hash = crypto.createHash('sha256'); let seen = 0; let last: number | null = null;
    if (table.columns.length) {
      while (true) {
        // NULL starts before ALL IDs (negative, zero and positive), unlike id > 0.
        const rows: Record<string, any>[] = (await client.query(`SELECT ${table.columns.map(identifier).join(', ')} FROM public.${identifier(table.table)} WHERE ($1::integer IS NULL OR id > $1) ORDER BY id LIMIT 500`, [last])).rows;
        for (const row of rows) {
          hash.update(JSON.stringify(table.columns.map(c => row[c])) + '\n');
          last = row.id; seen++;
        }
        if (rows.length < 500) break;
      }
    }
    if (seen !== table.count || hash.digest('hex') !== table.sha256) throw new Error(`Conteúdo divergente: ${table.table}.`);
    checks.push({ table: table.table, count, sha256: table.sha256 });
  }
  const sessions = Number((await client.query('SELECT COUNT(*) AS count FROM public.sessoes')).rows[0].count);
  if (sessions !== 0) throw new Error('Sessões devem permanecer vazias para homologação.');
  return checks;
}

export async function runPostgresCopy(source: string, verifyOnly = false, connectionUrl = process.env.PG_MIGRATION_URL) {
  const secret = connectionUrl;
  if (!secret) throw new Error('Configure PG_MIGRATION_URL somente no ambiente.');
  const connectionString = localMigrationUrl(secret, process.env.PG_MIGRATION_PROFILE ?? 'homologacao');
  const url = new URL(connectionString);
  if (!url.username || !url.password || decodeURIComponent(url.username) === 'brasilink_app') throw new Error('Use identidade de migração separada da aplicação.');
  const snapshot = openBackup(source);
  let pool: pg.Pool | undefined; let client: pg.PoolClient | undefined; let started = false;
  try {
    const expected = inspectBackup(snapshot);
    pool = new pg.Pool({ connectionString, ssl: false, max: 1, connectionTimeoutMillis: 5000 });
    client = await pool.connect();
    await client.query(verifyOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN'); started = true;
    await client.query("SET LOCAL search_path = public, pg_catalog");
    await client.query("SET LOCAL lock_timeout = '5s'");
    if (!verifyOnly) {
      await client.query('SELECT pg_advisory_xact_lock(192837465)');
      const existing = await client.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f')");
      if (existing.rows.length) throw new Error('Destino não está vazio; nada será removido.');
      await client.query(fs.readFileSync(new URL('./postgres-schema.sql', import.meta.url), 'utf8'));
      for (const table of expected) {
        if (!table.columns.length) continue;
        let batch: unknown[][] = [];
        const flush = async () => {
          if (!batch.length) return;
          const values: unknown[] = [];
          const tuples = batch.map(row => '(' + row.map(value => { values.push(value); return `$${values.length}`; }).join(',') + ')');
          await client!.query(`INSERT INTO public.${identifier(table.table)} (${table.columns.map(identifier).join(',')}) VALUES ${tuples.join(',')}`, values);
          batch = [];
        };
        for (const row of snapshot.prepare(`SELECT * FROM ${identifier(table.table)} ORDER BY id`).iterate() as Iterable<Record<string, unknown>>) {
          batch.push(table.columns.map(c => row[c]));
          if (batch.length === 250) await flush();
        }
        await flush();
      }
      for (const table of migrationTables) {
        // Preserve SQLite AUTOINCREMENT high-water mark, including deleted IDs.
        const seq = snapshot.prepare("SELECT name FROM sqlite_master WHERE name='sqlite_sequence'").get();
        const previous = seq ? (snapshot.prepare('SELECT seq FROM sqlite_sequence WHERE name=?').get(table) as { seq: number } | undefined)?.seq ?? 0 : 0;
        if (!Number.isSafeInteger(previous) || previous > 2147483647) throw new Error('Sequência incompatível com o domínio INTEGER.');
        await client.query(`SELECT setval(pg_get_serial_sequence($1, 'id'), GREATEST(COALESCE(MAX(id),0),$2::integer,1), GREATEST(COALESCE(MAX(id),0),$2::integer)>0) FROM public.${identifier(table)}`, [`public.${table}`, previous]);
      }
    }
    const verified = await compareBackup(client, expected); // Verify ALL rows/columns before COMMIT.
    await client.query('COMMIT'); started = false;
    return { migrated: !verifyOnly, sessionsCopied: 0, verified };
  } catch (error) {
    if (client && started) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client?.release(); if (pool) await pool.end();
    if (snapshot.inTransaction) snapshot.exec('ROLLBACK'); snapshot.close();
  }
}
