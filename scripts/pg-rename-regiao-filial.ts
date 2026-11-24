// Issue 03: renomeia a coluna regiao → filial na tabela tecnicos do PostgreSQL operacional.
// Idempotente: se filial já existe e regiao não, não faz nada e reporta. Requer backup prévio.
import { Pool } from 'pg';

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const colunas = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'tecnicos' AND column_name IN ('regiao', 'filial')`,
    );
    const nomes = new Set(colunas.rows.map((r) => r.column_name));
    if (nomes.has('filial') && !nomes.has('regiao')) {
      console.log('pg-rename-regiao-filial: coluna filial já existe e regiao não — nada a fazer.');
      return;
    }
    if (!nomes.has('regiao')) {
      throw new Error('Coluna regiao não existe na tabela tecnicos; verificar estado do banco.');
    }
    const total = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM tecnicos');
    await pool.query('ALTER TABLE tecnicos RENAME COLUMN regiao TO filial');
    console.log(
      `pg-rename-regiao-filial: coluna renomeada. ${total.rows[0].count} técnico(s) preservado(s) com o mesmo valor (agora em filial).`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((erro) => {
  console.error('pg-rename-regiao-filial: FALHOU:', erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
