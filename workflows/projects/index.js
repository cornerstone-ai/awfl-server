import express from 'express';
import { projectsCol, projectDoc, has, asBool, normalizeGitRemote } from './util.js';
import { FieldValue } from 'firebase-admin/firestore';

const router = express.Router();
router.use(express.json());

// Create a project
// Body: { remote: string, name?: string, live?: boolean }
router.post('/', async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized: missing req.userId' });

    const { remote, name } = req.body || {};
    let { live } = req.body || {};
    if (!remote || typeof remote !== 'string') return res.status(400).json({ error: 'remote is required' });

    const col = projectsCol(userId);
    const docRef = col.doc();
    const now = Date.now();

    const data = {
      id: docRef.id,
      remote: normalizeGitRemote(remote),
      ...(has(name) ? { name: String(name).trim() } : {}),
      live: asBool(live, false),
      created: now,
      updated: now,
    };

    await docRef.set(data, { merge: true });
    return res.status(201).json({ project: data });
  } catch (err) {
    console.error('[projects] create failed', err);
    return res.status(500).json({ error: 'Failed to create project' });
  }
});

// List projects
router.get('/', async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized: missing req.userId' });

    const { limit = 50, order = 'desc' } = req.query || {};
    const q = projectsCol(userId)
      .orderBy('created', order === 'asc' ? 'asc' : 'desc')
      .limit(Math.min(Number(limit) || 50, 200));

    const snap = await q.get();
    const projects = snap.docs.map(d => d.data());
    return res.status(200).json({ projects });
  } catch (err) {
    console.error('[projects] list failed', err);
    return res.status(500).json({ error: 'Failed to list projects' });
  }
});

// Get a project
router.get('/:id', async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized: missing req.userId' });
    const { id } = req.params;
    const ref = projectDoc(userId, id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Project not found' });
    return res.status(200).json({ project: snap.data() });
  } catch (err) {
    console.error('[projects] get failed', err);
    return res.status(500).json({ error: 'Failed to get project' });
  }
});

// Update a project
// Body: { remote?, name?, live? }
router.patch('/:id', async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized: missing req.userId' });
    const { id } = req.params;
    const { remote, name } = req.body || {};
    let { live } = req.body || {};

    const ref = projectDoc(userId, id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Project not found' });

    const updates = { updated: Date.now() };
    if (has(remote)) updates.remote = normalizeGitRemote(String(remote));
    if (has(name)) updates.name = String(name).trim();
    if (has(live)) updates.live = asBool(live, false);

    await ref.set(updates, { merge: true });
    const after = await ref.get();
    return res.status(200).json({ project: after.data() });
  } catch (err) {
    console.error('[projects] update failed', err);
    return res.status(500).json({ error: 'Failed to update project' });
  }
});

// Obtain or refresh a consumer lock for a project
// - Ensures only a single active consumer applies side-effects per project
// - Idempotent for the same consumer; returns 409 if held by another unexpired holder
// Endpoint: POST /:id/consumer-lock/acquire
// Headers (optional):
//   x-consumer-id: unique id for the consumer instance (required if not in body)
//   x-lock-lease-ms: desired lease duration in ms
//   x-consumer-type: LOCAL or CLOUD
// Body: { consumerId?: string, leaseMs?: number, consumerType?: 'LOCAL' | 'CLOUD' }
router.post('/:id/consumer-lock/acquire', async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized: missing req.userId' });
    const { id } = req.params;

    const consumerId = (req.body?.consumerId || req.header('x-consumer-id') || '').toString().trim();
    if (!consumerId) return res.status(400).json({ error: 'consumerId required (body.consumerId or x-consumer-id)' });

    const rawLease = Number(req.body?.leaseMs ?? req.header('x-lock-lease-ms'));
    const MIN_LEASE_MS = 5000;          // 5s
    const MAX_LEASE_MS = 10 * 60 * 1000; // 10m
    const DEFAULT_LEASE_MS = 45 * 1000;  // 45s
    let leaseMs = Number.isFinite(rawLease) ? Math.floor(rawLease) : DEFAULT_LEASE_MS;
    leaseMs = Math.max(MIN_LEASE_MS, Math.min(MAX_LEASE_MS, leaseMs));

    // Parse consumer type (LOCAL or CLOUD). Default to existing type on refresh, otherwise LOCAL.
    const rawType = (req.body?.consumerType || req.header('x-consumer-type') || '').toString().trim().toUpperCase();
    const VALID_TYPES = new Set(['LOCAL', 'CLOUD']);
    const inputType = VALID_TYPES.has(rawType) ? rawType : null;

    const ref = projectDoc(userId, id);
    const db = ref.firestore;

    let result = null;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error('not_found'), { code: 404 });

      const now = Date.now();
      const lock = snap.get('consumerLock') || null;
      const lockedBy = lock?.consumerId || lock?.holderId || null; // support future rename
      const expiresAt = Number(lock?.expiresAt || 0);

      const isActive = lockedBy && expiresAt > now;
      if (isActive && lockedBy !== consumerId) {
        result = { ok: false, conflict: true, lock: { ...lock, expiresInMs: expiresAt - now } };
        return; // do not modify
      }

      const acquiredAt = lock?.acquiredAt && lockedBy === consumerId ? lock.acquiredAt : now;
      const consumerType = inputType || (lockedBy === consumerId ? (lock?.consumerType || 'LOCAL') : 'LOCAL');
      const newLock = {
        consumerId,
        consumerType, // 'LOCAL' | 'CLOUD'
        leaseMs,
        acquiredAt,
        refreshedAt: now,
        expiresAt: now + leaseMs,
      };

      tx.set(ref, { consumerLock: newLock }, { merge: true });
      result = { ok: true, acquired: !isActive, refreshed: !!isActive, lock: newLock };
    });

    if (!result) {
      return res.status(500).json({ error: 'Unknown lock transaction result' });
    }

    if (result.conflict) {
      return res.status(409).json(result);
    }

    return res.status(200).json(result);
  } catch (err) {
    if (err?.code === 404) return res.status(404).json({ error: 'Project not found' });
    console.error('[projects] consumer-lock acquire failed', err);
    return res.status(500).json({ error: 'Failed to acquire consumer lock' });
  }
});

// Release a consumer lock
// Endpoint: POST /:id/consumer-lock/release
// Headers (optional): x-consumer-id; Body: { consumerId?: string, force?: boolean }
router.post('/:id/consumer-lock/release', async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized: missing req.userId' });
    const { id } = req.params;

    const consumerId = (req.body?.consumerId || req.header('x-consumer-id') || '').toString().trim();
    const force = asBool(req.body?.force ?? req.header('x-lock-force'), false);
    if (!consumerId && !force) return res.status(400).json({ error: 'consumerId required unless force=true' });

    const ref = projectDoc(userId, id);
    const db = ref.firestore;

    let status = null;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error('not_found'), { code: 404 });

      const now = Date.now();
      const lock = snap.get('consumerLock') || null;
      const lockedBy = lock?.consumerId || lock?.holderId || null;
      const expiresAt = Number(lock?.expiresAt || 0);
      const isActive = lockedBy && expiresAt > now;

      if (!lock) {
        status = { ok: true, released: false, reason: 'no_lock' };
        return;
      }

      if (!force && lockedBy !== consumerId) {
        status = { ok: false, conflict: true, lock };
        return;
      }

      tx.set(ref, { consumerLock: FieldValue.delete() }, { merge: true });
      status = { ok: true, released: true };
    });

    if (!status) return res.status(500).json({ error: 'Unknown release transaction result' });
    if (status.conflict) return res.status(409).json(status);
    return res.status(200).json(status);
  } catch (err) {
    if (err?.code === 404) return res.status(404).json({ error: 'Project not found' });
    console.error('[projects] consumer-lock release failed', err);
    return res.status(500).json({ error: 'Failed to release consumer lock' });
  }
});

// Get consumer lock status
// Endpoint: GET /:id/consumer-lock/status
// Response: { ok, active, now, lock?: { consumerId, consumerType, leaseMs, acquiredAt, refreshedAt, expiresAt, expiresInMs } }
router.get('/:id/consumer-lock/status', async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized: missing req.userId' });
    const { id } = req.params;

    const ref = projectDoc(userId, id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Project not found' });

    const now = Date.now();
    const lock = snap.get('consumerLock') || null;
    if (!lock) return res.status(200).json({ ok: true, active: false, now, lock: null });

    const consumerId = lock?.consumerId || lock?.holderId || null;
    const expiresAt = Number(lock?.expiresAt || 0);
    const active = !!(consumerId && expiresAt > now);

    return res.status(200).json({
      ok: true,
      active,
      now,
      lock: {
        consumerId,
        consumerType: lock?.consumerType || null,
        leaseMs: lock?.leaseMs ?? null,
        acquiredAt: lock?.acquiredAt ?? null,
        refreshedAt: lock?.refreshedAt ?? null,
        expiresAt: expiresAt || null,
        expiresInMs: Math.max(0, expiresAt - now),
      },
    });
  } catch (err) {
    console.error('[projects] consumer-lock status failed', err);
    return res.status(500).json({ error: 'Failed to get consumer lock status' });
  }
});

export default router;
