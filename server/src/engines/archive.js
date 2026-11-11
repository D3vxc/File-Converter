import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import AdmZip from 'adm-zip';
import { TarArchive, ZipArchive } from 'archiver';
import * as tar from 'tar';

const MAX_EXTRACTED = 4 * 1024 * 1024 * 1024; // zip-bomb guard: 4 GB
const MAX_ENTRIES = 20000;

function createArchive(kind) {
  if (kind === 'zip') return new ZipArchive({ zlib: { level: 6 } });
  return new TarArchive({ gzip: kind === 'tgz', gzipOptions: { level: 6 } });
}

/** Stream-pack a list of files (flat) into an archive written to `output` or piped to a stream. */
export async function zipFiles(files, dest, { kind = 'zip', names } = {}) {
  const archive = createArchive(kind);
  const used = new Set();
  files.forEach((f, i) => {
    let name = names?.[i] || path.basename(f);
    // de-duplicate names inside the archive
    const { name: n, ext } = path.parse(name);
    for (let k = 2; used.has(name.toLowerCase()); k++) name = `${n} (${k})${ext}`;
    used.add(name.toLowerCase());
    archive.file(f, { name });
  });
  const out = typeof dest === 'string' ? fs.createWriteStream(dest) : dest;
  const done = pipeline(archive, out);
  await archive.finalize();
  await done;
}

async function extract(input, from, dir) {
  await fsp.mkdir(dir, { recursive: true });
  if (from === 'zip') {
    const zip = new AdmZip(input);
    const entries = zip.getEntries();
    if (entries.length > MAX_ENTRIES) throw new Error('Archive has too many entries');
    const total = entries.reduce((n, e) => n + (e.header.size || 0), 0);
    if (total > MAX_EXTRACTED) throw new Error('Archive expands to more than 4 GB');
    for (const e of entries) {
      // adm-zip sanitises paths, but double-check against traversal.
      const target = path.resolve(dir, e.entryName);
      if (!target.startsWith(path.resolve(dir) + path.sep)) continue;
      if (e.isDirectory) await fsp.mkdir(target, { recursive: true });
      else {
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(target, e.getData());
      }
    }
    return;
  }
  let total = 0;
  let count = 0;
  await tar.x({
    file: input,
    cwd: dir,
    gzip: from === 'tgz' ? true : undefined,
    strict: false,
    preservePaths: false,
    filter: (_p, entry) => {
      total += entry.size || 0;
      count++;
      if (total > MAX_EXTRACTED || count > MAX_ENTRIES) throw new Error('Archive is too large to convert');
      return entry.type === 'File' || entry.type === 'Directory';
    },
  });
}

export async function convertArchive({ input, output, from, to, workDir }) {
  const dir = path.join(workDir, 'extracted');
  await extract(input, from, dir);
  const archive = createArchive(to);
  const done = pipeline(archive, fs.createWriteStream(output));
  archive.directory(dir, false);
  await archive.finalize();
  await done;
}
