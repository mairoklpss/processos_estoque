import crypto from 'crypto';
import type {
  DashboardSummaryDTO,
  ItemProduto,
  ParametroTecnicoItem,
  PendenciaDTO,
  PerfilUsuario,
  SeparacaoCoordenadorDTO,
  SeparacaoEstoqueDetalheDTO,
  SeparacaoEstoqueFilaDTO,
  SeparacaoItemCoordenadorDTO,
  SeparacaoResumoCoordenadorDTO,
  StatusSeparacao,
  Tecnico,
  UsuarioPublico,
} from '../src/shared/types.ts';
import { calcularPropostaItem, recalcularDisponibilidade, REGRA_VERSAO } from './calculo.ts';
import { hashPassword, verifyPassword, type DBInstance } from './db.ts';
import { getClosedPreviousMonth, nowIso } from './periodo.ts';

export class AppError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = 'APP_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface SessionUser {
  id: number;
  nome: string;
  username: string;
  perfil: PerfilUsuario;
}

const SESSION_TTL_HOURS = 12;
export const AMBIENTE_LABEL = 'Ambiente de demonstração · Dados simulados (sem conexão IXC)';

// ---------------- AUTH ----------------

export function loginUsuario(
  db: DBInstance,
  username: string,
  password: string
): { token: string; user: SessionUser; expiresAt: string } {
  const cleanUser = username.trim().toLowerCase();
  if (!cleanUser || !password) {
    throw new AppError(400, 'Informe usuário e senha.', 'INVALID_INPUT');
  }

  const row = db
    .prepare('SELECT id, nome, username, senha_hash, perfil, ativo FROM usuarios WHERE LOWER(username) = ?')
    .get(cleanUser) as
    | {
        id: number;
        nome: string;
        username: string;
        senha_hash: string;
        perfil: PerfilUsuario;
        ativo: number;
      }
    | undefined;

  if (!row || !verifyPassword(password, row.senha_hash)) {
    throw new AppError(401, 'Usuário ou senha inválidos.', 'INVALID_CREDENTIALS');
  }

  if (row.ativo !== 1) {
    throw new AppError(403, 'Usuário desativado. Procure a coordenação.', 'USER_INACTIVE');
  }

  const token = crypto.randomBytes(32).toString('hex');
  const created = new Date();
  const expires = new Date(created.getTime() + SESSION_TTL_HOURS * 3600 * 1000);

  db.prepare('INSERT INTO sessoes (token, usuario_id, criado_em, expira_em) VALUES (?, ?, ?, ?)').run(
    token,
    row.id,
    created.toISOString(),
    expires.toISOString()
  );

  return {
    token,
    expiresAt: expires.toISOString(),
    user: {
      id: row.id,
      nome: row.nome,
      username: row.username,
      perfil: row.perfil,
    },
  };
}

export function getUsuarioBySession(db: DBInstance, token: string | undefined): SessionUser | null {
  if (!token) return null;

  const row = db
    .prepare(`
      SELECT u.id, u.nome, u.username, u.perfil, u.ativo, s.expira_em
      FROM sessoes s
      JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token = ?
    `)
    .get(token) as
    | {
        id: number;
        nome: string;
        username: string;
        perfil: PerfilUsuario;
        ativo: number;
        expira_em: string;
      }
    | undefined;

  if (!row) return null;

  if (new Date(row.expira_em).getTime() <= Date.now()) {
    db.prepare('DELETE FROM sessoes WHERE token = ?').run(token);
    return null;
  }

  if (row.ativo !== 1) {
    return null;
  }

  return {
    id: row.id,
    nome: row.nome,
    username: row.username,
    perfil: row.perfil,
  };
}

export function logoutSessao(db: DBInstance, token: string | undefined): void {
  if (!token) return;
  db.prepare('DELETE FROM sessoes WHERE token = ?').run(token);
}

// ---------------- COORDENADOR: RESUMO ----------------

export function getDashboardSummary(db: DBInstance, now: Date = new Date()): DashboardSummaryDTO {
  const periodo = getClosedPreviousMonth(now);
  const tecnicosAtivos = (db.prepare('SELECT COUNT(*) as c FROM tecnicos WHERE ativo = 1').get() as { c: number }).c;
  const itensAtivos = (db.prepare('SELECT COUNT(*) as c FROM itens WHERE ativo = 1').get() as { c: number }).c;
  const rascunhosAbertos = (
    db.prepare("SELECT COUNT(*) as c FROM separacoes WHERE status = 'RASCUNHO'").get() as { c: number }
  ).c;
  const naFilaEstoque = (
    db.prepare("SELECT COUNT(*) as c FROM separacoes WHERE status = 'CALCULADA'").get() as { c: number }
  ).c;
  const pendenciasAbertas = (
    db.prepare("SELECT COUNT(*) as c FROM pendencias WHERE status = 'ABERTA'").get() as { c: number }
  ).c;

  return {
    competencia: periodo.competencia,
    competenciaLabel: periodo.label,
    tecnicosAtivos,
    itensAtivos,
    rascunhosAbertos,
    naFilaEstoque,
    pendenciasAbertas,
    ambiente: AMBIENTE_LABEL,
  };
}

// ---------------- COORDENADOR: TÉCNICOS ----------------

export function listarTecnicos(db: DBInstance): Tecnico[] {
  const rows = db
    .prepare('SELECT id, matricula, nome, regiao, ativo, criado_em, atualizado_em FROM tecnicos ORDER BY ativo DESC, nome ASC')
    .all() as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: Number(r.id),
    matricula: String(r.matricula),
    nome: String(r.nome),
    regiao: String(r.regiao),
    ativo: Number(r.ativo) === 1,
    criadoEm: String(r.criado_em),
    atualizadoEm: String(r.atualizado_em),
  }));
}

export function criarTecnico(
  db: DBInstance,
  input: { matricula: string; nome: string; regiao?: string }
): Tecnico {
  const matricula = input.matricula?.trim().toUpperCase();
  const nome = input.nome?.trim();
  const regiao = (input.regiao ?? '').trim();

  if (!matricula || !nome) {
    throw new AppError(400, 'Matrícula e nome do técnico são obrigatórios.', 'VALIDATION_ERROR');
  }

  const exists = db.prepare('SELECT id FROM tecnicos WHERE UPPER(matricula) = ?').get(matricula);
  if (exists) {
    throw new AppError(409, `Já existe um técnico com a matrícula ${matricula}.`, 'DUPLICATE_MATRICULA');
  }

  const ts = nowIso();
  const res = db
    .prepare(
      'INSERT INTO tecnicos (matricula, nome, regiao, ativo, criado_em, atualizado_em) VALUES (?, ?, ?, 1, ?, ?)'
    )
    .run(matricula, nome, regiao, ts, ts);

  return listarTecnicos(db).find((t) => t.id === Number(res.lastInsertRowid))!;
}

export function atualizarTecnico(
  db: DBInstance,
  id: number,
  input: { matricula?: string; nome?: string; regiao?: string; ativo?: boolean }
): Tecnico {
  const current = db.prepare('SELECT * FROM tecnicos WHERE id = ?').get(id) as
    | { id: number; matricula: string; nome: string; regiao: string; ativo: number }
    | undefined;
  if (!current) {
    throw new AppError(404, 'Técnico não encontrado.', 'NOT_FOUND');
  }

  const matricula = input.matricula !== undefined ? input.matricula.trim().toUpperCase() : current.matricula;
  const nome = input.nome !== undefined ? input.nome.trim() : current.nome;
  const regiao = input.regiao !== undefined ? input.regiao.trim() : current.regiao;
  const ativo = input.ativo !== undefined ? (input.ativo ? 1 : 0) : current.ativo;

  if (!matricula || !nome) {
    throw new AppError(400, 'Matrícula e nome do técnico não podem ficar vazios.', 'VALIDATION_ERROR');
  }

  const dup = db
    .prepare('SELECT id FROM tecnicos WHERE UPPER(matricula) = ? AND id != ?')
    .get(matricula, id);
  if (dup) {
    throw new AppError(409, `Já existe outro técnico com a matrícula ${matricula}.`, 'DUPLICATE_MATRICULA');
  }

  db.prepare('UPDATE tecnicos SET matricula = ?, nome = ?, regiao = ?, ativo = ?, atualizado_em = ? WHERE id = ?').run(
    matricula,
    nome,
    regiao,
    ativo,
    nowIso(),
    id
  );

  return listarTecnicos(db).find((t) => t.id === id)!;
}

// ---------------- COORDENADOR: PRODUTOS ----------------

export function listarItens(db: DBInstance): ItemProduto[] {
  const rows = db
    .prepare(
      'SELECT id, codigo, nome, unidade, estoque_atual, limite_maximo, ativo, criado_em, atualizado_em FROM itens ORDER BY ativo DESC, codigo ASC'
    )
    .all() as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: Number(r.id),
    codigo: String(r.codigo),
    nome: String(r.nome),
    unidade: String(r.unidade),
    estoqueAtual: Number(r.estoque_atual),
    limiteMaximo: Number(r.limite_maximo),
    ativo: Number(r.ativo) === 1,
    criadoEm: String(r.criado_em),
    atualizadoEm: String(r.atualizado_em),
  }));
}

export function criarItem(
  db: DBInstance,
  input: { codigo: string; nome: string; unidade?: string; estoqueAtual: number; limiteMaximo: number }
): ItemProduto {
  const codigo = input.codigo?.trim().toUpperCase();
  const nome = input.nome?.trim();
  const unidade = (input.unidade ?? 'un').trim() || 'un';
  const estoqueAtual = Number(input.estoqueAtual);
  const limiteMaximo = Number(input.limiteMaximo);

  if (!codigo || !nome) {
    throw new AppError(400, 'Código e nome do produto são obrigatórios.', 'VALIDATION_ERROR');
  }
  if (!Number.isInteger(estoqueAtual) || estoqueAtual < 0) {
    throw new AppError(400, 'Estoque atual deve ser um inteiro não negativo.', 'VALIDATION_ERROR');
  }
  if (!Number.isInteger(limiteMaximo) || limiteMaximo <= 0) {
    throw new AppError(400, 'Limite máximo global é obrigatório e deve ser maior que zero.', 'VALIDATION_ERROR');
  }

  const dup = db.prepare('SELECT id FROM itens WHERE UPPER(codigo) = ?').get(codigo);
  if (dup) {
    throw new AppError(409, `Já existe um produto com o código ${codigo}.`, 'DUPLICATE_CODE');
  }

  const ts = nowIso();
  const res = db
    .prepare(
      'INSERT INTO itens (codigo, nome, unidade, estoque_atual, limite_maximo, ativo, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, 1, ?, ?)'
    )
    .run(codigo, nome, unidade, estoqueAtual, limiteMaximo, ts, ts);

  return listarItens(db).find((i) => i.id === Number(res.lastInsertRowid))!;
}

export function atualizarItem(
  db: DBInstance,
  id: number,
  input: {
    codigo?: string;
    nome?: string;
    unidade?: string;
    estoqueAtual?: number;
    limiteMaximo?: number;
    ativo?: boolean;
  }
): ItemProduto {
  const current = db.prepare('SELECT * FROM itens WHERE id = ?').get(id) as
    | {
        id: number;
        codigo: string;
        nome: string;
        unidade: string;
        estoque_atual: number;
        limite_maximo: number;
        ativo: number;
      }
    | undefined;
  if (!current) {
    throw new AppError(404, 'Produto não encontrado.', 'NOT_FOUND');
  }

  const codigo = input.codigo !== undefined ? input.codigo.trim().toUpperCase() : current.codigo;
  const nome = input.nome !== undefined ? input.nome.trim() : current.nome;
  const unidade = input.unidade !== undefined ? input.unidade.trim() || 'un' : current.unidade;
  const estoqueAtual = input.estoqueAtual !== undefined ? Number(input.estoqueAtual) : current.estoque_atual;
  const limiteMaximo = input.limiteMaximo !== undefined ? Number(input.limiteMaximo) : current.limite_maximo;
  const ativo = input.ativo !== undefined ? (input.ativo ? 1 : 0) : current.ativo;

  if (!codigo || !nome) {
    throw new AppError(400, 'Código e nome do produto são obrigatórios.', 'VALIDATION_ERROR');
  }
  if (!Number.isInteger(estoqueAtual) || estoqueAtual < 0) {
    throw new AppError(400, 'Estoque atual deve ser um inteiro não negativo.', 'VALIDATION_ERROR');
  }
  if (!Number.isInteger(limiteMaximo) || limiteMaximo <= 0) {
    throw new AppError(400, 'Limite máximo global é obrigatório e deve ser maior que zero.', 'VALIDATION_ERROR');
  }

  const dup = db.prepare('SELECT id FROM itens WHERE UPPER(codigo) = ? AND id != ?').get(codigo, id);
  if (dup) {
    throw new AppError(409, `Já existe outro produto com o código ${codigo}.`, 'DUPLICATE_CODE');
  }

  db.prepare(
    'UPDATE itens SET codigo = ?, nome = ?, unidade = ?, estoque_atual = ?, limite_maximo = ?, ativo = ?, atualizado_em = ? WHERE id = ?'
  ).run(codigo, nome, unidade, estoqueAtual, limiteMaximo, ativo, nowIso(), id);

  return listarItens(db).find((i) => i.id === id)!;
}

// ---------------- COORDENADOR: PARÂMETROS POR TÉCNICO ----------------

export function listarParametrosTecnico(
  db: DBInstance,
  tecnicoId: number,
  now: Date = new Date()
): { tecnico: Tecnico; competencia: string; competenciaLabel: string; itens: ParametroTecnicoItem[] } {
  const tecnico = listarTecnicos(db).find((t) => t.id === tecnicoId);
  if (!tecnico) {
    throw new AppError(404, 'Técnico não encontrado.', 'NOT_FOUND');
  }

  const periodo = getClosedPreviousMonth(now);
  const itens = listarItens(db);

  const minimosRows = db
    .prepare('SELECT item_id, minimo_manual FROM minimos_tecnicos WHERE tecnico_id = ?')
    .all(tecnicoId) as Array<{ item_id: number; minimo_manual: number }>;
  const minimosMap = new Map(minimosRows.map((m) => [m.item_id, m.minimo_manual]));

  const consumosRows = db
    .prepare('SELECT item_id, quantidade_usada FROM consumos WHERE tecnico_id = ? AND competencia = ?')
    .all(tecnicoId, periodo.competencia) as Array<{ item_id: number; quantidade_usada: number }>;
  const consumosMap = new Map(consumosRows.map((c) => [c.item_id, c.quantidade_usada]));

  const saldosRows = db
    .prepare('SELECT item_id, quantidade FROM saldos_tecnicos WHERE tecnico_id = ?')
    .all(tecnicoId) as Array<{ item_id: number; quantidade: number }>;
  const saldosMap = new Map(saldosRows.map((s) => [s.item_id, s.quantidade]));

  const lista: ParametroTecnicoItem[] = itens.map((item) => {
    const usoMesAnterior = consumosMap.get(item.id) ?? 0;
    const saldoTecnico = saldosMap.get(item.id) ?? 0;
    const minimoManual = minimosMap.has(item.id) ? minimosMap.get(item.id)! : null;
    const calc = calcularPropostaItem({
      usoMesAnterior,
      minimoManual,
      limiteMaximo: item.limiteMaximo,
      saldoTecnico,
      estoqueAtual: item.estoqueAtual,
    });

    return {
      itemId: item.id,
      codigo: item.codigo,
      nome: item.nome,
      unidade: item.unidade,
      ativo: item.ativo,
      limiteMaximo: item.limiteMaximo,
      estoqueAtual: item.estoqueAtual,
      usoMesAnterior,
      saldoTecnico,
      alvoBase: calc.alvoBase,
      minimoManual,
      minimoEfetivo: calc.minimoEfetivo,
      minimoOrigem: calc.minimoOrigem,
      alertaMinimoMaiorMaximo: calc.alertaMinimoMaiorMaximo,
    };
  });

  return {
    tecnico,
    competencia: periodo.competencia,
    competenciaLabel: periodo.label,
    itens: lista,
  };
}

export function definirMinimoManual(
  db: DBInstance,
  tecnicoId: number,
  itemId: number,
  minimoManual: number | null
): { minimoManual: number | null; alertaMinimoMaiorMaximo: boolean } {
  const tec = db.prepare('SELECT id FROM tecnicos WHERE id = ?').get(tecnicoId);
  if (!tec) throw new AppError(404, 'Técnico não encontrado.', 'NOT_FOUND');

  const item = db.prepare('SELECT id, limite_maximo FROM itens WHERE id = ?').get(itemId) as
    | { id: number; limite_maximo: number }
    | undefined;
  if (!item) throw new AppError(404, 'Produto não encontrado.', 'NOT_FOUND');

  if (minimoManual === null) {
    db.prepare('DELETE FROM minimos_tecnicos WHERE tecnico_id = ? AND item_id = ?').run(tecnicoId, itemId);
    return { minimoManual: null, alertaMinimoMaiorMaximo: false };
  }

  const parsed = Number(minimoManual);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new AppError(400, 'Mínimo manual deve ser um inteiro não negativo.', 'VALIDATION_ERROR');
  }

  db.prepare(`
    INSERT INTO minimos_tecnicos (tecnico_id, item_id, minimo_manual, atualizado_em)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(tecnico_id, item_id) DO UPDATE SET
      minimo_manual = excluded.minimo_manual,
      atualizado_em = excluded.atualizado_em
  `).run(tecnicoId, itemId, parsed, nowIso());

  return {
    minimoManual: parsed,
    alertaMinimoMaiorMaximo: parsed > item.limite_maximo,
  };
}

// ---------------- COORDENADOR: USUÁRIOS ----------------

export function listarUsuarios(db: DBInstance): UsuarioPublico[] {
  const rows = db
    .prepare('SELECT id, nome, username, perfil, ativo, criado_em, atualizado_em FROM usuarios ORDER BY id ASC')
    .all() as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: Number(r.id),
    nome: String(r.nome),
    username: String(r.username),
    perfil: r.perfil as PerfilUsuario,
    ativo: Number(r.ativo) === 1,
    criadoEm: String(r.criado_em),
    atualizadoEm: String(r.atualizado_em),
  }));
}

export function criarUsuario(
  db: DBInstance,
  input: { nome: string; username: string; password: string; perfil: PerfilUsuario }
): UsuarioPublico {
  const nome = input.nome?.trim();
  const username = input.username?.trim().toLowerCase();
  const password = input.password ?? '';
  const perfil = input.perfil;

  if (!nome || !username || !password) {
    throw new AppError(400, 'Nome, usuário e senha são obrigatórios.', 'VALIDATION_ERROR');
  }
  if (password.length < 6) {
    throw new AppError(400, 'A senha deve ter pelo menos 6 caracteres.', 'VALIDATION_ERROR');
  }
  if (perfil !== 'COORDENADOR' && perfil !== 'ESTOQUE') {
    throw new AppError(400, 'Perfil inválido.', 'VALIDATION_ERROR');
  }

  const dup = db.prepare('SELECT id FROM usuarios WHERE LOWER(username) = ?').get(username);
  if (dup) {
    throw new AppError(409, `Já existe um usuário com login "${username}".`, 'DUPLICATE_USERNAME');
  }

  const ts = nowIso();
  const res = db
    .prepare(
      'INSERT INTO usuarios (nome, username, senha_hash, perfil, ativo, criado_em, atualizado_em) VALUES (?, ?, ?, ?, 1, ?, ?)'
    )
    .run(nome, username, hashPassword(password), perfil, ts, ts);

  return listarUsuarios(db).find((u) => u.id === Number(res.lastInsertRowid))!;
}

export function atualizarUsuario(
  db: DBInstance,
  actorId: number,
  id: number,
  input: { nome?: string; perfil?: PerfilUsuario; ativo?: boolean }
): UsuarioPublico {
  const current = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id) as
    | { id: number; nome: string; username: string; perfil: PerfilUsuario; ativo: number }
    | undefined;
  if (!current) throw new AppError(404, 'Usuário não encontrado.', 'NOT_FOUND');

  const nome = input.nome !== undefined ? input.nome.trim() : current.nome;
  const perfil = input.perfil !== undefined ? input.perfil : current.perfil;
  const ativo = input.ativo !== undefined ? (input.ativo ? 1 : 0) : current.ativo;

  if (!nome) throw new AppError(400, 'Nome não pode ficar vazio.', 'VALIDATION_ERROR');
  if (perfil !== 'COORDENADOR' && perfil !== 'ESTOQUE') {
    throw new AppError(400, 'Perfil inválido.', 'VALIDATION_ERROR');
  }
  if (id === actorId && ativo === 0) {
    throw new AppError(400, 'Você não pode desativar o próprio usuário logado.', 'SELF_DEACTIVATE');
  }

  db.prepare('UPDATE usuarios SET nome = ?, perfil = ?, ativo = ?, atualizado_em = ? WHERE id = ?').run(
    nome,
    perfil,
    ativo,
    nowIso(),
    id
  );

  if (ativo === 0) {
    db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(id);
  }

  return listarUsuarios(db).find((u) => u.id === id)!;
}

export function redefinirSenhaUsuario(db: DBInstance, id: number, novaSenha: string): void {
  const current = db.prepare('SELECT id FROM usuarios WHERE id = ?').get(id);
  if (!current) throw new AppError(404, 'Usuário não encontrado.', 'NOT_FOUND');
  if (!novaSenha || novaSenha.length < 6) {
    throw new AppError(400, 'A nova senha deve ter pelo menos 6 caracteres.', 'VALIDATION_ERROR');
  }

  db.prepare('UPDATE usuarios SET senha_hash = ?, atualizado_em = ? WHERE id = ?').run(
    hashPassword(novaSenha),
    nowIso(),
    id
  );
  // Invalida sessões antigas após troca de senha
  db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(id);
}

// ---------------- COORDENADOR: SEPARAÇÃO (CALCULAR, REVISAR, ENVIAR, HISTÓRICO) ----------------

function mapSeparacaoItemCoordenador(r: Record<string, unknown>): SeparacaoItemCoordenadorDTO {
  return {
    id: Number(r.id),
    separacaoId: Number(r.separacao_id),
    itemId: Number(r.item_id),
    itemCodigo: String(r.item_codigo_snapshot),
    itemNome: String(r.item_nome_snapshot),
    unidade: String(r.unidade_snapshot),
    usoMesAnterior: Number(r.uso_mes_anterior),
    demandaSemanalExata: Number(r.demanda_semanal_exata),
    demandaDiariaInformativa: Number(r.demanda_diaria_informativa),
    alvoBase: Number(r.alvo_base),
    minimoManual: r.minimo_manual_snapshot !== null ? Number(r.minimo_manual_snapshot) : null,
    minimoEfetivo: Number(r.minimo_efetivo),
    minimoOrigem: String(r.minimo_origem) as 'MANUAL' | 'DERIVADO',
    limiteMaximo: Number(r.limite_maximo_snapshot),
    alvoKit: Number(r.alvo_kit),
    saldoTecnico: Number(r.saldo_tecnico_snapshot),
    estoqueAlmoxarifado: Number(r.estoque_almoxarifado_snapshot),
    quantidadeCalculadaOriginal: Number(r.quantidade_calculada_original),
    quantidadeSolicitada: Number(r.quantidade_solicitada),
    quantidadeDisponivel: Number(r.quantidade_disponivel),
    faltante: Number(r.faltante),
    ajusteJustificativa: r.ajuste_justificativa !== null ? String(r.ajuste_justificativa) : null,
    ajustadoPorNome: r.ajustado_por_nome !== null ? String(r.ajustado_por_nome) : null,
    ajustadoEm: r.ajustado_em !== null ? String(r.ajustado_em) : null,
    comparacaoLimites: String(r.comparacao_limites) as SeparacaoItemCoordenadorDTO['comparacaoLimites'],
    consumoAtipico: Number(r.consumo_atipico) === 1,
    semConsumo: Number(r.sem_consumo) === 1,
    semSaldoAlmoxarifado: Number(r.sem_saldo_almoxarifado) === 1,
    alertaMinimoMaiorMaximo: Number(r.alerta_minimo_maior_maximo) === 1,
    quantidadeEntregue: r.quantidade_entregue !== null ? Number(r.quantidade_entregue) : null,
  };
}

export function obterSeparacaoCoordenador(db: DBInstance, id: number): SeparacaoCoordenadorDTO {
  const sep = db.prepare('SELECT * FROM separacoes WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!sep) {
    throw new AppError(404, 'Separação não encontrada.', 'NOT_FOUND');
  }

  const itemRows = db
    .prepare('SELECT * FROM separacao_itens WHERE separacao_id = ? ORDER BY item_codigo_snapshot ASC')
    .all(id) as Array<Record<string, unknown>>;

  return {
    id: Number(sep.id),
    codigo: String(sep.codigo),
    tecnicoId: Number(sep.tecnico_id),
    tecnicoNome: String(sep.tecnico_nome_snapshot),
    competencia: String(sep.competencia),
    competenciaLabel: String(sep.competencia_label),
    regraVersao: String(sep.regra_versao),
    status: String(sep.status) as StatusSeparacao,
    calculadoPorNome: String(sep.calculado_por_nome),
    calculadoEm: String(sep.calculado_em),
    enviadoPorNome: sep.enviado_por_nome !== null ? String(sep.enviado_por_nome) : null,
    enviadoEm: sep.enviado_em !== null ? String(sep.enviado_em) : null,
    confirmadoPorNome: sep.confirmado_por_nome !== null ? String(sep.confirmado_por_nome) : null,
    confirmadoEm: sep.confirmado_em !== null ? String(sep.confirmado_em) : null,
    observacoes: sep.observacoes !== null ? String(sep.observacoes) : null,
    itens: itemRows.map(mapSeparacaoItemCoordenador),
  };
}

export function calcularSeparacaoRascunho(
  db: DBInstance,
  user: SessionUser,
  tecnicoId: number,
  observacoes?: string,
  now: Date = new Date()
): SeparacaoCoordenadorDTO {
  const tecnico = db
    .prepare('SELECT id, matricula, nome, ativo FROM tecnicos WHERE id = ?')
    .get(tecnicoId) as { id: number; matricula: string; nome: string; ativo: number } | undefined;

  if (!tecnico) {
    throw new AppError(404, 'Técnico não encontrado.', 'NOT_FOUND');
  }
  if (tecnico.ativo !== 1) {
    throw new AppError(400, 'Apenas técnicos ativos podem receber cálculo de separação.', 'INACTIVE_TECH');
  }

  const itensAtivos = db
    .prepare('SELECT id, codigo, nome, unidade, estoque_atual, limite_maximo FROM itens WHERE ativo = 1 ORDER BY codigo ASC')
    .all() as Array<{
    id: number;
    codigo: string;
    nome: string;
    unidade: string;
    estoque_atual: number;
    limite_maximo: number;
  }>;

  if (itensAtivos.length === 0) {
    throw new AppError(400, 'Não há produtos ativos cadastrados para calcular a separação.', 'NO_ACTIVE_ITEMS');
  }

  const periodo = getClosedPreviousMonth(now);
  const ts = now.toISOString();

  const minimosRows = db
    .prepare('SELECT item_id, minimo_manual FROM minimos_tecnicos WHERE tecnico_id = ?')
    .all(tecnicoId) as Array<{ item_id: number; minimo_manual: number }>;
  const minimosMap = new Map(minimosRows.map((m) => [m.item_id, m.minimo_manual]));

  const consumosRows = db
    .prepare('SELECT item_id, quantidade_usada FROM consumos WHERE tecnico_id = ? AND competencia = ?')
    .all(tecnicoId, periodo.competencia) as Array<{ item_id: number; quantidade_usada: number }>;
  const consumosMap = new Map(consumosRows.map((c) => [c.item_id, c.quantidade_usada]));

  const saldosRows = db
    .prepare('SELECT item_id, quantidade FROM saldos_tecnicos WHERE tecnico_id = ?')
    .all(tecnicoId) as Array<{ item_id: number; quantidade: number }>;
  const saldosMap = new Map(saldosRows.map((s) => [s.item_id, s.quantidade]));

  const insertSep = db.transaction(() => {
    const seqRow = db.prepare('SELECT COUNT(*) as c FROM separacoes').get() as { c: number };
    const seqNum = String(seqRow.c + 1).padStart(4, '0');
    const randSuffix = crypto.randomBytes(2).toString('hex').toUpperCase();
    const codigo = `SEP-${periodo.competencia.replace('-', '')}-${seqNum}-${randSuffix}`;

    const sepRes = db
      .prepare(`
        INSERT INTO separacoes (
          codigo, tecnico_id, tecnico_nome_snapshot, competencia, competencia_label,
          regra_versao, status, calculado_por_id, calculado_por_nome, calculado_em, observacoes
        ) VALUES (?, ?, ?, ?, ?, ?, 'RASCUNHO', ?, ?, ?, ?)
      `)
      .run(
        codigo,
        tecnico.id,
        tecnico.nome,
        periodo.competencia,
        periodo.label,
        REGRA_VERSAO,
        user.id,
        user.nome,
        ts,
        observacoes?.trim() || null
      );

    const separacaoId = Number(sepRes.lastInsertRowid);

    const insertItemStmt = db.prepare(`
      INSERT INTO separacao_itens (
        separacao_id, item_id, item_codigo_snapshot, item_nome_snapshot, unidade_snapshot,
        uso_mes_anterior, demanda_semanal_exata, demanda_diaria_informativa, alvo_base,
        minimo_manual_snapshot, minimo_efetivo, minimo_origem, limite_maximo_snapshot, alvo_kit,
        saldo_tecnico_snapshot, estoque_almoxarifado_snapshot,
        quantidade_calculada_original, quantidade_solicitada, quantidade_disponivel, faltante,
        comparacao_limites, consumo_atipico, sem_consumo, sem_saldo_almoxarifado, alerta_minimo_maior_maximo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of itensAtivos) {
      const usoMesAnterior = consumosMap.get(item.id) ?? 0;
      const minimoManual = minimosMap.has(item.id) ? minimosMap.get(item.id)! : null;
      const saldoTecnico = saldosMap.get(item.id) ?? 0;

      const calc = calcularPropostaItem({
        usoMesAnterior,
        minimoManual,
        limiteMaximo: item.limite_maximo,
        saldoTecnico,
        estoqueAtual: item.estoque_atual,
      });

      insertItemStmt.run(
        separacaoId,
        item.id,
        item.codigo,
        item.nome,
        item.unidade,
        calc.usoMesAnterior,
        calc.demandaSemanalExata,
        calc.demandaDiariaInformativa,
        calc.alvoBase,
        calc.minimoManual,
        calc.minimoEfetivo,
        calc.minimoOrigem,
        calc.limiteMaximo,
        calc.alvoKit,
        calc.saldoTecnico,
        calc.estoqueAlmoxarifado,
        calc.quantidadeSolicitada,
        calc.quantidadeSolicitada,
        calc.quantidadeDisponivel,
        calc.faltante,
        calc.comparacaoLimites,
        calc.consumoAtipico ? 1 : 0,
        calc.semConsumo ? 1 : 0,
        calc.semSaldoAlmoxarifado ? 1 : 0,
        calc.alertaMinimoMaiorMaximo ? 1 : 0
      );
    }

    return separacaoId;
  });

  const separacaoId = insertSep.immediate();
  return obterSeparacaoCoordenador(db, separacaoId);
}

export function ajustarItemRascunho(
  db: DBInstance,
  user: SessionUser,
  separacaoId: number,
  sepItemId: number,
  quantidadeSolicitada: number,
  justificativa: string
): SeparacaoCoordenadorDTO {
  const cleanJust = (justificativa ?? '').trim();
  if (cleanJust.length < 3) {
    throw new AppError(
      400,
      'Justificativa obrigatória (mínimo 3 caracteres) para ajuste manual de quantidade.',
      'JUSTIFICATION_REQUIRED'
    );
  }

  const novaQtd = Number(quantidadeSolicitada);
  if (!Number.isInteger(novaQtd) || novaQtd < 0) {
    throw new AppError(400, 'A quantidade solicitada deve ser um número inteiro não negativo.', 'INVALID_QUANTITY');
  }

  const tx = db.transaction(() => {
    const sep = db.prepare('SELECT id, status FROM separacoes WHERE id = ?').get(separacaoId) as
      | { id: number; status: StatusSeparacao }
      | undefined;

    if (!sep) throw new AppError(404, 'Separação não encontrada.', 'NOT_FOUND');
    if (sep.status !== 'RASCUNHO') {
      throw new AppError(
        409,
        'Ajustes manuais são permitidos apenas enquanto a separação estiver em RASCUNHO.',
        'DRAFT_ONLY'
      );
    }

    const sepItem = db
      .prepare('SELECT id, item_id FROM separacao_itens WHERE id = ? AND separacao_id = ?')
      .get(sepItemId, separacaoId) as { id: number; item_id: number } | undefined;

    if (!sepItem) throw new AppError(404, 'Item da separação não encontrado.', 'NOT_FOUND');

    const item = db.prepare('SELECT estoque_atual FROM itens WHERE id = ?').get(sepItem.item_id) as {
      estoque_atual: number;
    };

    const recalc = recalcularDisponibilidade(novaQtd, item.estoque_atual);

    db.prepare(`
      UPDATE separacao_itens SET
        estoque_almoxarifado_snapshot = ?,
        quantidade_solicitada = ?,
        quantidade_disponivel = ?,
        faltante = ?,
        sem_saldo_almoxarifado = ?,
        ajuste_justificativa = ?,
        ajustado_por_nome = ?,
        ajustado_em = ?
      WHERE id = ?
    `).run(
      item.estoque_atual,
      recalc.quantidadeSolicitada,
      recalc.quantidadeDisponivel,
      recalc.faltante,
      recalc.semSaldoAlmoxarifado ? 1 : 0,
      cleanJust,
      user.nome,
      nowIso(),
      sepItemId
    );
  });

  tx.immediate();
  return obterSeparacaoCoordenador(db, separacaoId);
}

export function enviarSolicitacaoEstoque(
  db: DBInstance,
  user: SessionUser,
  separacaoId: number
): SeparacaoCoordenadorDTO {
  const tx = db.transaction(() => {
    const sep = db.prepare('SELECT id, status FROM separacoes WHERE id = ?').get(separacaoId) as
      | { id: number; status: StatusSeparacao }
      | undefined;

    if (!sep) throw new AppError(404, 'Separação não encontrada.', 'NOT_FOUND');
    if (sep.status !== 'RASCUNHO') {
      throw new AppError(409, 'Esta separação já foi enviada ao estoque.', 'ALREADY_SENT');
    }

    const sepItens = db
      .prepare('SELECT id, item_id, quantidade_solicitada FROM separacao_itens WHERE separacao_id = ?')
      .all(separacaoId) as Array<{ id: number; item_id: number; quantidade_solicitada: number }>;

    if (sepItens.length === 0) {
      throw new AppError(400, 'A separação não possui itens.', 'EMPTY_SEPARATION');
    }

    // Recalcula disponibilidade contra o saldo atual do almoxarifado no momento do envio (sem dar baixa!)
    const updateItemStmt = db.prepare(`
      UPDATE separacao_itens SET
        estoque_almoxarifado_snapshot = ?,
        quantidade_disponivel = ?,
        faltante = ?,
        sem_saldo_almoxarifado = ?
      WHERE id = ?
    `);

    for (const si of sepItens) {
      const item = db.prepare('SELECT estoque_atual FROM itens WHERE id = ?').get(si.item_id) as {
        estoque_atual: number;
      };
      const recalc = recalcularDisponibilidade(si.quantidade_solicitada, item.estoque_atual);
      updateItemStmt.run(
        item.estoque_atual,
        recalc.quantidadeDisponivel,
        recalc.faltante,
        recalc.semSaldoAlmoxarifado ? 1 : 0,
        si.id
      );
    }

    db.prepare(`
      UPDATE separacoes SET
        status = 'CALCULADA',
        enviado_por_id = ?,
        enviado_por_nome = ?,
        enviado_em = ?
      WHERE id = ?
    `).run(user.id, user.nome, nowIso(), separacaoId);
  });

  tx.immediate();
  return obterSeparacaoCoordenador(db, separacaoId);
}

export function listarSeparacoesCoordenador(
  db: DBInstance,
  filtros?: { tecnicoId?: number; competencia?: string; status?: StatusSeparacao }
): SeparacaoResumoCoordenadorDTO[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filtros?.tecnicoId) {
    conditions.push('s.tecnico_id = ?');
    params.push(filtros.tecnicoId);
  }
  if (filtros?.competencia) {
    conditions.push('s.competencia = ?');
    params.push(filtros.competencia);
  }
  if (filtros?.status) {
    conditions.push('s.status = ?');
    params.push(filtros.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db
    .prepare(`
      SELECT
        s.*,
        COUNT(si.id) as total_itens,
        COALESCE(SUM(si.quantidade_solicitada), 0) as total_solicitado,
        COALESCE(SUM(si.quantidade_disponivel), 0) as total_disponivel,
        COALESCE(SUM(si.faltante), 0) as total_faltante,
        COALESCE(SUM(COALESCE(si.quantidade_entregue, 0)), 0) as total_entregue
      FROM separacoes s
      LEFT JOIN separacao_itens si ON si.separacao_id = s.id
      ${where}
      GROUP BY s.id
      ORDER BY s.id DESC
    `)
    .all(...params) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: Number(r.id),
    codigo: String(r.codigo),
    tecnicoId: Number(r.tecnico_id),
    tecnicoNome: String(r.tecnico_nome_snapshot),
    competencia: String(r.competencia),
    competenciaLabel: String(r.competencia_label),
    regraVersao: String(r.regra_versao),
    status: String(r.status) as StatusSeparacao,
    calculadoPorNome: String(r.calculado_por_nome),
    calculadoEm: String(r.calculado_em),
    enviadoPorNome: r.enviado_por_nome !== null ? String(r.enviado_por_nome) : null,
    enviadoEm: r.enviado_em !== null ? String(r.enviado_em) : null,
    confirmadoPorNome: r.confirmado_por_nome !== null ? String(r.confirmado_por_nome) : null,
    confirmadoEm: r.confirmado_em !== null ? String(r.confirmado_em) : null,
    totalItens: Number(r.total_itens),
    totalSolicitado: Number(r.total_solicitado),
    totalDisponivel: Number(r.total_disponivel),
    totalFaltante: Number(r.total_faltante),
    totalEntregue: Number(r.total_entregue),
  }));
}

// ---------------- ESTOQUE: FILA, DETALHE ESTRITO, CONFIRMAÇÃO ATÔMICA E PENDÊNCIAS ----------------

function computeStockVersionHash(items: Array<{ item_id: number; estoque_atual: number }>): string {
  const canonical = [...items]
    .sort((a, b) => a.item_id - b.item_id)
    .map((i) => `${i.item_id}:${i.estoque_atual}`)
    .join('|');
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 24);
}

export function listarFilaEstoque(db: DBInstance): SeparacaoEstoqueFilaDTO[] {
  const rows = db
    .prepare(`
      SELECT
        s.id, s.codigo, s.tecnico_id, s.tecnico_nome_snapshot, s.status, s.enviado_em,
        COUNT(si.id) as total_itens
      FROM separacoes s
      JOIN separacao_itens si ON si.separacao_id = s.id
      WHERE s.status = 'CALCULADA'
      GROUP BY s.id
      ORDER BY s.enviado_em ASC, s.id ASC
    `)
    .all() as Array<Record<string, unknown>>;

  return rows.map((r) => {
    const sepId = Number(r.id);
    const itens = db
      .prepare(`
        SELECT si.quantidade_solicitada, i.estoque_atual
        FROM separacao_itens si
        JOIN itens i ON i.id = si.item_id
        WHERE si.separacao_id = ?
      `)
      .all(sepId) as Array<{ quantidade_solicitada: number; estoque_atual: number }>;

    const totalUnidadesASeparar = itens.reduce(
      (acc, cur) => acc + Math.min(cur.quantidade_solicitada, Math.max(cur.estoque_atual, 0)),
      0
    );

    return {
      id: sepId,
      codigo: String(r.codigo),
      tecnicoId: Number(r.tecnico_id),
      tecnicoNome: String(r.tecnico_nome_snapshot),
      status: 'CALCULADA',
      enviadoEm: String(r.enviado_em),
      totalItens: Number(r.total_itens),
      totalUnidadesASeparar,
    };
  });
}

export function obterDetalheEstoque(db: DBInstance, separacaoId: number): SeparacaoEstoqueDetalheDTO {
  const sep = db
    .prepare('SELECT id, codigo, tecnico_nome_snapshot, status, enviado_em, confirmado_em, confirmado_por_nome FROM separacoes WHERE id = ?')
    .get(separacaoId) as
    | {
        id: number;
        codigo: string;
        tecnico_nome_snapshot: string;
        status: StatusSeparacao;
        enviado_em: string | null;
        confirmado_em: string | null;
        confirmado_por_nome: string | null;
      }
    | undefined;

  if (!sep) {
    throw new AppError(404, 'Solicitação não encontrada.', 'NOT_FOUND');
  }

  // RASCUNHO é estritamente invisível ao perfil ESTOQUE
  if (sep.status === 'RASCUNHO') {
    throw new AppError(403, 'Rascunhos ainda não enviados não estão disponíveis para o estoque.', 'DRAFT_FORBIDDEN');
  }

  const rows = db
    .prepare(`
      SELECT
        si.id,
        si.item_id,
        si.item_codigo_snapshot,
        si.item_nome_snapshot,
        si.unidade_snapshot,
        si.quantidade_solicitada,
        si.quantidade_entregue,
        i.estoque_atual
      FROM separacao_itens si
      JOIN itens i ON i.id = si.item_id
      WHERE si.separacao_id = ?
      ORDER BY si.item_codigo_snapshot ASC
    `)
    .all(separacaoId) as Array<{
    id: number;
    item_id: number;
    item_codigo_snapshot: string;
    item_nome_snapshot: string;
    unidade_snapshot: string;
    quantidade_solicitada: number;
    quantidade_entregue: number | null;
    estoque_atual: number;
  }>;

  const versaoEstoque = computeStockVersionHash(rows);

  return {
    id: sep.id,
    codigo: sep.codigo,
    tecnicoNome: sep.tecnico_nome_snapshot,
    status: sep.status as 'CALCULADA' | 'SEPARADA',
    enviadoEm: sep.enviado_em ?? '',
    confirmadoEm: sep.confirmado_em,
    confirmadoPorNome: sep.confirmado_por_nome,
    versaoEstoque,
    itens: rows.map((r) => ({
      id: r.id,
      itemId: r.item_id,
      codigo: r.item_codigo_snapshot,
      nome: r.item_nome_snapshot,
      unidade: r.unidade_snapshot,
      quantidadeSolicitada: r.quantidade_solicitada,
      quantidadeASeparar:
        sep.status === 'SEPARADA'
          ? r.quantidade_entregue ?? 0
          : Math.min(r.quantidade_solicitada, Math.max(r.estoque_atual, 0)),
      quantidadeEntregue: r.quantidade_entregue,
    })),
  };
}

export function confirmarEntregaEstoque(
  db: DBInstance,
  user: SessionUser,
  separacaoId: number,
  input: {
    versaoEstoque: string;
    itens: Array<{ separacaoItemId: number; quantidadeEntregue: number }>;
  }
): SeparacaoEstoqueDetalheDTO {
  if (!input || !Array.isArray(input.itens) || input.itens.length === 0) {
    throw new AppError(400, 'Informe as quantidades entregues de todos os itens.', 'VALIDATION_ERROR');
  }

  const tx = db.transaction(() => {
    const sep = db
      .prepare('SELECT id, tecnico_id, tecnico_nome_snapshot, status FROM separacoes WHERE id = ?')
      .get(separacaoId) as
      | { id: number; tecnico_id: number; tecnico_nome_snapshot: string; status: StatusSeparacao }
      | undefined;

    if (!sep) {
      throw new AppError(404, 'Solicitação não encontrada.', 'NOT_FOUND');
    }
    if (sep.status === 'RASCUNHO') {
      throw new AppError(403, 'Rascunho não enviado ao estoque.', 'DRAFT_FORBIDDEN');
    }
    if (sep.status !== 'CALCULADA') {
      throw new AppError(
        409,
        'Esta separação já foi confirmada anteriormente. Atualize a fila do estoque.',
        'DOUBLE_CONFIRMATION'
      );
    }

    const dbItems = db
      .prepare(`
        SELECT
          si.id, si.item_id, si.item_nome_snapshot, si.unidade_snapshot,
          si.quantidade_solicitada, si.quantidade_disponivel,
          i.estoque_atual
        FROM separacao_itens si
        JOIN itens i ON i.id = si.item_id
        WHERE si.separacao_id = ?
      `)
      .all(separacaoId) as Array<{
      id: number;
      item_id: number;
      item_nome_snapshot: string;
      unidade_snapshot: string;
      quantidade_solicitada: number;
      quantidade_disponivel: number;
      estoque_atual: number;
    }>;

    const versaoAtual = computeStockVersionHash(dbItems);
    if (!input.versaoEstoque || input.versaoEstoque !== versaoAtual) {
      throw new AppError(
        409,
        'O estoque do almoxarifado foi alterado desde o carregamento da lista. Atualize a fila e confira novamente.',
        'STALE_STOCK_VERSION'
      );
    }

    const inputMap = new Map<number, number>();
    for (const entry of input.itens) {
      const sepItemId = Number(entry.separacaoItemId);
      const qtd = Number(entry.quantidadeEntregue);
      if (!Number.isInteger(qtd) || qtd < 0) {
        throw new AppError(400, 'Quantidade entregue deve ser um inteiro não negativo.', 'INVALID_QUANTITY');
      }
      if (inputMap.has(sepItemId)) {
        throw new AppError(400, 'Item duplicado na confirmação.', 'DUPLICATE_ITEM');
      }
      inputMap.set(sepItemId, qtd);
    }

    if (inputMap.size !== dbItems.length) {
      throw new AppError(400, 'Todos os itens da separação devem ser confirmados em conjunto.', 'INCOMPLETE_ITEMS');
    }

    const ts = nowIso();

    const deductStockStmt = db.prepare(
      'UPDATE itens SET estoque_atual = estoque_atual - ?, atualizado_em = ? WHERE id = ? AND estoque_atual >= ?'
    );
    const upsertTechStockStmt = db.prepare(`
      INSERT INTO saldos_tecnicos (tecnico_id, item_id, quantidade, atualizado_em)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(tecnico_id, item_id) DO UPDATE SET
        quantidade = saldos_tecnicos.quantidade + excluded.quantidade,
        atualizado_em = excluded.atualizado_em
    `);
    const updateSepItemStmt = db.prepare(
      'UPDATE separacao_itens SET quantidade_entregue = ? WHERE id = ?'
    );
    const insertPendenciaStmt = db.prepare(`
      INSERT INTO pendencias (
        separacao_id, separacao_item_id, tecnico_id, tecnico_nome_snapshot,
        item_id, item_nome_snapshot, unidade_snapshot,
        quantidade_solicitada, quantidade_referencia, diferenca,
        tipo, status, criado_em, atualizado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ABERTA', ?, ?)
    `);

    for (const dbItem of dbItems) {
      const entregue = inputMap.get(dbItem.id);
      if (entregue === undefined) {
        throw new AppError(400, 'Item ausente na confirmação.', 'INCOMPLETE_ITEMS');
      }

      if (entregue > dbItem.quantidade_solicitada) {
        throw new AppError(
          400,
          `Quantidade entregue de "${dbItem.item_nome_snapshot}" (${entregue}) excede o solicitado (${dbItem.quantidade_solicitada}).`,
          'EXCEEDS_REQUESTED'
        );
      }

      if (entregue > dbItem.estoque_atual) {
        throw new AppError(
          409,
          `Estoque insuficiente no almoxarifado para "${dbItem.item_nome_snapshot}" (saldo atual: ${dbItem.estoque_atual}). Atualize a fila.`,
          'INSUFFICIENT_STOCK'
        );
      }

      if (entregue > 0) {
        const res = deductStockStmt.run(entregue, ts, dbItem.item_id, entregue);
        if (res.changes !== 1) {
          throw new AppError(
            409,
            `Falha atômica ao baixar "${dbItem.item_nome_snapshot}". Atualize a fila e tente novamente.`,
            'STOCK_RACE'
          );
        }
        // Mantém o saldo do técnico coerente com entregas anteriores na fonte simulada
        upsertTechStockStmt.run(sep.tecnico_id, dbItem.item_id, entregue, ts);
      }

      updateSepItemStmt.run(entregue, dbItem.id);

      const diferenca = dbItem.quantidade_solicitada - entregue;
      if (diferenca > 0) {
        const tipo =
          dbItem.estoque_atual < dbItem.quantidade_solicitada && entregue === dbItem.estoque_atual
            ? 'FALTA_ESTOQUE'
            : 'ENTREGA_PARCIAL';
        insertPendenciaStmt.run(
          separacaoId,
          dbItem.id,
          sep.tecnico_id,
          sep.tecnico_nome_snapshot,
          dbItem.item_id,
          dbItem.item_nome_snapshot,
          dbItem.unidade_snapshot,
          dbItem.quantidade_solicitada,
          entregue,
          diferenca,
          tipo,
          ts,
          ts
        );
      }
    }

    const sepUpdate = db
      .prepare(`
        UPDATE separacoes SET
          status = 'SEPARADA',
          confirmado_por_id = ?,
          confirmado_por_nome = ?,
          confirmado_em = ?
        WHERE id = ? AND status = 'CALCULADA'
      `)
      .run(user.id, user.nome, ts, separacaoId);

    if (sepUpdate.changes !== 1) {
      throw new AppError(409, 'Separação já confirmada por outro usuário.', 'DOUBLE_CONFIRMATION');
    }
  });

  tx.immediate();
  return obterDetalheEstoque(db, separacaoId);
}

export function listarPendencias(db: DBInstance): PendenciaDTO[] {
  const rows = db
    .prepare(`
      SELECT
        p.*,
        s.codigo as separacao_codigo
      FROM pendencias p
      JOIN separacoes s ON s.id = p.separacao_id
      ORDER BY p.criado_em DESC, p.id DESC
    `)
    .all() as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: Number(r.id),
    separacaoId: Number(r.separacao_id),
    separacaoCodigo: String(r.separacao_codigo),
    tecnicoId: Number(r.tecnico_id),
    tecnicoNome: String(r.tecnico_nome_snapshot),
    itemId: Number(r.item_id),
    itemNome: String(r.item_nome_snapshot),
    unidade: String(r.unidade_snapshot),
    quantidadeSolicitada: Number(r.quantidade_solicitada),
    quantidadeReferencia: Number(r.quantidade_referencia),
    diferenca: Number(r.diferenca),
    tipo: String(r.tipo) as PendenciaDTO['tipo'],
    status: 'ABERTA',
    criadoEm: String(r.criado_em),
    atualizadoEm: String(r.atualizado_em),
  }));
}

// ---------------- EXPORTAÇÃO CSV ----------------

function escapeCsvCell(value: string | number): string {
  const str = String(value);
  const safe = /^[=+\-@]/.test(str) ? `'${str}` : str;
  if (safe.includes(';') || safe.includes('"') || safe.includes('\n')) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function gerarCsvSeparacaoSimples(
  items: Array<{ codigo: string; nome: string; unidade: string; quantidadeASeparar: number }>
): string {
  const header = ['Codigo', 'Material', 'Unidade', 'Quantidade a Separar'].join(';');
  const lines = items.map((i) =>
    [
      escapeCsvCell(i.codigo),
      escapeCsvCell(i.nome),
      escapeCsvCell(i.unidade),
      escapeCsvCell(i.quantidadeASeparar),
    ].join(';')
  );
  return `\uFEFF${[header, ...lines].join('\r\n')}\r\n`;
}
