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
  // If any tasks are running (for multi-task jobs), treat as running
  if (runningCount > 0) return 'running';
  // Treat presence of startTime as "starting"
  if (exec.startTime) return 'starting';
  // If the execution has already finished (Completed true/false), we still consider startup phase passed
  // Cloud Run v2 typically uses STATE_TRUE/STATE_FALSE, not SUCCEEDED/FAILED strings
  if (completed && String(completed.state || '').toUpperCase().includes('TRUE')) return 'running';
  if (exec.completionTime) return 'running';
  return 'queued';
}

async function resolveExecutionName(opName) {
  if (!opName) return null;
  try {
    const op = await getOperation({ name: opName });
    if (!op?.ok) return null;
    const data = op.data || {};

    // Prefer metadata.target if present (available before operation is done)
    // Example: projects/.../locations/.../jobs/.../executions/exec-123
    const meta = data.metadata || {};
    if (typeof meta.target === 'string' && meta.target.includes('/executions/')) return meta.target;
    if (typeof meta.name === 'string' && meta.name.includes('/executions/')) return meta.name;

    // If the operation has completed, response.name may also contain the execution resource name
    if (data.done && data.response?.name) return data.response.name;
  } catch {}
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

  try { await setStartupStatus({ userId, projectId, message: 'Queued/creating…' }); } catch {}

  const order = { queued: 0, starting: 1, running: 2 };

  const tick = async () => {
    const now = Date.now();

    if (!prodExecName && producerOperationName) prodExecName = await resolveExecutionName(producerOperationName);
    if (!consExecName && consumerOperationName) consExecName = await resolveExecutionName(consumerOperationName);

    let prodExec = null;
    let consExec = null;

    if (prodExecName) {
      try { const r = await getExecutionByName({ name: prodExecName }); if (r?.ok) prodExec = r.data; } catch {}
    }
    if (consExecName) {
      try { const r = await getExecutionByName({ name: consExecName }); if (r?.ok) consExec = r.data; } catch {}
    }

    const ps = stateOfExecution(prodExec);
    const cs = stateOfExecution(consExec);
    const slow = (ps && cs) ? (order[ps] <= order[cs] ? ps : cs) : (ps || cs || 'queued');

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

    if (now - start > timeoutMs) return true;
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
