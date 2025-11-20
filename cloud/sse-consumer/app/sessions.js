// Lightweight registry of active stream sessions to enable a final flush on process shutdown

const sessions = new Map(); // key -> () => Promise<void>

export function makeSessionKey({ userId, projectId, workspaceId, sessionId }) {
  return [userId || '', projectId || '', workspaceId || '', sessionId || ''].join(':');
}

export function registerSession(key, flushFn) {
  const k = String(key);
  if (typeof flushFn !== 'function') return;
  sessions.set(k, flushFn);
}

export function unregisterSession(key) {
  const k = String(key);
  sessions.delete(k);
}

async function withTimeout(promise, timeoutMs) {
  let timeoutId;
  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), Math.max(1, timeoutMs));
  });
  try {
    const res = await Promise.race([promise.then(() => ({ ok: true })).catch((e) => ({ ok: false, reason: e?.message || 'error' })), timeoutPromise]);
    return res;
  } finally {
    try { clearTimeout(timeoutId); } catch {}
  }
}

export async function flushAll({ timeoutMs = 3000 } = {}) {
  const entries = Array.from(sessions.entries());
  const results = await Promise.all(entries.map(([key, fn]) => withTimeout(Promise.resolve().then(fn), timeoutMs).then((r) => ({ key, ...r }))));
  return {
    total: entries.length,
    flushed: results.filter((r) => r.ok).length,
    results,
  };
}
