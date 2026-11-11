import { Archive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, File as FileIcon } from 'lucide-react';

export const CATEGORIES = {
  image: { label: 'Image', color: 'var(--c-image)', icon: FileImage },
  video: { label: 'Video', color: 'var(--c-video)', icon: FileVideo },
  audio: { label: 'Audio', color: 'var(--c-audio)', icon: FileAudio },
  document: { label: 'Document', color: 'var(--c-document)', icon: FileText },
  data: { label: 'Spreadsheet & Data', color: 'var(--c-data)', icon: FileSpreadsheet },
  archive: { label: 'Archive', color: 'var(--c-archive)', icon: Archive },
  other: { label: 'File', color: 'var(--ink-3)', icon: FileIcon },
};

const ALIASES = {
  jpeg: 'jpg', jfif: 'jpg', jpe: 'jpg', tif: 'tiff', yml: 'yaml', htm: 'html', mpg: 'mpeg',
  aif: 'aiff', oga: 'ogg', markdown: 'md', text: 'txt', m2ts: 'mts', qt: 'mov',
};

export function extOf(name = '') {
  const lower = name.toLowerCase();
  if (lower.endsWith('.tar.gz')) return 'tgz';
  const i = lower.lastIndexOf('.');
  const e = i >= 0 ? lower.slice(i + 1) : '';
  return ALIASES[e] || e;
}

export function catOf(ext, formats) {
  return formats?.[ext]?.cat || 'other';
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB'];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}

export const labelOf = (ext, formats) => formats?.[ext]?.label || ext.toUpperCase();

/** A sensible default target for a freshly added file. */
export function suggestTarget(ext, conversions, formats) {
  const options = conversions?.[ext] || [];
  const prefs = {
    image: ['webp', 'jpg', 'png'],
    video: ['mp4', 'webm'],
    audio: ['mp3', 'wav'],
    document: ['pdf', 'docx', 'txt'],
    data: ['xlsx', 'csv', 'json'],
    archive: ['zip'],
  }[catOf(ext, formats)] || [];
  if (ext === 'webp') prefs.unshift('png');
  if (ext === 'pdf') prefs.unshift('jpg', 'txt');
  if (ext === 'gif') prefs.unshift('mp4');
  if (ext === 'csv') prefs.unshift('xlsx');
  if (ext === 'xlsx') prefs.unshift('csv');
  return prefs.find((p) => options.includes(p) && p !== ext) || options[0] || '';
}
