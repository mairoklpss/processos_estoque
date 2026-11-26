import type { ComparacaoLimites, MinimoOrigem } from '../src/shared/types.ts';

export const REGRA_VERSAO = 'REPOSICAO_ATE_MAXIMO_V2';
export const DIVISOR_SEMANAL = 3.1428;
export const DIAS_UTEIS_INFORMATIVOS = 22;

export interface CalculoItemInput {
  usoMesAnterior: number;
  minimoManual: number | null;
  limiteMaximo: number;
  saldoTecnico: number;
  estoqueAtual: number;
}

export interface CalculoItemResultado {
  usoMesAnterior: number;
  demandaSemanalExata: number;
  demandaDiariaInformativa: number;
  alvoBase: number;
  minimoManual: number | null;
  minimoEfetivo: number;
  minimoOrigem: MinimoOrigem;
  limiteMaximo: number;
  alvoKit: number;
  saldoTecnico: number;
  estoqueAlmoxarifado: number;
  quantidadeSolicitada: number;
  quantidadeDisponivel: number;
  faltante: number;
  comparacaoLimites: ComparacaoLimites;
  consumoAtipico: boolean;
  semConsumo: boolean;
  semSaldoAlmoxarifado: boolean;
  alertaMinimoMaiorMaximo: boolean;
}

function assertNonNegativeInteger(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} deve ser um número inteiro não negativo.`);
  }
  return value;
}

export function calcularPropostaItem(input: CalculoItemInput): CalculoItemResultado {
  const usoMesAnterior = assertNonNegativeInteger(input.usoMesAnterior, 'usoMesAnterior');
  const limiteMaximo = assertNonNegativeInteger(input.limiteMaximo, 'limiteMaximo');
  const saldoTecnico = assertNonNegativeInteger(input.saldoTecnico, 'saldoTecnico');
  const estoqueAtual = assertNonNegativeInteger(input.estoqueAtual, 'estoqueAtual');

  const minimoManual =
    input.minimoManual !== null && input.minimoManual !== undefined
      ? assertNonNegativeInteger(input.minimoManual, 'minimoManual')
      : null;

  const demandaSemanalRaw = usoMesAnterior / DIVISOR_SEMANAL;
  const demandaSemanalExata = Number(demandaSemanalRaw.toFixed(4));
  const alvoBase = usoMesAnterior === 0 ? 0 : Math.ceil(Number(demandaSemanalRaw.toFixed(8)));

  // Demanda diária é estritamente informativa (22 dias úteis) e nunca entra no cálculo do alvo/separação
  const demandaDiariaInformativa = Number((usoMesAnterior / DIAS_UTEIS_INFORMATIVOS).toFixed(2));

  const minimoOrigem: MinimoOrigem = minimoManual !== null ? 'MANUAL' : 'DERIVADO';
  const minimoEfetivo = minimoManual !== null ? minimoManual : alvoBase;

  // Alvo do mínimo derivado (mantido para auditoria/snapshot): teto do mínimo efetivo pelo máximo.
  // Não define mais a quantidade solicitada — a regra vigente repõe até o máximo (issue 12).
  const alvoKit = Math.min(limiteMaximo, Math.max(alvoBase, minimoEfetivo));

  const semConsumo = usoMesAnterior === 0;
  // Reposição até o máximo: cada técnico solicita 1x por semana e recebe o que falta para
  // chegar ao máximo (saldo 15, máximo 60 => 45). O mínimo segue como alerta, não como alvo.
  const quantidadeSolicitada = semConsumo ? 0 : Math.max(limiteMaximo - saldoTecnico, 0);

  const quantidadeDisponivel = Math.min(quantidadeSolicitada, estoqueAtual);
  const faltante = quantidadeSolicitada - quantidadeDisponivel;

  // Régua (issue 18): compara a demanda SEMANAL ARREDONDADA (o número que a tela mostra)
  // com os limites SEMANAIS (mínimo efetivo e máximo global) — para o alerta bater com a
  // leitura visual (ex.: demanda exibida 10 e mínimo 10 = dentro, não 'abaixo').
  const demandaSemanalExibida = Math.round(demandaSemanalRaw);
  let comparacaoLimites: ComparacaoLimites = 'DENTRO_LIMITES';
  if (demandaSemanalExibida < minimoEfetivo) {
    comparacaoLimites = 'ABAIXO_MINIMO';
  } else if (demandaSemanalExibida > limiteMaximo) {
    comparacaoLimites = 'ACIMA_MAXIMO';
  }

  // Consumo atípico: a demanda semanal exibida supera o máximo global da semana
  const consumoAtipico = demandaSemanalExibida > limiteMaximo;
  const semSaldoAlmoxarifado = quantidadeSolicitada > 0 && estoqueAtual <= 0;
  const alertaMinimoMaiorMaximo = minimoManual !== null && minimoManual > limiteMaximo;

  return {
    usoMesAnterior,
    demandaSemanalExata,
    demandaDiariaInformativa,
    alvoBase,
    minimoManual,
    minimoEfetivo,
    minimoOrigem,
    limiteMaximo,
    alvoKit,
    saldoTecnico,
    estoqueAlmoxarifado: estoqueAtual,
    quantidadeSolicitada,
    quantidadeDisponivel,
    faltante,
    comparacaoLimites,
    consumoAtipico,
    semConsumo,
    semSaldoAlmoxarifado,
    alertaMinimoMaiorMaximo,
  };
}

export function recalcularDisponibilidade(
  quantidadeSolicitada: number,
  estoqueAtual: number
): {
  quantidadeSolicitada: number;
  quantidadeDisponivel: number;
  faltante: number;
  semSaldoAlmoxarifado: boolean;
} {
  const solicitada = assertNonNegativeInteger(quantidadeSolicitada, 'quantidadeSolicitada');
  const estoque = assertNonNegativeInteger(estoqueAtual, 'estoqueAtual');
  const quantidadeDisponivel = Math.min(solicitada, estoque);
  const faltante = solicitada - quantidadeDisponivel;
  const semSaldoAlmoxarifado = solicitada > 0 && estoque <= 0;

  return {
    quantidadeSolicitada: solicitada,
    quantidadeDisponivel,
    faltante,
    semSaldoAlmoxarifado,
  };
}
