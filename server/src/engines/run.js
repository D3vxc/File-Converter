import { spawn } from 'node:child_process';

/**
 * Runs a command, respecting an AbortSignal (job timeout / cancel).
 * onStdout / onStderr receive text chunks. Resolves with collected stderr tail.
 */
export function run(cmd, args, { signal, onStdout, onStderr, cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Cancelled'));
    const child = spawn(cmd, args, { cwd, env: env ? { ...process.env, ...env } : process.env, windowsHide: true });
    let tail = '';
    const keep = (s) => {
      tail = (tail + s).slice(-4000);
    };
    child.stdout.on('data', (d) => onStdout?.(d.toString()));
    child.stderr.on('data', (d) => {
      const s = d.toString();
      keep(s);
      onStderr?.(s);
    });
    const abort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', (e) => {
      signal?.removeEventListener('abort', abort);
      reject(e);
    });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(new Error(signal.reason?.message || 'Cancelled'));
      if (code === 0) resolve(tail);
      else {
        const err = new Error(`${cmd.split(/[\\/]/).pop()} exited with code ${code}`);
        err.details = tail;
        reject(err);
      }
    });
  });
}
