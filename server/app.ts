import express, { type NextFunction, type Request, type Response } from 'express';
import type { PerfilUsuario, StatusSeparacao } from '../src/shared/types.ts';
import type { DBInstance } from './db.ts';
import {
  AMBIENTE_LABEL,
  AppError,
  ajustarItemRascunho,
  atualizarItem,
  atualizarTecnico,
  atualizarUsuario,
  calcularSeparacaoRascunho,
  confirmarEntregaEstoque,
  criarItem,
  criarTecnico,
  criarUsuario,
  definirMinimoManual,
  enviarSolicitacaoEstoque,
  gerarCsvSeparacaoSimples,
  getDashboardSummary,
  getUsuarioBySession,
  listarFilaEstoque,
  listarItens,
  listarParametrosTecnico,
  listarPendencias,
  listarSeparacoesCoordenador,
  listarTecnicos,
  listarUsuarios,
  loginUsuario,
  logoutSessao,
  obterDetalheEstoque,
  obterSeparacaoCoordenador,
  redefinirSenhaUsuario,
  type SessionUser,
} from './services.ts';

export const SESSION_COOKIE_NAME = 'brasilink_sid';

interface AuthenticatedRequest extends Request {
  user?: SessionUser;
  sessionToken?: string;
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = part.slice(0, eqIndex).trim();
    const val = part.slice(eqIndex + 1).trim();
    result[key] = decodeURIComponent(val);
  }
  return result;
}

function setSessionCookie(req: Request, res: Response, token: string): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const attrs = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${isHttps ? 'None' : 'Lax'}`,
    `Max-Age=${12 * 3600}`,
  ];
  if (isHttps) {
    attrs.push('Secure', 'Partitioned');
  }
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(req: Request, res: Response): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const attrs = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    `SameSite=${isHttps ? 'None' : 'Lax'}`,
    'Max-Age=0',
  ];
  if (isHttps) {
    attrs.push('Secure', 'Partitioned');
  }
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function extractSessionToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE_NAME];
}

export function createApp(db: DBInstance, options?: { getNow?: () => Date }): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  const getNow = options?.getNow ?? (() => new Date());

  app.use(express.json());

  function requireAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
    const token = extractSessionToken(req);
    const user = getUsuarioBySession(db, token);
    if (!user) {
      next(new AppError(401, 'Sessão expirada ou não autenticada. Faça login novamente.', 'UNAUTHORIZED'));
      return;
    }
    req.user = user;
    req.sessionToken = token;
    next();
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

  app.post('/api/auth/login', (req, res, next) => {
    try {
      const { username, password } = req.body ?? {};
      const result = loginUsuario(db, String(username ?? ''), String(password ?? ''));
      setSessionCookie(req, res, result.token);
      res.json({ user: result.user, ambiente: AMBIENTE_LABEL, token: result.token });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/logout', (req: AuthenticatedRequest, res) => {
    logoutSessao(db, extractSessionToken(req));
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    res.json({ user: req.user, ambiente: AMBIENTE_LABEL });
  });

  // ---------------- COORDENADOR ROUTES ----------------

  app.get('/api/coord/summary', requireAuth, requireRole('COORDENADOR'), (_req, res, next) => {
    try {
      res.json(getDashboardSummary(db, getNow()));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/coord/tecnicos', requireAuth, requireRole('COORDENADOR'), (_req, res, next) => {
    try {
      res.json(listarTecnicos(db));
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/coord/tecnicos', requireAuth, requireRole('COORDENADOR'), (req, res, next) => {
    try {
      const created = criarTecnico(db, req.body ?? {});
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/coord/tecnicos/:id', requireAuth, requireRole('COORDENADOR'), (req, res, next) => {
    try {
      const updated = atualizarTecnico(db, Number(req.params.id), req.body ?? {});
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/coord/itens', requireAuth, requireRole('COORDENADOR'), (_req, res, next) => {
    try {
      res.json(listarItens(db));
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/coord/itens', requireAuth, requireRole('COORDENADOR'), (req, res, next) => {
    try {
      const created = criarItem(db, req.body ?? {});
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/coord/itens/:id', requireAuth, requireRole('COORDENADOR'), (req, res, next) => {
    try {
      const updated = atualizarItem(db, Number(req.params.id), req.body ?? {});
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/coord/parametros/:tecnicoId', requireAuth, requireRole('COORDENADOR'), (req, res, next) => {
    try {
      res.json(listarParametrosTecnico(db, Number(req.params.tecnicoId), getNow()));
    } catch (err) {
      next(err);
    }
  });

  app.put(
    '/api/coord/parametros/:tecnicoId/:itemId',
    requireAuth,
    requireRole('COORDENADOR'),
    (req, res, next) => {
      try {
        const raw = req.body?.minimoManual;
        const minimoManual = raw === null || raw === undefined || raw === '' ? null : Number(raw);
        const result = definirMinimoManual(db, Number(req.params.tecnicoId), Number(req.params.itemId), minimoManual);
        res.json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  app.get('/api/coord/usuarios', requireAuth, requireRole('COORDENADOR'), (_req, res, next) => {
    try {
      res.json(listarUsuarios(db));
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/coord/usuarios', requireAuth, requireRole('COORDENADOR'), (req, res, next) => {
    try {
      const created = criarUsuario(db, req.body ?? {});
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/coord/usuarios/:id', requireAuth, requireRole('COORDENADOR'), (req: AuthenticatedRequest, res, next) => {
    try {
      const updated = atualizarUsuario(db, req.user!.id, Number(req.params.id), req.body ?? {});
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/coord/usuarios/:id/reset-password', requireAuth, requireRole('COORDENADOR'), (req, res, next) => {
    try {
      redefinirSenhaUsuario(db, Number(req.params.id), String(req.body?.novaSenha ?? ''));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/coord/separacoes/calcular', requireAuth, requireRole('COORDENADOR'), (req: AuthenticatedRequest, res, next) => {
    try {
      const tecnicoId = Number(req.body?.tecnicoId);
      const observacoes = req.body?.observacoes ? String(req.body.observacoes) : undefined;
      const sep = calcularSeparacaoRascunho(db, req.user!, tecnicoId, observacoes, getNow());
      res.status(201).json(sep);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/coord/separacoes', requireAuth, requireRole('COORDENADOR'), (req, res, next) => {
    try {
      const tecnicoId = req.query.tecnicoId ? Number(req.query.tecnicoId) : undefined;
      const competencia = req.query.competencia ? String(req.query.competencia) : undefined;
      const status = req.query.status ? (String(req.query.status) as StatusSeparacao) : undefined;
      res.json(listarSeparacoesCoordenador(db, { tecnicoId, competencia, status }));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/coord/separacoes/:id', requireAuth, requireRole('COORDENADOR'), (req, res, next) => {
    try {
      res.json(obterSeparacaoCoordenador(db, Number(req.params.id)));
    } catch (err) {
      next(err);
    }
  });

  app.patch(
    '/api/coord/separacoes/:id/itens/:sepItemId',
    requireAuth,
    requireRole('COORDENADOR'),
    (req: AuthenticatedRequest, res, next) => {
      try {
        const sep = ajustarItemRascunho(
          db,
          req.user!,
          Number(req.params.id),
          Number(req.params.sepItemId),
          Number(req.body?.quantidadeSolicitada),
          String(req.body?.justificativa ?? '')
        );
        res.json(sep);
      } catch (err) {
        next(err);
      }
    }
  );

  app.post('/api/coord/separacoes/:id/enviar', requireAuth, requireRole('COORDENADOR'), (req: AuthenticatedRequest, res, next) => {
    try {
      const sep = enviarSolicitacaoEstoque(db, req.user!, Number(req.params.id));
      res.json(sep);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/coord/separacoes/:id/csv', requireAuth, requireRole('COORDENADOR'), (req, res, next) => {
    try {
      const sep = obterSeparacaoCoordenador(db, Number(req.params.id));
      const csv = gerarCsvSeparacaoSimples(
        sep.itens.map((i) => ({
          codigo: i.itemCodigo,
          nome: i.itemNome,
          unidade: i.unidade,
          quantidadeASeparar: i.quantidadeDisponivel,
        }))
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${sep.codigo}.csv"`);
      res.send(csv);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/coord/pendencias', requireAuth, requireRole('COORDENADOR'), (_req, res, next) => {
    try {
      res.json(listarPendencias(db));
    } catch (err) {
      next(err);
    }
  });

  // ---------------- ESTOQUE ROUTES (ESTRITAMENTE ISOLADAS) ----------------

  app.get('/api/estoque/fila', requireAuth, requireRole('ESTOQUE'), (_req, res, next) => {
    try {
      res.json(listarFilaEstoque(db));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/estoque/fila/:id', requireAuth, requireRole('ESTOQUE'), (req, res, next) => {
    try {
      res.json(obterDetalheEstoque(db, Number(req.params.id)));
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/estoque/fila/:id/confirmar', requireAuth, requireRole('ESTOQUE'), (req: AuthenticatedRequest, res, next) => {
    try {
      const detail = confirmarEntregaEstoque(db, req.user!, Number(req.params.id), req.body ?? {});
      res.json(detail);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/estoque/fila/:id/csv', requireAuth, requireRole('ESTOQUE'), (req, res, next) => {
    try {
      const detail = obterDetalheEstoque(db, Number(req.params.id));
      const csv = gerarCsvSeparacaoSimples(
        detail.itens.map((i) => ({
          codigo: i.codigo,
          nome: i.nome,
          unidade: i.unidade,
          quantidadeASeparar: i.quantidadeASeparar,
        }))
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${detail.codigo}-estoque.csv"`);
      res.send(csv);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/estoque/pendencias', requireAuth, requireRole('ESTOQUE'), (_req, res, next) => {
    try {
      res.json(listarPendencias(db));
    } catch (err) {
      next(err);
    }
  });

  // ---------------- ERROR HANDLER ----------------

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    console.error('Erro inesperado na API:', err);
    res.status(500).json({ error: 'Erro interno ao processar a operação.', code: 'INTERNAL_ERROR' });
  });

  return app;
}
