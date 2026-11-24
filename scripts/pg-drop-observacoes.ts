// Issue 02: remove a coluna observacoes da tabela separacoes no PostgreSQL operacional.
// Idempotente: se a coluna não existir, não faz nada e reporta. Requer backup prévio.
import { Pool } from 'pg';

async function main(): Promise<void> {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    console.error('pg-drop-observacoes: DATABASE_URL ausente no ambiente do processo.');
    process.exit(1);
  }
  const u = new URL(raw);
  console.log(`pg-drop-observacoes: conexão alvo ${u.protocol}//${u.username}@${u.host}${u.pathname}`);
  const pool = new Pool({ connectionString: raw });
  try {
    const existe = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'separacoes' AND column_name = 'observacoes'`,
    );
    if (existe.rows[0].count === '0') {
      console.log('pg-drop-observacoes: coluna observacoes não existe — nada a fazer.');
      return;
    }
    const antes = await pool.query<{ total: string }>(
      'SELECT COUNT(*)::text AS total FROM separacoes WHERE observacoes IS NOT NULL',
    );
    await pool.query('ALTER TABLE separacoes DROP COLUMN observacoes');
    console.log(
      `pg-drop-observacoes: coluna removida. ${antes.rows[0].total} linha(s) tinham observação preenchida (preservadas no backup anterior à migração).`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((erro) => {
  console.error('pg-drop-observacoes: FALHOU:', erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
