import {
  Combine, FileArchive, FileDown, FileImage, FilePen, Film, ImageDown, Images, Music, Scaling, Scissors, Sparkles, SplitSquareHorizontal,
} from 'lucide-react';

const IMAGES = ['jpg', 'png', 'webp', 'avif', 'gif', 'tiff', 'bmp', 'svg'];
const VIDEOS = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'flv', 'wmv', 'm4v', '3gp', 'mpeg', 'ts', 'mts', 'ogv'];
const AUDIOS = ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'opus', 'flac', 'wma', 'aiff', 'amr', 'weba'];
const sameOr = (fallback) => (ext, conversions) => (conversions?.[ext]?.includes(ext) || ['jpg', 'png', 'webp', 'avif', 'gif', 'tiff', 'mp4', 'mp3'].includes(ext) ? ext : fallback);

/**
 * kind:
 *  - convert: each file converts independently (via /api/convert or in-browser)
 *  - each:    each file runs a server tool independently (/api/tools/:slug)
 *  - batch:   all files go into one job (/api/tools/:slug), order matters
 *  - editor:  custom in-browser editor UI that saves through /api/tools/:slug
 */
export const TOOLS = [
  {
    slug: 'compress-image', title: 'Compress Image', cat: 'image', icon: ImageDown,
    blurb: 'Shrink JPG, PNG, WEBP and more without visible quality loss.',
    kind: 'convert', accept: IMAGES.filter((e) => e !== 'svg'), target: sameOr('jpg'), panel: 'image',
    defaults: { quality: 65, compress: true },
  },
  {
    slug: 'resize-image', title: 'Resize Image', cat: 'image', icon: Scaling,
    blurb: 'Set exact dimensions or scale down for the web.',
    kind: 'convert', accept: IMAGES, target: sameOr('png'), panel: 'image', defaults: { width: 1280 },
  },
  {
    slug: 'compress-video', title: 'Compress Video', cat: 'video', icon: Film, needs: 'media',
    blurb: 'Make videos small enough to email or share, in MP4.',
    kind: 'convert', accept: VIDEOS, target: () => 'mp4', panel: 'video', defaults: { quality: 'low', resolution: 720 },
  },
  {
    slug: 'video-to-gif', title: 'Video to GIF', cat: 'video', icon: Sparkles, needs: 'media',
    blurb: 'Turn a clip into a crisp, looping GIF with an optimised palette.',
    kind: 'convert', accept: VIDEOS, target: () => 'gif', panel: 'gif', defaults: { fps: 12, gifWidth: 480 },
  },
  {
    slug: 'video-to-mp3', title: 'Extract Audio', cat: 'audio', icon: Music, needs: 'media',
    blurb: 'Pull the soundtrack out of any video as MP3.',
    kind: 'convert', accept: VIDEOS, target: () => 'mp3', panel: 'audio', defaults: { audioBitrate: 192 },
  },
  {
    slug: 'trim-media', title: 'Trim Video & Audio', cat: 'video', icon: Scissors, needs: 'media',
    blurb: 'Cut a section out of a video or song by start and end time.',
    kind: 'convert', accept: [...VIDEOS, ...AUDIOS], target: (ext) => (VIDEOS.includes(ext) ? 'mp4' : AUDIOS.includes(ext) && ext !== 'wma' && ext !== 'amr' && ext !== 'weba' ? ext : 'mp3'),
    panel: 'trim', defaults: { trimStart: 0, trimEnd: 10 },
  },
  {
    slug: 'edit-pdf', title: 'Edit PDF Text', cat: 'document', icon: FilePen,
    blurb: 'Click any text in a PDF and change it. Fonts, colours and layout stay as they were.',
    kind: 'editor', accept: ['pdf'],
  },
  {
    slug: 'merge-pdf', title: 'Merge PDF', cat: 'document', icon: Combine,
    blurb: 'Combine several PDFs into one, in the order you choose.',
    kind: 'batch', accept: ['pdf'], min: 2,
  },
  {
    slug: 'split-pdf', title: 'Split PDF', cat: 'document', icon: SplitSquareHorizontal,
    blurb: 'Extract pages or ranges like “1-3, 7” into separate PDFs.',
    kind: 'each', accept: ['pdf'], panel: 'split', defaults: { ranges: '' },
  },
  {
    slug: 'compress-pdf', title: 'Compress PDF', cat: 'document', icon: FileArchive,
    blurb: 'Reduce PDF size for email and uploads.',
    kind: 'each', accept: ['pdf'], panel: 'compressPdf', defaults: { level: 'ebook' },
  },
  {
    slug: 'images-to-pdf', title: 'Images to PDF', cat: 'image', icon: Images,
    blurb: 'Put photos and scans into a single, ordered PDF.',
    kind: 'batch', accept: IMAGES, min: 1, panel: 'imagesToPdf', defaults: { pageSize: 'a4' },
  },
  {
    slug: 'pdf-to-jpg', title: 'PDF to JPG', cat: 'document', icon: FileImage, needs: 'pdfRaster',
    blurb: 'Render every page of a PDF as a high-quality image.',
    kind: 'convert', accept: ['pdf'], target: () => 'jpg', panel: 'pdfRaster', defaults: { dpi: 150 },
  },
  {
    slug: 'word-to-pdf', title: 'Word to PDF', cat: 'document', icon: FileDown, needs: 'office',
    blurb: 'DOCX, DOC, ODT and RTF to a print-ready PDF.',
    kind: 'convert', accept: ['docx', 'doc', 'odt', 'rtf'], target: () => 'pdf',
  },
  {
    slug: 'word-to-jpg', title: 'Word to Image', cat: 'document', icon: FileImage, needs: 'officeRaster',
    blurb: 'Turn every page of a Word document into a JPG image.',
    kind: 'convert', accept: ['docx', 'doc', 'odt', 'rtf'], target: () => 'jpg', panel: 'pdfRaster', defaults: { dpi: 150 },
  },
  {
    slug: 'powerpoint-to-pdf', title: 'PowerPoint to PDF', cat: 'document', icon: FileDown, needs: 'office',
    blurb: 'PPTX, PPT and ODP slides to a shareable PDF.',
    kind: 'convert', accept: ['pptx', 'ppt', 'odp'], target: () => 'pdf',
  },
  {
    slug: 'pdf-to-svg', title: 'PDF to SVG', cat: 'document', icon: FileImage, needs: 'pdfSvg',
    blurb: 'Sharp, scalable vector pages for design tools and the web.',
    kind: 'convert', accept: ['pdf'], target: () => 'svg',
  },
];

export const toolBySlug = (slug) => TOOLS.find((t) => t.slug === slug);
