import path from 'node:path';
import { capabilities } from './tools.js';

// ext -> { label, cat }
export const FORMATS = {
  // images
  jpg: { label: 'JPG', cat: 'image' },
  png: { label: 'PNG', cat: 'image' },
  webp: { label: 'WEBP', cat: 'image' },
  avif: { label: 'AVIF', cat: 'image' },
  gif: { label: 'GIF', cat: 'image' },
  tiff: { label: 'TIFF', cat: 'image' },
  svg: { label: 'SVG', cat: 'image' },
  ico: { label: 'ICO', cat: 'image' },
  bmp: { label: 'BMP', cat: 'image' },
  // video
  mp4: { label: 'MP4', cat: 'video' },
  webm: { label: 'WEBM', cat: 'video' },
  mkv: { label: 'MKV', cat: 'video' },
  mov: { label: 'MOV', cat: 'video' },
  avi: { label: 'AVI', cat: 'video' },
  flv: { label: 'FLV', cat: 'video' },
  wmv: { label: 'WMV', cat: 'video' },
  m4v: { label: 'M4V', cat: 'video' },
  '3gp': { label: '3GP', cat: 'video' },
  mpeg: { label: 'MPEG', cat: 'video' },
  ts: { label: 'TS', cat: 'video' },
  mts: { label: 'MTS', cat: 'video' },
  ogv: { label: 'OGV', cat: 'video' },
  // audio
  mp3: { label: 'MP3', cat: 'audio' },
  wav: { label: 'WAV', cat: 'audio' },
  aac: { label: 'AAC', cat: 'audio' },
  m4a: { label: 'M4A', cat: 'audio' },
  ogg: { label: 'OGG', cat: 'audio' },
  opus: { label: 'OPUS', cat: 'audio' },
  flac: { label: 'FLAC', cat: 'audio' },
  wma: { label: 'WMA', cat: 'audio' },
  aiff: { label: 'AIFF', cat: 'audio' },
  amr: { label: 'AMR', cat: 'audio' },
  weba: { label: 'WEBA', cat: 'audio' },
  // documents
  pdf: { label: 'PDF', cat: 'document' },
  docx: { label: 'DOCX', cat: 'document' },
  doc: { label: 'DOC', cat: 'document' },
  odt: { label: 'ODT', cat: 'document' },
  rtf: { label: 'RTF', cat: 'document' },
  txt: { label: 'TXT', cat: 'document' },
  md: { label: 'Markdown', cat: 'document' },
  html: { label: 'HTML', cat: 'document' },
  pptx: { label: 'PPTX', cat: 'document' },
  ppt: { label: 'PPT', cat: 'document' },
  odp: { label: 'ODP', cat: 'document' },
  epub: { label: 'EPUB', cat: 'document' },
  // data / spreadsheets
  xlsx: { label: 'XLSX', cat: 'data' },
  xls: { label: 'XLS', cat: 'data' },
  ods: { label: 'ODS', cat: 'data' },
  csv: { label: 'CSV', cat: 'data' },
  tsv: { label: 'TSV', cat: 'data' },
  json: { label: 'JSON', cat: 'data' },
  yaml: { label: 'YAML', cat: 'data' },
  xml: { label: 'XML', cat: 'data' },
  // archives
  zip: { label: 'ZIP', cat: 'archive' },
  tar: { label: 'TAR', cat: 'archive' },
  tgz: { label: 'TAR.GZ', cat: 'archive' },
};

const ALIASES = {
  jpeg: 'jpg', jfif: 'jpg', jpe: 'jpg', tif: 'tiff', yml: 'yaml', htm: 'html', mpg: 'mpeg',
  aif: 'aiff', oga: 'ogg', markdown: 'md', text: 'txt', m2ts: 'mts', qt: 'mov',
};

export function extOf(filename = '') {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.tar.gz')) return 'tgz';
  const e = path.extname(lower).slice(1);
  return ALIASES[e] || e;
}

const IMAGE_IN = ['jpg', 'png', 'webp', 'avif', 'gif', 'tiff', 'svg'];
const IMAGE_OUT = ['jpg', 'png', 'webp', 'avif', 'gif', 'tiff', 'ico', 'pdf'];
const VIDEO_IN = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'flv', 'wmv', 'm4v', '3gp', 'mpeg', 'ts', 'mts', 'ogv'];
const VIDEO_OUT = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'gif'];
const AUDIO_IN = ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'opus', 'flac', 'wma', 'aiff', 'amr', 'weba'];
const AUDIO_OUT = ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'opus', 'flac', 'aiff'];
const TEXT_DOCS = ['doc', 'docx', 'odt', 'rtf', 'txt', 'html', 'md'];
const SLIDES = ['ppt', 'pptx', 'odp'];
const SHEETS_IN = ['xlsx', 'xls', 'ods', 'csv', 'tsv', 'json', 'yaml', 'xml'];
const SHEETS_OUT = ['xlsx', 'ods', 'csv', 'tsv', 'json', 'yaml', 'xml', 'html'];
const ARCHIVES = ['zip', 'tar', 'tgz'];

// Order matters: the first rule matching (from, to) wins.
// lane: 'light' = fast jobs, 'heavy' = CPU-intensive jobs (video, office).
const RULES = [
  { from: IMAGE_IN, to: IMAGE_OUT, engine: 'image', lane: 'light' },
  { from: ['bmp'], to: IMAGE_OUT, engine: 'image', lane: 'light', needs: 'media' }, // decoded via ffmpeg
  { from: ['gif'], to: ['mp4', 'webm'], engine: 'media', lane: 'heavy', needs: 'media' },
  { from: VIDEO_IN, to: [...VIDEO_OUT, ...AUDIO_OUT], engine: 'media', lane: 'heavy', needs: 'media' },
  { from: AUDIO_IN, to: AUDIO_OUT, engine: 'media', lane: 'light', needs: 'media' },
  { from: ['docx'], to: ['html', 'txt', 'md'], engine: 'doc', lane: 'light' },
  { from: ['md'], to: ['html', 'txt'], engine: 'doc', lane: 'light' },
  { from: ['html'], to: ['txt', 'md'], engine: 'doc', lane: 'light' },
  { from: ['txt'], to: ['pdf', 'html', 'md'], engine: 'doc', lane: 'light' },
  { from: ['pdf'], to: ['txt'], engine: 'doc', lane: 'light' },
  { from: ['pdf'], to: ['png', 'jpg'], engine: 'pdfraster', lane: 'heavy', needs: 'pdfRaster' },
  { from: ['pdf'], to: ['svg'], engine: 'pdfraster', lane: 'heavy', needs: 'pdfSvg' },
  { from: TEXT_DOCS, to: ['pdf', 'docx', 'doc', 'odt', 'rtf', 'epub'], engine: 'office', lane: 'heavy', needs: 'office' },
  { from: ['doc', 'odt', 'rtf'], to: ['html', 'txt'], engine: 'office', lane: 'heavy', needs: 'office' },
  { from: SLIDES, to: ['pdf', 'pptx', 'ppt', 'odp'], engine: 'office', lane: 'heavy', needs: 'office' },
  { from: ['xlsx', 'xls', 'ods', 'csv'], to: ['pdf'], engine: 'office', lane: 'heavy', needs: 'office' },
  { from: [...TEXT_DOCS, ...SLIDES, 'xlsx', 'xls', 'ods'], to: ['jpg', 'png'], engine: 'officeRaster', lane: 'heavy', needs: 'officeRaster' },
  { from: [...TEXT_DOCS, ...SLIDES, 'xlsx', 'xls', 'ods'], to: ['svg'], engine: 'officeRaster', lane: 'heavy', needs: 'officeSvg' },
  { from: SHEETS_IN, to: SHEETS_OUT, engine: 'data', lane: 'light' },
  { from: ARCHIVES, to: ARCHIVES, engine: 'archive', lane: 'light' },
];

const available = (rule) => !rule.needs || capabilities[rule.needs];

// Same-format re-encoding (compression / resizing) is allowed for these engines.
const SAME_FORMAT_ENGINES = new Set(['image', 'media']);

export function resolveConversion(from, to) {
  for (const rule of RULES) {
    if (!available(rule)) continue;
    if (rule.from.includes(from) && rule.to.includes(to)) {
      if (from === to && !SAME_FORMAT_ENGINES.has(rule.engine)) continue;
      return { engine: rule.engine, lane: rule.lane };
    }
  }
  return null;
}

export function conversionMap() {
  const map = {};
  for (const rule of RULES) {
    if (!available(rule)) continue;
    for (const f of rule.from) {
      map[f] ??= new Set();
      for (const t of rule.to) if (t !== f) map[f].add(t);
    }
  }
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, [...v]]));
}

export function countConversions() {
  return Object.values(conversionMap()).reduce((n, v) => n + v.length, 0);
}
