import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createApp } from './server/app.ts';
import { openRuntimeDatabase, purgeExpiredRuntimeSessions } from './server/database-config.ts';

async function startServer() {
  const { db } = await openRuntimeDatabase();
  await purgeExpiredRuntimeSessions(db);
  const app = createApp(db);
  const port = Number(process.env.PORT ?? 3000);
  const isProd = process.env.NODE_ENV === 'production';
  const staticFrontend = isProd || process.env.APP_LOCAL_STATIC === 'true';

  if (staticFrontend) {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);

    app.get('*', async (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      try {
        const htmlPath = path.resolve(process.cwd(), 'index.html');
        let html = fs.readFileSync(htmlPath, 'utf-8');
        html = await vite.transformIndexHtml(req.originalUrl, html);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (err) {
        next(err);
      }
    });
  }

  const host = process.env.HOST ?? (isProd ? '0.0.0.0' : '127.0.0.1');
  const maintenance = setInterval(() => { void purgeExpiredRuntimeSessions(db).catch(() => console.error('SESSION_PURGE_FAILED')); }, 3600000);
  maintenance.unref();
  const server = app.listen(port, host, () => {
    console.log(`Brasilink Separação de Materiais ouvindo em http://${host}:${port}`);
  });
  let stopping = false;
  const stop = () => {
    if (stopping) return; stopping = true; clearInterval(maintenance);
    server.close(() => { void db.close().then(() => process.exit(0)).catch(() => process.exit(1)); });
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}

startServer().catch((err) => {
  let message = err instanceof Error ? err.message : 'Falha de configuração';
  message = message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[conexão omitida]');
  for (const secret of [process.env.DATABASE_URL, process.env.BACKUP_PASSPHRASE]) if (secret) message = message.replaceAll(secret, '[omitido]');
  console.error('Falha ao iniciar servidor:', message);
  process.exit(1);
});
