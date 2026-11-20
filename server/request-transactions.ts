import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler, Response } from 'express';
import type { AsyncDatabase } from './database.ts';
import { writeAudit } from './audit.ts';

class RejectedResponse extends Error {}
class AuditUnavailable extends Error {}

// Services already own transactions. Within a write request these are logical scopes
// of the SAME physical transaction, not nested BEGINs or separate commits.
export function requestTransactions(base: AsyncDatabase): { db: AsyncDatabase; middleware: RequestHandler } {
  const storage = new AsyncLocalStorage<AsyncDatabase>();
  const current = () => storage.getStore() ?? base;
  const db: AsyncDatabase = {
    dialect: base.dialect,
    get: (sql,...params) => current().get(sql,...params),
    all: (sql,...params) => current().all(sql,...params),
    run: (sql,...params) => current().run(sql,...params),
    lock: (sql,...params) => current().lock(sql,...params),
    lockAll: (sql,...params) => current().lockAll(sql,...params),
    transaction: work => { const tx=storage.getStore(); return tx ? work(tx) : base.transaction(work); },
    close: () => base.close(),
  };
  const middleware: RequestHandler = (req,res,next) => {
    if (['GET','HEAD','OPTIONS'].includes(req.method)) { next(); return; }
    res.locals.atomicAuditHandled = true;
    const originalEnd = res.end.bind(res); const originalWrite = res.write.bind(res);
    const chunks: Array<{ chunk: any; encoding?: any; callback?: any }> = [];
    let endArgs: any[] = []; let ended = false; let finished = false; let cancelled = res.destroyed || req.aborted;
    let rejectWork: ((error: Error) => void) | undefined;
    res.once('close', () => { if (!finished) { cancelled = true; rejectWork?.(new Error('CLIENT_DISCONNECTED')); } });
    if (cancelled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      if (finished || res.destroyed) return; finished = true;
      res.write = originalWrite; res.end = originalEnd;
      for (const part of chunks) (originalWrite as any)(part.chunk,part.encoding,part.callback);
      (originalEnd as any)(...endArgs);
    };
    const fail = (code: string, message: string) => {
      if (finished || res.destroyed) return; finished = true;
      res.write = originalWrite; res.end = originalEnd;
      res.removeHeader('Set-Cookie'); res.removeHeader('ETag');
      const body = JSON.stringify({ error: message, code });
      res.statusCode = 503; res.setHeader('Content-Type','application/json; charset=utf-8');
      res.setHeader('Content-Length',Buffer.byteLength(body));
      (originalEnd as any)(body);
    };
    // No retry of the Express handler: HTTP headers/buffer are side effects.
    // Disable the adapter retry policy for this externally-visible callback.
    void base.transaction(tx => new Promise<void>((resolve,reject) => {
      let settled = false;
      const stop = (error: Error) => { if (settled) return; settled=true; reject(error); };
      const succeed = () => { if (settled) return; settled=true; resolve(); };
      rejectWork = stop;
      if (cancelled || res.destroyed || req.aborted) { stop(new Error('CLIENT_DISCONNECTED')); return; }
      timer = setTimeout(() => stop(new Error('REQUEST_TRANSACTION_TIMEOUT')),20000);
      timer.unref();
      res.write = ((chunk: any,encoding?: any,callback?: any) => { chunks.push({chunk,encoding,callback}); return true; }) as typeof res.write;
      res.end = ((...args: any[]) => {
        if (ended || settled) return res; ended=true; endArgs=args;
        if (res.statusCode >= 400) { stop(new RejectedResponse()); return res; }
        let createdId: number | undefined;
        try { const parsed=JSON.parse(String(args[0]??'')); if (Number.isSafeInteger(parsed.id) && parsed.id>0) createdId=parsed.id; } catch { /* JSON routes only; no payload persisted. */ }
        void writeAudit(tx,req,res,createdId).then(succeed).catch(() => stop(new AuditUnavailable()));
        return res;
      }) as typeof res.end;
      storage.run(tx,() => { try { next(); } catch(error) { stop(error instanceof Error ? error : new Error('HANDLER_ERROR')); } });
    }), { retry: false }).then(flush).catch(async(error: unknown) => {
      if (error instanceof RejectedResponse) {
        // Domain failed: transaction is rolled back; failure record has no committed mutation.
        await writeAudit(base,req,res).catch(() => console.error('REJECTED_REQUEST_AUDIT_FAILED'));
        flush();
      } else if (error instanceof AuditUnavailable) {
        console.error('ATOMIC_AUDIT_FAILED');
        fail('AUDIT_UNAVAILABLE','Não foi possível registrar a auditoria. A alteração foi revertida.');
      } else {
        console.error('REQUEST_TRANSACTION_FAILED');
        fail('TRANSACTION_UNAVAILABLE','Não foi possível concluir a operação. Atualize os dados antes de tentar novamente.');
      }
    }).finally(() => { if(timer)clearTimeout(timer); });
  };
  return { db, middleware };
}
