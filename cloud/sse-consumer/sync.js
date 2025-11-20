// Consumer: CLI to request a downscoped token from the producer and sync objects under a prefix
// ESM. Node 18+ (Node 22 preferred per project).
//
// Env vars:
// - PRODUCER_URL: http(s)://host:port of the producer service (required)
// - BUCKET: GCS bucket (required unless producer default config applies)
// - PREFIX: object prefix to scope access (required unless producer default config applies)
// - LIST: '1' to enable listing via Rule B, else '0' (default '0')
// - OUT_DIR: local directory to write files (default ./sync-out)
// - KNOWN_OBJECTS: optional path to a text file with object names to fetch (one per line)
//                  Only used when LIST!='1'. Entries may be absolute (full object name) or relative to PREFIX.
// - BILLING_PROJECT: optional; if set, will include userProject/x-goog-user-project when calling GCS.
//
// Usage examples:
//   PRODUCER_URL=http://localhost:8080 BUCKET=my-bucket PREFIX=foo/bar/ LIST=1 node cloud/sse-consumer/sync.js
//   PRODUCER_URL=http://localhost:8080 BUCKET=my-bucket PREFIX=foo/bar/ KNOWN_OBJECTS=objects.txt node cloud/sse-consumer/sync.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PRODUCER_URL = process.env.PRODUCER_URL;
const BUCKET = process.env.BUCKET || '';
const PREFIX = process.env.PREFIX || '';
const LIST = process.env.LIST === '1';
const OUT_DIR = process.env.OUT_DIR || path.resolve(process.cwd(), 'sync-out');
const KNOWN_OBJECTS = process.env.KNOWN_OBJECTS || '';
const BILLING_PROJECT = process.env.BILLING_PROJECT || '';

function nowIso() { return new Date().toISOString(); }
function log(event, data) { console.log('[consumer]', JSON.stringify({ ts: nowIso(), event, ...data })); }
function err(event, data) { console.error('[consumer]', JSON.stringify({ ts: nowIso(), event, level: 'error', ...data })); }

if (!PRODUCER_URL) {
  console.error('PRODUCER_URL is required');
  process.exit(1);
}

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function writeText(file, text) { fs.writeFileSync(file, text); }
function readText(file) { return fs.readFileSync(file, 'utf8'); }
function fileExists(file) { try { fs.accessSync(file, fs.constants.F_OK); return true; } catch { return false; } }

async function mintToken({ bucket, prefix, list }) {
  const url = `${PRODUCER_URL.replace(/\/$/, '')}/token`;
  const body = { bucket, prefix, list, permissions: ['viewer'] };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Producer mint failed ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data; // { token, bucket, prefix, list, billingProject, cab }
}

function authHeaders(token) {
  const h = { Authorization: `Bearer ${token}` };
  if (BILLING_PROJECT) h['x-goog-user-project'] = BILLING_PROJECT;
  return h;
}

async function gcsJson(url, token) {
  const qp = new URL(url).searchParams;
  if (BILLING_PROJECT && !qp.has('userProject')) {
    const glue = url.includes('?') ? '&' : '?';
    url = `${url}${glue}userProject=${encodeURIComponent(BILLING_PROJECT)}`;
  }
  const res = await fetch(url, { headers: authHeaders(token) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GCS ${res.status}: ${text}`);
  }
  return res.json();
}

async function gcsStreamToFile(url, token, destPath) {
  if (BILLING_PROJECT) {
    const glue = url.includes('?') ? '&' : '?';
    url = `${url}${glue}userProject=${encodeURIComponent(BILLING_PROJECT)}`;
  }
  const res = await fetch(url, { headers: authHeaders(token) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GCS download ${res.status}: ${text}`);
  }
  await new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(destPath);
    res.body.pipe(fileStream);
    res.body.on('error', reject);
    fileStream.on('finish', resolve);
    fileStream.on('error', reject);
  });
}

async function listObjects(token, bucket, prefix) {
  const url = `https://www.googleapis.com/storage/v1/b/${bucket}/o?prefix=${encodeURIComponent(prefix)}`;
  const data = await gcsJson(url, token);
  const names = (data.items || []).map(o => o.name);
  log('list_ok', { count: names.length });
  return names;
}

async function getObjectMeta(token, bucket, name) {
  const url = `https://www.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(name)}`;
  return await gcsJson(url, token);
}

async function downloadObject(token, bucket, name, outPath) {
  const url = `https://www.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(name)}?alt=media`;
  await gcsStreamToFile(url, token, outPath);
}

function relativeToPrefix(name, prefix) {
  if (prefix && name.startsWith(prefix)) return name.substring(prefix.length);
  return name;
}

function localPaths(baseDir, name, prefix) {
  const rel = relativeToPrefix(name, prefix);
  const full = path.join(baseDir, rel);
  const meta = `${full}.etag`;
  return { full, meta, rel };
}

function shouldDownload(meta, size, etag) {
  if (!fileExists(meta)) return true;
  try {
    const recorded = JSON.parse(readText(meta));
    if (recorded.etag !== etag) return true;
    if (Number(recorded.size) !== Number(size)) return true;
    return false;
  } catch {
    return true;
  }
}

function writeMeta(metaFile, size, etag, updated) {
  writeText(metaFile, JSON.stringify({ size: Number(size), etag, updated }, null, 2));
}

async function loadKnownObjects(filePath, prefix) {
  if (!filePath) return [];
  const raw = readText(path.resolve(filePath));
  return raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(name => {
    // Support relative entries
    if (prefix && !name.startsWith(prefix)) return `${prefix}${name}`;
    return name;
  });
}

async function main() {
  ensureDir(OUT_DIR);
  log('start', { bucket: BUCKET, prefix: PREFIX, list: LIST, outDir: OUT_DIR });

  const { token, bucket, prefix } = await mintToken({ bucket: BUCKET, prefix: PREFIX, list: LIST });

  let objectNames = [];
  if (LIST) {
    objectNames = await listObjects(token, bucket, prefix);
  } else {
    if (!KNOWN_OBJECTS) {
      err('no_list_and_no_known_objects', { message: 'Provide KNOWN_OBJECTS when LIST=0' });
      process.exit(2);
    }
    objectNames = await loadKnownObjects(KNOWN_OBJECTS, prefix);
    log('known_objects_loaded', { count: objectNames.length });
  }

  let downloaded = 0, skipped = 0, errors = 0;
  for (const name of objectNames) {
    try {
      const meta = await getObjectMeta(token, bucket, name);
      const { full, meta: metaPath, rel } = localPaths(OUT_DIR, name, prefix);
      ensureDir(path.dirname(full));
      if (!shouldDownload(metaPath, meta.size, meta.etag)) {
        skipped++;
        continue;
      }
      const tmpPath = `${full}.part`;
      await downloadObject(token, bucket, name, tmpPath);
      fs.renameSync(tmpPath, full);
      writeMeta(metaPath, meta.size, meta.etag, meta.updated);
      downloaded++;
      log('download_ok', { name, rel, size: meta.size });
    } catch (e) {
      errors++;
      err('download_error', { name, message: e.message });
    }
  }

  log('done', { downloaded, skipped, errors });
}

main().catch(e => { err('fatal', { message: e.message, stack: e.stack }); process.exit(1); });
