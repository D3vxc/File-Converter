import fs from 'node:fs/promises';
import path from 'node:path';
import { createApp } from './app.js';
import { config } from './config.js';
import { countConversions } from './formats.js';
import { stats, sweep } from './jobs.js';
import { describeTools } from './tools.js';

// Start from a clean slate: nothing from a previous run should survive.
// Only job folders (18-char ids) are removed, never anything else in DATA_DIR.
await fs.mkdir(config.dataDir, { recursive: true });
for (const name of await fs.readdir(config.dataDir)) {
  if (/^[A-Za-z0-9_-]{18}$/.test(name)) await fs.rm(path.join(config.dataDir, name), { recursive: true, force: true }).catch(() => {});
}

const app = createApp();
const server = app.listen(config.port, config.host, () => {
  console.log(`File Converter API on http://localhost:${config.port}`);
  console.log(`  tools: ${describeTools()}`);
  console.log(`  ${countConversions()} conversions available · lanes: light×${config.lightConcurrency}, heavy×${config.heavyConcurrency}`);
});

// Large uploads on slow connections need more than Node's 5 minute default.
server.requestTimeout = 60 * 60 * 1000;
server.headersTimeout = 65 * 1000;
server.keepAliveTimeout = 65 * 1000;

const sweeper = setInterval(() => sweep().catch(() => {}), 60 * 1000);
sweeper.unref();

if (process.env.LOG_STATS) setInterval(() => console.log(JSON.stringify(stats())), 30_000).unref();

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
