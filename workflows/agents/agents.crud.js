import express from 'express';
import { db, userScopedCollectionPath } from './common.js';
import fs from 'node:fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();

// ESM-safe __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load file-defined agents from workflows/agents/defs/*.json
async function loadFileDefinedAgents() {
  try {
    const defsDir = path.resolve(__dirname, './defs');
    const entries = await fs.readdir(defsDir, { withFileTypes: true });
    const files = entries.filter(e => e.isFile() && e.name.endsWith('.json'));
    const out = [];
    for (const f of files) {
      try {
        const full = path.join(defsDir, f.name);
        const raw = await fs.readFile(full, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') continue;
        const name = typeof parsed.name === 'string' ? parsed.name.trim() : null;
        const providedId = typeof parsed.id === 'string' ? parsed.id.trim() : null;
        const id = providedId || (name ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') : null);
        if (!id || !name) continue;
        const description = typeof parsed.description === 'string' ? parsed.description : null;
        const workflowName = typeof parsed.workflowName === 'string' ? parsed.workflowName.trim() : null;
        const tools = Array.isArray(parsed.tools) ? parsed.tools.filter(t => typeof t === 'string') : undefined;
        const inputSchema = parsed.inputSchema && typeof parsed.inputSchema === 'object' ? parsed.inputSchema : undefined;
        out.push({ id, name, description, workflowName, tools, inputSchema, source: 'file' });
      } catch (_) {
        // skip malformed
      }
    }
    return out;
  } catch (_) {
    return [];
  }
}

function dedupeById(preferred = [], fallbacks = []) {
  const map = new Map();
  for (const a of preferred) {
    if (!a?.id) continue;
    map.set(a.id, a);
  }
  for (const a of fallbacks) {
    if (!a?.id) continue;
    if (!map.has(a.id)) map.set(a.id, a);
  }
  return Array.from(map.values());
}

// Create an agent
// Body: { name: string, description?: string, workflowName?: string, tools?: string[], inputSchema?: object }
router.post('/', async (req, res) => {
  try {
    const userId = req.userId;
    const { name, description, workflowName, tools, inputSchema } = req.body || {};
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }

    const colRef = db.collection(userScopedCollectionPath(userId, 'agents'));
    const docRef = colRef.doc();
    const now = Date.now();

    const data = {
      id: docRef.id,
      name: name.trim(),
      description: typeof description === 'string' ? description : null,
      workflowName: typeof workflowName === 'string' ? workflowName.trim() : null,
      created: now,
      updated: now,
    };

    if (Array.isArray(tools) && tools.length) data.tools = tools;
    if (inputSchema && typeof inputSchema === 'object') data.inputSchema = inputSchema;

    await docRef.set(data, { merge: true });
    return res.status(201).json({ agent: data });
  } catch (err) {
    console.error('[agents] create failed', err);
    return res.status(500).json({ error: 'Failed to create agent' });
  }
});

// List agents (optionally limit/order) - includes file-defined agents from workflows/agents/defs
router.get('/', async (req, res) => {
  try {
    const userId = req.userId;
    const { limit = 50, order = 'desc' } = req.query || {};

    const q = db
      .collection(userScopedCollectionPath(userId, 'agents'))
      .orderBy('created', order === 'asc' ? 'asc' : 'desc')
      .limit(Math.min(Number(limit) || 50, 200));

    const snap = await q.get();
    const dbAgents = snap.docs.map((d) => d.data());

    const fileAgents = await loadFileDefinedAgents();
    const agents = dedupeById(dbAgents, fileAgents);

    return res.status(200).json({ agents });
  } catch (err) {
    console.error('[agents] list failed', err);
    return res.status(500).json({ error: 'Failed to list agents' });
  }
});

// Get a single agent - supports file-defined agents by id
router.get('/:id', async (req, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const docRef = db.doc(userScopedCollectionPath(userId, `agents/${id}`));
    const snap = await docRef.get();
    if (snap.exists) {
      const agent = snap.data();
      return res.status(200).json({ agent });
    }

    // Fallback: file-defined
    const fileAgents = await loadFileDefinedAgents();
    const found = fileAgents.find(a => a.id === id);
    if (found) return res.status(200).json({ agent: found });

    return res.status(404).json({ error: 'Agent not found' });
  } catch (err) {
    console.error('[agents] get failed', err);
    return res.status(500).json({ error: 'Failed to get agent' });
  }
});

// Update an agent (name/description/workflowName/inputSchema)
router.patch('/:id', async (req, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const { name, description, workflowName, inputSchema } = req.body || {};

    const has = (v) => v !== undefined && v !== null;

    const docRef = db.doc(userScopedCollectionPath(userId, `agents/${id}`));
    const snap = await docRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'Agent not found' });

    const updates = { updated: Date.now() };
    if (has(name)) updates.name = String(name).trim();
    if (has(description)) updates.description = typeof description === 'string' ? description : null;
    if (has(workflowName)) updates.workflowName = typeof workflowName === 'string' ? workflowName.trim() : null;
    if (has(inputSchema)) updates.inputSchema = typeof inputSchema === 'object' ? inputSchema : null;

    await docRef.set(updates, { merge: true });
    const after = await docRef.get();
    return res.status(200).json({ agent: after.data() });
  } catch (err) {
    console.error('[agents] update failed', err);
    return res.status(500).json({ error: 'Failed to update agent' });
  }
});

// Delete an agent
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    const docRef = db.doc(userScopedCollectionPath(userId, `agents/${id}`));
    const snap = await docRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'Agent not found' });

    await docRef.delete();
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[agents] delete failed', err);
    return res.status(500).json({ error: 'Failed to delete agent' });
  }
});

export default router;
