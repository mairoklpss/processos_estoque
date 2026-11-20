import type { RequestHandler } from 'express';

// Defense in depth: filesystem ACLs do not protect a file read by the HTTP server itself.
// Match case-insensitively and decode before checking (Windows and /@fs/ included).
export const privateFiles: RequestHandler = (req, res, next) => {
  let pathname = req.originalUrl.split('?')[0];
  try {
    for (let i = 0; i < 3; i++) {
      const decoded = decodeURIComponent(pathname);
      if (decoded === pathname) break;
      pathname = decoded;
    }
  } catch { res.status(404).end(); return; }
  pathname = pathname.replaceAll('\\', '/').toLowerCase();
  const privateDirectory = /(?:^|\/)(?:\.local|\.git|data|server|scripts|infra|tests)(?:\/|$)/;
  const privateFile = /(?:^|\/)(?:\.env[^/]*|[^/]*\.dpapi\.xml|[^/]*\.(?:sqlite(?:3)?|db)(?:-wal|-shm|-journal)?|[^/]*\.backup\.enc|[^/]*\.(?:pem|key|crt|p12|pfx)|server\.ts|vite\.config\.ts|tsconfig\.json|setup\.md)(?:\/|$)/;
  if (privateDirectory.test(pathname) || privateFile.test(pathname)) {
    res.setHeader('Cache-Control', 'no-store'); res.status(404).end(); return;
  }
  next();
};
