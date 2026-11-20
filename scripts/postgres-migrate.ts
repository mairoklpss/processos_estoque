import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceArgument, runPostgresCopy } from '../server/migration-engine.ts';
export { sourceArgument, openBackup, safeValue, inspectBackup, compareBackup, runPostgresCopy } from '../server/migration-engine.ts';

export function sanitizedFailure(kind: string): void {
  // Never print exception.message, stack, URI, PostgreSQL detail or input paths.
  console.error(`${kind}: verifique backup íntegro, credenciais no ambiente, Docker ativo e destino dedicado/vazio. Nenhum banco existente foi apagado.`);
  process.exitCode = 1;
}
async function main() {
  const result = await runPostgresCopy(sourceArgument(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => sanitizedFailure('MIGRATION_FAILED'));
}
