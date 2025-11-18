import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { PORT } from './config.js';
import { registerStreamRoute } from './routes/stream.js';

const app = express();

app.use(cors({ origin: true }));
app.use(morgan('tiny'));
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ type: ['text/plain', 'application/x-ndjson'], limit: '10mb' }));

app.get('/healthz', (req, res) => res.status(200).json({ ok: true }));

// Only accept pushed event streams from the producer
registerStreamRoute(app);

app.use((err, _req, res, _next) => {
  const status = typeof err?.status === 'number' ? err.status : 500;
  res.status(status).json({ error: err?.message || 'internal_error' });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`sse-consumer listening on ${PORT}`);
  });
}

export default app;
