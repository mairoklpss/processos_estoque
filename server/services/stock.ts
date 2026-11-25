import { pageSql, pageParams, type Page } from '../validation.ts';
import crypto from 'crypto';
import type { DashboardSummaryDTO, ItemProduto, ParametroTecnicoItem, PendenciaDTO, PerfilUsuario, SeparacaoCoordenadorDTO, SeparacaoEstoqueDetalheDTO, SeparacaoEstoqueFilaDTO, SeparacaoItemCoordenadorDTO, SeparacaoResumoCoordenadorDTO, StatusSeparacao, Tecnico, UsuarioPublico, } from '../../src/shared/types.ts';
import { calcularPropostaItem, recalcularDisponibilidade, REGRA_VERSAO } from '../calculo.ts';
import { hashPassword, verifyPassword } from '../db.ts';
import type { AsyncDatabase } from '../data-access.ts';
import { getClosedPreviousMonth, nowIso } from '../periodo.ts';
import { AppError, AMBIENTE_LABEL, SESSION_TTL_HOURS, type SessionUser } from './common.ts';


// A demanda autorizada só diminui quando outra entrega elevou o saldo do técnico.
// Não recalcula alvos nem desfaz ajustes manuais; consumo posterior não aumenta pedidos.
function quantidadeEfetiva(item: {
    quantidade_solicitada: number;
    saldo_tecnico_snapshot: number;
    saldo_tecnico_atual: number;
}): number {
    return Math.max(item.quantidade_solicitada - Math.max(item.saldo_tecnico_atual - item.saldo_tecnico_snapshot, 0), 0);
}

// ---------------- ESTOQUE: FILA, DETALHE ESTRITO, CONFIRMAÇÃO ATÔMICA E PENDÊNCIAS ----------------
function computeStockVersionHash(items: Array<{
    item_id: number;
    estoque_atual: number;
    saldo_tecnico_atual: number;
}>): string {
    const canonical = [...items]
        .sort((a, b) => a.item_id - b.item_id)
        .map((i) => `${i.item_id}:${i.estoque_atual}:${i.saldo_tecnico_atual}`)
        .join('|');
    return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 24);
}

export async function listarFilaEstoque(db: AsyncDatabase, page?: Page): Promise<SeparacaoEstoqueFilaDTO[]> {
    const rows = await db.all(`
      SELECT
        s.id, s.codigo, s.tecnico_id, s.tecnico_nome_snapshot, s.status, s.enviado_em,
        COUNT(si.id) as total_itens
      FROM separacoes s
      JOIN separacao_itens si ON si.separacao_id = s.id
      WHERE s.status = 'CALCULADA'
      GROUP BY s.id
      ORDER BY s.enviado_em ASC, s.id ASC
    ` + pageSql(page), ...pageParams(page)) as Array<Record<string, unknown>>;
    return await Promise.all(rows.map(async (r): Promise<SeparacaoEstoqueFilaDTO> => {
        const sepId = Number(r.id);
        const itens = await db.all(`
        SELECT si.quantidade_solicitada, si.saldo_tecnico_snapshot, i.estoque_atual,
               COALESCE(st.quantidade, 0) AS saldo_tecnico_atual
        FROM separacao_itens si
        JOIN itens i ON i.id = si.item_id
        JOIN separacoes s ON s.id = si.separacao_id
        LEFT JOIN saldos_tecnicos st ON st.tecnico_id = s.tecnico_id AND st.item_id = si.item_id
        WHERE si.separacao_id = ?
      `, sepId) as Array<{
            quantidade_solicitada: number;
            saldo_tecnico_snapshot: number;
            saldo_tecnico_atual: number;
            estoque_atual: number;
        }>;
        const totalUnidadesASeparar = itens.reduce((acc, cur) => acc + Math.min(quantidadeEfetiva(cur), Math.max(cur.estoque_atual, 0)), 0);
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
    }));
}

export async function obterDetalheEstoque(db: AsyncDatabase, separacaoId: number): Promise<SeparacaoEstoqueDetalheDTO> {
    const sep = await db.get('SELECT id, codigo, tecnico_id, tecnico_nome_snapshot, status, enviado_em, confirmado_em, confirmado_por_nome FROM separacoes WHERE id = ?', separacaoId) as {
        id: number;
        codigo: string;
        tecnico_id: number;
        tecnico_nome_snapshot: string;
        status: StatusSeparacao;
        enviado_em: string | null;
        confirmado_em: string | null;
        confirmado_por_nome: string | null;
    } | undefined;
    if (!sep) {
        throw new AppError(404, 'Solicitação não encontrada.', 'NOT_FOUND');
    }
    // RASCUNHO é estritamente invisível ao perfil ESTOQUE
    if (sep.status === 'RASCUNHO') {
        throw new AppError(403, 'Rascunhos ainda não enviados não estão disponíveis para o estoque.', 'DRAFT_FORBIDDEN');
    }
    const rows = await db.all(`
      SELECT
        si.id,
        si.item_id,
        si.item_codigo_snapshot,
        si.item_nome_snapshot,
        si.unidade_snapshot,
        si.quantidade_solicitada,
        si.quantidade_entregue,
        si.saldo_tecnico_snapshot,
        COALESCE(st.quantidade, 0) AS saldo_tecnico_atual,
        i.estoque_atual
      FROM separacao_itens si
      JOIN itens i ON i.id = si.item_id
        JOIN separacoes s ON s.id = si.separacao_id
        LEFT JOIN saldos_tecnicos st ON st.tecnico_id = s.tecnico_id AND st.item_id = si.item_id
      WHERE si.separacao_id = ?
      ORDER BY si.item_codigo_snapshot ASC
    `, separacaoId) as Array<{
        id: number;
        item_id: number;
        item_codigo_snapshot: string;
        item_nome_snapshot: string;
        unidade_snapshot: string;
        quantidade_solicitada: number;
        quantidade_entregue: number | null;
        saldo_tecnico_snapshot: number;
        saldo_tecnico_atual: number;
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
            quantidadeSolicitada: sep.status === 'SEPARADA' ? r.quantidade_solicitada : quantidadeEfetiva(r),
            quantidadeASeparar: sep.status === 'SEPARADA'
                ? r.quantidade_entregue ?? 0
                : Math.min(quantidadeEfetiva(r), Math.max(r.estoque_atual, 0)),
            // Issue 13: estoque total do item no momento da consulta (o "como um todo", não limitado ao pedido)
            estoqueDisponivel: Math.max(r.estoque_atual, 0),
            quantidadeEntregue: r.quantidade_entregue,
        })),
    };
}

export async function confirmarEntregaEstoque(db: AsyncDatabase, user: SessionUser, separacaoId: number, input: {
    versaoEstoque: string;
    itens: Array<{
        separacaoItemId: number;
        quantidadeEntregue: number;
    }>;
}): Promise<SeparacaoEstoqueDetalheDTO> {
    if (!input || !Array.isArray(input.itens) || input.itens.length === 0) {
        throw new AppError(400, 'Informe as quantidades entregues de todos os itens.', 'VALIDATION_ERROR');
    }
    const tx = await db.transaction(async (db) => {
        const sep = await db.lock('SELECT id, tecnico_id, tecnico_nome_snapshot, status FROM separacoes WHERE id = ?', separacaoId) as {
            id: number;
            tecnico_id: number;
            tecnico_nome_snapshot: string;
            status: StatusSeparacao;
        } | undefined;
        if (!sep) {
            throw new AppError(404, 'Solicitação não encontrada.', 'NOT_FOUND');
        }
        if (sep.status === 'RASCUNHO') {
            throw new AppError(403, 'Rascunho não enviado ao estoque.', 'DRAFT_FORBIDDEN');
        }
        if (sep.status !== 'CALCULADA') {
            throw new AppError(409, 'Esta separação já foi confirmada anteriormente. Atualize a fila do estoque.', 'DOUBLE_CONFIRMATION');
        }
        const dbItems = await db.lockAll(`
        SELECT
          si.id, si.item_id, si.item_nome_snapshot, si.unidade_snapshot,
          si.quantidade_solicitada, si.quantidade_disponivel, si.saldo_tecnico_snapshot,
          si.ajuste_justificativa, COALESCE(st.quantidade, 0) AS saldo_tecnico_atual,
          i.estoque_atual
        FROM separacao_itens si
        JOIN itens i ON i.id = si.item_id
        JOIN separacoes s ON s.id = si.separacao_id
        LEFT JOIN saldos_tecnicos st ON st.tecnico_id = s.tecnico_id AND st.item_id = si.item_id
        WHERE si.separacao_id = ?
        ORDER BY i.id
      `, separacaoId) as Array<{
            id: number;
            item_id: number;
            item_nome_snapshot: string;
            unidade_snapshot: string;
            quantidade_solicitada: number;
            quantidade_disponivel: number;
            saldo_tecnico_snapshot: number;
            saldo_tecnico_atual: number;
            ajuste_justificativa: string | null;
            estoque_atual: number;
        }>;
        const versaoAtual = computeStockVersionHash(dbItems);
        if (!input.versaoEstoque || input.versaoEstoque !== versaoAtual) {
            throw new AppError(409, 'O estoque do almoxarifado ou o saldo do técnico foi alterado desde o carregamento da lista. Atualize a fila e confira novamente.', 'STALE_STOCK_VERSION');
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
        const deductStockStmt = 'UPDATE itens SET estoque_atual = estoque_atual - ?, atualizado_em = ? WHERE id = ? AND estoque_atual >= ?';
        const upsertTechStockStmt = `
      INSERT INTO saldos_tecnicos (tecnico_id, item_id, quantidade, atualizado_em)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(tecnico_id, item_id) DO UPDATE SET
        quantidade = saldos_tecnicos.quantidade + excluded.quantidade,
        atualizado_em = excluded.atualizado_em
    `;
        const updateSepItemStmt = 'UPDATE separacao_itens SET quantidade_entregue = ? WHERE id = ?';
        const insertPendenciaStmt = `
      INSERT INTO pendencias (
        separacao_id, separacao_item_id, tecnico_id, tecnico_nome_snapshot,
        item_id, item_nome_snapshot, unidade_snapshot,
        quantidade_solicitada, quantidade_referencia, diferenca,
        tipo, status, criado_em, atualizado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ABERTA', ?, ?)
    `;
        for (const dbItem of dbItems) {
            const entregue = inputMap.get(dbItem.id);
            if (entregue === undefined) {
                throw new AppError(400, 'Item ausente na confirmação.', 'INCOMPLETE_ITEMS');
            }
            const solicitadoEfetivo = quantidadeEfetiva(dbItem);
            if (entregue > solicitadoEfetivo) {
                throw new AppError(400, `Quantidade entregue de "${dbItem.item_nome_snapshot}" (${entregue}) excede o solicitado atual (${solicitadoEfetivo}).`, 'EXCEEDS_REQUESTED');
            }
            if (entregue > dbItem.estoque_atual) {
                throw new AppError(409, `Estoque insuficiente no almoxarifado para "${dbItem.item_nome_snapshot}" (saldo atual: ${dbItem.estoque_atual}). Atualize a fila.`, 'INSUFFICIENT_STOCK');
            }
            if (entregue > 0) {
                const res = await db.run(deductStockStmt, entregue, ts, dbItem.item_id, entregue);
                if (res.affectedRows !== 1) {
                    throw new AppError(409, `Falha atômica ao baixar "${dbItem.item_nome_snapshot}". Atualize a fila e tente novamente.`, 'STOCK_RACE');
                }
                // Mantém o saldo do técnico coerente com entregas anteriores na fonte simulada
                await db.run(upsertTechStockStmt, sep.tecnico_id, dbItem.item_id, entregue, ts);
            }
            if (solicitadoEfetivo < dbItem.quantidade_solicitada) {
                const disponibilidade = recalcularDisponibilidade(solicitadoEfetivo, dbItem.estoque_atual);
                const autoJust = `Revalidação automática: saldo técnico passou de ${dbItem.saldo_tecnico_snapshot} para ${dbItem.saldo_tecnico_atual}; solicitado reduzido de ${dbItem.quantidade_solicitada} para ${solicitadoEfetivo} por reposição já suprida.`;
                const justificativa = dbItem.ajuste_justificativa ? `${dbItem.ajuste_justificativa}
${autoJust}` : autoJust;
                await db.run(`UPDATE separacao_itens SET
                    saldo_tecnico_snapshot = ?, estoque_almoxarifado_snapshot = ?,
                    quantidade_solicitada = ?, quantidade_disponivel = ?, faltante = ?,
                    sem_saldo_almoxarifado = ?, ajuste_justificativa = ?,
                    ajustado_por_nome = ?, ajustado_em = ? WHERE id = ?`,
                    dbItem.saldo_tecnico_atual, dbItem.estoque_atual, solicitadoEfetivo,
                    disponibilidade.quantidadeDisponivel, disponibilidade.faltante,
                    disponibilidade.semSaldoAlmoxarifado ? 1 : 0, justificativa,
                    'Sistema (revalidação de saldo técnico)', ts, dbItem.id);
            }
            await db.run(updateSepItemStmt, entregue, dbItem.id);
            const diferenca = solicitadoEfetivo - entregue;
            if (diferenca > 0) {
                const tipo = dbItem.estoque_atual < solicitadoEfetivo && entregue === dbItem.estoque_atual
                    ? 'FALTA_ESTOQUE'
                    : 'ENTREGA_PARCIAL';
                await db.run(insertPendenciaStmt, separacaoId, dbItem.id, sep.tecnico_id, sep.tecnico_nome_snapshot, dbItem.item_id, dbItem.item_nome_snapshot, dbItem.unidade_snapshot, solicitadoEfetivo, entregue, diferenca, tipo, ts, ts);
            }
        }
        const sepUpdate = await db.run(`
        UPDATE separacoes SET
          status = 'SEPARADA',
          confirmado_por_id = ?,
          confirmado_por_nome = ?,
          confirmado_em = ?
        WHERE id = ? AND status = 'CALCULADA'
      `, user.id, user.nome, ts, separacaoId);
        if (sepUpdate.affectedRows !== 1) {
            throw new AppError(409, 'Separação já confirmada por outro usuário.', 'DOUBLE_CONFIRMATION');
        }
    });
    return await obterDetalheEstoque(db, separacaoId);
}

export async function listarPendencias(db: AsyncDatabase, page?: Page): Promise<PendenciaDTO[]> {
    const rows = await db.all(`
      SELECT
        p.*,
        s.codigo as separacao_codigo
      FROM pendencias p
      JOIN separacoes s ON s.id = p.separacao_id
      ORDER BY p.criado_em DESC, p.id DESC
    ` + pageSql(page), ...pageParams(page)) as Array<Record<string, unknown>>;
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
    const safe = /^[\s]*[=+\-@]|^[\t\r\n]/.test(str) ? `'${str}` : str;
    if (safe.includes(';') || safe.includes('"') || safe.includes('\n') || safe.includes('\r')) {
        return `"${safe.replace(/"/g, '""')}"`;
    }
    return safe;
}

export function gerarCsvSeparacaoSimples(items: Array<{
    codigo: string;
    nome: string;
    unidade: string;
    quantidadeASeparar: number;
}>): string {
    const header = ['Codigo', 'Material', 'Unidade', 'Quantidade a Separar'].join(';');
    const lines = items.map((i) => [
        escapeCsvCell(i.codigo),
        escapeCsvCell(i.nome),
        escapeCsvCell(i.unidade),
        escapeCsvCell(i.quantidadeASeparar),
    ].join(';'));
    return `\uFEFF${[header, ...lines].join('\r\n')}\r\n`;
}