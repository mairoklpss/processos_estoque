export type MigrationTarget = 'homologacao' | 'operacao';
export function localMigrationUrl(input: string, target: string = 'homologacao'): string {
  if (!['homologacao', 'operacao'].includes(target)) throw new Error('Destino de migração inválido.');
  const port = target === 'operacao' ? '55433' : '55432';
  const database = target === 'operacao' ? '/brasilink_operacao' : '/brasilink_homologacao';
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('URL de homologação inválida.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      decodeURIComponent(url.pathname) !== database || (url.port || '5432') !== port) {
    throw new Error(`Migração exige banco ${database.slice(1)} local na porta ${port}.`);
  }
  if (url.search) throw new Error('URL de migração não aceita opções adicionais.');
  return url.toString();
}

// Fachada compatível: motor único para evitar regras divergentes de migração.
export async function migrateSqliteCopy(source: string, connectionUrl: string) {
  const { runPostgresCopy } = await import('./migration-engine.ts');
  return runPostgresCopy(source, false, connectionUrl);
}
export async function verifySqliteCopy(source: string, connectionUrl: string) {
  const { runPostgresCopy } = await import('./migration-engine.ts');
  return (await runPostgresCopy(source, true, connectionUrl)).verified;
}
