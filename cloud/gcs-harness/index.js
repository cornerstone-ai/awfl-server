/*
GCS Downscoped token harness

What it does
- Loads the specified Service Account keyfile (default path below).
- Performs a sanity LIST using the source SA token (confirms base IAM on the bucket/prefix).
- Mints a CAB Downscoped token with the provided bucket+prefix and selected permissions.
- Performs LIST (and optional GET/PUT) with rich error logging using the downscoped token.
- Does NOT send requester-pays headers by default.

Usage (Node 18+)
  # Install deps
  #   cd cloud/gcs-harness && npm i
  # Run (defaults already set for bucket and prefix)
  #   node index.js

Environment variables
- SA_KEYFILE: path to SA key. Default: /Users/paul/github/cornerstone/awfl-server/serviceAccountKey.json
- BUCKET: optional override; default: cornerstoneai-org-work-bucket
- PREFIX: optional override; default: built-in test prefix below
- OBJECT: optional, object name for GET/PUT tests (should be under PREFIX)
- PERMISSIONS: comma-separated set from {viewer,creator,deleter,list}. Default: viewer
  - list: adds an additional unconditional bucket rule with inRole:roles/storage.legacyBucketReader to satisfy bucket-level list checks
- DO_LIST_SOURCE: if '1', run LIST with source SA as well (default 1)
- DO_LIST_CAB: if '1', run LIST with CAB token (default 1)
- DO_GET: if '1', run GET metadata with CAB token (default 0)
- DO_PUT: if '1', run PUT (simple upload) with CAB token (default 0)
- BILLING_PROJECT: optional; if set, will include x-goog-user-project and userProject for debugging requester-pays (OFF by default)
*/

const {GoogleAuth, DownscopedClient} = require('google-auth-library');

const DEFAULT_KEYFILE = process.env.SA_KEYFILE || '/Users/paul/github/cornerstone/awfl-server/serviceAccountKey.json';
const BUCKET = process.env.BUCKET || 'cornerstoneai-org-work-bucket';
const DEFAULT_TEST_PREFIX = 'ZroDMJixOXOljAS5b6rTCoLuTFa2/tKZ6Vj0AnFGFCdK0hfz9/GAecYV1nnKpfhA6LzEyn/3cffaeaf-be07-4b41-b333-ab4ca37db1a7/';
const PREFIX = process.env.PREFIX || DEFAULT_TEST_PREFIX;
const OBJECT = process.env.OBJECT || '';
const PERMISSIONS = (process.env.PERMISSIONS || 'viewer').split(',').map(s => s.trim()).filter(Boolean);
const DO_LIST_SOURCE = process.env.DO_LIST_SOURCE !== '0';
const DO_LIST_CAB = process.env.DO_LIST_CAB !== '0';
const DO_GET = process.env.DO_GET === '1';
const DO_PUT = process.env.DO_PUT === '1';
const BILLING_PROJECT = process.env.BILLING_PROJECT || '';

if (!BUCKET) {
  console.error('BUCKET is required');
  process.exit(1);
}

function nowIso() { return new Date().toISOString(); }

async function gcsRequest(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    let body;
    try {
      body = await res.json();
    } catch {
      try { body = { raw: await res.text() }; } catch { body = { raw: '<unreadable>' }; }
    }
    const log = {
      ts: nowIso(),
      url,
      method: options.method || 'GET',
      status: res.status,
      headers: {
        'x-goog-user-project': options.headers?.['x-goog-user-project'],
      },
      body,
      reasons: body?.error?.errors?.map(e => e.reason),
      message: body?.error?.message,
    };
    console.error('[harness][gcs] error', JSON.stringify(log, null, 2));
    const err = new Error(`GCS ${res.status}: ${body?.error?.message || 'Unknown error'}`);
    err.response = { status: res.status, body };
    throw err;
  }
  return res;
}

function buildCab(bucket, prefix, permissions) {
  const rules = [];
  const map = {
    viewer: 'inRole:roles/storage.objectViewer',
    creator: 'inRole:roles/storage.objectCreator',
    deleter: 'inRole:roles/storage.objectAdmin', // GCS has no standalone delete in CAB; admin includes it
    list: 'inRole:roles/storage.legacyBucketReader',
  };
  const requested = new Set(permissions);

  // Rule A: object-level permissions constrained to prefix
  const objPerms = [];
  for (const p of ['viewer', 'creator', 'deleter']) {
    if (requested.has(p)) objPerms.push(map[p]);
  }
  if (objPerms.length === 0) objPerms.push(map.viewer);
  const objectRule = {
    availableResource: `//storage.googleapis.com/projects/_/buckets/${bucket}`,
    availablePermissions: objPerms,
  };
  if (prefix) {
    objectRule.availabilityCondition = {
      expression: `resource.name.startsWith('projects/_/buckets/${bucket}/objects/${prefix}')`,
    };
  }
  rules.push(objectRule);

  // Rule B: bucket-level legacy bucket reader WITHOUT condition to satisfy list() bucket permission checks
  if (requested.has('list')) {
    rules.push({
      availableResource: `//storage.googleapis.com/projects/_/buckets/${bucket}`,
      availablePermissions: [map.list],
      // No availabilityCondition here, it must apply to the bucket resource itself
    });
  }

  return { accessBoundary: { accessBoundaryRules: rules } };
}

async function getSourceClient() {
  const auth = new GoogleAuth({ keyFilename: DEFAULT_KEYFILE, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  return client;
}

async function getAccessToken(client) {
  const t = await client.getAccessToken();
  return typeof t === 'string' ? t : t?.token || t;
}

async function mintDownscopedToken(sourceClient, cab) {
  const cabClient = new DownscopedClient(sourceClient, cab);
  const { token } = await cabClient.getAccessToken();
  return token;
}

function authHeaders(token) {
  const h = { Authorization: `Bearer ${token}` };
  if (BILLING_PROJECT) {
    h['x-goog-user-project'] = BILLING_PROJECT;
  }
  return h;
}

async function listObjects(token, bucket, prefix) {
  const qp = new URLSearchParams();
  if (prefix) qp.set('prefix', prefix);
  if (BILLING_PROJECT) qp.set('userProject', BILLING_PROJECT);
  const url = `https://www.googleapis.com/storage/v1/b/${bucket}/o?${qp.toString()}`;
  const res = await gcsRequest(url, { headers: authHeaders(token) });
  const data = await res.json();
  console.log('[harness][gcs] LIST ok', JSON.stringify({ ts: nowIso(), bucket, prefix, count: data.items?.length || 0 }, null, 2));
  return data;
}

async function getObjectMeta(token, bucket, objectName) {
  const qp = new URLSearchParams();
  if (BILLING_PROJECT) qp.set('userProject', BILLING_PROJECT);
  const url = `https://www.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(objectName)}?${qp.toString()}`;
  const res = await gcsRequest(url, { headers: authHeaders(token) });
  const data = await res.json();
  console.log('[harness][gcs] GET ok', JSON.stringify({ ts: nowIso(), bucket, object: objectName, size: data.size }, null, 2));
  return data;
}

async function putObject(token, bucket, objectName) {
  const qp = new URLSearchParams();
  qp.set('uploadType', 'media');
  qp.set('name', objectName);
  if (BILLING_PROJECT) qp.set('userProject', BILLING_PROJECT);
  const url = `https://www.googleapis.com/upload/storage/v1/b/${bucket}/o?${qp.toString()}`;
  const payload = Buffer.from(`harness upload at ${nowIso()}\n`);
  const res = await gcsRequest(url, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/octet-stream' },
    body: payload,
  });
  const data = await res.json();
  console.log('[harness][gcs] PUT ok', JSON.stringify({ ts: nowIso(), bucket, object: objectName, size: data.size }, null, 2));
  return data;
}

(async function main() {
  console.log('[harness] start', JSON.stringify({ bucket: BUCKET, prefix: PREFIX, keyfile: DEFAULT_KEYFILE, permissions: PERMISSIONS, billingProjectUsed: !!BILLING_PROJECT }, null, 2));

  const sourceClient = await getSourceClient();
  const sourceToken = await getAccessToken(sourceClient);

  if (DO_LIST_SOURCE) {
    console.log('[harness] LIST with source SA token');
    try { await listObjects(sourceToken, BUCKET, PREFIX); }
    catch (e) { console.error('[harness] LIST (source) failed'); }
  }

  const cab = buildCab(BUCKET, PREFIX, PERMISSIONS);
  console.log('[harness] CAB', JSON.stringify(cab, null, 2));

  let cabToken;
  try {
    cabToken = await mintDownscopedToken(sourceClient, cab);
    console.log('[harness] minted CAB token');
  } catch (e) {
    console.error('[harness] CAB mint failed', e?.message || e);
    process.exit(2);
  }

  if (DO_LIST_CAB) {
    console.log('[harness] LIST with CAB token');
    try { await listObjects(cabToken, BUCKET, PREFIX); }
    catch (e) { console.error('[harness] LIST (CAB) failed'); }
  }

  if (DO_GET && OBJECT) {
    console.log('[harness] GET with CAB token');
    try { await getObjectMeta(cabToken, BUCKET, OBJECT); }
    catch (e) { console.error('[harness] GET (CAB) failed'); }
  }

  if (DO_PUT && OBJECT) {
    console.log('[harness] PUT with CAB token');
    try { await putObject(cabToken, BUCKET, OBJECT); }
    catch (e) { console.error('[harness] PUT (CAB) failed'); }
  }

  console.log('[harness] done');
})().catch(err => { console.error('[harness] fatal', err); process.exit(1); });
