import { checkInboundAuth } from '../auth.js';
import { ensureWorkRoot } from '../storage.js';
import { createHandlers } from '../sse/consumer.js';
import { EVENTS_HEARTBEAT_MS } from '../config.js';

function sanitizeHeaders(h) {
  const out = { ...h };
  if (out.authorization) out.authorization = '[redacted]';
  if (out['x-service-auth']) out['x-service-auth'] = '[redacted]';
  return out;
}

export function registerStreamRoute(app) {
  app.post('/sessions/stream', async (req, res) => {
    // Connection diagnostics
    try {
      const sock = req.socket;
      const safeHeaders = sanitizeHeaders(req.headers || {});
      // eslint-disable-next-line no-console
      console.log('[consumer] <- inbound /sessions/stream', {
        method: req.method,
        url: req.originalUrl || req.url,
        headers: safeHeaders,
        remote: { address: sock?.remoteAddress, port: sock?.remotePort },
        local: { address: sock?.localAddress, port: sock?.localPort },
      });
    } catch (_) {}

    if (!checkInboundAuth(req, res)) return;

    const userId = req.headers['x-user-id'] || req.query.userId;
    const projectId = req.headers['x-project-id'] || req.query.projectId;
    const workspaceId = req.headers['x-workspace-id'] || req.query.workspaceId;
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;

    if (!userId || !projectId) {
      res.status(400).json({ error: 'missing userId/projectId' });
      return;
    }

    // Anti-buffering/keepalive headers and disable timeouts
    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Keep-Alive', 'timeout=120, max=1000');

    try { req.setTimeout(0); } catch {}
    try { res.setTimeout(0); } catch {}
    try { res.flushHeaders?.(); } catch {}
    try { res.socket?.setKeepAlive?.(true, Math.max(10000, EVENTS_HEARTBEAT_MS)); } catch {}

    let workRoot;
    try {
      workRoot = await ensureWorkRoot({ userId, projectId, workspaceId, sessionId });
      // eslint-disable-next-line no-console
      console.log('[consumer] work root ready', { workRoot, userId, projectId, workspaceId, sessionId });
    } catch (err) {
      try { res.write(`${JSON.stringify({ error: 'work_root_error', message: err?.message })}\n`); } catch {}
      return void res.end();
    }

    const { handleLine } = createHandlers({ workRoot, res });

    // Heartbeat pings back to producer
    try { res.write(`ready ${Date.now()}\n`); } catch {}
    const pingIv = setInterval(() => {
      try { res.write(`ping ${Date.now()}\n`); } catch {}
    }, EVENTS_HEARTBEAT_MS);

    // Stream in request lines (NDJSON) and handle them
    req.setEncoding('utf8');
    let buffer = '';
    let linesCount = 0;

    function flushLines() {
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        linesCount++;
        handleLine(line);
      }
    }

    req.on('data', (chunk) => {
      buffer += chunk;
      flushLines();
    });

    // Do NOT end the response when the request finishes writing; keep the server->client
    // stream open until the socket actually closes. Just flush any remaining buffered line.
    req.on('end', async () => {
      if (buffer.trim()) { linesCount++; await handleLine(buffer); buffer = ''; }
      // eslint-disable-next-line no-console
      console.log('[consumer] producer finished writing (req end)', { linesCount });
      // keep response open; heartbeats continue until close/aborted/error
    });

    req.on('error', (e) => {
      // eslint-disable-next-line no-console
      console.warn('[consumer] request error', e?.message || e);
      try { clearInterval(pingIv); } catch {}
      try { res.end(); } catch {}
    });

    req.on('aborted', () => {
      // eslint-disable-next-line no-console
      console.warn('[consumer] request aborted by client');
      try { clearInterval(pingIv); } catch {}
      try { res.end(); } catch {}
    });

    // End the response only when the response is closed (client stopped reading) or the socket closes
    res.on('close', () => {
      try { clearInterval(pingIv); } catch {}
      // eslint-disable-next-line no-console
      console.log('[consumer] response closed', { linesCount });
      try { res.end(); } catch {}
    });
  });
}
