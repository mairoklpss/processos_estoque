import { sourceArgument, runPostgresCopy, sanitizedFailure } from './postgres-migrate.ts';
async function main() {
  const result = await runPostgresCopy(sourceArgument(process.argv.slice(2)), true);
  console.log(JSON.stringify(result, null, 2));
}
main().catch(() => sanitizedFailure('VERIFICATION_FAILED'));
