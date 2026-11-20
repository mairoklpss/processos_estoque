import pg from 'pg';
import { localMigrationUrl } from '../server/postgres-migration.ts';
import { identifier } from '../server/migration-snapshot.ts';
async function main() {
  const url = localMigrationUrl(process.env.PG_MIGRATION_URL ?? '', process.env.PG_MIGRATION_PROFILE ?? 'homologacao');
  const database = decodeURIComponent(new URL(url).pathname.slice(1));
  const secret = process.env.PG_APP_PASSWORD;
  if (!secret || secret.length < 16 || secret.length > 128 || secret.includes(String.fromCharCode(0))) throw new Error('Configure PG_APP_PASSWORD no ambiente.');
  const pool = new pg.Pool({ connectionString: url, ssl: false, max: 1, connectionTimeoutMillis: 5000 });
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const role = await client.query("SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = 'brasilink_app'");
      if (role.rows.length && Object.values(role.rows[0]).some(Boolean)) throw new Error('Role existente tem privilégios excessivos.');
      if (!role.rows.length) {
        await client.query('SET LOCAL standard_conforming_strings = on');
        await client.query("CREATE ROLE brasilink_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '" + secret.replaceAll("'", "''") + "'");
      }
      await client.query(`GRANT CONNECT ON DATABASE ${identifier(database)} TO brasilink_app`);
      await client.query('GRANT USAGE ON SCHEMA public TO brasilink_app');
      await client.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO brasilink_app');
      await client.query('REVOKE UPDATE, DELETE ON audit_logs FROM brasilink_app');
      await client.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO brasilink_app');
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
    const appUrl = new URL(url); appUrl.username = 'brasilink_app'; appUrl.password = secret;
    const app = new pg.Pool({ connectionString: appUrl.toString(), ssl: false, max: 1, connectionTimeoutMillis: 5000 });
    try { await app.query('SELECT COUNT(*) FROM usuarios'); }
    finally { await app.end(); }
    console.log('Role de aplicação configurada e autenticada, sem privilégios administrativos.');
  } finally { await pool.end(); }
}
main().catch(() => { console.error('APP_ROLE_SETUP_FAILED: verifique o destino dedicado e as chaves locais.'); process.exitCode = 1; });
