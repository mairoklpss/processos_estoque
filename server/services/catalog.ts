import { pageSql, pageParams, type Page } from '../validation.ts';
import crypto from 'crypto';
import type { DashboardSummaryDTO, ItemProduto, ParametroTecnicoItem, PendenciaDTO, PerfilUsuario, SeparacaoCoordenadorDTO, SeparacaoEstoqueDetalheDTO, SeparacaoEstoqueFilaDTO, SeparacaoItemCoordenadorDTO, SeparacaoResumoCoordenadorDTO, StatusSeparacao, Tecnico, UsuarioPublico, } from '../../src/shared/types.ts';
import { calcularPropostaItem, recalcularDisponibilidade, REGRA_VERSAO } from '../calculo.ts';
import { hashPassword, verifyPassword } from '../db.ts';
import type { AsyncDatabase } from '../data-access.ts';
import { getClosedPreviousMonth, nowIso } from '../periodo.ts';
import { AppError, AMBIENTE_LABEL, SESSION_TTL_HOURS, type SessionUser } from './common.ts';


// ---------------- COORDENADOR: RESUMO ----------------
export async function getDashboardSummary(db: AsyncDatabase, now: Date = new Date()): Promise<DashboardSummaryDTO> {
    const periodo = getClosedPreviousMonth(now);
    const tecnicosAtivos = (await db.get('SELECT COUNT(*) as c FROM tecnicos WHERE ativo = 1') as {
        c: number;
    }).c;
    const itensAtivos = (await db.get('SELECT COUNT(*) as c FROM itens WHERE ativo = 1') as {
        c: number;
    }).c;
    const rascunhosAbertos = (await db.get("SELECT COUNT(*) as c FROM separacoes WHERE status = 'RASCUNHO'") as {
        c: number;
    }).c;
    const naFilaEstoque = (await db.get("SELECT COUNT(*) as c FROM separacoes WHERE status = 'CALCULADA'") as {
        c: number;
    }).c;
    const pendenciasAbertas = (await db.get("SELECT COUNT(*) as c FROM pendencias WHERE status = 'ABERTA'") as {
        c: number;
    }).c;
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
export async function listarTecnicos(db: AsyncDatabase, page?: Page): Promise<Tecnico[]> {
    const rows = await db.all('SELECT id, matricula, nome, regiao, ativo, criado_em, atualizado_em FROM tecnicos ORDER BY ativo DESC, nome ASC' + pageSql(page), ...pageParams(page)) as Array<Record<string, unknown>>;
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

export async function criarTecnico(db: AsyncDatabase, input: {
    matricula: string;
    nome: string;
    regiao?: string;
}): Promise<Tecnico> {
    return await db.transaction(async (db) => {
        const matricula = input.matricula?.trim().toUpperCase();
        const nome = input.nome?.trim();
        const regiao = (input.regiao ?? '').trim();
        if (!matricula || !nome) {
            throw new AppError(400, 'Matrícula e nome do técnico são obrigatórios.', 'VALIDATION_ERROR');
        }
        const exists = await db.get('SELECT id FROM tecnicos WHERE UPPER(matricula) = ?', matricula);
        if (exists) {
            throw new AppError(409, `Já existe um técnico com a matrícula ${matricula}.`, 'DUPLICATE_MATRICULA');
        }
        const ts = nowIso();
        const res = await db.run('INSERT INTO tecnicos (matricula, nome, regiao, ativo, criado_em, atualizado_em) VALUES (?, ?, ?, 1, ?, ?)', matricula, nome, regiao, ts, ts);
        return (await listarTecnicos(db)).find((t) => t.id === Number(res.insertId))!;
    });
}

export async function atualizarTecnico(db: AsyncDatabase, id: number, input: {
    matricula?: string;
    nome?: string;
    regiao?: string;
    ativo?: boolean;
}): Promise<Tecnico> {
    return await db.transaction(async (db) => {
        const current = await db.get('SELECT * FROM tecnicos WHERE id = ?', id) as {
            id: number;
            matricula: string;
            nome: string;
            regiao: string;
            ativo: number;
        } | undefined;
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
        const dup = await db.get('SELECT id FROM tecnicos WHERE UPPER(matricula) = ? AND id != ?', matricula, id);
        if (dup) {
            throw new AppError(409, `Já existe outro técnico com a matrícula ${matricula}.`, 'DUPLICATE_MATRICULA');
        }
        await db.run('UPDATE tecnicos SET matricula = ?, nome = ?, regiao = ?, ativo = ?, atualizado_em = ? WHERE id = ?', matricula, nome, regiao, ativo, nowIso(), id);
        return (await listarTecnicos(db)).find((t) => t.id === id)!;
    });
}

// ---------------- COORDENADOR: PRODUTOS ----------------
export async function listarItens(db: AsyncDatabase, page?: Page): Promise<ItemProduto[]> {
    const rows = await db.all('SELECT id, codigo, nome, unidade, estoque_atual, limite_maximo, ativo, criado_em, atualizado_em FROM itens ORDER BY ativo DESC, codigo ASC' + pageSql(page), ...pageParams(page)) as Array<Record<string, unknown>>;
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

export async function criarItem(db: AsyncDatabase, input: {
    codigo: string;
    nome: string;
    unidade?: string;
    estoqueAtual: number;
    limiteMaximo: number;
}): Promise<ItemProduto> {
    return await db.transaction(async (db) => {
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
        const dup = await db.get('SELECT id FROM itens WHERE UPPER(codigo) = ?', codigo);
        if (dup) {
            throw new AppError(409, `Já existe um produto com o código ${codigo}.`, 'DUPLICATE_CODE');
        }
        const ts = nowIso();
        const res = await db.run('INSERT INTO itens (codigo, nome, unidade, estoque_atual, limite_maximo, ativo, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, 1, ?, ?)', codigo, nome, unidade, estoqueAtual, limiteMaximo, ts, ts);
        return (await listarItens(db)).find((i) => i.id === Number(res.insertId))!;
    });
}

export async function atualizarItem(db: AsyncDatabase, id: number, input: {
    codigo?: string;
    nome?: string;
    unidade?: string;
    estoqueAtual?: number;
    expectedEstoqueAtual?: number;
    limiteMaximo?: number;
    ativo?: boolean;
}): Promise<ItemProduto> {
    return await db.transaction(async (db) => {
        const current = await db.lock('SELECT * FROM itens WHERE id = ?', id) as {
            id: number;
            codigo: string;
            nome: string;
            unidade: string;
            estoque_atual: number;
            limite_maximo: number;
            ativo: number;
        } | undefined;
        if (!current) {
            throw new AppError(404, 'Produto não encontrado.', 'NOT_FOUND');
        }
        if (input.estoqueAtual !== undefined) {
            if (input.expectedEstoqueAtual === undefined) {
                throw new AppError(400, 'Informe o saldo de estoque usado como referência da edição.', 'EXPECTED_STOCK_REQUIRED');
            }
            if (!Number.isInteger(input.expectedEstoqueAtual) || input.expectedEstoqueAtual < 0 || input.expectedEstoqueAtual > 2147483647) {
                throw new AppError(400, 'Saldo esperado deve ser um inteiro entre 0 e 2147483647.', 'VALIDATION_ERROR');
            }
            if (input.expectedEstoqueAtual !== current.estoque_atual) {
                throw new AppError(409, 'O estoque foi alterado desde o carregamento do produto. Atualize antes de editar.', 'STALE_STOCK_VERSION');
            }
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
        if (!Number.isInteger(estoqueAtual) || estoqueAtual < 0 || estoqueAtual > 2147483647) {
            throw new AppError(400, 'Estoque atual deve ser um inteiro não negativo.', 'VALIDATION_ERROR');
        }
        if (!Number.isInteger(limiteMaximo) || limiteMaximo <= 0) {
            throw new AppError(400, 'Limite máximo global é obrigatório e deve ser maior que zero.', 'VALIDATION_ERROR');
        }
        const dup = await db.get('SELECT id FROM itens WHERE UPPER(codigo) = ? AND id != ?', codigo, id);
        if (dup) {
            throw new AppError(409, `Já existe outro produto com o código ${codigo}.`, 'DUPLICATE_CODE');
        }
        if (input.estoqueAtual !== undefined) {
            await db.run('UPDATE itens SET codigo = ?, nome = ?, unidade = ?, estoque_atual = ?, limite_maximo = ?, ativo = ?, atualizado_em = ? WHERE id = ?', codigo, nome, unidade, estoqueAtual, limiteMaximo, ativo, nowIso(), id);
        } else {
            await db.run('UPDATE itens SET codigo = ?, nome = ?, unidade = ?, limite_maximo = ?, ativo = ?, atualizado_em = ? WHERE id = ?', codigo, nome, unidade, limiteMaximo, ativo, nowIso(), id);
        }
        return (await listarItens(db)).find((i) => i.id === id)!;
    });
}

// ---------------- COORDENADOR: PARÂMETROS POR TÉCNICO ----------------
export async function listarParametrosTecnico(db: AsyncDatabase, tecnicoId: number, now: Date = new Date()): Promise<{
    tecnico: Tecnico;
    competencia: string;
    competenciaLabel: string;
    itens: ParametroTecnicoItem[];
}> {
    const tecnico = (await listarTecnicos(db)).find((t) => t.id === tecnicoId);
    if (!tecnico) {
        throw new AppError(404, 'Técnico não encontrado.', 'NOT_FOUND');
    }
    const periodo = getClosedPreviousMonth(now);
    const itens = await listarItens(db);
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

export async function definirMinimoManual(db: AsyncDatabase, tecnicoId: number, itemId: number, minimoManual: number | null): Promise<{
    minimoManual: number | null;
    alertaMinimoMaiorMaximo: boolean;
}> {
    return await db.transaction(async (db) => {
        const tec = await db.get('SELECT id FROM tecnicos WHERE id = ?', tecnicoId);
        if (!tec)
            throw new AppError(404, 'Técnico não encontrado.', 'NOT_FOUND');
        const item = await db.get('SELECT id, limite_maximo FROM itens WHERE id = ?', itemId) as {
            id: number;
            limite_maximo: number;
        } | undefined;
        if (!item)
            throw new AppError(404, 'Produto não encontrado.', 'NOT_FOUND');
        if (minimoManual === null) {
            await db.run('DELETE FROM minimos_tecnicos WHERE tecnico_id = ? AND item_id = ?', tecnicoId, itemId);
            return { minimoManual: null, alertaMinimoMaiorMaximo: false };
        }
        const parsed = Number(minimoManual);
        if (!Number.isInteger(parsed) || parsed < 0) {
            throw new AppError(400, 'Mínimo manual deve ser um inteiro não negativo.', 'VALIDATION_ERROR');
        }
        await db.run(`
    INSERT INTO minimos_tecnicos (tecnico_id, item_id, minimo_manual, atualizado_em)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(tecnico_id, item_id) DO UPDATE SET
      minimo_manual = excluded.minimo_manual,
      atualizado_em = excluded.atualizado_em
  `, tecnicoId, itemId, parsed, nowIso());
        return {
            minimoManual: parsed,
            alertaMinimoMaiorMaximo: parsed > item.limite_maximo,
        };
    });
}