import 'dotenv/config';
import Database from 'better-sqlite3';
import path from 'node:path';
import { createSqliteBackup, restoreSqliteBackup } from '../server/backup-store.ts';

function option(name: string): string {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Informe ${name}.`);
  return path.resolve(process.argv[index + 1]);
}
const mode = process.argv[2];
const secret = process.env.BACKUP_PASSPHRASE;
if (!secret || secret.length < 16) throw new Error('Configure BACKUP_PASSPHRASE no ambiente com pelo menos 16 caracteres. Não passe na linha de comando.');
try {
  if (mode === 'create') {
    const source = process.env.SQLITE_PATH ?? path.resolve('data/brasilink_separacao.sqlite');
    const db = new Database(source, { readonly: true, fileMustExist: true });
    try { await createSqliteBackup(db, option('--output'), secret); }
    finally { db.close(); }
    console.log('Backup cifrado criado e consistente. Preserve a chave em local seguro.');
  } else if (mode === 'restore') {
    await restoreSqliteBackup(option('--input'), option('--output'), secret);
    console.log('Backup restaurado em arquivo novo; a operação atual não foi alterada.');
  } else throw new Error('Use create ou restore.');
} catch {
  console.error('Operação de backup falhou. Verifique caminhos, permissões e chave. Nenhum arquivo existente deve ser sobrescrito.');
  process.exitCode = 1;
}
