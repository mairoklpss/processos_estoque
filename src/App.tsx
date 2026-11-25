import {
  AlertTriangle,
  Boxes,
  Calculator,
  History,
  LogOut,
  Menu,
  Settings2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { CoordinatorCadastrosView } from './components/CoordinatorCadastrosView.tsx';
import { CoordinatorHistoricoView } from './components/CoordinatorHistoricoView.tsx';
import { CoordinatorSepararView } from './components/CoordinatorSepararView.tsx';
import { EstoqueFilaView } from './components/EstoqueFilaView.tsx';
import { EstoqueHistoricoView } from './components/EstoqueHistoricoView.tsx';
import { EstoquePendenciasView } from './components/EstoquePendenciasView.tsx';
import { LoginView } from './components/LoginView.tsx';
import { api, setOnSessionExpired } from './lib/api.ts';
import type { AuthSessionResponse, DashboardSummaryDTO } from './shared/types.ts';

type CoordNav = 'separar' | 'historico' | 'cadastros';
type EstoqueNav = 'fila' | 'pendencias' | 'historico';

export default function App() {
  const [session, setSession] = useState<AuthSessionResponse | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);

  const [coordNav, setCoordNav] = useState<CoordNav>('separar');
  const [estoqueNav, setEstoqueNav] = useState<EstoqueNav>('fila');
  const [activeSeparacaoId, setActiveSeparacaoId] = useState<number | null>(null);
  const [summary, setSummary] = useState<DashboardSummaryDTO | null>(null);

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const notify = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setToast({ text, type });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const refreshSummary = useCallback(async () => {
    try {
      const s = await api.getSummary();
      setSummary(s);
    } catch {
      // Silencioso se perfil não for Coordenador
    }
  }, []);

  useEffect(() => {
    setOnSessionExpired(() => {
      setSession(null);
      setSummary(null);
      setSessionNotice('Sua sessão expirou. Faça login novamente para continuar.');
    });

    async function checkSession() {
      try {
        const me = await api.me();
        setSession(me);
        if (me.user.perfil === 'COORDENADOR') {
          const s = await api.getSummary();
          setSummary(s);
        }
      } catch {
        setSession(null);
      } finally {
        setCheckingAuth(false);
      }
    }
    void checkSession();
  }, []);

  async function handleLoginSuccess(res: AuthSessionResponse) {
    setSession(res);
    setSessionNotice(null);
    setActiveSeparacaoId(null);
    if (res.user.perfil === 'COORDENADOR') {
      setCoordNav('separar');
      await refreshSummary();
    } else {
      setEstoqueNav('fila');
    }
  }

  async function handleLogout() {
    try {
      await api.logout();
    } finally {
      setSession(null);
      setSummary(null);
      setActiveSeparacaoId(null);
      setMobileMenuOpen(false);
    }
  }

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-600">
        Verificando sessão...
      </div>
    );
  }

  if (!session) {
    return <LoginView onSuccess={handleLoginSuccess} sessionNotice={sessionNotice} />;
  }

  const isCoord = session.user.perfil === 'COORDENADOR';

  const pageTitle = isCoord
    ? coordNav === 'separar'
      ? 'Separar Materiais'
      : coordNav === 'historico'
        ? 'Histórico e Snapshots'
        : 'Cadastros e Parâmetros'
    : estoqueNav === 'fila'
      ? 'Fila de Separação'
      : 'Pendências de Entrega';

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar Desktop */}
      <aside className="no-print hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-white border-r border-slate-200">
        <div className="h-16 px-5 flex items-center border-b border-slate-200">
          <span className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
            Brasilink · Materiais
          </span>
        </div>

        <nav aria-label="Navegação principal" className="flex-1 p-3 space-y-1">
          {isCoord ? (
            <>
              <button
                type="button"
                onClick={() => setCoordNav('separar')}
                className={`w-full h-10 px-3 flex items-center gap-2.5 text-sm font-medium rounded-md transition-colors cursor-pointer ${
                  coordNav === 'separar'
                    ? 'bg-blue-50 text-[#0F4C81] font-semibold'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Calculator className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Separar</span>
              </button>
              <button
                type="button"
                onClick={() => setCoordNav('historico')}
                className={`w-full h-10 px-3 flex items-center gap-2.5 text-sm font-medium rounded-md transition-colors cursor-pointer ${
                  coordNav === 'historico'
                    ? 'bg-blue-50 text-[#0F4C81] font-semibold'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <History className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Histórico</span>
              </button>
              <button
                type="button"
                onClick={() => setCoordNav('cadastros')}
                className={`w-full h-10 px-3 flex items-center gap-2.5 text-sm font-medium rounded-md transition-colors cursor-pointer ${
                  coordNav === 'cadastros'
                    ? 'bg-blue-50 text-[#0F4C81] font-semibold'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Settings2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Cadastros</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setEstoqueNav('fila')}
                className={`w-full h-10 px-3 flex items-center gap-2.5 text-sm font-medium rounded-md transition-colors cursor-pointer ${
                  estoqueNav === 'fila'
                    ? 'bg-blue-50 text-[#0F4C81] font-semibold'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Boxes className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Fila do Estoque</span>
              </button>
              <button
                type="button"
                onClick={() => setEstoqueNav('pendencias')}
                className={`w-full h-10 px-3 flex items-center gap-2.5 text-sm font-medium rounded-md transition-colors cursor-pointer ${
                  estoqueNav === 'pendencias'
                    ? 'bg-blue-50 text-[#0F4C81] font-semibold'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Pendências</span>
              </button>
              <button
                type="button"
                onClick={() => setEstoqueNav('historico')}
                className={`w-full h-10 px-3 flex items-center gap-2.5 text-sm font-medium rounded-md transition-colors cursor-pointer ${
                  estoqueNav === 'historico'
                    ? 'bg-blue-50 text-[#0F4C81] font-semibold'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <History className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Histórico</span>
              </button>
            </>
          )}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-3">
          <div className="text-xs">
            <p className="font-semibold text-slate-900 truncate">{session.user.nome}</p>
            <p className="mt-0.5 text-slate-500">
              {session.user.username} · {session.user.perfil}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="w-full h-9 px-3 inline-flex items-center justify-center gap-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Sair</span>
          </button>
        </div>
      </aside>

      {/* Drawer Mobile / Tablet */}
      {mobileMenuOpen && (
        <div className="no-print fixed inset-0 z-50 md:hidden bg-slate-900/40 flex">
          <div className="w-64 bg-white h-full flex flex-col border-r border-slate-200">
            <div className="h-16 px-4 flex items-center justify-between border-b border-slate-200">
              <span className="text-base font-bold text-slate-900">Brasilink · Materiais</span>
              <button
                type="button"
                aria-label="Fechar menu"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {isCoord ? (
                <>
                  {(
                    [
                      ['separar', 'Separar'],
                      ['historico', 'Histórico'],
                      ['cadastros', 'Cadastros'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setCoordNav(key);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full h-10 px-3 text-left text-sm font-medium rounded-md ${
                        coordNav === key ? 'bg-blue-50 text-[#0F4C81] font-semibold' : 'text-slate-700'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </>
              ) : (
                <>
                  {(
                    [
                      ['fila', 'Fila do Estoque'],
                      ['pendencias', 'Pendências'],
                      ['historico', 'Histórico'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setEstoqueNav(key);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full h-10 px-3 text-left text-sm font-medium rounded-md ${
                        estoqueNav === key ? 'bg-blue-50 text-[#0F4C81] font-semibold' : 'text-slate-700'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </>
              )}
            </nav>
            <div className="p-4 border-t border-slate-200">
              <p className="text-xs font-semibold text-slate-900">{session.user.nome}</p>
              <p className="text-xs text-slate-500 mb-3">{session.user.perfil}</p>
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="w-full h-9 text-xs font-medium text-slate-700 border border-slate-300 rounded-md"
              >
                Sair
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Conteúdo Principal */}
      <div className="flex-1 md:pl-64 flex flex-col min-w-0">
        <header className="no-print h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              aria-label="Abrir menu"
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold text-slate-900 truncate">{pageTitle}</h1>
            </div>
          </div>

          <div className="text-xs text-slate-600 text-right hidden sm:block shrink-0">
            {session.ambiente}
          </div>
        </header>

        {/* Faixa visível de ambiente de demonstração no mobile */}
        <div className="no-print sm:hidden px-4 py-2 bg-slate-100 border-b border-slate-200 text-[11px] text-slate-600">
          {session.ambiente}
        </div>

        {/* Toast de feedback */}
        {toast && (
          <div
            role="status"
            className={`no-print mx-4 sm:mx-6 mt-4 px-4 py-3 rounded-md border text-xs font-medium flex items-center justify-between gap-3 ${
              toast.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-900'
                : 'bg-emerald-50 border-emerald-200 text-emerald-900'
            }`}
          >
            <span>{toast.text}</span>
            <button
              type="button"
              aria-label="Dispensar aviso"
              onClick={() => setToast(null)}
              className="p-0.5 opacity-70 hover:opacity-100 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {isCoord && coordNav === 'separar' && (
            <CoordinatorSepararView
              activeSeparacaoId={activeSeparacaoId}
              onSelectSeparacaoId={setActiveSeparacaoId}
              onNotify={notify}
              onRefreshSummary={refreshSummary}
              summary={summary}
            />
          )}

          {isCoord && coordNav === 'historico' && (
            <CoordinatorHistoricoView
              onOpenSeparacao={(id) => {
                setActiveSeparacaoId(id);
                setCoordNav('separar');
              }}
              onNotify={notify}
            />
          )}

          {isCoord && coordNav === 'cadastros' && (
            <CoordinatorCadastrosView onNotify={notify} onRefreshSummary={refreshSummary} />
          )}

          {!isCoord && estoqueNav === 'fila' && (
            <EstoqueFilaView
              onNotify={notify}
              onEntregaConfirmada={() => {
                // Mantém atualização consistente
              }}
            />
          )}

          {!isCoord && estoqueNav === 'pendencias' && (
            <EstoquePendenciasView onNotify={notify} />
          )}

          {!isCoord && estoqueNav === 'historico' && (
            <EstoqueHistoricoView onNotify={notify} />
          )}
        </main>
      </div>
    </div>
  );
}
