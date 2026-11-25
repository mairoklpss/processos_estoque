import { Calendar, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { api, ApiError, formatDateTimeSP } from '../lib/api.ts';
import { competenciaAtualBrasilia, formatCompetenciaBR } from '../shared/competencia.ts';
import type {
  SeparacaoEstoqueDetalheDTO,
  SeparacaoResumoCoordenadorDTO,
  StatusSeparacao,
} from '../shared/types.ts';
import { StatusSeparacaoLabel } from './StatusText.tsx';

// Issue 15: histórico de separações para o perfil ESTOQUE — mesma interface do histórico do
// Coordenador, mas somente leitura (detalhe expansível; rascunhos nunca aparecem).

interface EstoqueHistoricoViewProps {
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export function EstoqueHistoricoView({ onNotify }: EstoqueHistoricoViewProps) {
  const [lista, setLista] = useState<SeparacaoResumoCoordenadorDTO[]>([]);
  const [tecnicosOpcoes, setTecnicosOpcoes] = useState<Array<{ id: number; nome: string }>>([]);
  const [loading, setLoading] = useState(true);

  const [filtroTecnico, setFiltroTecnico] = useState('');
  const [filtroCompetencia, setFiltroCompetencia] = useState(competenciaAtualBrasilia);
  const [filtroStatus, setFiltroStatus] = useState<StatusSeparacao | ''>('');

  const [expandidaId, setExpandidaId] = useState<number | null>(null);
  const [detalhe, setDetalhe] = useState<SeparacaoEstoqueDetalheDTO | null>(null);
  const [loadingDetalhe, setLoadingDetalhe] = useState(false);

  async function loadHistorico() {
    setLoading(true);
    try {
      const [todos, filtrada] = await Promise.all([
        api.listarSeparacoesEstoque(),
        api.listarSeparacoesEstoque({
          tecnicoId: filtroTecnico || undefined,
          competencia: filtroCompetencia || undefined,
          status: filtroStatus || undefined,
        }),
      ]);
      // Opções de técnico derivadas da listagem sem filtros (rascunhos nunca voltam da rota do estoque)
      const mapa = new Map<number, string>();
      for (const sep of todos) mapa.set(sep.tecnicoId, sep.tecnicoNome);
      setTecnicosOpcoes([...mapa.entries()].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome)));
      setLista(filtrada);
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Erro ao carregar histórico.', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadHistorico();
  }, [filtroTecnico, filtroCompetencia, filtroStatus]);

  async function alternarDetalhe(id: number) {
    if (expandidaId === id) {
      setExpandidaId(null);
      setDetalhe(null);
      return;
    }
    setExpandidaId(id);
    setDetalhe(null);
    setLoadingDetalhe(true);
    try {
      setDetalhe(await api.obterDetalheEstoque(id));
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Erro ao abrir detalhe.', 'error');
      setExpandidaId(null);
    } finally {
      setLoadingDetalhe(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <section className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-full sm:w-56">
            <label htmlFor="ehist-tecnico" className="block text-xs font-medium text-slate-700 mb-1.5">
              Técnico
            </label>
            <select
              id="ehist-tecnico"
              value={filtroTecnico}
              onChange={(e) => setFiltroTecnico(e.target.value)}
              className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-md"
            >
              <option value="">Todos os técnicos</option>
              {tecnicosOpcoes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </select>
          </div>

          <div className="w-full sm:w-44">
            <label htmlFor="ehist-competencia" className="block text-xs font-medium text-slate-700 mb-1.5">
              Mês de competência
            </label>
            <div className="relative focus-within:ring-2 focus-within:ring-[#0F4C81]/30 rounded-md">
              <div
                aria-hidden="true"
                className="w-full h-9 px-3 text-sm font-mono bg-white border border-slate-300 rounded-md flex items-center justify-between pointer-events-none"
              >
                <span className="tabular-nums">{formatCompetenciaBR(filtroCompetencia) || 'MM/AAAA'}</span>
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
              </div>
              <input
                id="ehist-competencia"
                type="month"
                aria-label="Mês de competência"
                value={filtroCompetencia}
                onChange={(e) => setFiltroCompetencia(e.target.value)}
                className="absolute inset-0 w-full h-9 px-3 text-sm font-mono bg-transparent border border-slate-300 rounded-md opacity-0 cursor-pointer"
              />
            </div>
          </div>

          <div className="w-full sm:w-48">
            <label htmlFor="ehist-status" className="block text-xs font-medium text-slate-700 mb-1.5">
              Status
            </label>
            <select
              id="ehist-status"
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value as StatusSeparacao | '')}
              className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-md"
            >
              <option value="">Todos os status</option>
              <option value="CALCULADA">Calculada (na fila)</option>
              <option value="SEPARADA">Separada (entregue)</option>
            </select>
          </div>

          <div className="flex items-center gap-2 sm:ml-auto">
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
            Histórico de separações ({lista.length})
          </h2>
          <span className="text-xs text-slate-500">Somente consulta — ajustes são feitos pelo Coordenador</span>
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
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Entregue</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Detalhes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {lista.map((sep) => (
                  <Fragment key={sep.id}>
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
                      <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-emerald-800 whitespace-nowrap">
                        {sep.status === 'SEPARADA' ? sep.totalEntregue : '—'}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => void alternarDetalhe(sep.id)}
                          className="text-xs font-medium text-[#0F4C81] hover:underline inline-flex items-center gap-1 cursor-pointer"
                        >
                          {expandidaId === sep.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          {expandidaId === sep.id ? 'Fechar' : 'Abrir'}
                        </button>
                      </td>
                    </tr>
                    {expandidaId === sep.id && (
                      <tr key={`${sep.id}-detalhe`} className="bg-slate-50/60">
                        <td colSpan={7} className="px-4 pb-4">
                          {loadingDetalhe && expandidaId === sep.id ? (
                            <div className="h-16 bg-slate-100 rounded animate-pulse mt-2" />
                          ) : detalhe && detalhe.id === sep.id ? (
                            <div className="mt-2 bg-white border border-slate-200 rounded-lg overflow-hidden">
                              <div className="px-4 py-2.5 border-b border-slate-200 text-[11px] text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
                                <span>
                                  <strong>Envio:</strong>{' '}
                                  {sep.enviadoEm ? `${sep.enviadoPorNome} · ${formatDateTimeSP(sep.enviadoEm)}` : '—'}
                                </span>
                                {sep.confirmadoEm && (
                                  <span>
                                    <strong>Confirmação:</strong> {sep.confirmadoPorNome} · {formatDateTimeSP(sep.confirmadoEm)}
                                  </span>
                                )}
                              </div>
                              <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                  <tr className="bg-slate-100 border-b border-slate-200 font-semibold text-slate-700">
                                    <th className="py-2 px-4">Código</th>
                                    <th className="py-2 px-3">Material</th>
                                    <th className="py-2 px-3">Unidade</th>
                                    <th className="py-2 px-3 text-right">Qtd. solicitada</th>
                                    <th className="py-2 px-3 text-right">Qtd. disponível no estoque</th>
                                    <th className="py-2 px-4 text-right">Qtd. efetivamente entregue</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200">
                                  {detalhe.itens.map((item) => (
                                    <tr key={item.id}>
                                      <td className="py-2 px-4 font-mono tabular-nums font-semibold text-slate-900">{item.codigo}</td>
                                      <td className="py-2 px-3 font-medium text-slate-900">{item.nome}</td>
                                      <td className="py-2 px-3 text-slate-600">{item.unidade}</td>
                                      <td className="py-2 px-3 text-right font-mono tabular-nums font-bold text-[#0F4C81]">
                                        {item.quantidadeSolicitada}
                                      </td>
                                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-800">
                                        {item.estoqueDisponivel}
                                      </td>
                                      <td className="py-2 px-4 text-right font-mono tabular-nums font-semibold text-emerald-800">
                                        {item.quantidadeEntregue ?? '—'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
