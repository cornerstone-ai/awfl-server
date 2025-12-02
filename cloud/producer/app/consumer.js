import axios from 'axios';
import { PassThrough } from 'stream';
import http from 'http';
import https from 'https';
import { CONSUMER_BASE_URL, RECONNECT_BACKOFF_MS } from './config.js';

// Persistent consumer connection (duplex NDJSON)
export function createPersistentConsumerClient(headers) {
  const url = `${CONSUMER_BASE_URL.replace(/\/$/, '')}/sessions/stream`;

  // Keep-alive agents
  const httpAgent = new http.Agent({ keepAlive: true, keepAliveMsecs: 10000, maxSockets: 1 });
  const httpsAgent = new https.Agent({ keepAlive: true, keepAliveMsecs: 10000, maxSockets: 1 });

  const isHttps = /^https:/i.test(url);
  const agent = isHttps ? httpsAgent : httpAgent;

  let reqStream = null; // PassThrough for request body
  let respStream = null; // Incoming response stream
  let connected = false;
  let connecting = null;
  let stopped = false;
  let reconnectTimer = null;

  // One-in-flight semantics
  let inflight = null; // { resolve, reject, timeoutId }
  const queue = []; // [{ line, resolve, reject, timeoutId }]

  function logHeadersSafe(h) {
    const out = { ...h };
    if (out.Authorization) out.Authorization = '[redacted]';
    if (out['X-Gcs-Token']) out['X-Gcs-Token'] = '[redacted]';
    return out;
  }

  async function connect() {
    if (stopped) return;
    if (connected) return;
    if (connecting) return connecting;

    connecting = new Promise(async (resolve, reject) => {
      try {
        // Create the PassThrough and write an initial keepalive newline immediately so
        // proxies/load-balancers don't 408 the request for lack of body data.
        reqStream = new PassThrough();
        try { reqStream.write('\n'); } catch {}

        const safeHeaders = logHeadersSafe(headers);
        console.log('[producer] -> consumer OPEN', { url, headers: safeHeaders });
        const resp = await axios.post(url, reqStream, {
          headers,
          responseType: 'stream',
          timeout: 0,
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          validateStatus: () => true,
          httpAgent,
          httpsAgent,
        });

        const sock = resp?.request?.socket;
        if (sock) {
          console.log('[producer] consumer connected', {
            status: resp.status,
            local: { address: sock.localAddress, port: sock.localPort, family: sock.localFamily },
            remote: { address: sock.remoteAddress, port: sock.remotePort },
          });
        } else {
          console.log('[producer] consumer response', { status: resp.status });
        }

        respStream = resp.data;
        respStream.setEncoding('utf8');
        let buf = '';
        respStream.on('data', (chunk) => {
          buf += chunk;
          let idx;
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line) continue;
            // Ignore non-JSON pings/ready
            if (line.startsWith('ready') || line.startsWith('ping') || line.startsWith('error ')) {
              continue;
            }
            let obj = null;
            try { obj = JSON.parse(line); } catch { obj = null; }
            if (!obj) continue;
            if (Object.prototype.hasOwnProperty.call(obj, 'result') || Object.prototype.hasOwnProperty.call(obj, 'error')) {
              // Resolve current inflight regardless of tool success or error.
              const current = inflight;
              inflight = null;
              if (current) {
                clearTimeout(current.timeoutId);
                // Treat tool-level errors as successful deliveries so the cursor can advance
                current.resolve(obj);
              }
              // Immediately try to send next from queue
              drainQueue();
            }
          }
        });
        respStream.on('end', () => {
          console.log('[producer] consumer stream ended');
          teardownAndRejectPending(new Error('consumer_stream_end'));
          scheduleReconnect('end');
        });
        respStream.on('error', (e) => {
          console.warn('[producer] consumer stream error', e?.message || e);
          teardownAndRejectPending(e);
          scheduleReconnect('error');
        });

        connected = true;
        resolve();
        // After connected, try to drain any queued items
        drainQueue();
      } catch (err) {
        console.warn('[producer] consumer connect failed', err?.message || err);
        teardownAndRejectPending(err);
        scheduleReconnect('connect_error');
        reject(err);
      } finally {
        connecting = null;
      }
    });

    return connecting;
  }

  function teardownAndRejectPending(err) {
    connected = false;
    try { reqStream?.end(); } catch {}
    reqStream = null;
    try { respStream?.destroy(); } catch {}
    respStream = null;

    // Reject inflight and queued
    if (inflight) {
      clearTimeout(inflight.timeoutId);
      inflight.reject(err);
      inflight = null;
    }
    while (queue.length) {
      const item = queue.shift();
      clearTimeout(item.timeoutId);
      item.reject(err);
    }
  }

  let reconnectDelay = RECONNECT_BACKOFF_MS;
  const reconnectCap = 30000;
  function scheduleReconnect(reason) {
    if (stopped) return;
    const jitter = Math.floor(Math.random() * 250);
    const delay = Math.min(reconnectDelay + jitter, reconnectCap);
    console.log('[producer] reconnecting consumer in', delay, 'ms due to', reason);
    if (reconnectTimer) { try { clearTimeout(reconnectTimer); } catch {} }
    reconnectTimer = setTimeout(() => { connect().catch(() => {}); }, delay);
    reconnectDelay = Math.min(reconnectDelay * 2, reconnectCap);
  }

  function ensureConnected() {
    if (stopped) return Promise.reject(new Error('consumer_stopped'));
    if (connected) return Promise.resolve();
    return connect();
  }

  function drainQueue() {
    if (!connected || inflight) return;
    const next = queue.shift();
    if (!next) return;
    inflight = next;
    try {
      reqStream.write(next.line + '\n');
    } catch (err) {
      clearTimeout(next.timeoutId);
      inflight = null;
      next.reject(err);
      scheduleReconnect('write_error');
    }
  }

  function send(obj, { timeoutMs = 20000 } = {}) {
    if (stopped) return Promise.reject(new Error('consumer_stopped'));
    const line = JSON.stringify(obj);
    return new Promise(async (resolve, reject) => {
      const timeoutId = setTimeout(() => {
        // If this item is in-flight, clear and force reconnect to unblock
        if (inflight && inflight.timeoutId === timeoutId) {
          inflight = null;
          scheduleReconnect('per-send-timeout');
        }
        reject(new Error('consumer_send_timeout'));
      }, timeoutMs);

      const item = { line, resolve, reject, timeoutId };
      queue.push(item);

      try {
        await ensureConnected();
        drainQueue();
      } catch (err) {
        clearTimeout(timeoutId);
        reject(err);
      }
    });
  }

  function close() {
    stopped = true;
    try { if (reconnectTimer) clearTimeout(reconnectTimer); } catch {}
    reconnectTimer = null;
    teardownAndRejectPending(new Error('consumer_closed'));
  }

  return { send, close };
}
