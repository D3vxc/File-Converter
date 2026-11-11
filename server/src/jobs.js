import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { config } from './config.js';
import { processJob } from './processors.js';
import { FairLane } from './queue.js';

const jobs = new Map();
export const lanes = {
  light: new FairLane('light', config.lightConcurrency),
  heavy: new FairLane('heavy', config.heavyConcurrency),
};

export const newJobId = () => nanoid(18);
export const jobDir = (id) => path.join(config.dataDir, id);

export function activeJobsFor(clientId) {
  let n = 0;
  for (const j of jobs.values()) if (j.clientId === clientId && (j.status === 'queued' || j.status === 'processing')) n++;
  return n;
}

export function totalWaiting() {
  return lanes.light.waiting + lanes.heavy.waiting;
}

/**
 * kind: 'convert' | tool name. inputs: [{ path, name, ext }]
 */
export function createJob({ id, clientId, kind, lane, engine, inputs, target, options }) {
  const job = {
    id,
    clientId,
    kind,
    lane,
    engine,
    inputs,
    target,
    options: options || {},
    status: 'queued',
    progress: 0,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    error: null,
    result: null, // { path, name, size }
    controller: new AbortController(),
  };
  jobs.set(id, job);
  lanes[lane].push(job, () => execute(job));
  return job;
}

async function execute(job) {
  if (job.status !== 'queued') return;
  job.status = 'processing';
  job.startedAt = Date.now();
  const timer = setTimeout(() => job.controller.abort(new Error('Conversion took too long and was stopped')), config.jobTimeoutMs);
  try {
    job.result = await processJob(job, {
      signal: job.controller.signal,
      onProgress: (p) => {
        job.progress = Math.max(job.progress, Math.min(0.99, p));
      },
    });
    job.status = 'done';
    job.progress = 1;
    // Drop the uploaded originals as soon as we're done with them.
    for (const sub of ['in', 'work']) fs.rm(path.join(jobDir(job.id), sub), { recursive: true, force: true }).catch(() => {});
  } catch (err) {
    job.status = 'error';
    job.error = friendlyError(err);
    if (!config.isProd || process.env.LOG_JOB_ERRORS) console.error(`[job ${job.id}] ${job.kind} failed:`, err.message, err.details?.slice(-600) || '');
  } finally {
    clearTimeout(timer);
    job.finishedAt = Date.now();
  }
}

function friendlyError(err) {
  const msg = String(err?.message || err);
  const details = String(err?.details || '');
  if (/does not contain any stream|Output file #0 does not contain|matches no streams/i.test(details)) {
    return 'This file has no audio track to extract.';
  }
  if (/Cancelled/.test(msg)) return 'Cancelled';
  if (/Invalid data found|could not find codec|moov atom not found|Invalid argument/i.test(err?.details || msg)) {
    return 'This file looks damaged or is not a valid media file.';
  }
  if (/unsupported image format|Input buffer contains unsupported/i.test(msg)) return 'This image could not be read — it may be damaged.';
  if (/encrypted|password/i.test(msg)) return 'This file is password-protected.';
  if (/Unexpected token|JSON|YAML|XML/i.test(msg) && msg.length < 200) return `Could not parse the file: ${msg}`;
  if (msg.length < 160 && !/exited with code|ENOENT|EACCES|at \w/.test(msg)) return msg;
  return 'Conversion failed. The file may be damaged or in an unexpected format.';
}

export function getJob(id) {
  return jobs.get(id);
}

export function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    progress: Math.round(job.progress * 1000) / 1000,
    position: job.status === 'queued' ? lanes[job.lane].position(job) : 0,
    error: job.error,
    target: job.target,
    result: job.result ? { name: job.result.name, size: job.result.size } : null,
    expiresAt: job.createdAt + config.fileTtlMs,
  };
}

export async function deleteJob(id) {
  const job = jobs.get(id);
  if (!job) return false;
  if (job.status === 'queued') lanes[job.lane].remove(id);
  if (job.status === 'processing') job.controller.abort(new Error('Cancelled'));
  job.status = job.status === 'done' ? 'deleted' : 'cancelled';
  jobs.delete(id);
  await fs.rm(jobDir(id), { recursive: true, force: true }).catch(() => {});
  return true;
}

/** Wipes expired jobs and orphaned folders. */
export async function sweep() {
  const now = Date.now();
  for (const job of jobs.values()) {
    if (now - job.createdAt > config.fileTtlMs) await deleteJob(job.id);
  }
  try {
    for (const name of await fs.readdir(config.dataDir)) {
      if (jobs.has(name)) continue;
      const p = path.join(config.dataDir, name);
      const st = await fs.stat(p).catch(() => null);
      // Folders without a job are uploads in progress (short) or leftovers.
      if (st && now - st.mtimeMs > 30 * 60 * 1000) await fs.rm(p, { recursive: true, force: true }).catch(() => {});
    }
  } catch {
    /* data dir may not exist yet */
  }
}

export function stats() {
  return { jobs: jobs.size, light: lanes.light.stats(), heavy: lanes.heavy.stats() };
}
