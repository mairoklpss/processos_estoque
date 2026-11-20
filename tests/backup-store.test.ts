import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createDatabase, seedDatabaseIfEmpty } from '../server/db.ts';
import { createSqliteBackup, restoreSqliteBackup } from '../server/backup-store.ts';

const secret = 'Chave apenas de teste com 32 caracteres';
test('Backup cifrado: snapshot WAL, restauração íntegra e não sobrescreve arquivos existentes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'brasilink-backup-test-'));
  const db = createDatabase(path.join(dir, 'source.sqlite')); seedDatabaseIfEmpty(db);
  const backup = path.join(dir, 'backup.enc'); const restore = path.join(dir, 'restore.sqlite');
  try {
    db.prepare('UPDATE itens SET estoque_atual = 123 WHERE id = 1').run();
    await createSqliteBackup(db, backup, secret);
    const encrypted = await fs.readFile(backup);
    assert.ok(!encrypted.includes(Buffer.from('SQLite format 3')));
    assert.ok(!encrypted.includes(Buffer.from('Carlos Eduardo')));
    await restoreSqliteBackup(backup, restore, secret);
    const check = new Database(restore, { readonly: true });
    try { assert.equal((check.prepare('SELECT estoque_atual FROM itens WHERE id = 1').get() as { estoque_atual: number }).estoque_atual, 123); }
    finally { check.close(); }
    await assert.rejects(createSqliteBackup(db, backup, secret));
    assert.deepEqual(await fs.readFile(backup), encrypted);
    const before = await fs.readFile(restore);
    await assert.rejects(restoreSqliteBackup(backup, restore, secret));
    assert.deepEqual(await fs.readFile(restore), before);
  } finally { db.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('Backup cifrado: senha incorreta e adulteração não produzem restauração', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'brasilink-backup-tamper-'));
  const db = createDatabase(':memory:'); seedDatabaseIfEmpty(db);
  try {
    const backup = path.join(dir, 'backup.enc'); const output = path.join(dir, 'restore.sqlite');
    await createSqliteBackup(db, backup, secret);
    await assert.rejects(restoreSqliteBackup(backup, output, 'outra senha incorreta longa'));
    await assert.rejects(fs.stat(output), { code: 'ENOENT' });
    const data = await fs.readFile(backup); data[data.length - 20] ^= 0xff; await fs.writeFile(backup, data);
    await assert.rejects(restoreSqliteBackup(backup, output, secret));
    await assert.rejects(fs.stat(output), { code: 'ENOENT' });
  } finally { db.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
