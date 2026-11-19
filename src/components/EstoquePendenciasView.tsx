import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ApiError, formatDateTimeSP } from '../lib/api.ts';
import type { PendenciaDTO } from '../shared/types.ts';

interface EstoquePendenciasViewProps {
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export function EstoquePendenciasView({ onNotify }: EstoquePendenciasViewProps) {
  const [pendencias, setPendencias] = useState<PendenciaDTO[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadPendencias() {
    setLoading(true);
    try {
      const data = await api.listarPendenciasEstoque();
      setPendencias(data);
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Erro ao carregar pendências.', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPendencias();
  }, []);

  return (
    <div className="space-y-5">
      <section className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Pendências por falta de estoque ou entrega parcial ({pendencias.length})
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            As diferenças permanecem visíveis mesmo após entrega parcial e não são encerradas automaticamente sem uma ação registrada.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadPendencias()}
          disabled={loading}
          className="h-9 px-4 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer whitespace-nowrap"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>Atualizar</span>
        </button>
      </section>

      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {loading && pendencias.length === 0 ? (
          <div className="p-6 space-y-2.5">
            <div className="h-10 bg-slate-100 rounded animate-pulse" />
            <div className="h-10 bg-slate-100 rounded animate-pulse" />
          </div>
        ) : pendencias.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-semibold text-slate-900">Nenhuma pendência registrada</p>
            <p className="mt-1 text-xs text-slate-600">
              Todas as entregas confirmadas até o momento atenderam integralmente às quantidades solicitadas.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 font-semibold text-slate-700">
                  <th className="py-2.5 px-4">Solicitação</th>
                  <th className="py-2.5 px-3">Técnico</th>
                  <th className="py-2.5 px-3">Produto</th>
                  <th className="py-2.5 px-3 text-right">Solicitada</th>
                  <th className="py-2.5 px-3 text-right">Entregue</th>
                  <th className="py-2.5 px-3 text-right">Diferença pendente</th>
                  <th className="py-2.5 px-3">Motivo</th>
                  <th className="py-2.5 px-3">Data</th>
                  <th className="py-2.5 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {pendencias.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono tabular-nums font-semibold text-slate-900">
                      {p.separacaoCodigo}
                    </td>
                    <td className="py-3 px-3 font-medium text-slate-900">{p.tecnicoNome}</td>
                    <td className="py-3 px-3 text-slate-800">
                      {p.itemNome} <span className="text-slate-500">({p.unidade})</span>
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800">
                      {p.quantidadeSolicitada}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800">
                      {p.quantidadeReferencia}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-red-700">
                      {p.diferenca}
                    </td>
                    <td className="py-3 px-3 text-slate-700">
                      {p.tipo === 'FALTA_ESTOQUE' ? 'Falta de estoque' : 'Entrega parcial'}
                    </td>
                    <td className="py-3 px-3 font-mono tabular-nums text-slate-600">
                      {formatDateTimeSP(p.criadoEm)}
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1 font-semibold text-amber-800">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" aria-hidden="true" />
                        <span>Aberta</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
