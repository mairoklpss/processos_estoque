import crypto from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import type { AsyncDatabase } from './data-access.ts';

const ipKey = crypto.randomBytes(32);
export async function writeAudit(db: AsyncDatabase, req: Request, res: Response, createdId?: number): Promise<void> {
  const template = typeof req.route?.path === 'string' ? req.route.path : '/api/unknown';
  let route = template.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, (match: string, name: string) => {
    const value = req.params[name];
    return typeof value === 'string' && /^[1-9][0-9]{0,9}$/.test(value) ? value : match;
  });
  if (createdId && res.statusCode === 201 && !route.includes('/auth/')) route += `/created/${createdId}`;
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const event = template.includes('/auth/login') ? 'AUTH_LOGIN' : template.includes('reset-password') ? 'PASSWORD_RESET' : template.includes('/usuarios') ? 'USER_CHANGE' : template.includes('/confirmar') ? 'STOCK_CONFIRM' : write ? 'API_WRITE' : 'ACCESS_REJECTED';
  const actor = (req as Request & { user?: { id: number } }).user?.id ?? null;
  const ipHash = req.ip ? crypto.createHmac('sha256', ipKey).update(req.ip).digest('hex') : null;
  // Explicit fields only; never body, password, token, cookie, username or raw IP.
  await db.run('INSERT INTO audit_logs (criado_em, actor_id, evento, metodo, rota, status, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
    new Date().toISOString(), actor, event, req.method, route.slice(0, 300), res.statusCode, ipHash);
}

// Read errors / rejected requests outside the domain transaction remain best-effort.
// Successful mutations are audited BEFORE COMMIT by request-transactions.ts.
export function auditRequests(db: AsyncDatabase): RequestHandler {
  return (req, res, next) => {
    const originalEnd = res.end.bind(res); let ending = false;
    res.end = ((...args: unknown[]) => {
      if (ending) return res; ending = true;
      const finish = () => (originalEnd as (...args: unknown[]) => Response)(...args);
      if (res.locals.atomicAuditHandled || (['GET','HEAD','OPTIONS'].includes(req.method) && res.statusCode < 400)) {
        finish(); return res;
      }
      void writeAudit(db, req, res).then(finish).catch(() => { console.error('AUDIT_WRITE_FAILED', { status: res.statusCode }); finish(); });
      return res;
    }) as typeof res.end;
    next();
  };
}
