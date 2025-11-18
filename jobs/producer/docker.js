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

export async function runLocalDocker({ image, containerName, envPairs, extraArgs = [] }) {
  const args = ['run', '-d', '--rm', '--name', containerName, ...toDockerEnvFlags(envPairs)];
  // optional mounts/args (global default for producer container only)
  const argStr = (process.env.PRODUCER_LOCAL_DOCKER_ARGS || '').trim();
  if (argStr) args.push(...splitArgs(argStr));
  if (Array.isArray(extraArgs) && extraArgs.length) args.push(...extraArgs);
  args.push(image);

  const { stdout } = await execFileAsync('docker', args, { timeout: 60_000 });
  const id = stdout.trim();
  return { id, args };
}

export async function stopContainer(nameOrId) {
  try {
    await execFileAsync('docker', ['stop', '-t', '5', nameOrId], { timeout: 30_000 });
  } catch {
    // best-effort; ignore
  }
}
