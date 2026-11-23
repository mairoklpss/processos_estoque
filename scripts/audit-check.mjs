// Gate de npm audit para CI: reprova em high/critical, aceita exceção só com motivo,
// e avisa quando uma exceção pode ser removida. Uso: node scripts/audit-check.mjs
import { execFileSync } from 'node:child_process';

// shell: true resolve o npm.cmd do Windows e o npm do Linux; audit é leitura, sem risco de injeção.
const json = JSON.parse(
  execFileSync('npm audit --json', { encoding: 'utf8', shell: true, maxBuffer: 20_000_000 }),
);

// Exceções ativas. Cada isenção EXIGE motivo. Formato:
// 'https://github.com/advisories/GH...': { motivo: 'por que ainda não corrigimos' }
const EXCECOES = {};

const severidades = ['high', 'critical'];

const vulnerabilidades = Object.values(json.vulnerabilities ?? {});
const bloqueantes = vulnerabilidades.filter(
  (v) => severidades.includes(v.severity) && !EXCECOES[v.url ?? v.name],
);

const usandoExcecao = vulnerabilidades.filter((v) => EXCECOES[v.url ?? v.name]);
for (const [url, ex] of Object.entries(EXCECOES)) {
  if (!vulnerabilidades.some((v) => (v.url ?? v.name) === url)) {
    console.warn(`AVISO: exceção "${url}" não aparece mais no audit; considere removê-la. Motivo original: ${ex.motivo}`);
  }
}

if (bloqueantes.length > 0) {
  console.error('GATE DE AUDIT REPROVADO. Vulnerabilidades high/critical sem exceção justificada:');
  for (const v of bloqueantes) {
    console.error(`- [${v.severity}] ${v.name} (${v.url ?? 'sem URL'}): ${v.title ?? 'sem título'}`);
  }
  process.exit(1);
}

console.log(
  `audit-check: aprovado. ${vulnerabilidades.length} vulnerabilidade(s) conhecida(s), ` +
    `${bloqueantes.length} bloqueante(s), ${usandoExcecao.length} em exceção justificada.`,
);
