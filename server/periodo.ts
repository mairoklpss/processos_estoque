const SAO_PAULO_TZ = 'America/Sao_Paulo';

const MESES_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

export interface CompetenciaFechada {
  competencia: string; // YYYY-MM
  ano: number;
  mes: number; // 1..12
  label: string; // Ex: Setembro/2026
  referenciaSp: string; // YYYY-MM-DD HH:mm (America/Sao_Paulo)
}

function getSaoPauloParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: SAO_PAULO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

export function formatCompetenciaLabel(ano: number, mes: number): string {
  const nomeMes = MESES_PT[mes - 1] ?? String(mes).padStart(2, '0');
  return `${nomeMes}/${ano}`;
}

export interface SemanaCompetencia {
  competencia: string; // 'YYYY-MM-DD' (domingo que inicia a semana)
  label: string; // Ex: '22 a 28 de Novembro' | '29 de Novembro a 5 de Dezembro'
}

// Issue 17: identificação semanal da separação (domingo a sábado, fuso de Brasília).
// Apenas a TAG da separação — o consumo usado no cálculo continua do mês fechado anterior.
export function getSemanaAtual(now: Date = new Date()): SemanaCompetencia {
  const sp = getSaoPauloParts(now);
  const hoje = new Date(Date.UTC(sp.year, sp.month - 1, sp.day));
  const diasAteDomingo = hoje.getUTCDay(); // 0 = domingo
  const inicio = new Date(hoje);
  inicio.setUTCDate(inicio.getUTCDate() - diasAteDomingo);
  const fim = new Date(inicio);
  fim.setUTCDate(fim.getUTCDate() + 6);

  const fmt = (d: Date): { dia: number; mes: number; ano: number } => ({
    dia: d.getUTCDate(),
    mes: d.getUTCMonth() + 1,
    ano: d.getUTCFullYear(),
  });
  const i = fmt(inicio);
  const f = fmt(fim);
  const competencia = `${i.ano}-${String(i.mes).padStart(2, '0')}-${String(i.dia).padStart(2, '0')}`;

  const mesmoMes = i.mes === f.mes && i.ano === f.ano;
  const label = mesmoMes
    ? `${i.dia} a ${f.dia} de ${MESES_PT[f.mes - 1]}`
    : `${i.dia} de ${MESES_PT[i.mes - 1]} a ${f.dia} de ${MESES_PT[f.mes - 1]}`;

  return { competencia, label };
}

export function getClosedPreviousMonth(now: Date = new Date()): CompetenciaFechada {
  const sp = getSaoPauloParts(now);

  let anoFechado = sp.year;
  let mesFechado = sp.month - 1;

  if (mesFechado === 0) {
    mesFechado = 12;
    anoFechado -= 1;
  }

  const competencia = `${anoFechado}-${String(mesFechado).padStart(2, '0')}`;
  const referenciaSp = `${sp.year}-${String(sp.month).padStart(2, '0')}-${String(sp.day).padStart(2, '0')} ${String(sp.hour).padStart(2, '0')}:${String(sp.minute).padStart(2, '0')}`;

  return {
    competencia,
    ano: anoFechado,
    mes: mesFechado,
    label: formatCompetenciaLabel(anoFechado, mesFechado),
    referenciaSp,
  };
}

export function shiftCompetencia(competencia: string, deltaMonths: number): CompetenciaFechada {
  const [anoStr, mesStr] = competencia.split('-');
  const baseTotal = Number(anoStr) * 12 + (Number(mesStr) - 1) + deltaMonths;
  const ano = Math.floor(baseTotal / 12);
  const mes = (baseTotal % 12) + 1;
  return {
    competencia: `${ano}-${String(mes).padStart(2, '0')}`,
    ano,
    mes,
    label: formatCompetenciaLabel(ano, mes),
    referenciaSp: '',
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}
