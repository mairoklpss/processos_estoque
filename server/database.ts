import { AsyncLocalStorage } from 'node:async_hooks';
import pg, { type PoolConfig, type PoolClient, type QueryResult } from 'pg';
import type { DBInstance } from './db.ts';

export interface AsyncDatabase {
  dialect: 'sqlite' | 'postgres';
  get<T = any>(sql: string, ...params: any[]): Promise<T | undefined>;
  all<T = any>(sql: string, ...params: any[]): Promise<T[]>;
  run(sql: string, ...params: any[]): Promise<{ insertId: number | undefined; affectedRows: number }>;
  transaction<T>(work: (db: AsyncDatabase) => Promise<T>, options?: { retry?: boolean }): Promise<T>;
  lock<T = any>(sql: string, ...params: any[]): Promise<T | undefined>;
  lockAll<T = any>(sql: string, ...params: any[]): Promise<T[]>;
  close(): Promise<void>;
}

type Token = { text: string; start: number; end: number; kind: 'word' | 'identifier' | 'literal' | 'symbol' | 'parameter' };

// Token positions refer to the original SQL, so additions do not discard comments.
// Supports doubled quotes, E'...' escapes, dollar quotes and nested block comments.
function sqlTokens(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const start = i;
    const ch = sql[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i + 2); i = end < 0 ? sql.length : end; continue;
    }
    if (sql.startsWith('/*', i)) {
      let depth = 1; i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith('/*', i)) { depth++; i += 2; }
        else if (sql.startsWith('*/', i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) throw new Error('Comentário SQL não terminado.');
      continue;
    }
    const escaped = /[eE]/.test(ch) && sql[i + 1] === "'" && (i === 0 || !/[\w$]/.test(sql[i - 1]));
    if (ch === "'" || ch === '"' || escaped) {
      const quote = escaped ? "'" : ch;
      i += escaped ? 2 : 1;
      let terminated = false;
      while (i < sql.length) {
        if (escaped && sql[i] === '\\') { i += 2; continue; }
        if (sql[i++] === quote) {
          if (sql[i] === quote) { i++; continue; }
          terminated = true; break;
        }
      }
      if (!terminated) throw new Error('Literal/identificador SQL não terminado.');
      tokens.push({ text: sql.slice(start, i), start, end: i, kind: ch === '"' ? 'identifier' : 'literal' });
      continue;
    }
    const tag = ch === '$' ? sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0] : undefined;
    if (tag) {
      const end = sql.indexOf(tag, i + tag.length);
      if (end < 0) throw new Error('Literal SQL não terminado.');
      i = end + tag.length;
      tokens.push({ text: sql.slice(start, i), start, end: i, kind: 'literal' }); continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      i++; while (i < sql.length && /[\w$]/.test(sql[i])) i++;
      tokens.push({ text: sql.slice(start, i), start, end: i, kind: 'word' }); continue;
    }
    i++;
    tokens.push({ text: ch, start, end: i, kind: ch === '?' ? 'parameter' : 'symbol' });
  }
  return tokens;
}

export function postgresSql(sql: string): string {
  let result = ''; let last = 0; let n = 0;
  for (const token of sqlTokens(sql)) {
    if (token.kind !== 'parameter') continue;
    result += sql.slice(last, token.start) + `$${++n}`;
    last = token.end;
  }
  return result + sql.slice(last);
}

function keyword(token: Token | undefined, word: string): boolean {
  return token?.kind === 'word' && token.text.toUpperCase() === word;
}
function identifier(token: Token | undefined): string | undefined {
  if (token?.kind === 'word') return token.text.toLowerCase();
  if (token?.kind === 'identifier') return token.text.slice(1, -1).replaceAll('""', '"');
  return undefined;
}
function insertRelation(sql: string): string | undefined {
  const tokens = sqlTokens(sql);
  if (!keyword(tokens[0], 'INSERT') || !keyword(tokens[1], 'INTO')) return undefined;
  let i = keyword(tokens[2], 'ONLY') ? 3 : 2;
  if (identifier(tokens[i]) === undefined) return undefined;
  let relation = tokens[i++].text;
  if (tokens[i]?.text === '.' && identifier(tokens[i + 1]) !== undefined) relation += '.' + tokens[i + 1].text;
  return relation;
}
function appendClause(sql: string, clause: string): string {
  const tokens = sqlTokens(sql);
  const last = tokens.at(-1);
  if (!last) throw new Error('SQL vazio.');
  const position = last.text === ';' ? (tokens.at(-2)?.end ?? last.start) : last.end;
  return sql.slice(0, position) + ' ' + clause + sql.slice(position);
}

export function postgresLockSql(sql: string): string {
  const tokens = sqlTokens(sql);
  if (tokens.some((t, i) => keyword(t, 'FOR') && (keyword(tokens[i + 1], 'UPDATE') || keyword(tokens[i + 1], 'SHARE') || keyword(tokens[i + 1], 'NO') || keyword(tokens[i + 1], 'KEY')))) return sql;
  const itemJoin = tokens.some((t, i) => {
    if (!keyword(t, 'JOIN')) return false;
    let j = i + 1;
    if (tokens[j + 1]?.text === '.') j += 2;
    if (identifier(tokens[j]) !== 'itens') return false;
    j++; if (keyword(tokens[j], 'AS')) j++;
    return identifier(tokens[j]) === 'i';
  });
  return appendClause(sql, itemJoin ? 'FOR UPDATE OF i' : 'FOR UPDATE');
}

function safeInteger(value: unknown): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('Inteiro do banco excede precisão segura.');
  return number;
}
function sqliteRow<T>(row: unknown): T | undefined {
  if (row === undefined) return undefined;
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    if (typeof value === 'bigint') (row as Record<string, unknown>)[key] = safeInteger(value);
  }
  return row as T;
}
const sqliteCache = new WeakMap<DBInstance, AsyncDatabase>();

export function adaptSqlite(raw: DBInstance): AsyncDatabase {
  const cached = sqliteCache.get(raw);
  if (cached) return cached;
  let tail: Promise<unknown> = Promise.resolve();
  let closed = false;
  const context = new AsyncLocalStorage<{ active: boolean }>();
  const queue = <T>(work: () => T | Promise<T>): Promise<T> => {
    if (context.getStore()?.active) return Promise.reject(new Error('Use o adaptador do escopo transacional; transação aninhada não suportada.'));
    const result = tail.then(() => { if (closed) throw new Error('Banco fechado.'); return work(); });
    tail = result.catch(() => undefined);
    return result;
  };
  const scoped = (active: () => boolean): AsyncDatabase => {
    const check = () => { if (!active()) throw new Error('Escopo transacional encerrado.'); };
    return {
      dialect: 'sqlite',
      async get(sql, ...params) { check(); return sqliteRow<any>(raw.prepare(sql).safeIntegers(true).get(...params)); },
      async all(sql, ...params) { check(); return raw.prepare(sql).safeIntegers(true).all(...params).map(row => sqliteRow<any>(row)!); },
      async run(sql, ...params) {
        check();
        const relation = insertRelation(sql);
        // SQLite lastInsertRowid is stale after an UPSERT update. RETURNING gives the actual row.
        if (relation) {
          const hasId = (raw.prepare(`PRAGMA table_info(${relation.split('.').at(-1)})`).all() as { name: string }[]).some(c => c.name === 'id');
          const returning = sqlTokens(sql).some(t => keyword(t, 'RETURNING'));
          if (hasId || returning) {
            const returned = raw.prepare(hasId && !returning ? appendClause(sql, 'RETURNING id') : sql).safeIntegers(true).all(...params) as { id?: number | bigint }[];
            const affectedRows = safeInteger((raw.prepare('SELECT changes() AS n').get() as { n: number }).n);
            return { insertId: returned[0]?.id == null ? undefined : safeInteger(returned[0].id), affectedRows };
          }
        }
        const result = raw.prepare(sql).run(...params);
        return { insertId: undefined, affectedRows: safeInteger(result.changes) };
      },
      async transaction() { throw new Error('Transação aninhada não suportada.'); },
      async lock(sql, ...params) { return this.get(sql, ...params); },
      async lockAll(sql, ...params) { return this.all(sql, ...params); },
      async close() { throw new Error('Não feche o banco dentro da transação.'); },
    };
  };
  const direct = scoped(() => !closed);
  const db: AsyncDatabase = {
    dialect: 'sqlite',
    get: (sql, ...params) => queue(() => direct.get(sql, ...params)),
    all: (sql, ...params) => queue(() => direct.all(sql, ...params)),
    run: (sql, ...params) => queue(() => direct.run(sql, ...params)),
    lock: (sql, ...params) => queue(() => direct.get(sql, ...params)),
    lockAll: (sql, ...params) => queue(() => direct.all(sql, ...params)),
    transaction: work => queue(async () => {
      const scope = { active: true };
      raw.exec('BEGIN IMMEDIATE');
      try {
        const result = await context.run(scope, () => work(scoped(() => scope.active)));
        raw.exec('COMMIT'); return result;
      } catch (error) { if (raw.inTransaction) raw.exec('ROLLBACK'); throw error; }
      finally { scope.active = false; }
    }),
    close: () => queue(() => { raw.close(); closed = true; }),
  };
  sqliteCache.set(raw, db);
  return db;
}

// All MVP adapter writers use this same lock, across pool connections/processes.
// It does not constrain writers that bypass this adapter.
const WRITE_LOCK = 192837465;

export async function createPostgresDatabase(options: PoolConfig): Promise<AsyncDatabase> {
  const pool = new pg.Pool({
    ...options,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5000,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 30000,
    statement_timeout: options.statement_timeout ?? 15000,
    idle_in_transaction_session_timeout: options.idle_in_transaction_session_timeout ?? 30000,
    // Per-pool parsers: do not mutate pg's global type registry.
    types: options.types ?? { getTypeParser(oid: number, format?: any) {
      if (format === 'binary') return pg.types.getTypeParser(oid, format);
      if (oid === 20) return safeInteger;
      if ([1082, 1114, 1184].includes(oid)) return (value: string) => value;
      if (oid === 1700) return (value: string) => {
        const number = Number(value);
        if (!Number.isFinite(number) || (Number.isInteger(number) && !Number.isSafeInteger(number))) throw new Error('Número PostgreSQL excede precisão segura.');
        return number;
      };
      return pg.types.getTypeParser(oid, format);
    } },
  });
  pool.on('error', () => console.error('POSTGRES_IDLE_CONNECTION_ERROR'));
  try { await pool.query('SELECT 1'); } catch (error) { await pool.end(); throw error; }
  let closed = false;
  const context = new AsyncLocalStorage<{ active: boolean }>();
  const assertRoot = () => {
    if (closed) throw new Error('Banco fechado.');
    if (context.getStore()?.active) throw new Error('Use o adaptador do escopo transacional; transação aninhada não suportada.');
  };
  // Metadata is checked per INSERT: respects search_path and avoids stale DDL caches.
  const insertSql = async (client: PoolClient, sql: string): Promise<string> => {
    const relation = insertRelation(sql);
    if (!relation || sqlTokens(sql).some(t => keyword(t, 'RETURNING'))) return sql;
    const result = await client.query<{ has_id: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass($1) AND attname = 'id' AND attnum > 0 AND NOT attisdropped) AS has_id", [relation]);
    return result.rows[0]?.has_id ? appendClause(sql, 'RETURNING id') : sql;
  };
  function scoped(client: PoolClient, scope: { active: boolean }): AsyncDatabase {
    const check = () => { if (!scope.active) throw new Error('Escopo transacional encerrado.'); };
    const query = async (sql: string, params: any[]): Promise<QueryResult> => {
      check(); return client.query(postgresSql(sql), params);
    };
    return {
      dialect: 'postgres',
      async get(sql, ...params) { return (await query(sql, params)).rows[0]; },
      async all(sql, ...params) { return (await query(sql, params)).rows; },
      async run(sql, ...params) {
        check();
        const result = await query(await insertSql(client, sql), params);
        return { insertId: insertRelation(sql) && result.rows[0]?.id != null ? safeInteger(result.rows[0].id) : undefined, affectedRows: result.rowCount ?? 0 };
      },
      async transaction() { throw new Error('Transação aninhada não suportada.'); },
      async lock(sql, ...params) { return this.get(postgresLockSql(sql), ...params); },
      async lockAll(sql, ...params) { return this.all(postgresLockSql(sql), ...params); },
      async close() { throw new Error('Não feche o banco dentro da transação.'); },
    };
  }
  const db: AsyncDatabase = {
    dialect: 'postgres',
    async get(sql, ...params) { assertRoot(); return (await pool.query(postgresSql(sql), params)).rows[0]; },
    async all(sql, ...params) { assertRoot(); return (await pool.query(postgresSql(sql), params)).rows; },
    async run(sql, ...params) { return db.transaction(tx => tx.run(sql, ...params)); },
    async lock() { throw new Error('FOR UPDATE exige escopo transacional.'); },
    async lockAll() { throw new Error('FOR UPDATE exige escopo transacional.'); },
    async transaction(work, transactionOptions) {
      assertRoot();
      for (let attempt = 0; attempt < 3; attempt++) {
        const client = await pool.connect();
        const scope = { active: true }; let began = false; let retry = false;
        try {
          await client.query('BEGIN'); began = true;
          await client.query("SET LOCAL lock_timeout = '5s'");
          await client.query('SELECT pg_advisory_xact_lock($1)', [WRITE_LOCK]);
          const result = await context.run(scope, () => work(scoped(client, scope)));
          scope.active = false; // Handler continuations may not queue work after COMMIT.
          await client.query('COMMIT'); return result;
        } catch (error) {
          scope.active = false; // Invalidate BEFORE awaiting rollback; pending handlers must not write after it.
          if (began) await client.query('ROLLBACK').catch(() => undefined);
          retry = transactionOptions?.retry !== false && attempt < 2 && ['40P01', '40001'].includes((error as { code?: string }).code ?? '');
          if (!retry) throw error;
        } finally { scope.active = false; client.release(); }
        // Bounded retry. Callbacks must not perform external side effects (e.g. send mail).
        if (retry) await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1)));
      }
      throw new Error('Tentativas transacionais esgotadas.');
    },
    async close() { assertRoot(); closed = true; await pool.end(); },
  };
  return db;
}
