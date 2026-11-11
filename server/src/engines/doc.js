import fs from 'node:fs/promises';
import mammoth from 'mammoth';
import { marked } from 'marked';
import TurndownService from 'turndown';
import { pdfToText, textToPdf } from './pdf.js';

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
turndown.remove(['script', 'style', 'noscript', 'iframe']);

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function htmlPage(body, title = 'Document') {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font: 16px/1.65 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; max-width: 760px; margin: 48px auto; padding: 0 20px; color: #1d1d22; }
  img { max-width: 100%; height: auto; }
  pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: #f4f4f6; border-radius: 6px; }
  pre { padding: 14px; overflow: auto; } code { padding: 1px 5px; }
  table { border-collapse: collapse; } td, th { border: 1px solid #ddd; padding: 6px 10px; }
  blockquote { border-left: 3px solid #ddd; margin-left: 0; padding-left: 16px; color: #555; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

export function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre|section|article)>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';
}

export async function markdownToHtml(md, title) {
  return htmlPage(await marked.parse(md, { gfm: true }), title);
}

export async function convertDoc({ input, output, from, to, title }) {
  const write = (s) => fs.writeFile(output, s, 'utf8');

  if (from === 'pdf' && to === 'txt') return pdfToText(input, output);

  if (from === 'docx') {
    if (to === 'txt') return write((await mammoth.extractRawText({ path: input })).value);
    const { value } = await mammoth.convertToHtml({ path: input });
    if (to === 'html') return write(htmlPage(value, title));
    if (to === 'md') return write(turndown.turndown(value));
  }

  const text = await fs.readFile(input, 'utf8');

  if (from === 'md') {
    if (to === 'html') return write(await markdownToHtml(text, title));
    if (to === 'txt') return write(htmlToText(await marked.parse(text)));
  }
  if (from === 'html') {
    if (to === 'md') return write(turndown.turndown(text));
    if (to === 'txt') return write(htmlToText(text));
  }
  if (from === 'txt') {
    if (to === 'pdf') return textToPdf(text, output);
    if (to === 'md') return write(text);
    if (to === 'html') {
      const body = text
        .split(/\n{2,}/)
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
        .join('\n');
      return write(htmlPage(body, title));
    }
  }
  throw new Error(`Unsupported document conversion ${from} → ${to}`);
}
