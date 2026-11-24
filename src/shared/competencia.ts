// Competência corrente no fuso de Brasília (identificador técnico America/Sao_Paulo, ver glossário).
// Formato 'YYYY-MM', o mesmo usado pelo campo "Mês de competência" e pelos filtros do histórico.
export function competenciaAtualBrasilia(agora: Date = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
    }).format(agora);
}

// Exibição da competência como DD/MM/AAAA (primeiro dia do mês), no lugar do nome por extenso.
// Ex.: '2026-11' → '01/11/2026'. Valor inesperado volta como veio (nunca quebra a tela).
export function formatCompetenciaBR(competencia: string): string {
    const m = /^([0-9]{4})-([0-9]{2})$/.exec(competencia ?? '');
    if (!m) return competencia ?? '';
    return `01/${m[2]}/${m[1]}`;
}
