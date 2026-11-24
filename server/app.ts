import { validateRequest, getPage } from './validation.ts';
import { auditRequests } from './audit.ts';
import { privateFiles } from './private-files.ts';
import { requestTransactions } from './request-transactions.ts';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { PerfilUsuario, StatusSeparacao } from '../src/shared/types.ts';
import type { DBInstance } from './db.ts';
import { adaptSqlite, type AsyncDatabase } from './data-access.ts';
import { AMBIENTE_LABEL, AppError, ajustarItemRascunho, atualizarItem, atualizarTecnico, atualizarUsuario, calcularSeparacaoRascunho, confirmarEntregaEstoque, criarItem, criarTecnico, criarUsuario, definirMinimoManual, enviarSolicitacaoEstoque, gerarCsvSeparacaoSimples, getDashboardSummary, getUsuarioBySession, listarFilaEstoque, listarItens, listarParametrosTecnico, listarPendencias, listarSeparacoesCoordenador, listarTecnicos, listarUsuarios, loginUsuario, logoutSessao, obterDetalheEstoque, obterSeparacaoCoordenador, redefinirSenhaUsuario, type SessionUser, } from './services.ts';
const instance = process.env.APP_INSTANCE ?? 'operacao';
if (!['operacao', 'homologacao', 'smoke'].includes(instance)) throw new Error('APP_INSTANCE inválida.');
export const SESSION_COOKIE_NAME = instance === 'operacao' ? 'brasilink_sid' : `brasilink_${instance}_sid`;
interface AuthenticatedRequest extends Request {
    user?: SessionUser;
    sessionToken?: string;
}
function parseCookies(cookieHeader: string | undefined): Record<string, string> {
    const result: Record<string, string> = Object.create(null);
    if (!cookieHeader)
        return result;
    for (const part of cookieHeader.split(';')) {
        const eqIndex = part.indexOf('=');
        if (eqIndex <= 0)
            continue;
        const key = part.slice(0, eqIndex).trim();
        const val = part.slice(eqIndex + 1).trim();
        try {
            result[key] = decodeURIComponent(val);
        }
        catch { /* Cookie inválido. */ }
    }
    return result;
}
function setSessionCookie(req: Request, res: Response, token: string): void {
    const isHttps = process.env.NODE_ENV === 'production' || req.secure;
    const attrs = [
        `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${12 * 3600}`,
    ];
    if (isHttps) {
        attrs.push('Secure');
    }
    res.setHeader('Set-Cookie', attrs.join('; '));
}
function clearSessionCookie(req: Request, res: Response): void {
    const isHttps = process.env.NODE_ENV === 'production' || req.secure;
    const attrs = [
        `${SESSION_COOKIE_NAME}=`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        'Max-Age=0',
    ];
    if (isHttps) {
        attrs.push('Secure');
    }
    res.setHeader('Set-Cookie', attrs.join('; '));
}
function extractSessionToken(req: Request): string | undefined {
    const cookies = parseCookies(req.headers.cookie);
    return cookies[SESSION_COOKIE_NAME];
}
export function createApp(connection: DBInstance | AsyncDatabase, options?: {
    getNow?: () => Date;
}): express.Express {
    const baseDb: AsyncDatabase = 'dialect' in connection ? connection : adaptSqlite(connection);
    const { db, middleware: atomicWrites } = requestTransactions(baseDb);
    const app = express();
    app.disable('x-powered-by');
    const proxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
    if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 5)
        throw new Error('TRUST_PROXY_HOPS inválido.');
    app.set('trust proxy', proxyHops || false);
    const production = process.env.NODE_ENV === 'production';
    const publicOrigin = process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN).origin : undefined;
    if (production && (!publicOrigin || !publicOrigin.startsWith('https://'))) {
        throw new Error('Produção exige PUBLIC_ORIGIN com HTTPS.');
    }
    const getNow = options?.getNow ?? (() => new Date());
    app.use((_req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
        if (production) {
            res.setHeader('Strict-Transport-Security', 'max-age=31536000');
            res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
        }
        next();
    });
    app.use(privateFiles);
    // Limita também a pressão sobre auditoria/banco. Rejeições de excesso não geram uma linha por request.
    const apiWindows = new Map<string, { count: number; until: number }>();
    let lastLimitWarning = 0;
    app.use('/api', (req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        const now = Date.now();
        for (const [key, value] of apiWindows) if (value.until <= now) apiWindows.delete(key);
        const key = req.ip ?? 'unknown';
        const existing = apiWindows.get(key);
        if ((existing?.count ?? 0) >= 120 || (!existing && apiWindows.size >= 10000)) {
            res.setHeader('Retry-After', String(Math.max(1, Math.ceil(((existing?.until ?? now + 60000) - now) / 1000))));
            if (now - lastLimitWarning >= 60000) { console.warn('API_RATE_LIMITED'); lastLimitWarning = now; }
            res.status(429).json({ error: 'Muitas requisições. Aguarde um minuto.', code: 'API_RATE_LIMITED' }); return;
        }
        const entry = existing ?? { count: 0, until: now + 60000 };
        entry.count++; apiWindows.set(key, entry); next();
    });
    app.use('/api', auditRequests(baseDb));
    app.use('/api', (req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
            const origin = req.get('origin');
            const expectedOrigin = publicOrigin ?? `${req.protocol}://${req.get('host')}`;
            // Header não simples exige preflight; esta API não habilita CORS.
            if (req.get('X-Requested-With') !== 'Brasilink' ||
                req.get('sec-fetch-site') === 'cross-site' || (origin && origin !== expectedOrigin)) {
                next(new AppError(403, 'Origem da requisição não autorizada.', 'CSRF_REJECTED'));
                return;
            }
            if ((req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length'] ?? 0) > 0) && !req.is('application/json')) {
                next(new AppError(415, 'Envie JSON.', 'UNSUPPORTED_MEDIA_TYPE'));
                return;
            }
        }
        next();
    });
    app.use(express.json({ limit: '100kb', strict: true }));
    app.use('/api', (req, _res, next) => {
        function valid(value: unknown, depth = 0): boolean {
            if (depth > 20)
                return false;
            if (typeof value === 'string')
                return value.length <= 4000;
            if (typeof value === 'number')
                return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
            if (value && typeof value === 'object')
                return Object.values(value).every(v => valid(v, depth + 1));
            return true;
        }
        const stringFields = ['nome', 'username', 'password', 'novaSenha', 'perfil', 'codigo', 'unidade', 'matricula', 'regiao', 'justificativa', 'versaoEstoque'];
        if (req.body !== undefined && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) {
            return next(new AppError(400, 'Envie um objeto JSON.', 'INVALID_INPUT'));
        }
        if (!valid(req.body) || stringFields.some(key => req.body?.[key] !== undefined && typeof req.body[key] !== 'string') ||
            (req.body?.ativo !== undefined && typeof req.body.ativo !== 'boolean')) {
            return next(new AppError(400, 'Campos inválidos ou fora dos limites permitidos.', 'INVALID_INPUT'));
        }
        next();
    });
    app.use('/api', validateRequest);
    for (const name of ['id', 'tecnicoId', 'itemId', 'sepItemId']) {
        app.param(name, (_req, _res, next, value: string) => {
            if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) {
                next(new AppError(400, 'Identificador inválido.', 'INVALID_INPUT'));
                return;
            }
            next();
        });
    }
    // Failures per IP and IP+username, not a global username lock induced by another client.
    // In-flight reservations also bound concurrent password verification.
    const attempts = new Map<string, { failures: number; pending: number; until: number }>();
    app.post('/api/auth/login', (req, res, next) => {
        const now = Date.now();
        for (const [key, entry] of attempts) if (entry.until <= now && entry.pending === 0) attempts.delete(key);
        const keys = [`ip:${req.ip}`, `user:${req.ip}:${String(req.body?.username ?? '').trim().toLowerCase()}`];
        const limits = [20,5];
        if (keys.some((key,i) => { const e=attempts.get(key); return e && e.failures+e.pending >= limits[i]; }) ||
            keys.some(key => !attempts.has(key)) && attempts.size >= 9999) {
            res.setHeader('Retry-After','900'); next(new AppError(429,'Muitas tentativas. Aguarde 15 minutos.','RATE_LIMITED')); return;
        }
        const entries = keys.map(key => {
            const entry=attempts.get(key) ?? { failures:0, pending:0, until:now+900000 };
            entry.pending++; attempts.set(key,entry); return entry;
        });
        let completed=false;
        const complete=() => {
            if (completed) return; completed=true;
            entries.forEach((entry,i) => {
                entry.pending=Math.max(0,entry.pending-1);
                if (!res.writableFinished || [401,403].includes(res.statusCode)) entry.failures++;
                else if (res.writableFinished && res.statusCode===200 && i===1) entry.failures=0;
                if (entry.failures===0 && entry.pending===0) attempts.delete(keys[i]);
            });
        };
        res.once('finish',complete); res.once('close',complete); next();
    });
    app.use('/api', atomicWrites);
    async function requireAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
        try {
        const token = extractSessionToken(req);
        const user = await getUsuarioBySession(db, token);
        if (!user) {
            next(new AppError(401, 'Sessão expirada ou não autenticada. Faça login novamente.', 'UNAUTHORIZED'));
            return;
        }
        req.user = user;
        req.sessionToken = token;
        next();
        } catch (error) { next(error); }
    }
    function requireRole(role: PerfilUsuario) {
        return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
            if (!req.user) {
                next(new AppError(401, 'Não autenticado.', 'UNAUTHORIZED'));
                return;
            }
            if (req.user.perfil !== role) {
                next(new AppError(403, 'Acesso negado para o seu perfil de usuário.', 'FORBIDDEN'));
                return;
            }
            next();
        };
    }
    // ---------------- AUTH ROUTES ----------------
    app.post('/api/auth/login', async (req, res, next) => {
        try {
            const { username, password } = req.body ?? {};
            const result = await loginUsuario(db, String(username ?? ''), String(password ?? ''));
            (req as AuthenticatedRequest).user = result.user;
            setSessionCookie(req, res, result.token);
            res.json({ user: result.user, ambiente: AMBIENTE_LABEL });
        }
        catch (err) {
            next(err);
        }
    });
    app.post('/api/auth/logout', async (req: AuthenticatedRequest, res, next) => {
        try {
        await logoutSessao(db, extractSessionToken(req));
        clearSessionCookie(req, res);
        res.json({ ok: true });
        } catch (error) { next(error); }
    });
    app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
        res.json({ user: req.user, ambiente: AMBIENTE_LABEL });
    });
    // ---------------- COORDENADOR ROUTES ----------------
    app.get('/api/coord/summary', requireAuth, requireRole('COORDENADOR'), async (_req, res, next) => {
        try {
            res.json(await getDashboardSummary(db, getNow()));
        }
        catch (err) {
            next(err);
        }
    });
    app.get('/api/coord/tecnicos', requireAuth, requireRole('COORDENADOR'), async (_req, res, next) => {
        try {
            res.json(await listarTecnicos(db, getPage(_req.query)));
        }
        catch (err) {
            next(err);
        }
    });
    app.post('/api/coord/tecnicos', requireAuth, requireRole('COORDENADOR'), async (req, res, next) => {
        try {
            const created = await criarTecnico(db, req.body ?? {});
            res.status(201).json(created);
        }
        catch (err) {
            next(err);
        }
    });
    app.patch('/api/coord/tecnicos/:id', requireAuth, requireRole('COORDENADOR'), async (req, res, next) => {
        try {
            const updated = await atualizarTecnico(db, Number(req.params.id), req.body ?? {});
            res.json(updated);
        }
        catch (err) {
            next(err);
        }
    });
    app.get('/api/coord/itens', requireAuth, requireRole('COORDENADOR'), async (_req, res, next) => {
        try {
            res.json(await listarItens(db, getPage(_req.query)));
        }
        catch (err) {
            next(err);
        }
    });
    app.post('/api/coord/itens', requireAuth, requireRole('COORDENADOR'), async (req, res, next) => {
        try {
            const created = await criarItem(db, req.body ?? {});
            res.status(201).json(created);
        }
        catch (err) {
            next(err);
        }
    });
    app.patch('/api/coord/itens/:id', requireAuth, requireRole('COORDENADOR'), async (req, res, next) => {
        try {
            const updated = await atualizarItem(db, Number(req.params.id), req.body ?? {});
            res.json(updated);
        }
        catch (err) {
            next(err);
        }
    });
    app.get('/api/coord/parametros/:tecnicoId', requireAuth, requireRole('COORDENADOR'), async (req, res, next) => {
        try {
            res.json(await listarParametrosTecnico(db, Number(req.params.tecnicoId), getNow()));
        }
        catch (err) {
            next(err);
        }
    });
    app.put('/api/coord/parametros/:tecnicoId/:itemId', requireAuth, requireRole('COORDENADOR'), async (req, res, next) => {
        try {
            const raw = req.body?.minimoManual;
            const minimoManual = raw === null || raw === undefined || raw === '' ? null : Number(raw);
            const result = await definirMinimoManual(db, Number(req.params.tecnicoId), Number(req.params.itemId), minimoManual);
            res.json(result);
        }
        catch (err) {
            next(err);
        }
    });
    app.get('/api/coord/usuarios', requireAuth, requireRole('COORDENADOR'), async (_req, res, next) => {
        try {
            res.json(await listarUsuarios(db, getPage(_req.query)));
        }
        catch (err) {
            next(err);
        }
    });
    app.post('/api/coord/usuarios', requireAuth, requireRole('COORDENADOR'), async (req, res, next) => {
        try {
            const created = await criarUsuario(db, req.body ?? {});
            res.status(201).json(created);
        }
        catch (err) {
            next(err);
        }
    });
    app.patch('/api/coord/usuarios/:id', requireAuth, requireRole('COORDENADOR'), async (req: AuthenticatedRequest, res, next) => {
        try {
            const updated = await atualizarUsuario(db, req.user!.id, Number(req.params.id), req.body ?? {});
            res.json(updated);
        }
        catch (err) {
            next(err);
        }
    });
    app.post('/api/coord/usuarios/:id/reset-password', requireAuth, requireRole('COORDENADOR'), async (req, res, next) => {
        try {
            await redefinirSenhaUsuario(db, Number(req.params.id), String(req.body?.novaSenha ?? ''));
            res.json({ ok: true });
        }
        catch (err) {
            next(err);
        }
    });
    app.post('/api/coord/separacoes/calcular', requireAuth, requireRole('COORDENADOR'), async (req: AuthenticatedRequest, res, next) => {
        try {
            const tecnicoId = Number(req.body?.tecnicoId);
            const sep = await calcularSeparacaoRascunho(db, req.user!, tecnicoId, getNow());
            res.status(201).json(sep);
        }
        catch (err) {
            next(err);
        }
    });
    app.get('/api/coord/separacoes', requireAuth, requireRole('COORDENADOR'), async (req, res, next) => {
        try {
            const tecnicoId = req.query.tecnicoId ? Number(req.query.tecnicoId) : undefined;
            const competencia = req.query.competencia ? String(req.query.competencia) : undefined;
            const status = req.query.status ? (String(req.query.status) as StatusSeparacao) : undefined;
            res.json(await listarSeparacoesCoordenador(db, { tecnicoId, competencia, status }, getPage(req.query)));
        }
        catch (err) {
            next(err);
        }
    });
    app.get('/api/coord/separacoes/:id', requireAuth, requireRole('COORDENADOR'), async (req, res, next) => {
        try {
            res.json(await obterSeparacaoCoordenador(db, Number(req.params.id)));
        }
        catch (err) {
            next(err);
        }
    });
    app.patch('/api/coord/separacoes/:id/itens/:sepItemId', requireAuth, requireRole('COORDENADOR'), async (req: AuthenticatedRequest, res, next) => {
        try {
            const sep = await ajustarItemRascunho(db, req.user!, Number(req.params.id), Number(req.params.sepItemId), Number(req.body?.quantidadeSolicitada), String(req.body?.justificativa ?? ''));
            res.json(sep);
        }
        catch (err) {
            next(err);
        }
    });
    app.post('/api/coord/separacoes/:id/enviar', requireAuth, requireRole('COORDENADOR'), async (req: AuthenticatedRequest, res, next) => {
        try {
            const sep = await enviarSolicitacaoEstoque(db, req.user!, Number(req.params.id));
            res.json(sep);
        }
        catch (err) {
            next(err);
        }
    });
    app.get('/api/coord/separacoes/:id/csv', requireAuth, requireRole('COORDENADOR'), async (req, res, next) => {
        try {
            const sep = await obterSeparacaoCoordenador(db, Number(req.params.id));
            const csv = gerarCsvSeparacaoSimples(sep.itens.map((i) => ({
                codigo: i.itemCodigo,
                nome: i.itemNome,
                unidade: i.unidade,
                quantidadeASeparar: i.quantidadeDisponivel,
            })));
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${sep.codigo}.csv"`);
            res.send(csv);
        }
        catch (err) {
            next(err);
        }
    });
    app.get('/api/coord/pendencias', requireAuth, requireRole('COORDENADOR'), async (_req, res, next) => {
        try {
            res.json(await listarPendencias(db, getPage(_req.query)));
        }
        catch (err) {
            next(err);
        }
    });
    // ---------------- ESTOQUE ROUTES (ESTRITAMENTE ISOLADAS) ----------------
    app.get('/api/estoque/fila', requireAuth, requireRole('ESTOQUE'), async (_req, res, next) => {
        try {
            res.json(await listarFilaEstoque(db, getPage(_req.query)));
        }
        catch (err) {
            next(err);
        }
    });
    app.get('/api/estoque/fila/:id', requireAuth, requireRole('ESTOQUE'), async (req, res, next) => {
        try {
            res.json(await obterDetalheEstoque(db, Number(req.params.id)));
        }
        catch (err) {
            next(err);
        }
    });
    app.post('/api/estoque/fila/:id/confirmar', requireAuth, requireRole('ESTOQUE'), async (req: AuthenticatedRequest, res, next) => {
        try {
            const detail = await confirmarEntregaEstoque(db, req.user!, Number(req.params.id), req.body ?? {});
            res.json(detail);
        }
        catch (err) {
            next(err);
        }
    });
    app.get('/api/estoque/fila/:id/csv', requireAuth, requireRole('ESTOQUE'), async (req, res, next) => {
        try {
            const detail = await obterDetalheEstoque(db, Number(req.params.id));
            const csv = gerarCsvSeparacaoSimples(detail.itens.map((i) => ({
                codigo: i.codigo,
                nome: i.nome,
                unidade: i.unidade,
                quantidadeASeparar: i.quantidadeASeparar,
            })));
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${detail.codigo}-estoque.csv"`);
            res.send(csv);
        }
        catch (err) {
            next(err);
        }
    });
    app.get('/api/estoque/pendencias', requireAuth, requireRole('ESTOQUE'), async (_req, res, next) => {
        try {
            res.json(await listarPendencias(db, getPage(_req.query)));
        }
        catch (err) {
            next(err);
        }
    });
    app.get('/api/coord/auditoria', requireAuth, requireRole('COORDENADOR'), async (req, res, next) => {
        try {
            const page = getPage(req.query);
            res.json(await db.all('SELECT id, criado_em, actor_id, evento, metodo, rota, status FROM audit_logs ORDER BY id DESC LIMIT ? OFFSET ?', page.limit, page.offset));
        } catch (error) { next(error); }
    });
    app.use('/api', (_req, res) => res.status(404).json({ error:'Endpoint não encontrado.', code:'NOT_FOUND' }));
    // ---------------- ERROR HANDLER ----------------
    app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        if (res.headersSent || res.writableEnded || res.destroyed) return;
        if (err instanceof AppError) {
            res.status(err.status).json({ error: err.message, code: err.code });
            return;
        }
        const parserError = err as {
            type?: string;
        };
        if (parserError?.type === 'entity.too.large') {
            res.status(413).json({ error: 'JSON excede 100 KB.', code: 'PAYLOAD_TOO_LARGE' });
            return;
        }
        if (parserError?.type === 'entity.parse.failed') {
            res.status(400).json({ error: 'JSON inválido.', code: 'INVALID_JSON' });
            return;
        }
        const databaseError = err as { code?: string };
        if (databaseError?.code === '23505' || databaseError?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            res.status(409).json({ error: 'Registro já existente.', code: 'DUPLICATE_RECORD' }); return;
        }
        console.error('Erro inesperado na API', { code: databaseError?.code ?? 'INTERNAL_ERROR' });
        res.status(500).json({ error: 'Erro interno ao processar a operação.', code: 'INTERNAL_ERROR' });
    });
    return app;
}
