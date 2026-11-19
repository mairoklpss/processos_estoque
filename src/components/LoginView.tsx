import { Lock, LogIn } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api.ts';
import type { AuthSessionResponse } from '../shared/types.ts';

interface LoginViewProps {
  onSuccess: (session: AuthSessionResponse) => void;
  sessionNotice?: string | null;
}

export function LoginView({ onSuccess, sessionNotice }: LoginViewProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.login(username, password);
      onSuccess(res);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Não foi possível conectar ao servidor.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center px-4 py-12">
      <div className="w-full max-w-md mx-auto">
        <div className="mb-8">
          <p className="text-xs font-medium text-slate-500 tracking-wide">
            Brasilink · Operação de Campo
          </p>
          <h1 className="mt-1.5 text-2xl font-bold text-slate-900 tracking-tight">
            Separação de Materiais
          </h1>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">
            Acesso exclusivo para Coordenação e Almoxarifado. Ambiente de demonstração com dados simulados.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-6">
          {sessionNotice && (
            <div
              role="alert"
              className="mb-5 p-3 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-900"
            >
              {sessionNotice}
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="mb-5 p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-800 font-medium"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-username" className="block text-sm font-medium text-slate-800 mb-1.5">
                Usuário
              </label>
              <input
                id="login-username"
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Digite seu usuário"
                className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-blue-700"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-slate-800 mb-1.5">
                Senha
              </label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Digite sua senha"
                className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-blue-700"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 px-4 inline-flex items-center justify-center gap-2 bg-[#0F4C81] hover:bg-[#0C3D68] disabled:opacity-60 text-white text-sm font-semibold rounded-md transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0F4C81]"
            >
              <LogIn className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{loading ? 'Autenticando...' : 'Entrar no sistema'}</span>
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-200 flex items-start gap-2.5 text-xs text-slate-500">
            <Lock className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" aria-hidden="true" />
            <p className="leading-relaxed">
              Não há auto-cadastro público. Novos usuários são criados e administrados exclusivamente pelo perfil Coordenador.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
