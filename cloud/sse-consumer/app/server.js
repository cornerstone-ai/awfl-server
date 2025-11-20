import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { PORT, SHUTDOWN_SYNC_TIMEOUT_MS } from './config.js';
import { registerStreamRoute } from './routes/stream.js';
import { flushAll } from './sessions.js';

const app = express();

app.use(cors({ origin: true }));
app.use(morgan('tiny'));

// IMPORTANT: Register the streaming route BEFORE global body parsers, so it can
// handle the raw request stream without buffering by express.json/text.
registerStreamRoute(app);

// Generic parsers for non-streaming routes
app.use(express.json({ limit: '1mb' }));
// Do NOT include 'application/x-ndjson' here; the stream route consumes raw data
app.use(express.text({ type: ['text/plain'], limit: '10mb' }));

app.get('/healthz', (req, res) => res.status(200).json({ ok: true }));

app.use((err, _req, res, _next) => {
  const status = typeof err?.status === 'number' ? err.status : 500;
  res.status(status).json({ error: err?.message || 'internal_error' });
});

if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`sse-consumer listening on ${PORT}`);
  });

  // Graceful shutdown: flush any pending syncs once before exit
  let shuttingDown = false;
  async function gracefulExit(code = 0, reason = 'signal') {
    if (shuttingDown) return; // idempotent
    shuttingDown = true;
    try {
      // eslint-disable-next-line no-console
      console.log('[consumer] shutting down, flushing syncs', { reason, timeoutMs: SHUTDOWN_SYNC_TIMEOUT_MS });
      await Promise.race([
        flushAll({ timeoutMs: SHUTDOWN_SYNC_TIMEOUT_MS }),
        new Promise((resolve) => setTimeout(resolve, SHUTDOWN_SYNC_TIMEOUT_MS + 100)),
      ]);
    } catch (_) {}
    try { server.close?.(); } catch {}
    try { process.exit(code); } catch {}
  }

  process.on('SIGINT', () => gracefulExit(0, 'SIGINT'));
  process.on('SIGTERM', () => gracefulExit(0, 'SIGTERM'));
  process.on('SIGHUP', () => gracefulExit(0, 'SIGHUP'));
  process.on('beforeExit', (code) => gracefulExit(code, 'beforeExit'));
  process.on('uncaughtException', (err) => { console.error('[consumer] uncaughtException', err); gracefulExit(1, 'uncaughtException'); });
  process.on('unhandledRejection', (reason) => { console.error('[consumer] unhandledRejection', reason); gracefulExit(1, 'unhandledRejection'); });
}

export default app;
