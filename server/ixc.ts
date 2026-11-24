// Emenda para a integração IXC (issue 05 ampliada). Ponto único de encaixe: quando a API do IXC
// for conectada, implementar estas funções contra o serviço real — rotas e telas não mudam.
import { AppError } from './services/common.ts';

export type ModoBuscaIxc = 'id' | 'nome';

export interface TecnicoIxc {
    idIxc: number;
    nome: string;
    filial: string;
}

function indisponivel(): never {
    throw new AppError(503, 'Integração com o IXC ainda não configurada. Disponível quando a integração IXC for ativada.', 'IXC_INTEGRACAO_INDISPONIVEL');
}

// Busca técnicos no IXC por ID ou por nome (descrição). Hoje: indisponível de forma explícita.
export async function buscarTecnicosIxc(modo: ModoBuscaIxc, termo: string): Promise<TecnicoIxc[]> {
    void modo; void termo;
    indisponivel();
}

// Busca produtos no IXC por ID ou por nome (descrição). Hoje: indisponível de forma explícita.
export async function buscarItensIxc(modo: ModoBuscaIxc, termo: string): Promise<Array<{ idIxc: number; codigo: string; nome: string }>> {
    void modo; void termo;
    indisponivel();
}

// Adiciona ao sistema o produto confirmado vindo do IXC (estoque e descrição do IXC; Máx. global definido na confirmação).
// Hoje: indisponível de forma explícita.
export async function adicionarItemIxc(idIxc: number, limiteMaximo: number): Promise<{ idIxc: number; codigo: string; nome: string }> {
    void idIxc; void limiteMaximo;
    indisponivel();
}
