import express from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { projectScopedCollectionPath } from '../../workflows/utils.js';

const db = getFirestore();
const router = express.Router();
router.use(express.json());

function isHttpUrl(u) {
  try {
    const url = new URL(String(u));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

// POST /jobs/callbacks — create a callback record
// Body: { callback_url: string, name?: string, description?: string, metadata?: object }
router.post('/', async (req, res) => {
  try {
    const userId = req.userId;
    const projectId = req.projectId;
    const { callback_url, name, description, metadata } = req.body || {};

    if (!userId) return res.status(401).json({ error: 'Unauthorized: missing req.userId' });
    if (!projectId) return res.status(400).json({ error: 'Missing x-project-id header' });

    if (!callback_url || typeof callback_url !== 'string' || !isHttpUrl(callback_url)) {
      return res.status(400).json({ error: 'callback_url must be a valid http(s) URL' });
    }

    const colPath = projectScopedCollectionPath(userId, projectId, 'callbacks');
    const colRef = db.collection(colPath);

    const doc = await colRef.add({
      callback_url: String(callback_url),
      name: name ? String(name) : null,
      description: description ? String(description) : null,
      metadata: metadata && typeof metadata === 'object' ? metadata : null,
      created_at: Date.now(),
      created_by: userId,
      called_at: null,
      last_status: null,
      last_error: null,
    });

    res.status(201).json({ id: doc.id, callback_url });
  } catch (err) {
    console.error('[jobs/callbacks:create] error', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

export default router;