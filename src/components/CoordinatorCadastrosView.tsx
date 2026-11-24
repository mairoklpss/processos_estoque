import { AlertTriangle, KeyRound, Plus, Save, Trash2, UserCheck, UserX } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, buildItemUpdatePayload } from '../lib/api.ts';
import type {
  ItemProduto,
  ParametroTecnicoItem,
  PerfilUsuario,
  Tecnico,
  UsuarioPublico,
} from '../shared/types.ts';

interface CoordinatorCadastrosViewProps {
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onRefreshSummary: () => void;
}

type AbaCadastro = 'tecnicos' | 'produtos' | 'parametros' | 'usuarios';

export function CoordinatorCadastrosView({ onNotify, onRefreshSummary }: CoordinatorCadastrosViewProps) {
  const [aba, setAba] = useState<AbaCadastro>('tecnicos');

  // Técnicos
  const [tecnicos, setTecnicos] = useState<Tecnico[]>([]);
  const [tecEditId, setTecEditId] = useState<number | null>(null);
  const [tecMatricula, setTecMatricula] = useState('');
  const [tecNome, setTecNome] = useState('');
  const [tecFilial, setTecFilial] = useState('');

  // Produtos
  const [itens, setItens] = useState<ItemProduto[]>([]);
  const [itemEditId, setItemEditId] = useState<number | null>(null);
  const [itemCodigo, setItemCodigo] = useState('');
  const [itemNome, setItemNome] = useState('');
  const [itemUnidade, setItemUnidade] = useState('un');
  const [itemEstoque, setItemEstoque] = useState('0');
  const [itemEstoqueOriginal, setItemEstoqueOriginal] = useState<number | null>(null);
  const [itemMaximo, setItemMaximo] = useState('10');

  // Parâmetros por técnico
  const [paramTecId, setParamTecId] = useState<string>('');
  const [paramCompetencia, setParamCompetencia] = useState('');
  const [paramItens, setParamItens] = useState<ParametroTecnicoItem[]>([]);
  const [paramDrafts, setParamDrafts] = useState<Record<number, string>>({});

  // Usuários
  const [usuarios, setUsuarios] = useState<UsuarioPublico[]>([]);
  const [usrNome, setUsrNome] = useState('');
  const [usrUsername, setUsrUsername] = useState('');
  const [usrPassword, setUsrPassword] = useState('');
  const [usrPerfil, setUsrPerfil] = useState<PerfilUsuario>('ESTOQUE');
  const [resetUserId, setResetUserId] = useState<number | null>(null);
  const [resetPass, setResetPass] = useState('');

  const [loading, setLoading] = useState(false);

  async function loadAll() {
    setLoading(true);
    try {
      const [tecs, prods, users] = await Promise.all([
        api.listarTecnicos(),
        api.listarItens(),
        api.listarUsuarios(),
      ]);
      setTecnicos(tecs);
      setItens(prods);
      setUsuarios(users);
      if (tecs.length > 0 && !paramTecId) {
        setParamTecId(String(tecs[0].id));
      }
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Erro ao carregar cadastros.', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function loadParametros(tecId: number) {
    try {
      const res = await api.listarParametros(tecId);
      setParamCompetencia(res.competenciaLabel);
      setParamItens(res.itens);
      const map: Record<number, string> = {};
      for (const i of res.itens) {
        map[i.itemId] = i.minimoManual !== null ? String(i.minimoManual) : '';
      }
      setParamDrafts(map);
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Erro ao carregar parâmetros.', 'error');
    }
  }

  useEffect(() => {
    if (aba === 'parametros' && paramTecId) {
      void loadParametros(Number(paramTecId));
    }
  }, [aba, paramTecId]);

  // Handlers Técnicos
  async function handleSalvarTecnico(e: FormEvent) {
    e.preventDefault();
    try {
      if (tecEditId) {
        await api.atualizarTecnico(tecEditId, { matricula: tecMatricula, nome: tecNome, filial: tecFilial });
        onNotify('Técnico atualizado.');
      } else {
        await api.criarTecnico({ matricula: tecMatricula, nome: tecNome, filial: tecFilial });
        onNotify('Técnico cadastrado.');
      }
      setTecEditId(null);
      setTecMatricula('');
      setTecNome('');
      setTecFilial('');
      await loadAll();
      onRefreshSummary();
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Erro ao salvar técnico.', 'error');
    }
  }

  async function handleToggleTecnico(t: Tecnico) {
    try {
      await api.atualizarTecnico(t.id, { ativo: !t.ativo });
      onNotify(t.ativo ? `Técnico ${t.nome} desativado.` : `Técnico ${t.nome} reativado.`);
      await loadAll();
      onRefreshSummary();
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Erro ao atualizar técnico.', 'error');
    }
  }

  // Handlers Produtos
  async function handleSalvarItem(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        codigo: itemCodigo,
        nome: itemNome,
        unidade: itemUnidade,
        estoqueAtual: Number(itemEstoque),
        limiteMaximo: Number(itemMaximo),
      };
      if (itemEditId) {
        if (itemEstoqueOriginal === null) throw new ApiError(409,'Reabra o produto antes de salvar.');
        await api.atualizarItem(itemEditId, buildItemUpdatePayload(payload,itemEstoqueOriginal));
        onNotify('Produto atualizado.');
      } else {
        await api.criarItem(payload);
        onNotify('Produto cadastrado.');
      }
      setItemEditId(null);
      setItemCodigo('');
      setItemNome('');
      setItemUnidade('un');
      setItemEstoque('0');
      setItemEstoqueOriginal(null);
      setItemMaximo('10');
      await loadAll();
      onRefreshSummary();
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Erro ao salvar produto.', 'error');
    }
  }

  async function handleToggleItem(i: ItemProduto) {
    try {
      await api.atualizarItem(i.id, { ativo: !i.ativo });
      onNotify(i.ativo ? `Produto ${i.nome} desativado.` : `Produto ${i.nome} reativado.`);
      await loadAll();
      onRefreshSummary();
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Erro ao atualizar produto.', 'error');
    }
  }

  // Handlers Parâmetros
  async function handleSalvarMinimo(itemId: number, limpar = false) {
    if (!paramTecId) return;
    const raw = limpar ? '' : (paramDrafts[itemId] ?? '').trim();
    const valor = raw === '' ? null : Number(raw);
    if (valor !== null && (!Number.isInteger(valor) || valor < 0)) {
      onNotify('O mínimo manual deve ser um inteiro não negativo ou vazio para usar o derivado.', 'error');
      return;
    }
    try {
      const res = await api.definirMinimoManual(Number(paramTecId), itemId, valor);
      await loadParametros(Number(paramTecId));
      if (res.alertaMinimoMaiorMaximo) {
        onNotify('Mínimo manual salvo, porém supera o máximo global do produto.');
      } else if (valor === null) {
        onNotify('Mínimo manual removido; item voltou ao mínimo derivado.');
      } else {
        onNotify('Mínimo manual salvo.');
      }
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Erro ao salvar mínimo.', 'error');
    }
  }

  // Handlers Usuários
  async function handleCriarUsuario(e: FormEvent) {
    e.preventDefault();
    try {
      await api.criarUsuario({
        nome: usrNome,
        username: usrUsername,
        password: usrPassword,
        perfil: usrPerfil,
      });
      setUsrNome('');
      setUsrUsername('');
      setUsrPassword('');
      onNotify('Usuário criado com sucesso.');
      await loadAll();
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Erro ao criar usuário.', 'error');
    }
  }

  async function handleToggleUsuario(u: UsuarioPublico) {
    try {
      await api.atualizarUsuario(u.id, { ativo: !u.ativo });
      onNotify(u.ativo ? `Usuário ${u.username} desativado.` : `Usuário ${u.username} ativado.`);
      await loadAll();
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Erro ao atualizar usuário.', 'error');
    }
  }

  async function handleResetSenha(e: FormEvent) {
    e.preventDefault();
    if (!resetUserId) return;
    try {
      await api.redefinirSenha(resetUserId, resetPass);
      setResetUserId(null);
      setResetPass('');
      onNotify('Senha redefinida e sessões anteriores encerradas.');
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Erro ao redefinir senha.', 'error');
    }
  }

  return (
    <div className="space-y-5">
      {/* Navegação por abas */}
      <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
        {(
          [
            ['tecnicos', 'Técnicos'],
            ['produtos', 'Produtos'],
            ['parametros', 'Parâmetros por Técnico'],
            ['usuarios', 'Usuários'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setAba(key)}
            className={`h-9 px-4 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              aba === key ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ABA TÉCNICOS */}
      {aba === 'tecnicos' && (
        <div className="space-y-5">
          <form onSubmit={handleSalvarTecnico} className="bg-white border border-slate-200 rounded-lg p-5">
            <h2 className="text-sm font-bold text-slate-900 mb-3">
              {tecEditId ? 'Editar técnico' : 'Cadastrar novo técnico'}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
              <div>
                <label htmlFor="tec-mat" className="block text-xs font-medium text-slate-700 mb-1">
                  Matrícula
                </label>
                <input
                  id="tec-mat"
                  required
                  value={tecMatricula}
                  onChange={(e) => setTecMatricula(e.target.value)}
                  placeholder="Ex.: TEC-04"
                  className="w-full h-9 px-3 text-sm font-mono border border-slate-300 rounded-md"
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="tec-nome" className="block text-xs font-medium text-slate-700 mb-1">
                  Nome completo
                </label>
                <input
                  id="tec-nome"
                  required
                  value={tecNome}
                  onChange={(e) => setTecNome(e.target.value)}
                  placeholder="Nome do técnico"
                  className="w-full h-9 px-3 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="tec-filial" className="block text-xs font-medium text-slate-700 mb-1">
                  Filial
                </label>
                <input
                  id="tec-filial"
                  value={tecFilial}
                  onChange={(e) => setTecFilial(e.target.value)}
                  placeholder="Ex.: Tianguá"
                  className="w-full h-9 px-3 text-sm border border-slate-300 rounded-md"
                />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <button
                type="submit"
                className="h-9 px-4 inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-[#0F4C81] hover:bg-[#0C3D68] rounded-md cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{tecEditId ? 'Salvar alterações' : 'Adicionar técnico'}</span>
              </button>
              {tecEditId && (
                <button
                  type="button"
                  onClick={() => {
                    setTecEditId(null);
                    setTecMatricula('');
                    setTecNome('');
                    setTecFilial('');
                  }}
                  className="h-9 px-3 text-xs font-medium text-slate-700 border border-slate-300 rounded-md cursor-pointer"
                >
                  Cancelar edição
                </button>
              )}
            </div>
          </form>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 font-semibold text-slate-700">
                  <th className="py-2.5 px-4">Matrícula</th>
                  <th className="py-2.5 px-3">Nome</th>
                  <th className="py-2.5 px-3">Filial</th>
                  <th className="py-2.5 px-3">Situação</th>
                  <th className="py-2.5 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {tecnicos.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono tabular-nums font-semibold text-slate-900">{t.matricula}</td>
                    <td className="py-2.5 px-3 font-medium text-slate-900">{t.nome}</td>
                    <td className="py-2.5 px-3 text-slate-600">{t.filial || '—'}</td>
                    <td className="py-2.5 px-3">
                      <span className={t.ativo ? 'text-emerald-800 font-medium' : 'text-slate-500'}>
                        {t.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right space-x-2">
                      <button
                        type="button"
                        onClick={() => {
                          setTecEditId(t.id);
                          setTecMatricula(t.matricula);
                          setTecNome(t.nome);
                          setTecFilial(t.filial);
                        }}
                        className="text-xs font-medium text-[#0F4C81] hover:underline cursor-pointer"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleToggleTecnico(t)}
                        className="text-xs font-medium text-slate-700 hover:underline cursor-pointer"
                      >
                        {t.ativo ? 'Desativar' : 'Ativar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ABA PRODUTOS */}
      {aba === 'produtos' && (
        <div className="space-y-5">
          <form onSubmit={handleSalvarItem} className="bg-white border border-slate-200 rounded-lg p-5">
            <h2 className="text-sm font-bold text-slate-900 mb-3">
              {itemEditId ? 'Editar produto' : 'Cadastrar novo produto'}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
              <div>
                <label htmlFor="prod-cod" className="block text-xs font-medium text-slate-700 mb-1">
                  Código
                </label>
                <input
                  id="prod-cod"
                  required
                  value={itemCodigo}
                  onChange={(e) => setItemCodigo(e.target.value)}
                  placeholder="MAT-007"
                  className="w-full h-9 px-3 text-sm font-mono border border-slate-300 rounded-md"
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="prod-nome" className="block text-xs font-medium text-slate-700 mb-1">
                  Descrição do material
                </label>
                <input
                  id="prod-nome"
                  required
                  value={itemNome}
                  onChange={(e) => setItemNome(e.target.value)}
                  placeholder="Ex.: Splitter Óptico 1x8"
                  className="w-full h-9 px-3 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="prod-un" className="block text-xs font-medium text-slate-700 mb-1">
                  Unidade
                </label>
                <input
                  id="prod-un"
                  required
                  value={itemUnidade}
                  onChange={(e) => setItemUnidade(e.target.value)}
                  placeholder="un ou m"
                  className="w-full h-9 px-3 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="prod-est" className="block text-xs font-medium text-slate-700 mb-1">
                    Estoque
                  </label>
                  <input
                    id="prod-est"
                    type="number"
                    min={0}
                    step={1}
                    required
                    value={itemEstoque}
                    onChange={(e) => setItemEstoque(e.target.value)}
                    className="w-full h-9 px-2.5 text-sm font-mono tabular-nums border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label htmlFor="prod-max" className="block text-xs font-medium text-slate-700 mb-1">
                    Máx. global
                  </label>
                  <input
                    id="prod-max"
                    type="number"
                    min={1}
                    step={1}
                    required
                    value={itemMaximo}
                    onChange={(e) => setItemMaximo(e.target.value)}
                    className="w-full h-9 px-2.5 text-sm font-mono tabular-nums border border-slate-300 rounded-md"
                  />
                </div>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <button
                type="submit"
                className="h-9 px-4 inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-[#0F4C81] hover:bg-[#0C3D68] rounded-md cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{itemEditId ? 'Salvar produto' : 'Adicionar produto'}</span>
              </button>
              {itemEditId && (
                <button
                  type="button"
                  onClick={() => {
                    setItemEditId(null);
                    setItemCodigo('');
                    setItemNome('');
                    setItemUnidade('un');
                    setItemEstoque('0');
                    setItemEstoqueOriginal(null);
                    setItemMaximo('10');
                  }}
                  className="h-9 px-3 text-xs font-medium text-slate-700 border border-slate-300 rounded-md cursor-pointer"
                >
                  Cancelar edição
                </button>
              )}
            </div>
          </form>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 font-semibold text-slate-700">
                  <th className="py-2.5 px-4">Código</th>
                  <th className="py-2.5 px-3">Material</th>
                  <th className="py-2.5 px-3">Unidade</th>
                  <th className="py-2.5 px-3 text-right">Estoque atual</th>
                  <th className="py-2.5 px-3 text-right">Máximo global</th>
                  <th className="py-2.5 px-3">Situação</th>
                  <th className="py-2.5 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {itens.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono tabular-nums font-semibold text-slate-900">{item.codigo}</td>
                    <td className="py-2.5 px-3 font-medium text-slate-900">{item.nome}</td>
                    <td className="py-2.5 px-3 text-slate-600">{item.unidade}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {item.estoqueAtual}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-800">
                      {item.limiteMaximo}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={item.ativo ? 'text-emerald-800 font-medium' : 'text-slate-500'}>
                        {item.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right space-x-2">
                      <button
                        type="button"
                        onClick={() => {
                          setItemEditId(item.id);
                          setItemCodigo(item.codigo);
                          setItemNome(item.nome);
                          setItemUnidade(item.unidade);
                          setItemEstoque(String(item.estoqueAtual));
                          setItemEstoqueOriginal(item.estoqueAtual);
                          setItemMaximo(String(item.limiteMaximo));
                        }}
                        className="text-xs font-medium text-[#0F4C81] hover:underline cursor-pointer"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleToggleItem(item)}
                        className="text-xs font-medium text-slate-700 hover:underline cursor-pointer"
                      >
                        {item.ativo ? 'Desativar' : 'Ativar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ABA PARÂMETROS POR TÉCNICO */}
      {aba === 'parametros' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="w-full sm:w-80">
              <label htmlFor="param-tec" className="block text-xs font-medium text-slate-700 mb-1.5">
                Selecionar técnico para configurar mínimos manuais
              </label>
              <select
                id="param-tec"
                value={paramTecId}
                onChange={(e) => setParamTecId(e.target.value)}
                className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md"
              >
                {tecnicos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.matricula} — {t.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="text-xs text-slate-600">
              Consumo simulado de referência: <strong className="text-slate-900">{paramCompetencia}</strong>
              {' · '}Deixe o mínimo manual vazio para usar o alvo-base derivado.
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 font-semibold text-slate-700">
                  <th className="py-2.5 px-4">Produto</th>
                  <th className="py-2.5 px-3 text-right">Uso mês ant.</th>
                  <th className="py-2.5 px-3 text-right">Alvo-base (derivado)</th>
                  <th className="py-2.5 px-3 text-right">Saldo téc.</th>
                  <th className="py-2.5 px-3 text-right">Máximo global</th>
                  <th className="py-2.5 px-3">Mínimo efetivo</th>
                  <th className="py-2.5 px-4">Definir mínimo manual</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {paramItens.map((p) => (
                  <tr key={p.itemId} className="hover:bg-slate-50">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{p.nome}</div>
                      <div className="font-mono text-slate-500">{p.codigo} · {p.unidade}</div>
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800">{p.usoMesAnterior}</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">{p.alvoBase}</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800">{p.saldoTecnico}</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800">{p.limiteMaximo}</td>
                    <td className="py-3 px-3">
                      <div className="font-mono tabular-nums font-semibold text-slate-900">
                        {p.minimoEfetivo} ({p.minimoOrigem === 'MANUAL' ? 'Manual' : 'Derivado'})
                      </div>
                      {p.alertaMinimoMaiorMaximo && (
                        <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800">
                          <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
                          <span>Mínimo supera máximo do produto</span>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          aria-label={`Mínimo manual para ${p.nome}`}
                          value={paramDrafts[p.itemId] ?? ''}
                          onChange={(e) => setParamDrafts((prev) => ({ ...prev, [p.itemId]: e.target.value }))}
                          placeholder="Derivado"
                          className="w-24 h-8 px-2.5 text-xs font-mono tabular-nums border border-slate-300 rounded"
                        />
                        <button
                          type="button"
                          onClick={() => void handleSalvarMinimo(p.itemId, false)}
                          className="h-8 px-2.5 inline-flex items-center gap-1 text-xs font-medium text-white bg-[#0F4C81] hover:bg-[#0C3D68] rounded cursor-pointer"
                        >
                          <Save className="w-3 h-3" aria-hidden="true" />
                          <span>Salvar</span>
                        </button>
                        {p.minimoManual !== null && (
                          <button
                            type="button"
                            onClick={() => void handleSalvarMinimo(p.itemId, true)}
                            title="Remover mínimo manual e voltar ao derivado"
                            className="h-8 px-2 inline-flex items-center gap-1 text-xs text-slate-600 border border-slate-300 hover:bg-slate-100 rounded cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" aria-hidden="true" />
                            <span>Limpar</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ABA USUÁRIOS */}
      {aba === 'usuarios' && (
        <div className="space-y-5">
          <form onSubmit={handleCriarUsuario} className="bg-white border border-slate-200 rounded-lg p-5">
            <h2 className="text-sm font-bold text-slate-900 mb-3">Cadastrar novo usuário (Coordenador ou Estoque)</h2>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
              <div>
                <label htmlFor="usr-nome" className="block text-xs font-medium text-slate-700 mb-1">
                  Nome de exibição
                </label>
                <input
                  id="usr-nome"
                  required
                  value={usrNome}
                  onChange={(e) => setUsrNome(e.target.value)}
                  placeholder="Ex.: João Almoxarifado"
                  className="w-full h-9 px-3 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="usr-login" className="block text-xs font-medium text-slate-700 mb-1">
                  Login (usuário)
                </label>
                <input
                  id="usr-login"
                  required
                  value={usrUsername}
                  onChange={(e) => setUsrUsername(e.target.value)}
                  placeholder="joao.estoque"
                  className="w-full h-9 px-3 text-sm font-mono border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="usr-senha" className="block text-xs font-medium text-slate-700 mb-1">
                  Senha inicial (mín. 12)
                </label>
                <input
                  id="usr-senha"
                  type="password"
                  minLength={12}
                  required
                  value={usrPassword}
                  onChange={(e) => setUsrPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-9 px-3 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="usr-perfil" className="block text-xs font-medium text-slate-700 mb-1">
                  Perfil de acesso
                </label>
                <select
                  id="usr-perfil"
                  value={usrPerfil}
                  onChange={(e) => setUsrPerfil(e.target.value as PerfilUsuario)}
                  className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-md"
                >
                  <option value="ESTOQUE">ESTOQUE</option>
                  <option value="COORDENADOR">COORDENADOR</option>
                </select>
              </div>
            </div>
            <div className="mt-4">
              <button
                type="submit"
                className="h-9 px-4 inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-[#0F4C81] hover:bg-[#0C3D68] rounded-md cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Criar usuário</span>
              </button>
            </div>
          </form>

          {resetUserId !== null && (
            <form onSubmit={handleResetSenha} className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[200px]">
                <label htmlFor="nova-senha" className="block text-xs font-semibold text-amber-950 mb-1">
                  Nova senha para {usuarios.find((u) => u.id === resetUserId)?.username}
                </label>
                <input
                  id="nova-senha"
                  type="password"
                  minLength={12}
                  required
                  value={resetPass}
                  onChange={(e) => setResetPass(e.target.value)}
                  placeholder="Mínimo 12 caracteres"
                  className="w-full h-9 px-3 text-sm bg-white border border-amber-300 rounded-md"
                />
              </div>
              <button
                type="submit"
                className="h-9 px-4 text-xs font-semibold text-white bg-amber-800 hover:bg-amber-900 rounded-md cursor-pointer"
              >
                Confirmar nova senha
              </button>
              <button
                type="button"
                onClick={() => {
                  setResetUserId(null);
                  setResetPass('');
                }}
                className="h-9 px-3 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md cursor-pointer"
              >
                Cancelar
              </button>
            </form>
          )}

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 font-semibold text-slate-700">
                  <th className="py-2.5 px-4">Nome</th>
                  <th className="py-2.5 px-3">Login</th>
                  <th className="py-2.5 px-3">Perfil</th>
                  <th className="py-2.5 px-3">Situação</th>
                  <th className="py-2.5 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {usuarios.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-medium text-slate-900">{u.nome}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-700">{u.username}</td>
                    <td className="py-2.5 px-3 font-medium text-slate-800">{u.perfil}</td>
                    <td className="py-2.5 px-3">
                      <span className={u.ativo ? 'text-emerald-800 font-medium' : 'text-slate-500'}>
                        {u.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right space-x-3">
                      <button
                        type="button"
                        onClick={() => {
                          setResetUserId(u.id);
                          setResetPass('');
                        }}
                        className="inline-flex items-center gap-1 text-xs font-medium text-[#0F4C81] hover:underline cursor-pointer"
                      >
                        <KeyRound className="w-3 h-3" aria-hidden="true" />
                        <span>Redefinir senha</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleToggleUsuario(u)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:underline cursor-pointer"
                      >
                        {u.ativo ? (
                          <>
                            <UserX className="w-3 h-3" aria-hidden="true" />
                            <span>Desativar</span>
                          </>
                        ) : (
                          <>
                            <UserCheck className="w-3 h-3" aria-hidden="true" />
                            <span>Ativar</span>
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loading && <div className="text-xs text-slate-500">Atualizando dados...</div>}
    </div>
  );
}
