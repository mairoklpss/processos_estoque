import type {
  AuthSessionResponse,
  DashboardSummaryDTO,
  ItemProduto,
  ParametroTecnicoItem,
  PendenciaDTO,
  PerfilUsuario,
  SeparacaoCoordenadorDTO,
  SeparacaoEstoqueDetalheDTO,
  SeparacaoEstoqueFilaDTO,
  SeparacaoResumoCoordenadorDTO,
  StatusSeparacao,
  Tecnico,
  UsuarioPublico,
} from '../shared/types.ts';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = 'API_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let sessionExpiredHandler: (() => void) | null = null;

export function setOnSessionExpired(cb: () => void): void {
  sessionExpiredHandler = cb;
}

async function request<T>(url: string, options?: RequestInit & { suppressExpiredNotice?: boolean }): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'Brasilink',
    ...((options?.headers as Record<string, string>) ?? {}),
  };

  const res = await fetch(url, {
    credentials: 'include',
    ...options,
    headers,
  });

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : null;

  if (!res.ok) {
    if (
      res.status === 401 &&
      !url.includes('/api/auth/login') &&
      !options?.suppressExpiredNotice
    ) {
      if (sessionExpiredHandler) {
        sessionExpiredHandler();
      }
    }
    throw new ApiError(
      res.status,
      body?.error ?? 'Falha ao comunicar com o servidor.',
      body?.code ?? 'HTTP_ERROR'
    );
  }

  return body as T;
}

export async function requestAllPages<T extends { id: number }>(url: string): Promise<T[]> {
  const [pathname, query = ''] = url.split('?');
  const params = new URLSearchParams(query);
  const limit = 500;
  const maximum = 10000;
  const rows: T[] = [];
  const seen = new Set<number>();
  // One extra page distinguishes exactly 10,000 records from an oversized list.
  for (let offset = 0; offset <= maximum; offset += limit) {
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    const page = await request<T[]>(`${pathname}?${params}`);
    if (!Array.isArray(page) || page.length > limit) {
      throw new ApiError(502, 'Resposta de paginação inválida.', 'INVALID_PAGE');
    }
    for (const row of page) {
      if (!row || !Number.isInteger(row.id) || row.id <= 0) {
        throw new ApiError(502, 'Registro de paginação inválido.', 'INVALID_PAGE');
      }
      if (seen.has(row.id)) {
        throw new ApiError(409, 'A lista mudou durante o carregamento. Atualize novamente.', 'UNSTABLE_PAGINATION');
      }
      seen.add(row.id);
      rows.push(row);
    }
    if (rows.length > maximum) break;
    if (page.length < limit) return rows;
  }
  throw new ApiError(413, 'A lista excede 10 mil registros. Refine filtros ou solicite paginação por demanda.', 'PAGINATION_LIMIT');
}

export function buildItemUpdatePayload(
  data: { codigo: string; nome: string; unidade: string; estoqueAtual: number; limiteMaximo: number },
  expectedEstoqueAtual: number
) {
  const { estoqueAtual, ...metadata } = data;
  return estoqueAtual === expectedEstoqueAtual
    ? metadata
    : { ...metadata, estoqueAtual, expectedEstoqueAtual };
}

export function formatDateTimeSP(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export const api = {
  // Auth
  login: async (username: string, password: string) => {
    const data = await request<AuthSessionResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    return data;
  },
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST', suppressExpiredNotice: true }),
  me: () =>
    request<AuthSessionResponse>('/api/auth/me', {
      suppressExpiredNotice: true,
    }),

  downloadCsv: async (url: string, filename: string) => {
    const res = await fetch(url, {
      credentials: 'include',
      headers: {},
    });
    if (!res.ok) {
      if (res.status === 401 && sessionExpiredHandler) {
        sessionExpiredHandler();
      }
      throw new ApiError(res.status, 'Não foi possível exportar o arquivo CSV.');
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  },

  // Coordenador - Resumo
  getSummary: () => request<DashboardSummaryDTO>('/api/coord/summary'),

  // Coordenador - Técnicos
  listarTecnicos: () => requestAllPages<Tecnico>('/api/coord/tecnicos'),
  criarTecnico: (data: { matricula: string; nome: string; regiao: string }) =>
    request<Tecnico>('/api/coord/tecnicos', { method: 'POST', body: JSON.stringify(data) }),
  atualizarTecnico: (id: number, data: Partial<{ matricula: string; nome: string; regiao: string; ativo: boolean }>) =>
    request<Tecnico>(`/api/coord/tecnicos/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Coordenador - Produtos
  listarItens: () => requestAllPages<ItemProduto>('/api/coord/itens'),
  criarItem: (data: { codigo: string; nome: string; unidade: string; estoqueAtual: number; limiteMaximo: number }) =>
    request<ItemProduto>('/api/coord/itens', { method: 'POST', body: JSON.stringify(data) }),
  atualizarItem: (
    id: number,
    data: Partial<{
      codigo: string;
      nome: string;
      unidade: string;
      estoqueAtual: number;
      expectedEstoqueAtual: number;
      limiteMaximo: number;
      ativo: boolean;
    }>
  ) => request<ItemProduto>(`/api/coord/itens/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Coordenador - Parâmetros por Técnico
  listarParametros: (tecnicoId: number) =>
    request<{
      tecnico: Tecnico;
      competencia: string;
      competenciaLabel: string;
      itens: ParametroTecnicoItem[];
    }>(`/api/coord/parametros/${tecnicoId}`),
  definirMinimoManual: (tecnicoId: number, itemId: number, minimoManual: number | null) =>
    request<{ minimoManual: number | null; alertaMinimoMaiorMaximo: boolean }>(
      `/api/coord/parametros/${tecnicoId}/${itemId}`,
      { method: 'PUT', body: JSON.stringify({ minimoManual }) }
    ),

  // Coordenador - Usuários
  listarUsuarios: () => requestAllPages<UsuarioPublico>('/api/coord/usuarios'),
  criarUsuario: (data: { nome: string; username: string; password: string; perfil: PerfilUsuario }) =>
    request<UsuarioPublico>('/api/coord/usuarios', { method: 'POST', body: JSON.stringify(data) }),
  atualizarUsuario: (id: number, data: Partial<{ nome: string; perfil: PerfilUsuario; ativo: boolean }>) =>
    request<UsuarioPublico>(`/api/coord/usuarios/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  redefinirSenha: (id: number, novaSenha: string) =>
    request<{ ok: boolean }>(`/api/coord/usuarios/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ novaSenha }),
    }),

  // Coordenador - Separações
  calcularSeparacao: (tecnicoId: number, observacoes?: string) =>
    request<SeparacaoCoordenadorDTO>('/api/coord/separacoes/calcular', {
      method: 'POST',
      body: JSON.stringify({ tecnicoId, observacoes }),
    }),
  listarSeparacoes: (filtros?: { tecnicoId?: string; competencia?: string; status?: StatusSeparacao | '' }) => {
    const params = new URLSearchParams();
    if (filtros?.tecnicoId) params.set('tecnicoId', filtros.tecnicoId);
    if (filtros?.competencia) params.set('competencia', filtros.competencia);
    if (filtros?.status) params.set('status', filtros.status);
    const qs = params.toString();
    return requestAllPages<SeparacaoResumoCoordenadorDTO>(`/api/coord/separacoes${qs ? `?${qs}` : ''}`);
  },
  obterSeparacao: (id: number) => request<SeparacaoCoordenadorDTO>(`/api/coord/separacoes/${id}`),
  ajustarItemRascunho: (
    separacaoId: number,
    sepItemId: number,
    quantidadeSolicitada: number,
    justificativa: string
  ) =>
    request<SeparacaoCoordenadorDTO>(`/api/coord/separacoes/${separacaoId}/itens/${sepItemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ quantidadeSolicitada, justificativa }),
    }),
  enviarSolicitacao: (separacaoId: number) =>
    request<SeparacaoCoordenadorDTO>(`/api/coord/separacoes/${separacaoId}/enviar`, { method: 'POST' }),
  listarPendenciasCoord: () => requestAllPages<PendenciaDTO>('/api/coord/pendencias'),

  // Estoque
  listarFilaEstoque: () => requestAllPages<SeparacaoEstoqueFilaDTO>('/api/estoque/fila'),
  obterDetalheEstoque: (id: number) => request<SeparacaoEstoqueDetalheDTO>(`/api/estoque/fila/${id}`),
  confirmarEntregaEstoque: (
    id: number,
    payload: { versaoEstoque: string; itens: Array<{ separacaoItemId: number; quantidadeEntregue: number }> }
  ) =>
    request<SeparacaoEstoqueDetalheDTO>(`/api/estoque/fila/${id}/confirmar`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listarPendenciasEstoque: () => requestAllPages<PendenciaDTO>('/api/estoque/pendencias'),
};
