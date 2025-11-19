import { splitArgs } from './utils.js';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execFileAsync = promisify(execFile);

export function toDockerEnvFlags(envPairs) {
  const flags = [];
  for (const { name, value } of envPairs) {
    if (typeof value === 'undefined' || value === null) continue;
    flags.push('-e', `${name}=${String(value)}`);
  }
  return flags;
}

function sanitizeEnvPairs(envPairs = []) {
  const redactionRe = /token|secret|authorization|auth|password|key/i;
  return envPairs.map(({ name, value }) => {
    const v = String(value ?? '');
    return { name, value: redactionRe.test(name) ? '[redacted]' : (v.length > 200 ? v.slice(0, 200) + '…' : v) };
  });
}

export async function runLocalDocker({ image, containerName, envPairs, extraArgs = [] }) {
  const args = ['run', '-d', '--rm', '--name', containerName, ...toDockerEnvFlags(envPairs)];
  // optional mounts/args (global default for producer container only)
  const argStr = (process.env.PRODUCER_LOCAL_DOCKER_ARGS || '').trim();
  if (argStr) args.push(...splitArgs(argStr));
  if (Array.isArray(extraArgs) && extraArgs.length) args.push(...extraArgs);
  args.push(image);

  // Diagnostics: log the docker run we are about to execute (sanitized)
  try {
    // eslint-disable-next-line no-console
    console.log('[jobs/producer][docker] docker run', {
      image,
      containerName,
      extraArgs,
      env: sanitizeEnvPairs(envPairs),
    });
  } catch {}

  const { stdout } = await execFileAsync('docker', args, { timeout: 60_000 });
  const id = stdout.trim();

  // Diagnostics: container id
  try { console.log('[jobs/producer][docker] started container', { containerName, id }); } catch {}

  return { id, args };
}

export async function stopContainer(nameOrId) {
  try {
    await execFileAsync('docker', ['stop', '-t', '5', nameOrId], { timeout: 30_000 });
    try { console.log('[jobs/producer][docker] stopped container', { nameOrId }); } catch {}
  } catch {
    // best-effort; ignore
  }
}
