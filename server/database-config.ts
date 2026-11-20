import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, seedDatabaseIfEmpty, verifyPassword, type DBInstance } from './db.ts';
import { adaptSqlite, createPostgresDatabase, type AsyncDatabase } from './data-access.ts';

export function runtimePostgresUrl(input: string, production = false, target = 'homologacao'): URL {
  if (!['homologacao', 'operacao'].includes(target)) throw new Error('DATABASE_TARGET inválido.');
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('DATABASE_URL inválida.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Protocolo PostgreSQL inválido.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!local && !production) throw new Error('Execução local exige host loopback.');
  const port = target === 'operacao' ? '55433' : '55432';
  const database = target === 'operacao' ? '/brasilink_operacao' : '/brasilink_homologacao';
  if (!production && (url.port !== port || url.pathname !== database)) {
    throw new Error(`Destino ${target} exige ${database.slice(1)} na porta ${port}; não use o PostgreSQL nativo.`);
  }
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key);
  return url;
}

export function assertSqliteSelection(cutoverRecorded: boolean, rollbackAllowed: boolean, explicitExistingSource: boolean): void {
  if (cutoverRecorded && (!rollbackAllowed || !explicitExistingSource)) {
    throw new Error('Operação migrada para PostgreSQL. Use npm start; retorno ao SQLite exige autorização explícita e SQLITE_PATH existente.');
  }
}

export async function openRuntimeDatabase(): Promise<{ db: AsyncDatabase; sqlite?: DBInstance }> {
  const client = process.env.DATABASE_CLIENT ?? 'sqlite';
  if (client !== 'sqlite' && client !== 'postgres') throw new Error('DATABASE_CLIENT deve ser sqlite ou postgres.');
  let db: AsyncDatabase;
  let sqlite: DBInstance | undefined;
  if (client === 'sqlite') {
    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const recorded = fs.existsSync(path.join(projectRoot, '.local/operacao/ativo.json'));
    assertSqliteSelection(recorded, process.env.ALLOW_SQLITE_ROLLBACK === 'true', Boolean(process.env.SQLITE_PATH && fs.existsSync(process.env.SQLITE_PATH)));
    sqlite = createDatabase();
    if (process.env.NODE_ENV !== 'production') seedDatabaseIfEmpty(sqlite);
    db = adaptSqlite(sqlite);
  } else {
    if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL no ambiente; não envie credenciais pelo chat.');
    const url = runtimePostgresUrl(process.env.DATABASE_URL, process.env.NODE_ENV === 'production', process.env.DATABASE_TARGET ?? 'homologacao');
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    db = await createPostgresDatabase({ connectionString: url.toString(), max: 10,
      ssl: local ? false : { rejectUnauthorized: true }, connectionTimeoutMillis: 5000 });
    try {
      const schema = await db.get<{ users: string | null; audit: string | null }>("SELECT to_regclass('usuarios')::text AS users, to_regclass('audit_logs')::text AS audit");
      if (!schema?.users || !schema.audit) throw new Error('Schema PostgreSQL não inicializado. Execute a migração de homologação.');
    } catch { await db.close(); throw new Error('PostgreSQL indisponível ou sem schema de aplicação.'); }
  }
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_TARGET === 'operacao') {
    const users = await db.all<{ senha_hash: string }>('SELECT senha_hash FROM usuarios');
    if (!users.length || users.some(u => ['Coord@2026', 'Estoque@2026'].some(p => verifyPassword(p, u.senha_hash)))) {
      await db.close();
      throw new Error('Produção bloqueada: inicialize usuários e troque as senhas de demonstração antes de publicar.');
    }
  }
  return { db, sqlite };
}

export async function purgeExpiredRuntimeSessions(db: AsyncDatabase, now = new Date()): Promise<number> {
  return db.transaction(async tx => {
    const result = await tx.run('DELETE FROM sessoes WHERE expira_em <= ?', now.toISOString());
    if (result.affectedRows > 0) {
      await tx.run('INSERT INTO audit_logs (criado_em, actor_id, evento, metodo, rota, status, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
        now.toISOString(), null, 'SESSION_PURGE', 'SYSTEM', 'maintenance/sessions', 200, null);
    }
    return result.affectedRows;
  });
}
