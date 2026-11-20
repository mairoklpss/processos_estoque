import { pageSql, pageParams, type Page } from '../validation.ts';
import crypto from 'crypto';
import type { DashboardSummaryDTO, ItemProduto, ParametroTecnicoItem, PendenciaDTO, PerfilUsuario, SeparacaoCoordenadorDTO, SeparacaoEstoqueDetalheDTO, SeparacaoEstoqueFilaDTO, SeparacaoItemCoordenadorDTO, SeparacaoResumoCoordenadorDTO, StatusSeparacao, Tecnico, UsuarioPublico, } from '../../src/shared/types.ts';
import { calcularPropostaItem, recalcularDisponibilidade, REGRA_VERSAO } from '../calculo.ts';
import { hashPassword, verifyPassword } from '../db.ts';
import type { AsyncDatabase } from '../data-access.ts';
import { getClosedPreviousMonth, nowIso } from '../periodo.ts';
import { AppError, AMBIENTE_LABEL, SESSION_TTL_HOURS, type SessionUser } from './common.ts';


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

export async function obterSeparacaoCoordenador(db: AsyncDatabase, id: number): Promise<SeparacaoCoordenadorDTO> {
    const sep = await db.get('SELECT * FROM separacoes WHERE id = ?', id) as Record<string, unknown> | undefined;
    if (!sep) {
        throw new AppError(404, 'Separação não encontrada.', 'NOT_FOUND');
    }
    const itemRows = await db.all('SELECT * FROM separacao_itens WHERE separacao_id = ? ORDER BY item_codigo_snapshot ASC', id) as Array<Record<string, unknown>>;
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

export async function calcularSeparacaoRascunho(db: AsyncDatabase, user: SessionUser, tecnicoId: number, observacoes?: string, now: Date = new Date()): Promise<SeparacaoCoordenadorDTO> {
    const tecnico = await db.get('SELECT id, matricula, nome, ativo FROM tecnicos WHERE id = ?', tecnicoId) as {
        id: number;
        matricula: string;
        nome: string;
        ativo: number;
    } | undefined;
    if (!tecnico) {
        throw new AppError(404, 'Técnico não encontrado.', 'NOT_FOUND');
    }
    if (tecnico.ativo !== 1) {
        throw new AppError(400, 'Apenas técnicos ativos podem receber cálculo de separação.', 'INACTIVE_TECH');
    }
    const itensAtivos = await db.all('SELECT id, codigo, nome, unidade, estoque_atual, limite_maximo FROM itens WHERE ativo = 1 ORDER BY codigo ASC') as Array<{
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
    const minimosRows = await db.all('SELECT item_id, minimo_manual FROM minimos_tecnicos WHERE tecnico_id = ?', tecnicoId) as Array<{
        item_id: number;
        minimo_manual: number;
    }>;
    const minimosMap = new Map(minimosRows.map((m) => [m.item_id, m.minimo_manual]));
    const consumosRows = await db.all('SELECT item_id, quantidade_usada FROM consumos WHERE tecnico_id = ? AND competencia = ?', tecnicoId, periodo.competencia) as Array<{
        item_id: number;
        quantidade_usada: number;
    }>;
    const consumosMap = new Map(consumosRows.map((c) => [c.item_id, c.quantidade_usada]));
    const saldosRows = await db.all('SELECT item_id, quantidade FROM saldos_tecnicos WHERE tecnico_id = ?', tecnicoId) as Array<{
        item_id: number;
        quantidade: number;
    }>;
    const saldosMap = new Map(saldosRows.map((s) => [s.item_id, s.quantidade]));
    const insertSep = await db.transaction(async (db) => {
        const seqRow = await db.get('SELECT COUNT(*) as c FROM separacoes') as {
            c: number;
        };
        const seqNum = String(seqRow.c + 1).padStart(4, '0');
        const randSuffix = crypto.randomBytes(2).toString('hex').toUpperCase();
        const codigo = `SEP-${periodo.competencia.replace('-', '')}-${seqNum}-${randSuffix}`;
        const sepRes = await db.run(`
        INSERT INTO separacoes (
          codigo, tecnico_id, tecnico_nome_snapshot, competencia, competencia_label,
          regra_versao, status, calculado_por_id, calculado_por_nome, calculado_em, observacoes
        ) VALUES (?, ?, ?, ?, ?, ?, 'RASCUNHO', ?, ?, ?, ?)
      `, codigo, tecnico.id, tecnico.nome, periodo.competencia, periodo.label, REGRA_VERSAO, user.id, user.nome, ts, observacoes?.trim() || null);
        const separacaoId = Number(sepRes.insertId);
        const insertItemStmt = `
      INSERT INTO separacao_itens (
        separacao_id, item_id, item_codigo_snapshot, item_nome_snapshot, unidade_snapshot,
        uso_mes_anterior, demanda_semanal_exata, demanda_diaria_informativa, alvo_base,
        minimo_manual_snapshot, minimo_efetivo, minimo_origem, limite_maximo_snapshot, alvo_kit,
        saldo_tecnico_snapshot, estoque_almoxarifado_snapshot,
        quantidade_calculada_original, quantidade_solicitada, quantidade_disponivel, faltante,
        comparacao_limites, consumo_atipico, sem_consumo, sem_saldo_almoxarifado, alerta_minimo_maior_maximo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
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
            await db.run(insertItemStmt, separacaoId, item.id, item.codigo, item.nome, item.unidade, calc.usoMesAnterior, calc.demandaSemanalExata, calc.demandaDiariaInformativa, calc.alvoBase, calc.minimoManual, calc.minimoEfetivo, calc.minimoOrigem, calc.limiteMaximo, calc.alvoKit, calc.saldoTecnico, calc.estoqueAlmoxarifado, calc.quantidadeSolicitada, calc.quantidadeSolicitada, calc.quantidadeDisponivel, calc.faltante, calc.comparacaoLimites, calc.consumoAtipico ? 1 : 0, calc.semConsumo ? 1 : 0, calc.semSaldoAlmoxarifado ? 1 : 0, calc.alertaMinimoMaiorMaximo ? 1 : 0);
        }
        return separacaoId;
    });
    const separacaoId = insertSep;
    return await obterSeparacaoCoordenador(db, separacaoId);
}

export async function ajustarItemRascunho(db: AsyncDatabase, user: SessionUser, separacaoId: number, sepItemId: number, quantidadeSolicitada: number, justificativa: string): Promise<SeparacaoCoordenadorDTO> {
    const cleanJust = (justificativa ?? '').trim();
    if (cleanJust.length < 3) {
        throw new AppError(400, 'Justificativa obrigatória (mínimo 3 caracteres) para ajuste manual de quantidade.', 'JUSTIFICATION_REQUIRED');
    }
    const novaQtd = Number(quantidadeSolicitada);
    if (!Number.isInteger(novaQtd) || novaQtd < 0) {
        throw new AppError(400, 'A quantidade solicitada deve ser um número inteiro não negativo.', 'INVALID_QUANTITY');
    }
    const tx = await db.transaction(async (db) => {
        const sep = await db.lock('SELECT id, status FROM separacoes WHERE id = ?', separacaoId) as {
            id: number;
            status: StatusSeparacao;
        } | undefined;
        if (!sep)
            throw new AppError(404, 'Separação não encontrada.', 'NOT_FOUND');
        if (sep.status !== 'RASCUNHO') {
            throw new AppError(409, 'Ajustes manuais são permitidos apenas enquanto a separação estiver em RASCUNHO.', 'DRAFT_ONLY');
        }
        const sepItem = await db.get('SELECT id, item_id FROM separacao_itens WHERE id = ? AND separacao_id = ?', sepItemId, separacaoId) as {
            id: number;
            item_id: number;
        } | undefined;
        if (!sepItem)
            throw new AppError(404, 'Item da separação não encontrado.', 'NOT_FOUND');
        const item = await db.get('SELECT estoque_atual FROM itens WHERE id = ?', sepItem.item_id) as {
            estoque_atual: number;
        };
        const recalc = recalcularDisponibilidade(novaQtd, item.estoque_atual);
        await db.run(`
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
    `, item.estoque_atual, recalc.quantidadeSolicitada, recalc.quantidadeDisponivel, recalc.faltante, recalc.semSaldoAlmoxarifado ? 1 : 0, cleanJust, user.nome, nowIso(), sepItemId);
    });
    return await obterSeparacaoCoordenador(db, separacaoId);
}

export async function enviarSolicitacaoEstoque(db: AsyncDatabase, user: SessionUser, separacaoId: number): Promise<SeparacaoCoordenadorDTO> {
    const tx = await db.transaction(async (db) => {
        const sep = await db.lock('SELECT id, status FROM separacoes WHERE id = ?', separacaoId) as {
            id: number;
            status: StatusSeparacao;
        } | undefined;
        if (!sep)
            throw new AppError(404, 'Separação não encontrada.', 'NOT_FOUND');
        if (sep.status !== 'RASCUNHO') {
            throw new AppError(409, 'Esta separação já foi enviada ao estoque.', 'ALREADY_SENT');
        }
        const sepItens = await db.all('SELECT id, item_id, quantidade_solicitada FROM separacao_itens WHERE separacao_id = ?', separacaoId) as Array<{
            id: number;
            item_id: number;
            quantidade_solicitada: number;
        }>;
        if (sepItens.length === 0) {
            throw new AppError(400, 'A separação não possui itens.', 'EMPTY_SEPARATION');
        }
        // Recalcula disponibilidade contra o saldo atual do almoxarifado no momento do envio (sem dar baixa!)
        const updateItemStmt = `
      UPDATE separacao_itens SET
        estoque_almoxarifado_snapshot = ?,
        quantidade_disponivel = ?,
        faltante = ?,
        sem_saldo_almoxarifado = ?
      WHERE id = ?
    `;
        for (const si of sepItens) {
            const item = await db.get('SELECT estoque_atual FROM itens WHERE id = ?', si.item_id) as {
                estoque_atual: number;
            };
            const recalc = recalcularDisponibilidade(si.quantidade_solicitada, item.estoque_atual);
            await db.run(updateItemStmt, item.estoque_atual, recalc.quantidadeDisponivel, recalc.faltante, recalc.semSaldoAlmoxarifado ? 1 : 0, si.id);
        }
        await db.run(`
      UPDATE separacoes SET
        status = 'CALCULADA',
        enviado_por_id = ?,
        enviado_por_nome = ?,
        enviado_em = ?
      WHERE id = ?
    `, user.id, user.nome, nowIso(), separacaoId);
    });
    return await obterSeparacaoCoordenador(db, separacaoId);
}

export async function listarSeparacoesCoordenador(db: AsyncDatabase, filtros?: {
    tecnicoId?: number;
    competencia?: string;
    status?: StatusSeparacao;
}, page?: Page): Promise<SeparacaoResumoCoordenadorDTO[]> {
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
    const rows = await db.all(`
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
    ` + pageSql(page), ...params, ...pageParams(page)) as Array<Record<string, unknown>>;
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