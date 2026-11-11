import os from 'node:os';
import path from 'node:path';

const cpus = os.availableParallelism?.() ?? os.cpus().length;
const num = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);

export const config = {
  port: num(process.env.PORT, 8080),
  host: process.env.HOST || '0.0.0.0',
  isProd: process.env.NODE_ENV === 'production',

  // Where uploads and results live. Everything in here is temporary.
  dataDir: process.env.DATA_DIR || path.join(os.tmpdir(), 'file-converter'),

  maxFileSize: num(process.env.MAX_FILE_MB, 500) * 1024 * 1024,
  maxFilesPerRequest: num(process.env.MAX_FILES_PER_REQUEST, 30),

  // Files and job records are wiped after this long.
  fileTtlMs: num(process.env.FILE_TTL_MIN, 60) * 60 * 1000,
  jobTimeoutMs: num(process.env.JOB_TIMEOUT_MIN, 20) * 60 * 1000,

  // Two lanes so a queue of long video jobs never blocks quick image/doc jobs.
  cpus,
  heavyConcurrency: num(process.env.HEAVY_CONCURRENCY, Math.max(1, Math.floor(cpus / 2))),
  lightConcurrency: num(process.env.LIGHT_CONCURRENCY, Math.max(2, cpus * 2)),

  // Fairness / abuse limits.
  maxActiveJobsPerClient: num(process.env.MAX_ACTIVE_JOBS_PER_CLIENT, 40),
  maxQueuedTotal: num(process.env.MAX_QUEUED_TOTAL, 5000),
  uploadsPerWindow: num(process.env.UPLOADS_PER_10MIN, 300),
  apiRequestsPerMinute: num(process.env.API_REQUESTS_PER_MIN, 900),

  // Donation links shown in the UI. Set e.g. KOFI_USERNAME=yourname in the host's environment.
  kofiUrl: process.env.KOFI_URL || (process.env.KOFI_USERNAME ? `https://ko-fi.com/${process.env.KOFI_USERNAME}` : null),
  bmcUrl: process.env.BMC_URL || (process.env.BMC_USERNAME ? `https://buymeacoffee.com/${process.env.BMC_USERNAME}` : null),

  trustProxy: num(process.env.TRUST_PROXY, 1),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  clientDist: process.env.CLIENT_DIST || path.resolve(import.meta.dirname, '../../client/dist'),
};
