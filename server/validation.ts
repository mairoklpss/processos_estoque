import { z } from 'zod';
import type { RequestHandler } from 'express';

const integer = z.number().int().min(0).max(2147483647);
const id = integer.min(1);
const text = z.string().max(4000);
const short = z.string().trim().min(1).max(200);
const profile = z.enum(['COORDENADOR', 'ESTOQUE']);
const empty = z.object({}).strict();
const technician = z.object({ matricula: short.max(100), nome: short, filial: z.string().max(200).optional() }).strict();
const item = z.object({ codigo: short.max(100), nome: short, unidade: short.max(30).optional(), estoqueAtual: integer, limiteMaximo: integer.min(1) }).strict();
const user = z.object({ nome: short, username: short.max(100), password: z.string().min(12).max(128), perfil: profile }).strict();
const delivery = z.object({ versaoEstoque: z.string().regex(/^[a-f0-9]{24}$/), itens: z.array(z.object({ separacaoItemId: id, quantidadeEntregue: integer }).strict()).min(1).max(1000) }).strict();
const rules: { method: string; path: RegExp; schema: z.ZodType }[] = [
  { method: 'POST', path: /^\/auth\/login$/, schema: z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(128) }).strict() },
  { method: 'POST', path: /^\/auth\/logout$/, schema: empty },
  { method: 'POST', path: /^\/coord\/tecnicos$/, schema: technician },
  { method: 'PATCH', path: /^\/coord\/tecnicos\/[1-9][0-9]*$/, schema: technician.partial().extend({ ativo: z.boolean().optional() }).strict() },
  { method: 'POST', path: /^\/coord\/itens$/, schema: item },
  { method: 'PATCH', path: /^\/coord\/itens\/[1-9][0-9]*$/, schema: item.partial().extend({ ativo: z.boolean().optional(), expectedEstoqueAtual: integer.optional() }).strict().refine(value => value.estoqueAtual === undefined || value.expectedEstoqueAtual !== undefined) },
  { method: 'POST', path: /^\/coord\/usuarios$/, schema: user },
  { method: 'PATCH', path: /^\/coord\/usuarios\/[1-9][0-9]*$/, schema: z.object({ nome: short.optional(), perfil: profile.optional(), ativo: z.boolean().optional() }).strict() },
  { method: 'POST', path: /^\/coord\/usuarios\/[1-9][0-9]*\/reset-password$/, schema: z.object({ novaSenha: z.string().min(12).max(128) }).strict() },
  { method: 'PUT', path: /^\/coord\/parametros\/[1-9][0-9]*\/[1-9][0-9]*$/, schema: z.object({ minimoManual: integer.nullable() }).strict() },
  { method: 'POST', path: /^\/coord\/separacoes\/calcular$/, schema: z.object({ tecnicoId: id }).strict() },
  { method: 'PATCH', path: /^\/coord\/separacoes\/[1-9][0-9]*\/itens\/[1-9][0-9]*$/, schema: z.object({ quantidadeSolicitada: integer, justificativa: text }).strict() },
  { method: 'POST', path: /^\/coord\/separacoes\/[1-9][0-9]*\/enviar$/, schema: empty },
  { method: 'POST', path: /^\/estoque\/fila\/[1-9][0-9]*\/confirmar$/, schema: delivery },
];

export interface Page { limit: number; offset: number }
export function getPage(query: Record<string, unknown>): Page {
  return { limit: Number(query.limit ?? 100), offset: Number(query.offset ?? 0) };
}
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).max(2147483647).optional(),
});
const separationQuery = listQuery.extend({
  tecnicoId: z.coerce.number().int().min(1).max(2147483647).optional(),
  competencia: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/).optional(),
  status: z.enum(['RASCUNHO', 'CALCULADA', 'SEPARADA']).optional(),
}).strict();
const listPaths = /^\/(coord\/(tecnicos|itens|usuarios|pendencias|auditoria|separacoes)|estoque\/(fila|pendencias))$/;

export const validateRequest: RequestHandler = (req, res, next) => {
  let pathname: string;
  try { pathname = decodeURIComponent(req.path).toLowerCase().replace(/\/+$/, '') || '/'; }
  catch { res.status(400).json({ error:'Caminho inválido.', code:'INVALID_INPUT' }); return; }
  const rule = rules.find(rule => rule.method === req.method && rule.path.test(pathname));
  if (rule) {
    const result = rule.schema.safeParse(req.body ?? {});
    if (!result.success) {
      res.status(400).json({ error: 'Campos inválidos. Verifique tipos, limites e campos permitidos.', code: 'VALIDATION_ERROR' }); return;
    }
    req.body = result.data;
  }
  if (req.method === 'GET' && listPaths.test(pathname)) {
    const schema = pathname === '/coord/separacoes' ? separationQuery : listQuery.strict();
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json({ error: 'Filtros ou paginação inválidos.', code: 'VALIDATION_ERROR' }); return;
    }
    const page = getPage(req.query);
    res.setHeader('X-Page-Limit', page.limit);
    res.setHeader('X-Page-Offset', page.offset);
  }
  next();
};

export function pageSql(page?: Page): string { return page ? ' LIMIT ? OFFSET ?' : ''; }
export function pageParams(page?: Page): number[] { return page ? [page.limit, page.offset] : []; }
