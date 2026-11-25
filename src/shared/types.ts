export type PerfilUsuario = 'COORDENADOR' | 'ESTOQUE';

export type StatusSeparacao = 'RASCUNHO' | 'CALCULADA' | 'SEPARADA';

export type ComparacaoLimites = 'ABAIXO_MINIMO' | 'DENTRO_LIMITES' | 'ACIMA_MAXIMO';

export type MinimoOrigem = 'MANUAL' | 'DERIVADO';

export type TipoPendencia = 'FALTA_ESTOQUE' | 'ENTREGA_PARCIAL';

export interface UsuarioPublico {
  id: number;
  nome: string;
  username: string;
  perfil: PerfilUsuario;
  ativo: boolean;
  criadoEm: string;
  atualizadoEm: string;
}

export interface AuthSessionResponse {
  user: Pick<UsuarioPublico, 'id' | 'nome' | 'username' | 'perfil'>;
  ambiente: string;
}

export interface Tecnico {
  id: number;
  matricula: string;
  nome: string;
  filial: string;
  ativo: boolean;
  criadoEm: string;
  atualizadoEm: string;
}

export interface ItemProduto {
  id: number;
  codigo: string;
  nome: string;
  unidade: string;
  estoqueAtual: number;
  limiteMaximo: number;
  ativo: boolean;
  criadoEm: string;
  atualizadoEm: string;
}

export interface ParametroTecnicoItem {
  itemId: number;
  codigo: string;
  nome: string;
  unidade: string;
  ativo: boolean;
  limiteMaximo: number;
  estoqueAtual: number;
  usoMesAnterior: number;
  saldoTecnico: number;
  alvoBase: number;
  minimoManual: number | null;
  minimoEfetivo: number;
  minimoOrigem: MinimoOrigem;
  alertaMinimoMaiorMaximo: boolean;
}

export interface SeparacaoItemCoordenadorDTO {
  id: number;
  separacaoId: number;
  itemId: number;
  itemCodigo: string;
  itemNome: string;
  unidade: string;
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
  quantidadeCalculadaOriginal: number;
  quantidadeSolicitada: number;
  quantidadeDisponivel: number;
  faltante: number;
  ajusteJustificativa: string | null;
  ajustadoPorNome: string | null;
  ajustadoEm: string | null;
  comparacaoLimites: ComparacaoLimites;
  consumoAtipico: boolean;
  semConsumo: boolean;
  semSaldoAlmoxarifado: boolean;
  alertaMinimoMaiorMaximo: boolean;
  quantidadeEntregue: number | null;
}

export interface SeparacaoCoordenadorDTO {
  id: number;
  codigo: string;
  tecnicoId: number;
  tecnicoNome: string;
  competencia: string;
  competenciaLabel: string;
  regraVersao: string;
  status: StatusSeparacao;
  calculadoPorNome: string;
  calculadoEm: string;
  enviadoPorNome: string | null;
  enviadoEm: string | null;
  confirmadoPorNome: string | null;
  confirmadoEm: string | null;
  itens: SeparacaoItemCoordenadorDTO[];
}

export interface SeparacaoResumoCoordenadorDTO {
  id: number;
  codigo: string;
  tecnicoId: number;
  tecnicoNome: string;
  competencia: string;
  competenciaLabel: string;
  regraVersao: string;
  status: StatusSeparacao;
  calculadoPorNome: string;
  calculadoEm: string;
  enviadoPorNome: string | null;
  enviadoEm: string | null;
  confirmadoPorNome: string | null;
  confirmadoEm: string | null;
  totalItens: number;
  totalSolicitado: number;
  totalDisponivel: number;
  totalFaltante: number;
  totalEntregue: number;
}

// DTOs estritos para ESTOQUE: sem médias, limites, consumo, saldo interno do técnico ou alertas internos
export interface SeparacaoEstoqueFilaDTO {
  id: number;
  codigo: string;
  tecnicoId: number;
  tecnicoNome: string;
  status: 'CALCULADA';
  enviadoEm: string;
  totalItens: number;
  totalUnidadesASeparar: number;
}

export interface SeparacaoItemEstoqueDTO {
  id: number;
  itemId: number;
  codigo: string;
  nome: string;
  unidade: string;
  quantidadeSolicitada: number;
  quantidadeASeparar: number;
  estoqueDisponivel: number;
  quantidadeEntregue: number | null;
}

export interface SeparacaoEstoqueDetalheDTO {
  id: number;
  codigo: string;
  tecnicoNome: string;
  status: 'CALCULADA' | 'SEPARADA';
  enviadoEm: string;
  confirmadoEm: string | null;
  confirmadoPorNome: string | null;
  versaoEstoque: string;
  itens: SeparacaoItemEstoqueDTO[];
}

export interface PendenciaDTO {
  id: number;
  separacaoId: number;
  separacaoCodigo: string;
  tecnicoId: number;
  tecnicoNome: string;
  itemId: number;
  itemNome: string;
  unidade: string;
  quantidadeSolicitada: number;
  quantidadeReferencia: number;
  diferenca: number;
  tipo: TipoPendencia;
  status: 'ABERTA';
  criadoEm: string;
  atualizadoEm: string;
}

export interface DashboardSummaryDTO {
  competencia: string;
  competenciaLabel: string;
  tecnicosAtivos: number;
  itensAtivos: number;
  rascunhosAbertos: number;
  naFilaEstoque: number;
  pendenciasAbertas: number;
  ambiente: string;
}
