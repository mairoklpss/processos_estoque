import type { PerfilUsuario } from '../../src/shared/types.ts';

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

export const SESSION_TTL_HOURS = 12;

export const AMBIENTE_LABEL = 'Ambiente de demonstração · Dados simulados (sem conexão IXC)';