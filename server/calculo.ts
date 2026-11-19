import type { ComparacaoLimites, MinimoOrigem } from '../src/shared/types.ts';

export const REGRA_VERSAO = 'SEMANAL_PROVISORIA_V1';
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

  const alvoKit = Math.min(limiteMaximo, Math.max(alvoBase, minimoEfetivo));

  const semConsumo = usoMesAnterior === 0;
  const quantidadeSolicitada = semConsumo ? 0 : Math.max(alvoKit - saldoTecnico, 0);

  const quantidadeDisponivel = Math.min(quantidadeSolicitada, estoqueAtual);
  const faltante = quantidadeSolicitada - quantidadeDisponivel;

  let comparacaoLimites: ComparacaoLimites = 'DENTRO_LIMITES';
  if (usoMesAnterior < minimoEfetivo) {
    comparacaoLimites = 'ABAIXO_MINIMO';
  } else if (usoMesAnterior > limiteMaximo) {
    comparacaoLimites = 'ACIMA_MAXIMO';
  }

  // Consumo atípico: somente quando o consumo ultrapassar o máximo global do produto
  const consumoAtipico = usoMesAnterior > limiteMaximo;
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
