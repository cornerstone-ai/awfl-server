import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { WORK_ROOT_BASE } from './config.js';

function sanitizeSegment(seg) {
  const s = String(seg ?? '').trim();
  const cleaned = s.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'default';
}

export function buildWorkRoot({ userId, projectId, workspaceId, sessionId }) {
  const u = sanitizeSegment(userId);
  const p = sanitizeSegment(projectId);
  const w = sanitizeSegment(workspaceId || 'ws');
  const s = sanitizeSegment(sessionId || 'current');
  return path.resolve(WORK_ROOT_BASE, u, p, w, s);
}

export async function ensureWorkRoot(ctx) {
  const root = buildWorkRoot(ctx);
  await fsp.mkdir(root, { recursive: true });
  return root;
}

export function resolveWithin(root, rel) {
  const abs = path.resolve(root, String(rel || ''));
  const normRoot = path.resolve(root) + path.sep;
  if (!abs.startsWith(normRoot)) {
    throw new Error('Path escapes workspace root');
  }
  return abs;
}
