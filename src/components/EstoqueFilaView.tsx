import { CheckSquare, Download, PackageCheck, Printer, RefreshCw, ArrowLeft } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, formatDateTimeSP } from '../lib/api.ts';
import type { SeparacaoEstoqueDetalheDTO, SeparacaoEstoqueFilaDTO } from '../shared/types.ts';

interface EstoqueFilaViewProps {
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onEntregaConfirmada: () => void;
}

export function EstoqueFilaView({ onNotify, onEntregaConfirmada }: EstoqueFilaViewProps) {
  const [fila, setFila] = useState<SeparacaoEstoqueFilaDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState<string | null>(null);

  const [detalhe, setDetalhe] = useState<SeparacaoEstoqueDetalheDTO | null>(null);
  const [loadingDetalhe, setLoadingDetalhe] = useState(false);

  // Estado do checklist e quantidades entregues
  const [conferidos, setConferidos] = useState<Record<number, boolean>>({});
  const [quantidades, setQuantidades] = useState<Record<number, string>>({});
  const [confirmando, setConfirmando] = useState(false);
  const [erroEntrega, setErroEntrega] = useState<string | null>(null);

  async function loadFila(silent = false) {
    if (!silent) setLoading(true);
    try {
      const data = await api.listarFilaEstoque();
      setFila(data);
      setUltimaAtualizacao(new Date().toISOString());
    } catch (err) {
      if (!silent) {
        onNotify(err instanceof ApiError ? err.message : 'Erro ao atualizar fila do estoque.', 'error');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void loadFila();
    const timer = window.setInterval(() => {
      void loadFila(true);
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  async function abrirSolicitacao(id: number) {
    setLoadingDetalhe(true);
    setErroEntrega(null);
    try {
      const data = await api.obterDetalheEstoque(id);
      setDetalhe(data);
      const initConferidos: Record<number, boolean> = {};
      const initQtds: Record<number, string> = {};
      for (const item of data.itens) {
        initConferidos[item.id] = false;
        initQtds[item.id] = String(item.quantidadeASeparar);
      }
      setConferidos(initConferidos);
      setQuantidades(initQtds);
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Erro ao abrir solicitação.', 'error');
    } finally {
      setLoadingDetalhe(false);
    }
  }

  async function handleConfirmarEntrega(e: FormEvent) {
    e.preventDefault();
    if (!detalhe) return;
    setErroEntrega(null);

    const naoConferidos = detalhe.itens.filter((i) => !conferidos[i.id]);
    if (naoConferidos.length > 0) {
      setErroEntrega('Marque a conferência física de todos os itens antes de confirmar a entrega.');
      return;
    }

    const itensPayload: Array<{ separacaoItemId: number; quantidadeEntregue: number }> = [];
    for (const item of detalhe.itens) {
      const raw = (quantidades[item.id] ?? '').trim();
      const val = Number(raw);
      if (raw === '' || !Number.isInteger(val) || val < 0) {
        setErroEntrega(`Informe uma quantidade inteira não negativa para "${item.nome}".`);
        return;
      }
      if (val > item.quantidadeSolicitada) {
        setErroEntrega(
          `Quantidade entregue de "${item.nome}" (${val}) não pode exceder a solicitada (${item.quantidadeSolicitada}).`
        );
        return;
      }
      itensPayload.push({ separacaoItemId: item.id, quantidadeEntregue: val });
    }

    setConfirmando(true);
    try {
      const confirmado = await api.confirmarEntregaEstoque(detalhe.id, {
        versaoEstoque: detalhe.versaoEstoque,
        itens: itensPayload,
      });
      setDetalhe(confirmado);
      onNotify(`Entrega da solicitação ${confirmado.codigo} confirmada com baixa no almoxarifado.`);
      await loadFila(true);
      onEntregaConfirmada();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Erro ao confirmar entrega.';
      setErroEntrega(msg);
      onNotify(msg, 'error');
    } finally {
      setConfirmando(false);
    }
  }

  // Tela de detalhe / conferência e entrega
  if (detalhe) {
    const isCalculada = detalhe.status === 'CALCULADA';
    return (
      <div className="space-y-5">
        <div className="no-print flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              setDetalhe(null);
              void loadFila();
            }}
            className="h-9 px-3.5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Voltar para fila</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                void api
                  .downloadCsv(`/api/estoque/fila/${detalhe.id}/csv`, `${detalhe.codigo}-estoque.csv`)
                  .catch((err) =>
                    onNotify(err instanceof ApiError ? err.message : 'Erro ao exportar CSV.', 'error')
                  )
              }
              className="h-9 px-3.5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Exportar CSV</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="h-9 px-3.5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Imprimir lista</span>
            </button>
          </div>
        </div>

        <section className="no-print bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-bold font-mono tabular-nums text-slate-900">{detalhe.codigo}</h2>
                <span className="text-slate-300" aria-hidden="true">·</span>
                <span className="text-base font-semibold text-slate-800">{detalhe.tecnicoNome}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Enviada em <span className="font-mono tabular-nums">{formatDateTimeSP(detalhe.enviadoEm)}</span>
                {detalhe.confirmadoEm && (
                  <>
                    {' · '}Confirmada por {detalhe.confirmadoPorNome} em{' '}
                    <span className="font-mono tabular-nums">{formatDateTimeSP(detalhe.confirmadoEm)}</span>
                  </>
                )}
              </p>
            </div>

            {isCalculada ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-800">
                <CheckSquare className="w-4 h-4" aria-hidden="true" />
                <span>Aguardando conferência e entrega</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
                <PackageCheck className="w-4 h-4" aria-hidden="true" />
                <span>Entrega confirmada (SEPARADA)</span>
              </span>
            )}
          </div>

          {erroEntrega && (
            <div role="alert" className="m-5 mb-0 p-3.5 bg-red-50 border border-red-200 rounded-md flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-red-800">
              <span className="font-medium">{erroEntrega}</span>
              <button
                type="button"
                onClick={() => void abrirSolicitacao(detalhe.id)}
                className="h-8 px-3 bg-white border border-red-300 text-red-800 font-semibold rounded hover:bg-red-100 whitespace-nowrap cursor-pointer"
              >
                Recarregar lista atualizada
              </button>
            </div>
          )}

          <form onSubmit={handleConfirmarEntrega}>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 font-semibold text-slate-700">
                    {isCalculada && <th className="py-2.5 px-4 w-14 text-center">Conferido</th>}
                    <th className="py-2.5 px-4">Código</th>
                    <th className="py-2.5 px-3">Material</th>
                    <th className="py-2.5 px-3">Unidade</th>
                    <th className="py-2.5 px-3 text-right">Qtd. solicitada</th>
                    <th className="py-2.5 px-3 text-right">Qtd. disponível no estoque</th>
                    <th className="py-2.5 px-4 text-right">Qtd. efetivamente entregue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {detalhe.itens.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      {isCalculada && (
                        <td className="py-3 px-4 text-center">
                          <input
                            type="checkbox"
                            aria-label={`Conferido ${item.nome}`}
                            checked={Boolean(conferidos[item.id])}
                            onChange={(e) =>
                              setConferidos((prev) => ({ ...prev, [item.id]: e.target.checked }))
                            }
                            className="w-4 h-4 accent-[#0F4C81] cursor-pointer"
                          />
                        </td>
                      )}
                      <td className="py-3 px-4 font-mono tabular-nums font-semibold text-slate-900">
                        {item.codigo}
                      </td>
                      <td className="py-3 px-3 font-medium text-slate-900">{item.nome}</td>
                      <td className="py-3 px-3 text-slate-600">{item.unidade}</td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-[#0F4C81]">
                        {item.quantidadeSolicitada}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800">
                        {item.estoqueDisponivel}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {isCalculada ? (
                          <input
                            type="number"
                            min={0}
                            max={item.quantidadeASeparar}
                            step={1}
                            required
                            aria-label={`Quantidade entregue de ${item.nome}`}
                            value={quantidades[item.id] ?? '0'}
                            onChange={(e) =>
                              setQuantidades((prev) => ({ ...prev, [item.id]: e.target.value }))
                            }
                            className="w-24 h-8 px-2.5 text-right text-sm font-mono tabular-nums border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-700"
                          />
                        ) : (
                          <span className="font-mono tabular-nums font-bold text-emerald-800">
                            {item.quantidadeEntregue ?? 0}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {isCalculada && (
              <div className="p-5 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      const all: Record<number, boolean> = {};
                      for (const i of detalhe.itens) all[i.id] = true;
                      setConferidos(all);
                    }}
                    className="h-9 px-3 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-100 cursor-pointer"
                  >
                    Marcar todos conferidos
                  </button>
                  <span className="text-xs text-slate-600">
                    Entregas parciais deixam a diferença registrada em Pendências.
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={confirmando}
                  className="h-10 px-5 inline-flex items-center justify-center gap-2 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-md cursor-pointer whitespace-nowrap"
                >
                  <PackageCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{confirmando ? 'Confirmando baixa...' : 'Confirmar entrega de todos os itens'}</span>
                </button>
              </div>
            )}
          </form>
        </section>

        {/* Impressão simples do estoque */}
        <section className="hidden print-only p-6">
          <h1 className="text-xl font-bold">Brasilink — Lista de Separação (Almoxarifado)</h1>
          <p className="text-sm mt-1">
            Solicitação: <strong>{detalhe.codigo}</strong> · Técnico: <strong>{detalhe.tecnicoNome}</strong>
          </p>
          <table className="w-full mt-4 border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-black text-left">
                <th className="py-2 pr-3">Código</th>
                <th className="py-2 pr-3">Material</th>
                <th className="py-2 pr-3 text-right">Qtd. a Separar</th>
                <th className="py-2 text-right">Unidade</th>
              </tr>
            </thead>
            <tbody>
              {detalhe.itens.map((i) => (
                <tr key={i.id} className="border-b border-slate-300">
                  <td className="py-2 pr-3 font-mono">{i.codigo}</td>
                  <td className="py-2 pr-3">{i.nome}</td>
                  <td className="py-2 pr-3 text-right font-mono font-bold">{i.quantidadeASeparar}</td>
                  <td className="py-2 text-right">{i.unidade}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Solicitações na fila do almoxarifado ({fila.length})
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            Atualização automática a cada 30 segundos.{' '}
            {ultimaAtualizacao && (
              <span>
                Última leitura: <span className="font-mono tabular-nums">{formatDateTimeSP(ultimaAtualizacao)}</span>
              </span>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadFila()}
          disabled={loading}
          className="h-9 px-4 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer whitespace-nowrap"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>Atualizar fila</span>
        </button>
      </section>

      {loadingDetalhe && (
        <div className="bg-white border border-slate-200 rounded-lg p-6 text-xs text-slate-600">
          Carregando lista de separação...
        </div>
      )}

      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {loading && fila.length === 0 ? (
          <div className="p-6 space-y-2.5">
            <div className="h-10 bg-slate-100 rounded animate-pulse" />
            <div className="h-10 bg-slate-100 rounded animate-pulse" />
          </div>
        ) : fila.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-semibold text-slate-900">Fila de separação vazia</p>
            <p className="mt-1 text-xs text-slate-600">
              Nenhuma solicitação enviada pela coordenação aguarda separação no momento.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 font-semibold text-slate-700">
                  <th className="py-2.5 px-4">Solicitação</th>
                  <th className="py-2.5 px-3">Técnico</th>
                  <th className="py-2.5 px-3">Enviada em</th>
                  <th className="py-2.5 px-3 text-right">Itens</th>
                  <th className="py-2.5 px-3 text-right">Unidades a separar</th>
                  <th className="py-2.5 px-4 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {fila.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono tabular-nums font-semibold text-slate-900">
                      {row.codigo}
                    </td>
                    <td className="py-3 px-3 font-medium text-slate-900">{row.tecnicoNome}</td>
                    <td className="py-3 px-3 font-mono tabular-nums text-slate-600">
                      {formatDateTimeSP(row.enviadoEm)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800">
                      {row.totalItens}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-[#0F4C81]">
                      {row.totalUnidadesASeparar}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => void abrirSolicitacao(row.id)}
                        className="h-8 px-3.5 text-xs font-semibold text-white bg-[#0F4C81] hover:bg-[#0C3D68] rounded cursor-pointer whitespace-nowrap"
                      >
                        Conferir e entregar
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
