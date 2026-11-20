import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import type { PoolClient } from 'pg';

export const migrationTables = ['usuarios', 'tecnicos', 'itens', 'minimos_tecnicos', 'consumos', 'saldos_tecnicos', 'separacoes', 'separacao_itens', 'pendencias', 'audit_logs'] as const;
export function identifier(name: string): string { return '"' + name.replaceAll('"', '""') + '"'; }
export interface TableCheck { table: string; columns: string[]; count: number; sha256: string }

export function inspectSnapshot(db: Database.Database): TableCheck[] {
  const integrity = db.pragma('integrity_check') as { integrity_check: string }[];
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' || (db.pragma('foreign_key_check') as unknown[]).length) throw new Error('Cópia SQLite não íntegra.');
  return migrationTables.map(table => {
    const fields = db.prepare(`PRAGMA table_info(${identifier(table)})`).all() as { name: string; type: string }[];
    if (!fields.length && table !== 'audit_logs') throw new Error(`Tabela obrigatória ausente: ${table}`);
    const columns = fields.map(f => f.name);
    const hash = crypto.createHash('sha256'); let count = 0;
    if (columns.length) {
      for (const row of db.prepare(`SELECT * FROM ${identifier(table)} ORDER BY id`).iterate() as Iterable<Record<string, unknown>>) {
        const values = fields.map(field => {
          const value = row[field.name];
          if (value !== null && /INT|REAL/i.test(field.type) && typeof value !== 'number') throw new Error(`Tipo numérico incompatível na tabela ${table}.`);
          if (typeof value === 'number' && (!Number.isFinite(value) || (/INT/i.test(field.type) && (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)))) throw new Error(`Número incompatível na tabela ${table}.`);
          if (typeof value === 'string' && value.includes(String.fromCharCode(0))) throw new Error(`Texto incompatível na tabela ${table}.`);
          if (value !== null && typeof value !== 'number' && typeof value !== 'string') throw new Error(`Tipo incompatível na tabela ${table}.`);
          return value;
        });
        hash.update(JSON.stringify(values) + '\n'); count++;
      }
    }
    return { table, columns, count, sha256: hash.digest('hex') };
  });
}

export async function verifyTarget(client: PoolClient, expected: TableCheck[]): Promise<{ table: string; count: number; sha256: string }[]> {
  const results = [];
  for (const source of expected) {
    const countRow = await client.query(`SELECT COUNT(*) AS count FROM ${identifier(source.table)}`);
    const count = Number(countRow.rows[0].count);
    if (count !== source.count) throw new Error(`Contagem divergente na tabela ${source.table}.`);
    const hash = crypto.createHash('sha256');
    if (source.columns.length) {
      let lastId = 0; let seen = 0;
      while (true) {
        const page = await client.query(`SELECT ${source.columns.map(identifier).join(', ')} FROM ${identifier(source.table)} WHERE id > $1 ORDER BY id LIMIT 500`, [lastId]);
        for (const row of page.rows) {
          hash.update(JSON.stringify(source.columns.map(c => row[c])) + '\n');
          lastId = row.id; seen++;
        }
        if (page.rows.length < 500) break;
      }
      if (seen !== source.count) throw new Error(`IDs inválidos na tabela ${source.table}.`);
    }
    const sha256 = hash.digest('hex');
    if (sha256 !== source.sha256) throw new Error(`Conteúdo divergente na tabela ${source.table}.`);
    results.push({ table: source.table, count, sha256 });
  }
  return results;
}
