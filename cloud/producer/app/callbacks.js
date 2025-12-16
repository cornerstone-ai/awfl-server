import axios from 'axios';
import { getWorkflowsIdTokenHeaders } from './auth.js';
import { WORKFLOWS_BASE_URL } from './config.js';
import { contextHeaders } from './config.js';

export async function postCallback(callbackId, payload) {
  const url = `${WORKFLOWS_BASE_URL.replace(/\/$/, '')}/callbacks/${encodeURIComponent(callbackId)}`;
  const authz = await getWorkflowsIdTokenHeaders();
  const headers = {
    'Content-Type': 'application/json',
    ...contextHeaders(),
    ...authz,
  };

  const maxAttempts = 3;
  let attempt = 0;
  let useWrapper = false; // on 400, retry with { result: payload }
  while (attempt < maxAttempts) {
    attempt++;
    try {
      const body = useWrapper ? { result: payload } : payload;
      const resp = await axios.post(url, body, { headers, timeout: 20000, validateStatus: s => s < 500 });
      if (resp.status >= 200 && resp.status < 300) return;
      if (resp.status === 400 && !useWrapper) {
        console.warn('[producer] callback 400; retrying with wrapper { result: ... }');
        useWrapper = true;
        continue; // immediate retry without backoff count
      }
      throw new Error(`callback_http_${resp.status}`);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 400 && !useWrapper) {
        console.warn('[producer] callback 400; retrying with wrapper { result: ... }');
        useWrapper = true;
        continue;
      }
      const backoff = 300 * attempt + Math.floor(Math.random() * 200);
      await new Promise((r) => setTimeout(r, backoff));
      if (attempt >= maxAttempts) throw err;
    }
  }
}
