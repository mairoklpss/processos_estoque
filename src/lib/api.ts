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

const SESSION_TOKEN_KEY = 'brasilink_session_token';

function getStoredToken(): string | null {
  try {
    return window.sessionStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

function setStoredToken(token: string | null): void {
  try {
    if (token) {
      window.sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    } else {
      window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
    }
  } catch {
    // Ignorar se sessionStorage estiver indisponível
  }
}

let sessionExpiredHandler: (() => void) | null = null;

export function setOnSessionExpired(cb: () => void): void {
  sessionExpiredHandler = cb;
}

async function request<T>(url: string, options?: RequestInit & { suppressExpiredNotice?: boolean }): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options?.headers as Record<string, string>) ?? {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

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
      setStoredToken(null);
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
    if (data.token) {
      setStoredToken(data.token);
    }
    return data;
  },
  logout: async () => {
    try {
      return await request<{ ok: boolean }>('/api/auth/logout', {
        method: 'POST',
        suppressExpiredNotice: true,
      });
    } finally {
      setStoredToken(null);
    }
  },
  me: () =>
    request<AuthSessionResponse>('/api/auth/me', {
      suppressExpiredNotice: true,
    }),

  downloadCsv: async (url: string, filename: string) => {
    const token = getStoredToken();
    const res = await fetch(url, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      if (res.status === 401 && sessionExpiredHandler) {
        setStoredToken(null);
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
  listarTecnicos: () => request<Tecnico[]>('/api/coord/tecnicos'),
  criarTecnico: (data: { matricula: string; nome: string; regiao: string }) =>
    request<Tecnico>('/api/coord/tecnicos', { method: 'POST', body: JSON.stringify(data) }),
  atualizarTecnico: (id: number, data: Partial<{ matricula: string; nome: string; regiao: string; ativo: boolean }>) =>
    request<Tecnico>(`/api/coord/tecnicos/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Coordenador - Produtos
  listarItens: () => request<ItemProduto[]>('/api/coord/itens'),
  criarItem: (data: { codigo: string; nome: string; unidade: string; estoqueAtual: number; limiteMaximo: number }) =>
    request<ItemProduto>('/api/coord/itens', { method: 'POST', body: JSON.stringify(data) }),
  atualizarItem: (
    id: number,
    data: Partial<{
      codigo: string;
      nome: string;
      unidade: string;
      estoqueAtual: number;
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
  listarUsuarios: () => request<UsuarioPublico[]>('/api/coord/usuarios'),
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
    return request<SeparacaoResumoCoordenadorDTO[]>(`/api/coord/separacoes${qs ? `?${qs}` : ''}`);
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
  listarPendenciasCoord: () => request<PendenciaDTO[]>('/api/coord/pendencias'),

  // Estoque
  listarFilaEstoque: () => request<SeparacaoEstoqueFilaDTO[]>('/api/estoque/fila'),
  obterDetalheEstoque: (id: number) => request<SeparacaoEstoqueDetalheDTO>(`/api/estoque/fila/${id}`),
  confirmarEntregaEstoque: (
    id: number,
    payload: { versaoEstoque: string; itens: Array<{ separacaoItemId: number; quantidadeEntregue: number }> }
  ) =>
    request<SeparacaoEstoqueDetalheDTO>(`/api/estoque/fila/${id}/confirmar`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listarPendenciasEstoque: () => request<PendenciaDTO[]>('/api/estoque/pendencias'),
};
