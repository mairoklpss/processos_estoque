import {
  AlertCircle,
  AlertTriangle,
  Calculator,
  Download,
  Edit3,
  Info,
  Printer,
  Send,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, ApiError, formatDateTimeSP } from '../lib/api.ts';
import type {
  DashboardSummaryDTO,
  SeparacaoCoordenadorDTO,
  SeparacaoItemCoordenadorDTO,
  SeparacaoResumoCoordenadorDTO,
  Tecnico,
} from '../shared/types.ts';
import { ComparacaoLimitesLabel, StatusSeparacaoLabel } from './StatusText.tsx';

interface CoordinatorSepararViewProps {
  activeSeparacaoId: number | null;
  onSelectSeparacaoId: (id: number | null) => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onRefreshSummary: () => void;
  summary: DashboardSummaryDTO | null;
}

export function CoordinatorSepararView({
  activeSeparacaoId,
  onSelectSeparacaoId,
  onNotify,
  onRefreshSummary,
  summary,
}: CoordinatorSepararViewProps) {
  const [tecnicos, setTecnicos] = useState<Tecnico[]>([]);
  const [rascunhos, setRascunhos] = useState<SeparacaoResumoCoordenadorDTO[]>([]);
  const [searchTech, setSearchTech] = useState('');
  const [selectedTecnicoId, setSelectedTecnicoId] = useState<string>('');
  const [observacoes, setObservacoes] = useState('');
  const [loadingInit, setLoadingInit] = useState(true);
  const [calculating, setCalculating] = useState(false);

  const [separacao, setSeparacao] = useState<SeparacaoCoordenadorDTO | null>(null);
  const [loadingSep, setLoadingSep] = useState(false);

  // Ajuste manual modal
  const [editingItem, setEditingItem] = useState<SeparacaoItemCoordenadorDTO | null>(null);
  const [editQty, setEditQty] = useState('');
  const [editJustificativa, setEditJustificativa] = useState('');
  const [savingAjuste, setSavingAjuste] = useState(false);
  const [ajusteError, setAjusteError] = useState<string | null>(null);

  // Envio ao estoque
  const [confirmandoEnvio, setConfirmandoEnvio] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function loadBase() {
    setLoadingInit(true);
    try {
      const [tecs, drafts] = await Promise.all([
        api.listarTecnicos(),
        api.listarSeparacoes({ status: 'RASCUNHO' }),
      ]);
      const ativos = tecs.filter((t) => t.ativo);
      setTecnicos(ativos);
      setRascunhos(drafts);
      if (ativos.length > 0 && !selectedTecnicoId) {
        setSelectedTecnicoId(String(ativos[0].id));
      }
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Erro ao carregar técnicos.', 'error');
    } finally {
      setLoadingInit(false);
    }
  }

  useEffect(() => {
    void loadBase();
  }, []);

  useEffect(() => {
    if (!activeSeparacaoId) {
      setSeparacao(null);
      return;
    }
    let cancelled = false;
    async function loadSep() {
      setLoadingSep(true);
      try {
        const data = await api.obterSeparacao(activeSeparacaoId!);
        if (!cancelled) setSeparacao(data);
      } catch (err) {
        if (!cancelled) {
          onNotify(err instanceof ApiError ? err.message : 'Erro ao carregar separação.', 'error');
        }
      } finally {
        if (!cancelled) setLoadingSep(false);
      }
    }
    void loadSep();
    return () => {
      cancelled = true;
    };
  }, [activeSeparacaoId]);

  const filteredTecnicos = useMemo(() => {
    const q = searchTech.trim().toLowerCase();
    if (!q) return tecnicos;
    return tecnicos.filter(
      (t) =>
        t.nome.toLowerCase().includes(q) ||
        t.matricula.toLowerCase().includes(q) ||
        t.regiao.toLowerCase().includes(q)
    );
  }, [tecnicos, searchTech]);

  useEffect(() => {
    if (filteredTecnicos.length > 0 && !filteredTecnicos.some((t) => String(t.id) === selectedTecnicoId)) {
      setSelectedTecnicoId(String(filteredTecnicos[0].id));
    }
  }, [filteredTecnicos, selectedTecnicoId]);

  async function handleCalcular() {
    if (!selectedTecnicoId) {
      onNotify('Selecione um técnico ativo para calcular.', 'error');
      return;
    }
    setCalculating(true);
    try {
      const novaSep = await api.calcularSeparacao(Number(selectedTecnicoId), observacoes);
      setSeparacao(novaSep);
      onSelectSeparacaoId(novaSep.id);
      setObservacoes('');
      onNotify(`Rascunho ${novaSep.codigo} calculado com sucesso.`);
      const drafts = await api.listarSeparacoes({ status: 'RASCUNHO' });
      setRascunhos(drafts);
      onRefreshSummary();
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Erro ao calcular separação.', 'error');
    } finally {
      setCalculating(false);
    }
  }

  function openAjusteModal(item: SeparacaoItemCoordenadorDTO) {
    setEditingItem(item);
    setEditQty(String(item.quantidadeSolicitada));
    setEditJustificativa(item.ajusteJustificativa ?? '');
    setAjusteError(null);
  }

  async function handleSalvarAjuste(e: FormEvent) {
    e.preventDefault();
    if (!separacao || !editingItem) return;
    const parsed = Number(editQty);
    if (!Number.isInteger(parsed) || parsed < 0 || editQty.trim() === '') {
      setAjusteError('Informe um número inteiro não negativo.');
      return;
    }
    if (editJustificativa.trim().length < 3) {
      setAjusteError('A justificativa é obrigatória (mínimo 3 caracteres).');
      return;
    }
    setSavingAjuste(true);
    setAjusteError(null);
    try {
      const updated = await api.ajustarItemRascunho(separacao.id, editingItem.id, parsed, editJustificativa);
      setSeparacao(updated);
      setEditingItem(null);
      onNotify(`Quantidade de "${editingItem.itemNome}" ajustada no rascunho.`);
    } catch (err) {
      setAjusteError(err instanceof ApiError ? err.message : 'Erro ao salvar ajuste.');
    } finally {
      setSavingAjuste(false);
    }
  }

  async function handleEnviarEstoque() {
    if (!separacao) return;
    setEnviando(true);
    try {
      const updated = await api.enviarSolicitacao(separacao.id);
      setSeparacao(updated);
      setConfirmandoEnvio(false);
      onNotify(`Solicitação ${updated.codigo} enviada para a fila do estoque.`);
      const drafts = await api.listarSeparacoes({ status: 'RASCUNHO' });
      setRascunhos(drafts);
      onRefreshSummary();
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Erro ao enviar solicitação.', 'error');
    } finally {
      setEnviando(false);
    }
  }

  const totais = useMemo(() => {
    if (!separacao) return { solicitado: 0, disponivel: 0, faltante: 0, entregues: 0 };
    return separacao.itens.reduce(
      (acc, i) => ({
        solicitado: acc.solicitado + i.quantidadeSolicitada,
        disponivel: acc.disponivel + i.quantidadeDisponivel,
        faltante: acc.faltante + i.faltante,
        entregues: acc.entregues + (i.quantidadeEntregue ?? 0),
      }),
      { solicitado: 0, disponivel: 0, faltante: 0, entregues: 0 }
    );
  }, [separacao]);

  return (
    <div className="space-y-6">
      {/* Formulário de cálculo (não imprimível) */}
      <section className="no-print bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-col lg:flex-row lg:items-end gap-4">
          <div className="w-full lg:w-64">
            <label htmlFor="busca-tecnico" className="block text-xs font-medium text-slate-700 mb-1.5">
              Buscar técnico ativo
            </label>
            <input
              id="busca-tecnico"
              type="text"
              value={searchTech}
              onChange={(e) => setSearchTech(e.target.value)}
              placeholder="Nome, matrícula ou região"
              className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-700"
            />
          </div>

          <div className="w-full lg:flex-1">
            <label htmlFor="select-tecnico" className="block text-xs font-medium text-slate-700 mb-1.5">
              Técnico selecionado ({filteredTecnicos.length} ativo{filteredTecnicos.length === 1 ? '' : 's'})
            </label>
            <select
              id="select-tecnico"
              value={selectedTecnicoId}
              onChange={(e) => setSelectedTecnicoId(e.target.value)}
              disabled={loadingInit || filteredTecnicos.length === 0}
              className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-700"
            >
              {filteredTecnicos.length === 0 ? (
                <option value="">Nenhum técnico ativo encontrado</option>
              ) : (
                filteredTecnicos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.matricula} — {t.nome} ({t.regiao || 'Sem região'})
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="w-full lg:w-64">
            <label htmlFor="obs-separacao" className="block text-xs font-medium text-slate-700 mb-1.5">
              Observação (opcional)
            </label>
            <input
              id="obs-separacao"
              type="text"
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              placeholder="Ex.: Reposição semana 3"
              className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-700"
            />
          </div>

          <button
            type="button"
            onClick={handleCalcular}
            disabled={calculating || !selectedTecnicoId}
            className="h-10 px-5 inline-flex items-center justify-center gap-2 bg-[#0F4C81] hover:bg-[#0C3D68] disabled:opacity-60 text-white text-sm font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0F4C81]"
          >
            <Calculator className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{calculating ? 'Calculando...' : 'Calcular separação'}</span>
          </button>
        </div>

        <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
            <span>
              Período de consumo fechado (America/Sao_Paulo):{' '}
              <strong className="font-semibold text-slate-900">{summary?.competenciaLabel ?? '...'}</strong>
              {' · '}Regra semanal provisória sem lotes (uso ÷ 3,1428). O cálculo gera um rascunho sem baixar o estoque.
            </span>
          </div>

          {rascunhos.length > 0 && (
            <div className="flex items-center gap-2">
              <label htmlFor="retomar-rascunho" className="text-slate-600 font-medium whitespace-nowrap">
                Retomar rascunho:
              </label>
              <select
                id="retomar-rascunho"
                value={separacao?.status === 'RASCUNHO' ? String(separacao.id) : ''}
                onChange={(e) => onSelectSeparacaoId(e.target.value ? Number(e.target.value) : null)}
                className="h-8 px-2.5 text-xs bg-slate-50 border border-slate-300 rounded text-slate-800"
              >
                <option value="">Selecionar rascunho ({rascunhos.length})</option>
                {rascunhos.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.codigo} — {r.tecnicoNome} ({r.competenciaLabel})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </section>

      {/* Estado de carregamento ou vazio */}
      {loadingSep && (
        <div className="no-print bg-white border border-slate-200 rounded-lg p-6 space-y-3">
          <div className="h-5 w-64 bg-slate-200 rounded animate-pulse" />
          <div className="h-10 w-full bg-slate-100 rounded animate-pulse" />
          <div className="h-10 w-full bg-slate-100 rounded animate-pulse" />
          <div className="h-10 w-full bg-slate-100 rounded animate-pulse" />
        </div>
      )}

      {!loadingSep && !separacao && (
        <div className="no-print bg-white border border-slate-200 rounded-lg p-10 text-center">
          <p className="text-base font-semibold text-slate-900">Nenhuma separação aberta no momento</p>
          <p className="mt-1 text-sm text-slate-600 max-w-lg mx-auto">
            Selecione um técnico ativo acima e clique em <strong>Calcular separação</strong> para gerar um rascunho de reposição ou retome um rascunho pelo Histórico.
          </p>
        </div>
      )}

      {/* Detalhe da separação calculada/retomada */}
      {!loadingSep && separacao && (
        <>
          <section className="no-print bg-white border border-slate-200 rounded-lg overflow-hidden">
            {/* Cabeçalho da separação */}
            <div className="p-5 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-lg font-bold text-slate-900 font-mono tabular-nums">
                    {separacao.codigo}
                  </h2>
                  <span className="text-slate-300" aria-hidden="true">·</span>
                  <span className="text-base font-semibold text-slate-800">{separacao.tecnicoNome}</span>
                  <span className="text-slate-300" aria-hidden="true">·</span>
                  <StatusSeparacaoLabel status={separacao.status} />
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  <span>Competência: <strong className="text-slate-700">{separacao.competenciaLabel}</strong></span>
                  <span aria-hidden="true">·</span>
                  <span>Calculado por {separacao.calculadoPorNome} em <span className="font-mono tabular-nums">{formatDateTimeSP(separacao.calculadoEm)}</span></span>
                  {separacao.enviadoEm && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Enviado por {separacao.enviadoPorNome} em <span className="font-mono tabular-nums">{formatDateTimeSP(separacao.enviadoEm)}</span></span>
                    </>
                  )}
                  {separacao.confirmadoEm && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Confirmado por {separacao.confirmadoPorNome} em <span className="font-mono tabular-nums">{formatDateTimeSP(separacao.confirmadoEm)}</span></span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    void api
                      .downloadCsv(`/api/coord/separacoes/${separacao.id}/csv`, `${separacao.codigo}.csv`)
                      .catch((err) =>
                        onNotify(err instanceof ApiError ? err.message : 'Erro ao exportar CSV.', 'error')
                      )
                  }
                  className="h-9 px-3.5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Exportar CSV</span>
                </button>

                <button
                  type="button"
                  onClick={() => window.print()}
                  className="h-9 px-3.5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Imprimir lista</span>
                </button>

                {separacao.status === 'RASCUNHO' && !confirmandoEnvio && (
                  <button
                    type="button"
                    onClick={() => setConfirmandoEnvio(true)}
                    className="h-9 px-4 inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-[#0F4C81] hover:bg-[#0C3D68] rounded-md whitespace-nowrap cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>Enviar solicitação ao estoque</span>
                  </button>
                )}
              </div>
            </div>

            {/* Confirmação explícita de envio */}
            {separacao.status === 'RASCUNHO' && confirmandoEnvio && (
              <div className="px-5 py-3.5 bg-blue-50 border-b border-blue-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <p className="text-xs text-blue-950 font-medium">
                  Ao enviar ao estoque, o rascunho mudará para <strong>CALCULADA</strong>, bloqueará novos ajustes manuais e entrará na fila do almoxarifado (sem baixa imediata de estoque). Confirmar envio?
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setConfirmandoEnvio(false)}
                    disabled={enviando}
                    className="h-8 px-3 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleEnviarEstoque}
                    disabled={enviando}
                    className="h-8 px-3.5 text-xs font-semibold text-white bg-[#0F4C81] hover:bg-[#0C3D68] rounded cursor-pointer disabled:opacity-60"
                  >
                    {enviando ? 'Enviando...' : 'Confirmar envio ao estoque'}
                  </button>
                </div>
              </div>
            )}

            {/* Faixa resumo numérico */}
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 border-b border-slate-200 bg-slate-50/70">
              <div className="px-5 py-3">
                <p className="text-xs text-slate-500">Total solicitado</p>
                <p className="mt-0.5 text-lg font-bold font-mono tabular-nums text-slate-900">{totais.solicitado}</p>
              </div>
              <div className="px-5 py-3">
                <p className="text-xs text-slate-500">Possível separar agora</p>
                <p className="mt-0.5 text-lg font-bold font-mono tabular-nums text-[#0F4C81]">{totais.disponivel}</p>
              </div>
              <div className="px-5 py-3">
                <p className="text-xs text-slate-500">Faltante no almoxarifado</p>
                <p className={`mt-0.5 text-lg font-bold font-mono tabular-nums ${totais.faltante > 0 ? 'text-red-700' : 'text-slate-900'}`}>
                  {totais.faltante}
                </p>
              </div>
              <div className="px-5 py-3">
                <p className="text-xs text-slate-500">
                  {separacao.status === 'SEPARADA' ? 'Efetivamente entregue' : 'Itens na lista'}
                </p>
                <p className="mt-0.5 text-lg font-bold font-mono tabular-nums text-slate-900">
                  {separacao.status === 'SEPARADA' ? totais.entregues : separacao.itens.length}
                </p>
              </div>
            </div>

            {/* Notas obrigatórias da regra */}
            <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-col md:flex-row md:items-center md:justify-between gap-2 text-xs text-slate-600">
              <span>
                <strong>Demanda diária:</strong> Média diária exibida com base em 22 dias úteis; a reposição ainda usa a regra semanal provisória.
              </span>
              <span>
                <strong>Régua informativa:</strong> Alertas comparam o consumo mensal com os limites e não alteram o cálculo.
              </span>
            </div>

            {/* Tabela completa do Coordenador */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-xs font-semibold text-slate-700">
                    <th className="py-2.5 px-4 whitespace-nowrap">Material</th>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap bg-blue-50/70 text-[#0F4C81]">
                      Qtd. possível separar
                    </th>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">Uso mês ({separacao.competencia})</th>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">Dem. diária (22d)</th>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">Mín. efetivo</th>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">Máx. global</th>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">Alvo kit</th>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">Saldo téc.</th>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">Solicitada</th>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">Almox.</th>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">Faltante</th>
                    {separacao.status === 'SEPARADA' && (
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">Entregue</th>
                    )}
                    <th className="py-2.5 px-4 whitespace-nowrap">Alertas e leitura da régua</th>
                    {separacao.status === 'RASCUNHO' && (
                      <th className="py-2.5 px-4 text-right whitespace-nowrap">Ajuste</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {separacao.itens.map((item) => {
                    const foiAjustado = item.ajusteJustificativa !== null;
                    return (
                      <tr key={item.id} className="hover:bg-slate-50/80 align-top">
                        <td className="py-3 px-4 min-w-[200px]">
                          <div className="font-semibold text-slate-900">{item.itemNome}</div>
                          <div className="mt-0.5 text-slate-500 font-mono tabular-nums">
                            {item.itemCodigo} · {item.unidade}
                          </div>
                          {foiAjustado && (
                            <div className="mt-1.5 p-2 rounded bg-amber-50 border border-amber-200 text-[11px] text-amber-950">
                              <div>
                                <strong>Ajuste manual:</strong>{' '}
                                <span className="font-mono tabular-nums">
                                  {item.quantidadeCalculadaOriginal} → {item.quantidadeSolicitada}
                                </span>
                              </div>
                              <div className="mt-0.5 text-amber-800">
                                Motivo: {item.ajusteJustificativa} ({item.ajustadoPorNome})
                              </div>
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3 text-right font-mono tabular-nums text-sm font-bold text-[#0F4C81] bg-blue-50/40 whitespace-nowrap">
                          {item.quantidadeDisponivel} {item.unidade}
                        </td>

                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                          {item.usoMesAnterior}
                        </td>

                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                          {item.demandaDiariaInformativa.toFixed(2)}/dia
                        </td>

                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          <div className="font-mono tabular-nums text-slate-900 font-medium">
                            {item.minimoEfetivo}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {item.minimoOrigem === 'MANUAL' ? 'Manual' : `Derivado (alvo ${item.alvoBase})`}
                          </div>
                        </td>

                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                          {item.limiteMaximo}
                        </td>

                        <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                          {item.alvoKit}
                        </td>

                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                          {item.saldoTecnico}
                        </td>

                        <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                          {item.quantidadeSolicitada}
                        </td>

                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          {item.estoqueAlmoxarifado}
                        </td>

                        <td
                          className={`py-3 px-3 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                            item.faltante > 0 ? 'text-red-700' : 'text-slate-400'
                          }`}
                        >
                          {item.faltante}
                        </td>

                        {separacao.status === 'SEPARADA' && (
                          <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-emerald-800 whitespace-nowrap">
                            {item.quantidadeEntregue ?? 0}
                          </td>
                        )}

                        <td className="py-3 px-4 min-w-[210px] space-y-1">
                          <div>
                            <ComparacaoLimitesLabel comparacao={item.comparacaoLimites} />
                          </div>
                          {item.consumoAtipico && (
                            <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700">
                              <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                              <span>Consumo atípico (&gt; máximo global)</span>
                            </div>
                          )}
                          {item.semConsumo && (
                            <div className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600">
                              <Info className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                              <span>Sem consumo no período</span>
                            </div>
                          )}
                          {item.semSaldoAlmoxarifado && (
                            <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                              <span>Sem saldo no almoxarifado</span>
                            </div>
                          )}
                          {item.alertaMinimoMaiorMaximo && (
                            <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                              <span>Mínimo manual supera máximo do produto</span>
                            </div>
                          )}
                        </td>

                        {separacao.status === 'RASCUNHO' && (
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => openAjusteModal(item)}
                              className="h-8 px-2.5 inline-flex items-center gap-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded cursor-pointer"
                            >
                              <Edit3 className="w-3 h-3 shrink-0" aria-hidden="true" />
                              <span>Ajustar</span>
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Versão simplificada exclusiva para impressão */}
          <section className="hidden print-only p-6">
            <h1 className="text-xl font-bold">Brasilink — Lista de Separação de Materiais</h1>
            <p className="text-sm mt-1">
              Solicitação: <strong>{separacao.codigo}</strong> · Técnico: <strong>{separacao.tecnicoNome}</strong> · Competência: {separacao.competenciaLabel}
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
                {separacao.itens
                  .filter((i) => i.quantidadeDisponivel > 0)
                  .map((i) => (
                    <tr key={i.id} className="border-b border-slate-300">
                      <td className="py-2 pr-3 font-mono">{i.itemCodigo}</td>
                      <td className="py-2 pr-3">{i.itemNome}</td>
                      <td className="py-2 pr-3 text-right font-mono font-bold">{i.quantidadeDisponivel}</td>
                      <td className="py-2 text-right">{i.unidade}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {/* Modal de ajuste manual no rascunho */}
      {editingItem && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-ajuste-title"
          className="no-print fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-md p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="modal-ajuste-title" className="text-base font-bold text-slate-900">
                  Ajustar quantidade solicitada
                </h3>
                <p className="mt-1 text-xs text-slate-600">
                  {editingItem.itemCodigo} — {editingItem.itemNome}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                aria-label="Fechar"
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 p-3 bg-slate-50 border border-slate-200 rounded text-xs text-slate-700 flex justify-between">
              <span>Proposta original calculada:</span>
              <strong className="font-mono tabular-nums">
                {editingItem.quantidadeCalculadaOriginal} {editingItem.unidade}
              </strong>
            </div>

            {ajusteError && (
              <div role="alert" className="mt-3 p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-800">
                {ajusteError}
              </div>
            )}

            <form onSubmit={handleSalvarAjuste} className="mt-4 space-y-4">
              <div>
                <label htmlFor="ajuste-qtd" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Nova quantidade solicitada ({editingItem.unidade})
                </label>
                <input
                  id="ajuste-qtd"
                  type="number"
                  min={0}
                  step={1}
                  required
                  value={editQty}
                  onChange={(e) => setEditQty(e.target.value)}
                  className="w-full h-10 px-3 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>

              <div>
                <label htmlFor="ajuste-justificativa" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Justificativa obrigatória
                </label>
                <textarea
                  id="ajuste-justificativa"
                  rows={3}
                  required
                  value={editJustificativa}
                  onChange={(e) => setEditJustificativa(e.target.value)}
                  placeholder="Explique o motivo da alteração manual (ex.: ordem de serviço emergencial)"
                  className="w-full p-3 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="h-9 px-4 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingAjuste}
                  className="h-9 px-4 text-xs font-semibold text-white bg-[#0F4C81] hover:bg-[#0C3D68] rounded-md cursor-pointer disabled:opacity-60"
                >
                  {savingAjuste ? 'Salvando...' : 'Salvar ajuste'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
