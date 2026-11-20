import crypto from 'node:crypto';
import fs from 'node:fs';
import { promises as files, constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import Database from 'better-sqlite3';
import type { DBInstance } from './db.ts';

const magic = Buffer.from('BRASILINK-BACKUP-1\n');
const saltSize = 16; const ivSize = 12; const tagSize = 16;
const headerSize = magic.length + saltSize + ivSize;
function key(secret: string, salt: Buffer): Promise<Buffer> {
  if (typeof secret !== 'string' || secret.length < 16 || secret.length > 1024) throw new Error('Chave de backup inválida.');
  return new Promise((resolve, reject) => crypto.scrypt(secret, salt, 32, { N: 16384, r: 8, p: 1 }, (error, derived) => error ? reject(error) : resolve(derived)));
}

export async function createSqliteBackup(db: DBInstance, outputPath: string, secret: string): Promise<{ path: string }> {
  const directory = await files.mkdtemp(path.join(os.tmpdir(), 'brasilink-backup-'));
  const snapshot = path.join(directory, 'snapshot.sqlite');
  let ownedOutput = false;
  try {
    await db.backup(snapshot);
    const salt = crypto.randomBytes(saltSize); const iv = crypto.randomBytes(ivSize);
    const header = Buffer.concat([magic, salt, iv]); const derived = await key(secret, salt);
    const cipher = crypto.createCipheriv('aes-256-gcm', derived, iv); cipher.setAAD(header); derived.fill(0);
    const output = fs.createWriteStream(outputPath, { flags: 'wx', mode: 0o600 });
    output.once('open', () => { ownedOutput = true; });
    output.write(header);
    await pipeline(fs.createReadStream(snapshot), cipher, output);
    await files.appendFile(outputPath, cipher.getAuthTag());
    return { path: path.resolve(outputPath) };
  } catch (error) {
    if (ownedOutput) await files.unlink(outputPath).catch(() => {}); // Apenas saída nova criada por esta tentativa.
    throw error;
  } finally { await files.rm(directory, { recursive: true, force: true }); }
}

export async function restoreSqliteBackup(inputPath: string, outputPath: string, secret: string): Promise<{ path: string }> {
  if (path.resolve(inputPath) === path.resolve(outputPath)) throw new Error('A restauração exige outro arquivo.');
  const stat = await files.stat(inputPath);
  if (stat.size < headerSize + tagSize) throw new Error('Backup inválido.');
  const handle = await files.open(inputPath, 'r');
  const header = Buffer.alloc(headerSize); const tag = Buffer.alloc(tagSize);
  try {
    await handle.read(header, 0, header.length, 0);
    await handle.read(tag, 0, tag.length, stat.size - tagSize);
  } finally { await handle.close(); }
  if (!header.subarray(0, magic.length).equals(magic)) throw new Error('Formato de backup inválido.');
  const salt = header.subarray(magic.length, magic.length + saltSize);
  const iv = header.subarray(magic.length + saltSize);
  const derived = await key(secret, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', derived, iv); decipher.setAAD(header); decipher.setAuthTag(tag); derived.fill(0);
  const directory = await files.mkdtemp(path.join(os.tmpdir(), 'brasilink-restore-'));
  const restored = path.join(directory, 'restored.sqlite');
  try {
    await pipeline(fs.createReadStream(inputPath, { start: headerSize, end: stat.size - tagSize - 1 }), decipher,
      fs.createWriteStream(restored, { flags: 'wx', mode: 0o600 }));
    const check = new Database(restored, { readonly: true, fileMustExist: true });
    try {
      const integrity = check.pragma('integrity_check') as { integrity_check: string }[];
      if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' || (check.pragma('foreign_key_check') as unknown[]).length) throw new Error('Backup restaurado não íntegro.');
    } finally { check.close(); }
    await files.copyFile(restored, outputPath, constants.COPYFILE_EXCL);
    await files.chmod(outputPath, 0o600);
    return { path: path.resolve(outputPath) };
  } finally { await files.rm(directory, { recursive: true, force: true }); }
}
