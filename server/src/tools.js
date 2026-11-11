// Detects optional native tools. Features that need a missing tool are hidden
// from the API instead of failing at conversion time.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import ffmpegStatic from 'ffmpeg-static';

function works(cmd, args) {
  if (!cmd) return false;
  try {
    const r = spawnSync(cmd, args, { timeout: 15000, windowsHide: true, stdio: 'ignore' });
    return !r.error;
  } catch {
    return false;
  }
}

function firstWorking(candidates, args) {
  for (const c of candidates.filter(Boolean)) {
    if (works(c, args)) return c;
  }
  return null;
}

const win = process.platform === 'win32';

export const tools = {
  ffmpeg: firstWorking([process.env.FFMPEG_PATH, ffmpegStatic, 'ffmpeg'], ['-version']),
  soffice: firstWorking(
    [
      process.env.SOFFICE_PATH,
      'soffice',
      'libreoffice',
      win && 'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
      process.platform === 'darwin' && '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    ],
    ['--version'],
  ),
  gs: firstWorking([process.env.GS_PATH, win ? 'gswin64c' : 'gs', 'gs'], ['--version']),
  pdftoppm: firstWorking([process.env.PDFTOPPM_PATH, 'pdftoppm'], ['-v']),
};

export const capabilities = {
  media: Boolean(tools.ffmpeg),
  office: Boolean(tools.soffice),
  pdfRaster: Boolean(tools.pdftoppm || tools.gs),
  pdfCompress: true, // falls back to pdf-lib re-save without Ghostscript
  ghostscript: Boolean(tools.gs),
};

export function describeTools() {
  return Object.entries(tools)
    .map(([k, v]) => `${k}: ${v ? (fs.existsSync(v) ? 'bundled' : v) : 'not found'}`)
    .join(', ');
}
