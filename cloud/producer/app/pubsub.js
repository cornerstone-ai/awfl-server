// Pub/Sub transport with AES-256-GCM encryption and reply-subscription listener
// - Publishes requests on TOPIC with attributes {user_id, project_id, session_id, channel=req, type, seq}
// - Listens on SUBSCRIPTION for responses (channel=resp) and resolves per-event promises by seq
// - Uses compact envelope { v, n, ct, tag } for payload encryption

import { PubSub } from '@google-cloud/pubsub';
import { encryptJson, decryptToJson, scheme as encScheme } from './crypto.js';
import {
  PROJECT_ID,
  TOPIC,
  SUBSCRIPTION,
  ENC_KEY_B64,
  PUBSUB_EMULATOR_HOST,
  X_USER_ID,
  X_PROJECT_ID,
  X_SESSION_ID,
  RECONNECT_BACKOFF_MS,
} from './config.js';

function stableAttrs(base) {
  return {
    user_id: base.user_id || '',
    project_id: base.project_id || '',
    session_id: base.session_id || '',
    channel: base.channel || '',
    type: base.type || '',
    seq: String(base.seq ?? ''),
  };
}

export function createPubSubTransport() {
  const clientOpts = {};
  if (PROJECT_ID) clientOpts.projectId = PROJECT_ID;
  if (PUBSUB_EMULATOR_HOST) clientOpts.apiEndpoint = PUBSUB_EMULATOR_HOST;
  const pubsub = new PubSub(clientOpts);

  const topic = pubsub.topic(TOPIC);
  const sub = pubsub.subscription(SUBSCRIPTION, {
    // Keep flow small; we expect responses in-order per seq but be tolerant
    flowControl: { maxMessages: 10 },
    enableOpenTelemetryTracing: false,
  });

  let stopped = false;
  let connected = false;
  let reconnectTimer = null;
  let reconnectDelay = RECONNECT_BACKOFF_MS;
  const reconnectCap = 30000;

  // Pending waiters by seq and pre-received inbox
  const waiters = new Map(); // seq -> { resolve, reject, timeoutId }
  const inbox = new Map();   // seq -> payload

  function scheduleReconnect(reason) {
    if (stopped || connected) return;
    const jitter = Math.floor(Math.random() * 250);
    const delay = Math.min(reconnectDelay + jitter, reconnectCap);
    console.log('[producer] pubsub reply reconnect in', delay, 'ms due to', reason);
    if (reconnectTimer) { try { clearTimeout(reconnectTimer); } catch {} }
    reconnectTimer = setTimeout(() => { startListener().catch(() => {}); }, delay);
    reconnectDelay = Math.min(reconnectDelay * 2, reconnectCap);
  }

  function handleMessage(msg) {
    // Attributes must include channel=resp and match our user/project/session
    const attrs = msg.attributes || {};
    const channel = attrs.channel || '';
    const seq = String(attrs.seq || '');
    try {
      if (channel !== 'resp') { msg.nack(); return; }
      if (attrs.user_id !== X_USER_ID || attrs.project_id !== X_PROJECT_ID) { msg.nack(); return; }
      if (X_SESSION_ID && attrs.session_id !== X_SESSION_ID) { msg.nack(); return; }

      const env = JSON.parse(msg.data.toString('utf8'));
      const payload = decryptToJson(env, ENC_KEY_B64, stableAttrs(attrs));

      // Ack before resolving to avoid redelivery; our processing is idempotent at the producer level
      msg.ack();

      // Deliver
      const waiter = waiters.get(seq);
      if (waiter) {
        waiters.delete(seq);
        clearTimeout(waiter.timeoutId);
        waiter.resolve(payload);
      } else {
        inbox.set(seq, payload);
      }
    } catch (err) {
      console.warn('[producer] pubsub resp decrypt/parse failed; nacking', err?.message || err);
      try { msg.nack(); } catch {}
    }
  }

  function handleError(err) {
    console.warn('[producer] pubsub subscription error', err?.message || err);
    try { sub.removeListener('message', handleMessage); } catch {}
    try { sub.removeListener('error', handleError); } catch {}
    connected = false;
    scheduleReconnect('subscription_error');
  }

  async function startListener() {
    if (stopped || connected) return;
    try {
      sub.on('message', handleMessage);
      sub.on('error', handleError);
      // A ping to cause stream to open; listSnapshots triggers connection indirectly, but we avoid heavy calls.
      console.log('[producer] pubsub reply listener started', { subscription: SUBSCRIPTION });
      connected = true;
      reconnectDelay = RECONNECT_BACKOFF_MS;
    } catch (err) {
      connected = false;
      console.warn('[producer] pubsub reply start failed', err?.message || err);
      scheduleReconnect('start_failed');
    }
  }

  function waitFor(seq, { timeoutMs = 20000 } = {}) {
    const key = String(seq || '');
    // If payload already arrived, resolve immediately
    if (inbox.has(key)) {
      const payload = inbox.get(key);
      inbox.delete(key);
      return Promise.resolve(payload);
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        waiters.delete(key);
        reject(new Error('pubsub_reply_timeout'));
      }, timeoutMs);
      waiters.set(key, { resolve, reject, timeoutId });
    });
  }

  async function publishRequest(obj) {
    // Determine tool type and correlation id
    const tool = obj?.tool_call?.function?.name || obj?.tool || 'tool';
    const seq = String(obj?.id || obj?.seq || '');
    const attrs = stableAttrs({
      user_id: X_USER_ID,
      project_id: X_PROJECT_ID,
      session_id: X_SESSION_ID,
      channel: 'req',
      type: tool,
      seq,
    });

    const env = encryptJson(obj, ENC_KEY_B64, attrs);
    const data = Buffer.from(JSON.stringify(env), 'utf8');
    const message = {
      data,
      attributes: { ...attrs, v: encScheme() },
    };

    const messageId = await topic.publishMessage(message);
    console.log('[producer] pubsub published', { messageId, seq, type: tool });
    return { seq };
  }

  async function send(obj, { timeoutMs = 20000 } = {}) {
    if (stopped) throw new Error('pubsub_transport_stopped');
    // Ensure listener is running
    await startListener();

    const { seq } = await publishRequest(obj);
    // Wait for response
    const payload = await waitFor(seq, { timeoutMs });
    return payload;
  }

  async function close() {
    stopped = true;
    try { if (reconnectTimer) clearTimeout(reconnectTimer); } catch {}
    reconnectTimer = null;
    try { sub.removeListener('message', handleMessage); } catch {}
    try { sub.removeListener('error', handleError); } catch {}
    try { await sub.close(); } catch {}
    try { await pubsub.close(); } catch {}

    // Reject all waiters
    const err = new Error('pubsub_transport_closed');
    for (const [key, w] of waiters) { clearTimeout(w.timeoutId); w.reject(err); }
    waiters.clear();
    inbox.clear();
  }

  return { send, close };
}
