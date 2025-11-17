import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

// Sanitize a single path segment to prevent traversal or special chars.
function sanitizeSegment(seg) {
  if (!seg) return '';
  // Replace path separators and collapse dots; allow letters, numbers, dash, underscore, dot.
  const cleaned = String(seg)
    .replace(/\\|\//g, '-') // no slashes
    .replace(/\.+/g, '.') // collapse multiple dots
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^\.+$/, '') // if only dots, drop
    .slice(0, 128);
  return cleaned;
}

function renderPrefixTemplate(template, ctx) {
  const tpl = template || '{projectId}/{workspaceId}';
  const map = {
    projectId: ctx.projectId || '',
    workspaceId: ctx.workspaceId || '',
    sessionId: ctx.sessionId || '',
    userId: ctx.userId || '',
  };
  const rendered = tpl.replace(/\{(projectId|workspaceId|sessionId|userId)\}/g, (_, key) => map[key] || '');
  // Normalize and split; drop empties
  return rendered
    .split('/')
    .map((s) => sanitizeSegment(s))
    .filter(Boolean);
}

export async function ensureWorkRoot({ userId, projectId, workspaceId, sessionId }) {
  const base = path.resolve(process.env.WORK_ROOT || '/mnt/work');
  const template = process.env.WORK_PREFIX_TEMPLATE || '{projectId}/{workspaceId}';

  const segs = renderPrefixTemplate(template, { userId, projectId, workspaceId, sessionId });

  // Always ensure at least project segmentation
  if (!segs.length && projectId) segs.push(sanitizeSegment(projectId));

  const target = path.join(base, ...segs);

  // Ensure inside base
  const resolved = path.resolve(target);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error('Resolved work root escapes base');
  }

  await fsp.mkdir(resolved, { recursive: true });
  // Verify R/W
  await fsp.access(resolved, fs.constants.R_OK | fs.constants.W_OK);
  return resolved;
}

export function resolveWithin(root, rel) {
  if (!root) throw new Error('Missing root');
  if (!rel || typeof rel !== 'string') throw new Error('Missing relative path');
  if (path.isAbsolute(rel)) throw new Error('Absolute paths are not allowed');
  // Disallow parent traversal in the relative input
  const normalized = rel.replace(/\\/g, '/');
  if (normalized.includes('..')) throw new Error('Parent traversal is not allowed');

  const abs = path.resolve(path.join(root, rel));
  const rootResolved = path.resolve(root);
  if (!abs.startsWith(rootResolved + path.sep) && abs !== rootResolved) {
    throw new Error('Resolved path escapes work root');
  }
  return abs;
}

export default { ensureWorkRoot, resolveWithin };
