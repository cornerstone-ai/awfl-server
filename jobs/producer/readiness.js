// Cloud Run startup readiness monitor
// - Polls LROs to discover execution names
// - Polls executions for state and updates project.status_message with coarse status plus cosmetic micro-steps
// - Clears status_message early via completeStartupProgress once both jobs have started

import { getOperation, getExecutionByName } from './cloudRun.js';
import { setStartupStatus, completeStartupProgress } from './progress.js';

const MICRO_STEPS = [
  'Contacting regional scheduler…',
  'Warming container image cache…',
  'Pulling container layers…',
  'Provisioning network…',
  'Attaching service account…',
  'Preparing volumes…',
  'Verifying health checks…',
  'Routing through service mesh…',
  'Syncing logs…',
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function stateOfExecution(exec) {
  if (!exec) return 'queued';
  const conditions = Array.isArray(exec.conditions) ? exec.conditions : [];
  const completed = conditions.find((c) => c?.type === 'Completed');
  const runningCount = Number(exec.runningCount || 0);
  if (runningCount > 0) return 'running';
  if (completed && /SUCCEEDED|FAILED|CANCELLED/i.test(String(completed.state || ''))) return 'running';
  if (exec.startTime) return 'starting';
  return 'queued';
}

// Track operations we've already warned about to avoid log spam
const warnedOps = new Set();

async function resolveExecutionName(opName) {
  if (!opName) return null;
  try {
    const op = await getOperation({ name: opName });
    if (!op?.ok) {
      if (!warnedOps.has(opName)) {
        console.warn('[readiness] getOperation !ok', { name: opName, status: op?.status, data: op?.data });
        warnedOps.add(opName);
      }
      return null;
    }
    const data = op.data || {};
    if (data.done) {
      if (data.response?.name) return data.response.name;
      if (data.metadata?.target) return data.metadata.target;
    }
  } catch (e) {
    if (!warnedOps.has(opName)) {
      console.warn('[readiness] getOperation error', { name: opName, err: e?.message || String(e) });
      warnedOps.add(opName);
    }
  }
  return null;
}

export async function monitorCloudRunStartup({
  userId,
  projectId,
  producerOperationName,
  consumerOperationName,
  timeoutMs = 90_000,
}) {
  const start = Date.now();
  let prodExecName = null;
  let consExecName = null;
  let lastMix = 0;

  // Warn-once sets for execution fetches
  const warnedExecs = new Set();

  try { await setStartupStatus({ userId, projectId, message: 'Queued/creating…' }); } catch {}

  const order = { queued: 0, starting: 1, running: 2 };

  const tick = async () => {
    const now = Date.now();

    if (!prodExecName && producerOperationName) prodExecName = await resolveExecutionName(producerOperationName);
    if (!consExecName && consumerOperationName) consExecName = await resolveExecutionName(consumerOperationName);

    let prodExec = null;
    let consExec = null;

    if (prodExecName) {
      try {
        const r = await getExecutionByName({ name: prodExecName });
        if (r?.ok) prodExec = r.data;
        else if (!warnedExecs.has(prodExecName)) {
          console.warn('[readiness] getExecution !ok', { name: prodExecName, status: r?.status, data: r?.data });
          warnedExecs.add(prodExecName);
        }
      } catch (e) {
        if (!warnedExecs.has(prodExecName)) {
          console.warn('[readiness] getExecution error', { name: prodExecName, err: e?.message || String(e) });
          warnedExecs.add(prodExecName);
        }
      }
    }
    if (consExecName) {
      try {
        const r = await getExecutionByName({ name: consExecName });
        if (r?.ok) consExec = r.data;
        else if (!warnedExecs.has(consExecName)) {
          console.warn('[readiness] getExecution !ok', { name: consExecName, status: r?.status, data: r?.data });
          warnedExecs.add(consExecName);
        }
      } catch (e) {
        if (!warnedExecs.has(consExecName)) {
          console.warn('[readiness] getExecution error', { name: consExecName, err: e?.message || String(e) });
          warnedExecs.add(consExecName);
        }
      }
    }

    const ps = stateOfExecution(prodExec);
    const cs = stateOfExecution(consExec);
    const slow = order[ps] <= order[cs] ? ps : cs;

    let base = slow === 'queued' ? 'Queued/creating…'
      : slow === 'starting' ? 'Starting…'
      : 'Running…';

    if (now - lastMix > 1400) {
      base += ' ' + pick(MICRO_STEPS);
      lastMix = now;
    }

    try { await setStartupStatus({ userId, projectId, message: base }); } catch {}

    const startedEnough = (s) => s === 'starting' || s === 'running';
    if (startedEnough(ps) && startedEnough(cs)) {
      try { await completeStartupProgress({ userId, projectId, reason: 'cloud-run started' }); } catch {}
      return true;
    }

    if (now - start > timeoutMs) {
      // On timeout, clear status and log a single warning with what we know
      try { await completeStartupProgress({ userId, projectId, reason: 'cloud-run timeout' }); } catch {}
      console.warn('[readiness] timeout clearing status', {
        userId,
        projectId,
        prodExecName,
        consExecName,
        elapsedMs: now - start,
        ps,
        cs,
      });
      return true;
    }
    return false;
  };

  let done = false;
  while (!done) {
    try { done = await tick(); } catch { /* best-effort */ }
    if (done) break;
    const waited = Date.now() - start;
    const delay = waited < 30_000 ? 1000 : 2500;
    await new Promise((r) => setTimeout(r, delay));
  }
}

export default { monitorCloudRunStartup };
