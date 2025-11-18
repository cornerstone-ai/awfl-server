import { checkInboundAuth } from '../auth.js';
import { ensureWorkRoot } from '../storage.js';
import { createHandlers } from '../sse/consumer.js';
import { EVENTS_HEARTBEAT_MS } from '../config.js';

export function registerStreamRoute(app) {
  app.post('/sessions/stream', async (req, res) => {
    if (!checkInboundAuth(req, res)) return;

    const userId = req.headers['x-user-id'] || req.query.userId;
    const projectId = req.headers['x-project-id'] || req.query.projectId;
    const workspaceId = req.headers['x-workspace-id'] || req.query.workspaceId;
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;

    if (!userId || !projectId) {
      res.status(400).json({ error: 'missing userId/projectId' });
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');

    let workRoot;
    try {
      workRoot = await ensureWorkRoot({ userId, projectId, workspaceId, sessionId });
    } catch (err) {
      try { res.write(`${JSON.stringify({ error: 'work_root_error', message: err?.message })}\n`); } catch {}
      res.end();
      return;
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

    function flushLines() {
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        handleLine(line);
      }
    }

    req.on('data', (chunk) => {
      buffer += chunk;
      flushLines();
    });

    req.on('end', async () => {
      if (buffer.trim()) await handleLine(buffer);
      clearInterval(pingIv);
      try { res.end(); } catch {}
    });

    req.on('error', () => {
      clearInterval(pingIv);
      try { res.end(); } catch {}
    });

    req.on('aborted', () => {
      clearInterval(pingIv);
      try { res.end(); } catch {}
    });
  });
}
