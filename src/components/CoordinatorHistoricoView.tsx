import { Eye, Filter, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ApiError, formatDateTimeSP } from '../lib/api.ts';
import type {
  SeparacaoResumoCoordenadorDTO,
  StatusSeparacao,
  Tecnico,
} from '../shared/types.ts';
import { StatusSeparacaoLabel } from './StatusText.tsx';

interface CoordinatorHistoricoViewProps {
  onOpenSeparacao: (id: number) => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export function CoordinatorHistoricoView({ onOpenSeparacao, onNotify }: CoordinatorHistoricoViewProps) {
  const [tecnicos, setTecnicos] = useState<Tecnico[]>([]);
  const [lista, setLista] = useState<SeparacaoResumoCoordenadorDTO[]>([]);
  const [loading, setLoading] = useState(true);

  const [filtroTecnico, setFiltroTecnico] = useState('');
  const [filtroCompetencia, setFiltroCompetencia] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<StatusSeparacao | ''>('');

  async function loadHistorico() {
    setLoading(true);
    try {
      const [tecs, seps] = await Promise.all([
        api.listarTecnicos(),
        api.listarSeparacoes({
          tecnicoId: filtroTecnico || undefined,
          competencia: filtroCompetencia || undefined,
          status: filtroStatus || undefined,
        }),
      ]);
      setTecnicos(tecs);
      setLista(seps);
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Erro ao carregar histórico.', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadHistorico();
  }, [filtroTecnico, filtroCompetencia, filtroStatus]);

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <section className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-full sm:w-56">
            <label htmlFor="hist-tecnico" className="block text-xs font-medium text-slate-700 mb-1.5">
              Técnico
            </label>
            <select
              id="hist-tecnico"
              value={filtroTecnico}
              onChange={(e) => setFiltroTecnico(e.target.value)}
              className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-md"
            >
              <option value="">Todos os técnicos</option>
              {tecnicos.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome} ({t.matricula})
                </option>
              ))}
            </select>
          </div>

          <div className="w-full sm:w-44">
            <label htmlFor="hist-competencia" className="block text-xs font-medium text-slate-700 mb-1.5">
              Mês de competência
            </label>
            <input
              id="hist-competencia"
              type="month"
              value={filtroCompetencia}
              onChange={(e) => setFiltroCompetencia(e.target.value)}
              className="w-full h-9 px-3 text-sm font-mono bg-white border border-slate-300 rounded-md"
            />
          </div>

          <div className="w-full sm:w-48">
            <label htmlFor="hist-status" className="block text-xs font-medium text-slate-700 mb-1.5">
              Status
            </label>
            <select
              id="hist-status"
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value as StatusSeparacao | '')}
              className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-md"
            >
              <option value="">Todos os status</option>
              <option value="RASCUNHO">Rascunho</option>
              <option value="CALCULADA">Calculada (na fila)</option>
              <option value="SEPARADA">Separada (entregue)</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            {(filtroTecnico || filtroCompetencia || filtroStatus) && (
              <button
                type="button"
                onClick={() => {
                  setFiltroTecnico('');
                  setFiltroCompetencia('');
                  setFiltroStatus('');
                }}
                className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
              >
                <Filter className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Limpar filtros</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => void loadHistorico()}
              className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Atualizar</span>
            </button>
          </div>
        </div>
      </section>

      {/* Tabela de histórico */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">
            Histórico de separações e snapshots ({lista.length})
          </h2>
          <span className="text-xs text-slate-500">
            Valores preservados conforme a regra vigente no cálculo
          </span>
        </div>

        {loading ? (
          <div className="p-6 space-y-2.5">
            <div className="h-9 bg-slate-100 rounded animate-pulse" />
            <div className="h-9 bg-slate-100 rounded animate-pulse" />
            <div className="h-9 bg-slate-100 rounded animate-pulse" />
          </div>
        ) : lista.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-600">
            Nenhuma separação encontrada para os filtros selecionados.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 font-semibold text-slate-700">
                  <th className="py-2.5 px-4 whitespace-nowrap">Código</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Técnico</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Competência / Regra</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Status</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Solicitado</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Disponível</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Entregue</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Auditoria (Cálculo · Envio · Confirmação)</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {lista.map((sep) => (
                  <tr key={sep.id} className="hover:bg-slate-50/80 align-top">
                    <td className="py-3 px-4 font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                      {sep.codigo}
                    </td>
                    <td className="py-3 px-3 font-medium text-slate-900 whitespace-nowrap">
                      {sep.tecnicoNome}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <div className="text-slate-900 font-medium">{sep.competenciaLabel}</div>
                      <div className="text-[11px] font-mono text-slate-500">{sep.regraVersao}</div>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <StatusSeparacaoLabel status={sep.status} />
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                      {sep.totalSolicitado}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                      {sep.totalDisponivel}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-emerald-800 whitespace-nowrap">
                      {sep.status === 'SEPARADA' ? sep.totalEntregue : '—'}
                    </td>
                    <td className="py-3 px-4 text-[11px] text-slate-600 space-y-0.5 min-w-[260px]">
                      <div>
                        <strong>Cálculo:</strong> {sep.calculadoPorNome} ·{' '}
                        <span className="font-mono tabular-nums">{formatDateTimeSP(sep.calculadoEm)}</span>
                      </div>
                      <div>
                        <strong>Envio:</strong>{' '}
                        {sep.enviadoEm ? (
                          <>
                            {sep.enviadoPorNome} ·{' '}
                            <span className="font-mono tabular-nums">{formatDateTimeSP(sep.enviadoEm)}</span>
                          </>
                        ) : (
                          'Ainda em rascunho'
                        )}
                      </div>
                      <div>
                        <strong>Confirmação:</strong>{' '}
                        {sep.confirmadoEm ? (
                          <>
                            {sep.confirmadoPorNome} ·{' '}
                            <span className="font-mono tabular-nums">{formatDateTimeSP(sep.confirmadoEm)}</span>
                          </>
                        ) : (
                          'Aguardando estoque'
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onOpenSeparacao(sep.id)}
                        className="h-8 px-3 inline-flex items-center gap-1.5 text-xs font-medium text-[#0F4C81] bg-white border border-slate-300 hover:bg-slate-50 rounded cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{sep.status === 'RASCUNHO' ? 'Retomar' : 'Detalhes'}</span>
                      </button>
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
