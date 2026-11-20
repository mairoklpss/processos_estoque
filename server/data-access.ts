// Fachada única: todos os serviços e testes compartilham o mesmo cache/mutex.
// Não instanciar adaptadores independentes para o mesmo SQLite.
export { adaptSqlite, createPostgresDatabase, postgresSql, postgresLockSql, type AsyncDatabase } from './database.ts';
