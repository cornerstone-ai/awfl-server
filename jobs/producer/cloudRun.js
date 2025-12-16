import { getAccessToken } from './utils.js';

export async function runCloudRunJob({ gcpProject, location, jobName, containerOverrides }) {
  const url = `https://run.googleapis.com/v2/projects/${encodeURIComponent(gcpProject)}/locations/${encodeURIComponent(location)}/jobs/${encodeURIComponent(jobName)}:run`;
  const token = await getAccessToken();
  const payload = containerOverrides && Array.isArray(containerOverrides)
    ? { overrides: { containerOverrides } }
    : {};
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}
