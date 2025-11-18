import { getFirestore } from 'firebase-admin/firestore';
import { projectScopedCollectionPath } from '../userAuth.js';
import { projectDoc } from '../projects/util.js';

const db = getFirestore();

function nowMs() { return Date.now(); }
function has(v) { return v !== undefined && v !== null; }

function workspaceCol(userId, projectId) {
  return db.collection(projectScopedCollectionPath(userId, projectId, 'workspaces'));
}
function workspaceDoc(userId, projectId, id) {
  return db.doc(projectScopedCollectionPath(userId, projectId, `workspaces/${id}`));
}

function coerceTtlMs(input) {
  let ttlMs = Number(input);
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) ttlMs = 5 * 60 * 1000; // default 5m
  return Math.floor(ttlMs);
}

export async function resolveWorkspace({ userId, projectId, sessionId, ttlMs }) {
  if (!userId) throw new Error('resolveWorkspace: userId required');
  if (!projectId) throw new Error('resolveWorkspace: projectId required');

  const ttl = coerceTtlMs(ttlMs);
  const cutoff = nowMs() - ttl;
  const col = workspaceCol(userId, projectId);

  const runQuery = async (pid, sid) => {
    let q = col.where('projectId', '==', pid)
               .where('live_at', '>=', cutoff)
               .orderBy('live_at', 'desc')
               .limit(1);
    if (sid === null) q = q.where('sessionId', '==', null);
    else if (typeof sid === 'string' && sid.length) q = q.where('sessionId', '==', sid);
    const snap = await q.get();
    if (!snap.empty) return snap.docs[0].data();
    return null;
  };

  const pid = String(projectId).trim();
  const sid = (typeof sessionId === 'string' && sessionId.trim().length > 0) ? sessionId.trim() : undefined;

  let workspace = null;
  if (sid) {
    workspace = await runQuery(pid, sid);
    if (!workspace) workspace = await runQuery(pid, null);
  } else {
    workspace = await runQuery(pid, null);
  }
  return workspace; // may be null
}

export async function registerWorkspace({ userId, projectId, sessionId }) {
  if (!userId) throw new Error('registerWorkspace: userId required');
  if (!projectId) throw new Error('registerWorkspace: projectId required');

  // Validate project exists
  const pRef = projectDoc(userId, String(projectId).trim());
  const pSnap = await pRef.get();
  if (!pSnap.exists) throw new Error('Project not found');

  const wsRef = workspaceCol(userId, projectId).doc();
  const now = nowMs();
  const data = {
    id: wsRef.id,
    projectId: String(projectId).trim(),
    sessionId: (typeof sessionId === 'string' && sessionId.trim().length > 0) ? sessionId.trim() : null,
    live_at: now,
    created: now,
    updated: now,
  };
  await wsRef.set(data, { merge: true });
  return { id: wsRef.id, workspace: data };
}

export async function ensureWorkspaceId({ userId, projectId, sessionId, ttlMs }) {
  // Try resolve existing
  const resolved = await resolveWorkspace({ userId, projectId, sessionId, ttlMs });
  if (resolved?.id) return resolved.id;
  // Otherwise create
  const created = await registerWorkspace({ userId, projectId, sessionId });
  return created.id;
}
