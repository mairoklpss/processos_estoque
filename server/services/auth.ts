import { pageSql, pageParams, type Page } from '../validation.ts';
import crypto from 'crypto';
import type { DashboardSummaryDTO, ItemProduto, ParametroTecnicoItem, PendenciaDTO, PerfilUsuario, SeparacaoCoordenadorDTO, SeparacaoEstoqueDetalheDTO, SeparacaoEstoqueFilaDTO, SeparacaoItemCoordenadorDTO, SeparacaoResumoCoordenadorDTO, StatusSeparacao, Tecnico, UsuarioPublico, } from '../../src/shared/types.ts';
import { calcularPropostaItem, recalcularDisponibilidade, REGRA_VERSAO } from '../calculo.ts';
import { hashPassword, verifyPassword } from '../db.ts';
import type { AsyncDatabase } from '../data-access.ts';
import { getClosedPreviousMonth, nowIso } from '../periodo.ts';
import { AppError, AMBIENTE_LABEL, SESSION_TTL_HOURS, type SessionUser } from './common.ts';


// ---------------- AUTH ----------------
const dummyPasswordHash = hashPassword(crypto.randomBytes(32).toString('hex'));
function sessionKey(token: string): string {
    return `sha256:${crypto.createHash('sha256').update(token).digest('hex')}`;
}

export async function loginUsuario(db: AsyncDatabase, username: string, password: string): Promise<{
    token: string;
    user: SessionUser;
    expiresAt: string;
}> {
    return db.transaction(async db => {
    const cleanUser = username.trim().toLowerCase();
    if (!cleanUser || !password) {
        throw new AppError(400, 'Informe usuário e senha.', 'INVALID_INPUT');
    }
    const row = await db.get('SELECT id, nome, username, senha_hash, perfil, ativo FROM usuarios WHERE LOWER(username) = ?', cleanUser) as {
        id: number;
        nome: string;
        username: string;
        senha_hash: string;
        perfil: PerfilUsuario;
        ativo: number;
    } | undefined;
    const passwordMatches = verifyPassword(password, row?.senha_hash ?? dummyPasswordHash);
    if (!row || !passwordMatches) {
        throw new AppError(401, 'Usuário ou senha inválidos.', 'INVALID_CREDENTIALS');
    }
    if (row.ativo !== 1) {
        throw new AppError(403, 'Usuário desativado. Procure a coordenação.', 'USER_INACTIVE');
    }
    const token = crypto.randomBytes(32).toString('hex');
    const created = new Date();
    const expires = new Date(created.getTime() + SESSION_TTL_HOURS * 3600 * 1000);
    await db.run('INSERT INTO sessoes (token, usuario_id, criado_em, expira_em) VALUES (?, ?, ?, ?)', sessionKey(token), row.id, created.toISOString(), expires.toISOString());
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
    });
}

export async function getUsuarioBySession(db: AsyncDatabase, token: string | undefined): Promise<SessionUser | null> {
    if (!token || !/^[a-f0-9]{64}$/.test(token))
        return null;
    const row = await db.get(`
      SELECT u.id, u.nome, u.username, u.perfil, u.ativo, s.expira_em
      FROM sessoes s
      JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token IN (?, ?)
    `, sessionKey(token), token) as {
        id: number;
        nome: string;
        username: string;
        perfil: PerfilUsuario;
        ativo: number;
        expira_em: string;
    } | undefined;
    if (!row)
        return null;
    if (new Date(row.expira_em).getTime() <= Date.now()) {
        await db.run('DELETE FROM sessoes WHERE token IN (?, ?)', sessionKey(token), token);
        return null;
    }
    if (row.ativo !== 1) {
        return null;
    }
    // Atualiza sessões legadas sem revogar a sessão ativa.
    await db.run('UPDATE sessoes SET token = ? WHERE token = ?', sessionKey(token), token);
    return {
        id: row.id,
        nome: row.nome,
        username: row.username,
        perfil: row.perfil,
    };
}

export async function logoutSessao(db: AsyncDatabase, token: string | undefined): Promise<void> {
    if (!token)
        return;
    await db.run('DELETE FROM sessoes WHERE token IN (?, ?)', sessionKey(token), token);
}

// ---------------- COORDENADOR: USUÁRIOS ----------------
export async function listarUsuarios(db: AsyncDatabase, page?: Page): Promise<UsuarioPublico[]> {
    const rows = await db.all('SELECT id, nome, username, perfil, ativo, criado_em, atualizado_em FROM usuarios ORDER BY id ASC' + pageSql(page), ...pageParams(page)) as Array<Record<string, unknown>>;
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

function validarSenha(senha: unknown): asserts senha is string {
    if (typeof senha !== 'string' || senha.length < 12 || senha.length > 128) {
        throw new AppError(400, 'Use uma senha de 12 a 128 caracteres; prefira uma frase longa e exclusiva.', 'VALIDATION_ERROR');
    }
}

export async function criarUsuario(db: AsyncDatabase, input: {
    nome: string;
    username: string;
    password: string;
    perfil: PerfilUsuario;
}): Promise<UsuarioPublico> {
    return await db.transaction(async (db) => {
        const nome = input.nome?.trim();
        const username = input.username?.trim().toLowerCase();
        const password = input.password ?? '';
        const perfil = input.perfil;
        if (!nome || !username || !password) {
            throw new AppError(400, 'Nome, usuário e senha são obrigatórios.', 'VALIDATION_ERROR');
        }
        validarSenha(password);
        if (perfil !== 'COORDENADOR' && perfil !== 'ESTOQUE') {
            throw new AppError(400, 'Perfil inválido.', 'VALIDATION_ERROR');
        }
        const dup = await db.get('SELECT id FROM usuarios WHERE LOWER(username) = ?', username);
        if (dup) {
            throw new AppError(409, `Já existe um usuário com login "${username}".`, 'DUPLICATE_USERNAME');
        }
        const ts = nowIso();
        const res = await db.run('INSERT INTO usuarios (nome, username, senha_hash, perfil, ativo, criado_em, atualizado_em) VALUES (?, ?, ?, ?, 1, ?, ?)', nome, username, hashPassword(password), perfil, ts, ts);
        return (await listarUsuarios(db)).find((u) => u.id === Number(res.insertId))!;
    });
}

export async function atualizarUsuario(db: AsyncDatabase, actorId: number, id: number, input: {
    nome?: string;
    perfil?: PerfilUsuario;
    ativo?: boolean;
}): Promise<UsuarioPublico> {
    return await db.transaction(async (db) => {
        const current = await db.get('SELECT * FROM usuarios WHERE id = ?', id) as {
            id: number;
            nome: string;
            username: string;
            perfil: PerfilUsuario;
            ativo: number;
        } | undefined;
        if (!current)
            throw new AppError(404, 'Usuário não encontrado.', 'NOT_FOUND');
        const nome = input.nome !== undefined ? input.nome.trim() : current.nome;
        const perfil = input.perfil !== undefined ? input.perfil : current.perfil;
        const ativo = input.ativo !== undefined ? (input.ativo ? 1 : 0) : current.ativo;
        if (!nome)
            throw new AppError(400, 'Nome não pode ficar vazio.', 'VALIDATION_ERROR');
        if (perfil !== 'COORDENADOR' && perfil !== 'ESTOQUE') {
            throw new AppError(400, 'Perfil inválido.', 'VALIDATION_ERROR');
        }
        if (id === actorId && ativo === 0) {
            throw new AppError(400, 'Você não pode desativar o próprio usuário logado.', 'SELF_DEACTIVATE');
        }
        if (current.perfil === 'COORDENADOR' && current.ativo === 1 && (perfil !== 'COORDENADOR' || ativo === 0)) {
            const count = await db.get<{ c: number }>("SELECT COUNT(*) AS c FROM usuarios WHERE perfil = 'COORDENADOR' AND ativo = 1");
            if (!count || count.c <= 1) throw new AppError(400, 'Mantenha pelo menos um coordenador ativo.', 'LAST_COORDINATOR');
        }
        await db.run('UPDATE usuarios SET nome = ?, perfil = ?, ativo = ?, atualizado_em = ? WHERE id = ?', nome, perfil, ativo, nowIso(), id);
        if (ativo === 0 || perfil !== current.perfil) {
            await db.run('DELETE FROM sessoes WHERE usuario_id = ?', id);
        }
        return (await listarUsuarios(db)).find((u) => u.id === id)!;
    });
}

export async function redefinirSenhaUsuario(db: AsyncDatabase, id: number, novaSenha: string): Promise<void> {
    return await db.transaction(async (db) => {
        const current = await db.get('SELECT id FROM usuarios WHERE id = ?', id);
        if (!current)
            throw new AppError(404, 'Usuário não encontrado.', 'NOT_FOUND');
        validarSenha(novaSenha);
        await db.run('UPDATE usuarios SET senha_hash = ?, atualizado_em = ? WHERE id = ?', hashPassword(novaSenha), nowIso(), id);
        // Invalida sessões antigas após troca de senha
        await db.run('DELETE FROM sessoes WHERE usuario_id = ?', id);
    });
}