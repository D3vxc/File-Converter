// In-place PDF text editing.
//
// The browser (pdf.js) detects text runs and sends back the ones the user changed: the run's
// transform, width and height in PDF user space plus the new text. Here we walk the page's
// content stream (and any Form XObjects it draws), find every glyph that falls inside an edited
// run, and remove exactly those glyphs. Their advance is replaced with TJ spacing so the rest of
// the line keeps its position. The new text is then drawn with the original font, size, colour,
// spacing and matrix. When the original (usually subset) font lacks a glyph we need, a close
// substitute font is used instead. Everything else in the file stays untouched.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import { Encodings, Font as AfmFont, FontNames } from '@pdf-lib/standard-fonts';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, StandardFonts, decodePDFRawStream } from 'pdf-lib';

const MAX_FORM_DEPTH = 6;

// ---------------------------------------------------------------------------------------------
// Content-stream tokenizer / parser (works on a latin1 string so offsets equal byte offsets)
// ---------------------------------------------------------------------------------------------

const isWs = (c) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
const isDelim = (c) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;

function readLiteral(src, i) {
  // src[i] === '('
  let depth = 1;
  let out = '';
  i++;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      const n = src[i + 1];
      i += 2;
      if (n === 'n') out += '\n';
      else if (n === 'r') out += '\r';
      else if (n === 't') out += '\t';
      else if (n === 'b') out += '\b';
      else if (n === 'f') out += '\f';
      else if (n === '\r') {
        if (src[i] === '\n') i++;
      } else if (n === '\n') {
        /* line continuation */
      } else if (n >= '0' && n <= '7') {
        let oct = n;
        while (oct.length < 3 && src[i] >= '0' && src[i] <= '7') oct += src[i++];
        out += String.fromCharCode(parseInt(oct, 8) & 0xff);
      } else if (n !== undefined) out += n;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return { value: out, end: i + 1 };
    if (ch === '\r') {
      out += '\n';
      if (src[i + 1] === '\n') i++;
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return { value: out, end: i };
}

function readHex(src, i) {
  const close = src.indexOf('>', i);
  const end = close < 0 ? src.length : close;
  let hex = src.slice(i + 1, end).replace(/[^0-9a-fA-F]/g, '');
  if (hex.length % 2) hex += '0';
  let out = '';
  for (let k = 0; k < hex.length; k += 2) out += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16));
  return { value: out, end: end + 1 };
}

function* tokenize(src) {
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src.charCodeAt(i);
    if (isWs(c)) {
      i++;
      continue;
    }
    if (c === 37) {
      // % comment
      while (i < n && src[i] !== '\n' && src[i] !== '\r') i++;
      continue;
    }
    const start = i;
    if (c === 40) {
      const { value, end } = readLiteral(src, i);
      i = end;
      yield { type: 'str', value, start, end };
    } else if (c === 60) {
      if (src[i + 1] === '<') {
        i += 2;
        yield { type: '<<', start, end: i };
      } else {
        const { value, end } = readHex(src, i);
        i = end;
        yield { type: 'str', value, start, end };
      }
    } else if (c === 62) {
      i += src[i + 1] === '>' ? 2 : 1;
      yield { type: '>>', start, end: i };
    } else if (c === 91 || c === 93 || c === 123 || c === 125) {
      i++;
      yield { type: c === 91 || c === 123 ? '[' : ']', start, end: i };
    } else if (c === 47) {
      i++;
      while (i < n && !isWs(src.charCodeAt(i)) && !isDelim(src.charCodeAt(i))) i++;
      const raw = src.slice(start + 1, i).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      yield { type: 'name', value: raw, start, end: i };
    } else {
      while (i < n && !isWs(src.charCodeAt(i)) && !isDelim(src.charCodeAt(i))) i++;
      if (i === start) {
        i++; // stray delimiter such as ')'
        continue;
      }
      const word = src.slice(start, i);
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) yield { type: 'num', value: Number(word), start, end: i };
      else if (word === 'true' || word === 'false') yield { type: 'bool', value: word === 'true', start, end: i };
      else if (word === 'null') yield { type: 'null', value: null, start, end: i };
      else {
        yield { type: 'op', value: word, start, end: i };
        if (word === 'ID') {
          // Inline image data: skip to the "EI" that ends it.
          let k = i + 1;
          for (;;) {
            k = src.indexOf('EI', k);
            if (k < 0) {
              k = n;
              break;
            }
            const before = src.charCodeAt(k - 1);
            const after = src.charCodeAt(k + 2);
            if (isWs(before) && (k + 2 >= n || isWs(after) || isDelim(after))) break;
            k += 2;
          }
          i = k;
        }
      }
    }
  }
}

/** -> [{ op, args, start, end }] where start/end span the operands and the operator. */
function parseOps(src) {
  const ops = [];
  let operands = [];
  let opStart = -1;
  const stack = [];
  const push = (v) => (stack.length ? stack[stack.length - 1].items.push(v) : operands.push(v));
  for (const t of tokenize(src)) {
    if (opStart < 0) opStart = t.start;
    if (t.type === '[' || t.type === '<<') {
      stack.push({ type: t.type, items: [] });
    } else if (t.type === ']' || t.type === '>>') {
      const s = stack.pop();
      if (s) push({ type: s.type === '[' ? 'array' : 'dict', items: s.items });
    } else if (t.type === 'op') {
      if (stack.length) {
        push(t);
        continue;
      }
      ops.push({ op: t.value, args: operands, start: opStart, end: t.end });
      operands = [];
      opStart = -1;
    } else push(t);
  }
  return ops;
}

// ---------------------------------------------------------------------------------------------
// Matrices
// ---------------------------------------------------------------------------------------------

const ID = [1, 0, 0, 1, 0, 0];
/** m applied first, then n. */
const mul = (m, n) => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const fmt = (v) => {
  if (!Number.isFinite(v)) return '0';
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
};
const hex = (s) => '<' + Buffer.from(s, 'latin1').toString('hex') + '>';

// ---------------------------------------------------------------------------------------------
// Fonts: widths, code length, unicode <-> code
// ---------------------------------------------------------------------------------------------

function parseToUnicode(text) {
  const map = new Map();
  const u16 = (h) => {
    let s = '';
    for (let k = 0; k + 4 <= h.length; k += 4) s += String.fromCharCode(parseInt(h.slice(k, k + 4), 16));
    if (h.length % 4 === 2) s += String.fromCharCode(parseInt(h.slice(-2), 16));
    return s;
  };
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(m[1], 16), u16(m[2]));
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const re = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]*)>|\[([^\]]*)\])/g;
    for (const m of block[1].matchAll(re)) {
      const lo = parseInt(m[1], 16);
      const hi = Math.min(parseInt(m[2], 16), lo + 65535);
      if (m[3] !== undefined) {
        const base = u16(m[3]);
        if (!base) continue;
        const head = base.slice(0, -1);
        const last = base.charCodeAt(base.length - 1);
        for (let c = lo; c <= hi; c++) map.set(c, head + String.fromCharCode(last + (c - lo)));
      } else {
        const dsts = [...m[4].matchAll(/<([0-9a-fA-F]*)>/g)].map((d) => u16(d[1]));
        dsts.forEach((d, k) => lo + k <= hi && map.set(lo + k, d));
      }
    }
  }
  return map;
}

const num = (doc, v, d = 0) => {
  const o = v instanceof PDFRef ? doc.context.lookup(v) : v;
  return o instanceof PDFNumber ? o.asNumber() : d;
};
const nameOf = (doc, v) => {
  const o = v instanceof PDFRef ? doc.context.lookup(v) : v;
  return o instanceof PDFName ? o.decodeText() : null;
};
const decodeStream = (s) =>
  Buffer.from(
    s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : typeof s.getUnencodedContents === 'function' ? s.getUnencodedContents() : s.getContents(),
  ).toString('latin1');

const STD_BY_KEY = {
  'sans': FontNames.Helvetica, 'sans-b': FontNames.HelveticaBold, 'sans-i': FontNames.HelveticaOblique, 'sans-bi': FontNames.HelveticaBoldOblique,
  'serif': FontNames.TimesRoman, 'serif-b': FontNames.TimesRomanBold, 'serif-i': FontNames.TimesRomanItalic, 'serif-bi': FontNames.TimesRomanBoldItalic,
  'mono': FontNames.Courier, 'mono-b': FontNames.CourierBold, 'mono-i': FontNames.CourierOblique, 'mono-bi': FontNames.CourierBoldOblique,
};

/** Classify a font by family (sans/serif/mono) and style (bold/italic) from its name and descriptor. */
function classify(doc, fontDict) {
  let base = nameOf(doc, fontDict.get(PDFName.of('BaseFont'))) || '';
  let desc = fontDict.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
  const descendants = fontDict.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray);
  if (descendants) {
    const d = descendants.lookup(0, PDFDict);
    desc = desc || d.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
  }
  base = base.replace(/^[A-Z]{6}\+/, '');
  const flags = desc ? num(doc, desc.get(PDFName.of('Flags'))) : 0;
  const weight = desc ? num(doc, desc.get(PDFName.of('FontWeight'))) : 0;
  const angle = desc ? num(doc, desc.get(PDFName.of('ItalicAngle'))) : 0;
  const lower = base.toLowerCase();
  const family =
    flags & 1 || /courier|mono|consol|menlo|code|typewriter/.test(lower)
      ? 'mono'
      : /times|serif(?!.*sans)|georgia|garamond|cambria|minion|palatino|book|roman|caslon|baskerville|bodoni|merriweather|tiro/.test(lower) && !/sans/.test(lower)
        ? 'serif'
        : flags & 2 && !/sans|arial|helvet/.test(lower)
          ? 'serif'
          : 'sans';
  const bold = weight >= 600 || /bold|black|heavy|semibold|demi/.test(lower) || Boolean(flags & (1 << 18));
  const italic = angle !== 0 || /italic|oblique/.test(lower) || Boolean(flags & (1 << 6));
  return { family, bold, italic, key: `${family}${bold || italic ? '-' : ''}${bold ? 'b' : ''}${italic ? 'i' : ''}`, base };
}

function standardWidths(doc, fontDict) {
  const name = classify(doc, fontDict).base.toLowerCase();
  let afmName;
  if (name.includes('symbol')) afmName = FontNames.Symbol;
  else if (name.includes('zapf') || name.includes('dingbat')) afmName = FontNames.ZapfDingbats;
  else afmName = STD_BY_KEY[classify(doc, fontDict).key];
  const afm = AfmFont.load(afmName);
  const byCode = new Map();
  if (afmName === FontNames.Symbol || afmName === FontNames.ZapfDingbats) return () => 500;
  for (const [, [code, glyph]] of Object.entries(Encodings.WinAnsi.unicodeMappings)) {
    const w = afm.getWidthOfGlyph(glyph);
    if (w !== undefined) byCode.set(code, w);
  }
  return (code) => byCode.get(code) ?? 500;
}

function buildFontInfo(doc, fontDict) {
  const sub = nameOf(doc, fontDict.get(PDFName.of('Subtype')));
  const info = { dict: fontDict, bytes: 1, scale: 0.001, width: () => 0, toUnicode: null, type0: false };

  const tu = fontDict.lookupMaybe(PDFName.of('ToUnicode'), PDFStream);
  if (tu) {
    try {
      info.toUnicode = parseToUnicode(decodeStream(tu));
    } catch {
      /* ignore broken CMaps */
    }
  }

  if (sub === 'Type0') {
    info.type0 = true;
    info.bytes = 2;
    const enc = fontDict.get(PDFName.of('Encoding'));
    const encObj = enc instanceof PDFRef ? doc.context.lookup(enc) : enc;
    if (encObj instanceof PDFStream) {
      try {
        const m = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(decodeStream(encObj));
        if (m) info.bytes = Math.max(1, m[1].length / 2);
      } catch {
        /* keep 2 */
      }
    }
    const cid = fontDict.lookup(PDFName.of('DescendantFonts'), PDFArray).lookup(0, PDFDict);
    const dw = num(doc, cid.get(PDFName.of('DW')), 1000);
    const widths = new Map();
    const W = cid.lookupMaybe(PDFName.of('W'), PDFArray);
    if (W) {
      const arr = W.asArray().map((v) => (v instanceof PDFRef ? doc.context.lookup(v) : v));
      for (let k = 0; k < arr.length; ) {
        const first = num(doc, arr[k]);
        const next = arr[k + 1];
        if (next instanceof PDFArray) {
          next.asArray().forEach((w, j) => widths.set(first + j, num(doc, w)));
          k += 2;
        } else {
          const last = num(doc, next);
          const w = num(doc, arr[k + 2]);
          for (let c = first; c <= last && c - first < 65536; c++) widths.set(c, w);
          k += 3;
        }
      }
    }
    info.width = (code) => widths.get(code) ?? dw;
    info.hasWidth = (code) => widths.has(code) ? widths.get(code) > 0 : !W;
    return info;
  }

  if (sub === 'Type3') {
    const fm = fontDict.lookupMaybe(PDFName.of('FontMatrix'), PDFArray);
    info.scale = fm ? num(doc, fm.get(0), 0.001) : 0.001;
  }
  const widthsArr = fontDict.lookupMaybe(PDFName.of('Widths'), PDFArray);
  if (widthsArr) {
    const first = num(doc, fontDict.get(PDFName.of('FirstChar')));
    const desc = fontDict.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
    const missing = desc ? num(doc, desc.get(PDFName.of('MissingWidth'))) : 0;
    const ws = widthsArr.asArray().map((w) => num(doc, w));
    info.width = (code) => ws[code - first] ?? missing;
    info.hasWidth = (code) => (ws[code - first] ?? 0) > 0;
  } else {
    info.width = standardWidths(doc, fontDict);
    info.hasWidth = () => true;
  }
  // Simple fonts without a ToUnicode map: assume the usual Latin encodings for ASCII.
  if (!info.toUnicode && sub !== 'Type3') {
    const encObj = fontDict.lookupMaybe(PDFName.of('Encoding'), PDFName, PDFDict);
    const overridden = new Set();
    if (encObj instanceof PDFDict) {
      const diffs = encObj.lookupMaybe(PDFName.of('Differences'), PDFArray);
      let code = 0;
      for (const d of diffs?.asArray() || []) {
        if (d instanceof PDFNumber) code = d.asNumber();
        else overridden.add(code++);
      }
    }
    const symbolic = /symbol|dingbat|wingding/i.test(classify(doc, fontDict).base);
    if (!symbolic) {
      info.toUnicode = new Map();
      for (let c = 32; c < 127; c++) if (!overridden.has(c)) info.toUnicode.set(c, String.fromCharCode(c));
    }
  }
  return info;
}

/** Codes for `text` in this font, or null if any character has no glyph. Spaces without a glyph become null codes (emitted as spacing). */
function encodeWithFont(info, text) {
  if (!info.toUnicode) return null;
  if (!info.reverse) {
    info.reverse = new Map();
    for (const [code, uni] of info.toUnicode) {
      if (uni.length && !info.reverse.has(uni) && info.hasWidth(code)) info.reverse.set(uni, code);
    }
  }
  const codes = [];
  for (const ch of text) {
    const code = info.reverse.get(ch);
    if (code === undefined) {
      if (ch === ' ' || ch === '\u00a0') {
        codes.push(null);
        continue;
      }
      return null;
    }
    codes.push(code);
  }
  return codes;
}

const codeBytes = (code, bytes) => {
  let s = '';
  for (let b = bytes - 1; b >= 0; b--) s += String.fromCharCode((code >> (8 * b)) & 0xff);
  return s;
};

// ---------------------------------------------------------------------------------------------
// Substitute fonts (when the original font cannot draw the new text)
// ---------------------------------------------------------------------------------------------

const STANDARD = {
  'sans': StandardFonts.Helvetica, 'sans-b': StandardFonts.HelveticaBold, 'sans-i': StandardFonts.HelveticaOblique, 'sans-bi': StandardFonts.HelveticaBoldOblique,
  'serif': StandardFonts.TimesRoman, 'serif-b': StandardFonts.TimesRomanBold, 'serif-i': StandardFonts.TimesRomanItalic, 'serif-bi': StandardFonts.TimesRomanBoldItalic,
  'mono': StandardFonts.Courier, 'mono-b': StandardFonts.CourierBold, 'mono-i': StandardFonts.CourierOblique, 'mono-bi': StandardFonts.CourierBoldOblique,
};

const LIB = ['/usr/share/fonts/truetype/liberation2', '/usr/share/fonts/truetype/liberation'];
const DJV = '/usr/share/fonts/truetype/dejavu';
const WIN = (process.env.WINDIR || 'C:\\Windows') + '\\Fonts';
const STYLE_FILE = { '': 'Regular', b: 'Bold', i: 'Italic', bi: 'BoldItalic' };
function unicodeFontCandidates(key) {
  const [family, style = ''] = key.split('-');
  const lib = { sans: 'LiberationSans', serif: 'LiberationSerif', mono: 'LiberationMono' }[family];
  const djv = { sans: 'DejaVuSans', serif: 'DejaVuSerif', mono: 'DejaVuSansMono' }[family];
  const djvStyle = { '': '', b: '-Bold', i: family === 'serif' ? '-Italic' : '-Oblique', bi: family === 'serif' ? '-BoldItalic' : '-BoldOblique' }[style];
  const win = {
    sans: { '': 'arial', b: 'arialbd', i: 'ariali', bi: 'arialbi' },
    serif: { '': 'times', b: 'timesbd', i: 'timesi', bi: 'timesbi' },
    mono: { '': 'cour', b: 'courbd', i: 'couri', bi: 'courbi' },
  }[family][style];
  return [
    ...LIB.map((d) => `${d}/${lib}-${STYLE_FILE[style]}.ttf`),
    `${DJV}/${djv}${djvStyle}.ttf`,
    `${DJV}/DejaVuSans.ttf`,
    '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
    `${WIN}\\${win}.ttf`,
    `${WIN}\\arial.ttf`,
  ];
}

function canStandardEncode(text) {
  for (const ch of text) if (!Encodings.WinAnsi.canEncodeUnicodeCodePoint(ch.codePointAt(0))) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Interpreter
// ---------------------------------------------------------------------------------------------

function inside(edit, x, y) {
  const [a, b, c, d, e, f] = edit.transform;
  const det = a * d - b * c;
  if (!det) return false;
  // Solve p - o = s*(a,b) + t*(c,d), so s and t are in "font units" along / across the baseline.
  const px = x - e;
  const py = y - f;
  const s = (px * d - py * c) / det;
  const t = (a * py - b * px) / det;
  const fontScale = Math.hypot(a, b) || 1;
  const widthUnits = edit.width / fontScale;
  const heightUnits = (edit.height || Math.hypot(c, d)) / (Math.hypot(c, d) || 1);
  const tol = 0.12;
  return s >= -tol && s <= widthUnits + tol && t >= -0.3 * heightUnits && t <= 0.9 * heightUnits;
}

class StreamCtx {
  constructor(src, ref) {
    this.src = src;
    this.ref = ref;
    this.ops = parseOps(src);
    this.pieces = new Map(); // opIndex -> pieces
    this.dirty = false;
  }
}

function newState() {
  return {
    ctm: ID,
    font: null, // { name, ref, info, resources }
    Tfs: 0,
    Tc: 0,
    Tw: 0,
    Th: 1,
    TL: 0,
    Ts: 0,
    Tr: 0,
    fill: { space: 'DeviceGray', comps: [0], resources: null, csName: null },
  };
}
const cloneState = (s) => ({ ...s, fill: { ...s.fill } });

function editPage(doc, page, edits, formCache) {
  const ctx = doc.context;
  page.node.normalizedEntries();
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => ctx.lookup(r)) : contents ? [ctx.lookup(contents)] : [];
  const src = streams.filter((s) => s instanceof PDFStream).map(decodeStream).join('\n');
  const pageCtx = new StreamCtx(src, null);
  const resources = page.node.Resources() || ctx.obj({});
  const fontCache = new Map();

  const getFont = (res, name) => {
    const fonts = res?.lookupMaybe(PDFName.of('Font'), PDFDict);
    const raw = fonts?.get(PDFName.of(name));
    if (!raw) return null;
    const dict = raw instanceof PDFRef ? ctx.lookupMaybe(raw, PDFDict) : raw;
    if (!(dict instanceof PDFDict)) return null;
    const key = raw instanceof PDFRef ? raw.toString() : dict;
    if (!fontCache.has(key)) {
      try {
        fontCache.set(key, buildFontInfo(doc, dict));
      } catch {
        fontCache.set(key, null);
      }
    }
    const info = fontCache.get(key);
    return info ? { name, raw, info } : null;
  };

  const run = (sctx, res, ctm0, depth) => {
    let st = newState();
    st.ctm = ctm0;
    const stack = [];
    let Tm = ID;
    let Tlm = ID;
    const lineMove = (tx, ty) => {
      Tlm = mul([1, 0, 0, 1, tx, ty], Tlm);
      Tm = Tlm;
    };

    const show = (opIndex, items) => {
      const f = st.font;
      if (!f || !st.Tfs) return;
      let pieces = sctx.pieces.get(opIndex);
      const first = !pieces;
      if (first) pieces = [];
      items.forEach((item, pi) => {
        if (item.type === 'num') {
          const tx = (-item.value / 1000) * st.Tfs * st.Th;
          Tm = mul([1, 0, 0, 1, tx, 0], Tm);
          if (first) pieces.push({ num: item.value });
          return;
        }
        if (item.type !== 'str') return;
        const bytes = item.value;
        const n = f.info.bytes;
        if (first) pieces.push({ glyphs: [], Tfs: st.Tfs, n });
        const piece = pieces[pi];
        let gi = 0;
        for (let k = 0; k + n <= bytes.length; k += n, gi++) {
          let code = 0;
          for (let b = 0; b < n; b++) code = (code << 8) | bytes.charCodeAt(k + b);
          const w0 = f.info.width(code) * f.info.scale;
          const advNoTh = w0 * st.Tfs + st.Tc + (n === 1 && code === 32 ? st.Tw : 0);
          const adv = advNoTh * st.Th;
          if (first) piece.glyphs.push({ code, advNoTh, removed: false });
          const g = piece.glyphs[gi];
          if (g && st.Tr !== 7) {
            const trm = mul(Tm, st.ctm);
            const [x, y] = apply(trm, (w0 * st.Tfs * st.Th) / 2, st.Ts + st.Tfs * 0.32);
            for (const e of edits) {
              if (e.page !== undefined && inside(e, x, y)) {
                g.removed = true;
                sctx.dirty = true;
                e.matched = (e.matched || 0) + 1;
                if (!e.snap) {
                  e.snap = {
                    ctm: st.ctm,
                    Tm,
                    font: f,
                    res,
                    Tfs: st.Tfs,
                    Tc: st.Tc,
                    Tw: st.Tw,
                    Th: st.Th,
                    Ts: st.Ts,
                    Tr: st.Tr,
                    fill: { ...st.fill },
                  };
                }
                break;
              }
            }
          }
          Tm = mul([1, 0, 0, 1, adv, 0], Tm);
        }
      });
      if (first) sctx.pieces.set(opIndex, pieces);
    };

    sctx.ops.forEach((o, idx) => {
      const a = o.args;
      const n = (k) => (a[k]?.type === 'num' ? a[k].value : 0);
      switch (o.op) {
        case 'q':
          stack.push(cloneState(st));
          break;
        case 'Q':
          if (stack.length) st = stack.pop();
          break;
        case 'cm':
          st.ctm = mul([n(0), n(1), n(2), n(3), n(4), n(5)], st.ctm);
          break;
        case 'BT':
          Tm = ID;
          Tlm = ID;
          break;
        case 'Tf':
          st.font = a[0]?.type === 'name' ? getFont(res, a[0].value) : null;
          st.Tfs = n(1);
          break;
        case 'Tc':
          st.Tc = n(0);
          break;
        case 'Tw':
          st.Tw = n(0);
          break;
        case 'Tz':
          st.Th = n(0) / 100;
          break;
        case 'TL':
          st.TL = n(0);
          break;
        case 'Ts':
          st.Ts = n(0);
          break;
        case 'Tr':
          st.Tr = n(0);
          break;
        case 'Td':
          lineMove(n(0), n(1));
          break;
        case 'TD':
          st.TL = -n(1);
          lineMove(n(0), n(1));
          break;
        case 'Tm':
          Tlm = [n(0), n(1), n(2), n(3), n(4), n(5)];
          Tm = Tlm;
          break;
        case 'T*':
          lineMove(0, -st.TL);
          break;
        case 'Tj':
          show(idx, [a[0]]);
          break;
        case "'":
          lineMove(0, -st.TL);
          show(idx, [a[0]]);
          break;
        case '"':
          st.Tw = n(0);
          st.Tc = n(1);
          lineMove(0, -st.TL);
          show(idx, [a[2]]);
          break;
        case 'TJ':
          show(idx, a[0]?.type === 'array' ? a[0].items : []);
          break;
        case 'g':
          st.fill = { space: 'DeviceGray', comps: [n(0)] };
          break;
        case 'rg':
          st.fill = { space: 'DeviceRGB', comps: [n(0), n(1), n(2)] };
          break;
        case 'k':
          st.fill = { space: 'DeviceCMYK', comps: [n(0), n(1), n(2), n(3)] };
          break;
        case 'cs': {
          const nm = a[0]?.value;
          if (nm === 'DeviceGray' || nm === 'G') st.fill = { space: 'DeviceGray', comps: [0] };
          else if (nm === 'DeviceRGB' || nm === 'RGB') st.fill = { space: 'DeviceRGB', comps: [0, 0, 0] };
          else if (nm === 'DeviceCMYK' || nm === 'CMYK') st.fill = { space: 'DeviceCMYK', comps: [0, 0, 0, 1] };
          else st.fill = { space: 'named', csName: nm, resources: res, comps: [] };
          break;
        }
        case 'sc':
        case 'scn': {
          const comps = a.filter((x) => x.type === 'num').map((x) => x.value);
          const pattern = a.some((x) => x.type === 'name');
          st.fill = pattern ? { space: 'DeviceGray', comps: [0] } : { ...st.fill, comps };
          break;
        }
        case 'Do': {
          if (depth >= MAX_FORM_DEPTH || a[0]?.type !== 'name') break;
          const xobjs = res?.lookupMaybe(PDFName.of('XObject'), PDFDict);
          const ref = xobjs?.get(PDFName.of(a[0].value));
          if (!(ref instanceof PDFRef)) break;
          const xo = ctx.lookup(ref);
          if (!(xo instanceof PDFStream) || nameOf(doc, xo.dict.get(PDFName.of('Subtype'))) !== 'Form') break;
          const key = ref.toString();
          let fctx = formCache.get(key);
          if (!fctx) {
            try {
              fctx = new StreamCtx(decodeStream(xo), ref);
            } catch {
              break;
            }
            formCache.set(key, fctx);
          }
          const mArr = xo.dict.lookupMaybe(PDFName.of('Matrix'), PDFArray);
          const m = mArr ? mArr.asArray().map((v) => num(doc, v)) : ID;
          const fres = xo.dict.lookupMaybe(PDFName.of('Resources'), PDFDict) || res;
          run(fctx, fres, mul(m, st.ctm), depth + 1);
          break;
        }
        default:
          break;
      }
    });
  };

  run(pageCtx, resources, ID, 0);
  return { pageCtx, resources };
}

/** Rewrites a stream's source with removed glyphs turned into TJ spacing. */
function rewrite(sctx) {
  if (!sctx.dirty) return sctx.src;
  const parts = [];
  let cursor = 0;
  sctx.ops.forEach((o, idx) => {
    const pieces = sctx.pieces.get(idx);
    if (!pieces || !pieces.some((p) => p.glyphs?.some((g) => g.removed))) return;
    const arr = [];
    for (const p of pieces) {
      if (p.num !== undefined) {
        arr.push(fmt(p.num));
        continue;
      }
      let run = '';
      let gap = 0;
      const flush = () => {
        if (run) arr.push(hex(run));
        run = '';
      };
      for (const g of p.glyphs) {
        if (g.removed && p.Tfs) {
          if (run) flush();
          gap += (-g.advNoTh * 1000) / p.Tfs;
        } else {
          if (gap) arr.push(fmt(gap));
          gap = 0;
          run += codeBytes(g.code, p.n);
        }
      }
      flush();
      if (gap) arr.push(fmt(gap));
    }
    let prefix = '';
    if (o.op === "'") prefix = 'T* ';
    if (o.op === '"') prefix = `${fmt(o.args[0]?.value ?? 0)} Tw ${fmt(o.args[1]?.value ?? 0)} Tc T* `;
    parts.push(sctx.src.slice(cursor, o.start), `${prefix}[${arr.join(' ')}] TJ`);
    cursor = o.end;
  });
  parts.push(sctx.src.slice(cursor));
  return parts.join('');
}

function fillOps(doc, page, fill) {
  const c = (fill.comps || []).map(fmt).join(' ');
  if (fill.space === 'DeviceGray' && fill.comps.length === 1) return `${c} g`;
  if (fill.space === 'DeviceRGB' && fill.comps.length === 3) return `${c} rg`;
  if (fill.space === 'DeviceCMYK' && fill.comps.length === 4) return `${c} k`;
  if (fill.space === 'named' && fill.csName && fill.comps.length) {
    const cs = fill.resources?.lookupMaybe(PDFName.of('ColorSpace'), PDFDict)?.get(PDFName.of(fill.csName));
    if (cs) {
      const { Resources } = page.node.normalizedEntries();
      let csDict = Resources.lookupMaybe(PDFName.of('ColorSpace'), PDFDict);
      if (!csDict) {
        csDict = doc.context.obj({});
        Resources.set(PDFName.of('ColorSpace'), csDict);
      }
      const key = csDict.uniqueKey('MorphCS');
      csDict.set(key, cs);
      return `${key.toString()} cs ${c} scn`;
    }
  }
  return '0 g';
}

async function substituteFont(doc, key, text, cache) {
  if (canStandardEncode(text)) {
    const id = `std:${key}`;
    if (!cache.has(id)) cache.set(id, await doc.embedFont(STANDARD[key]));
    return cache.get(id);
  }
  for (const file of unicodeFontCandidates(key)) {
    if (!fs.existsSync(file)) continue;
    const id = `ttf:${file}`;
    if (!cache.has(id)) {
      try {
        cache.set(id, await doc.embedFont(await fsp.readFile(file), { subset: true }));
      } catch {
        cache.set(id, null);
      }
    }
    const font = cache.get(id);
    if (!font) continue;
    try {
      font.encodeText(text);
      const hasAll = [...text].every((ch) => ch === ' ' || font.embedder.font.hasGlyphForCodePoint(ch.codePointAt(0)));
      if (hasAll) return font;
    } catch {
      /* try next */
    }
  }
  throw new Error('Some of the new text uses characters we have no font for');
}

/**
 * edits: [{ page, transform:[a,b,c,d,e,f], width, height, text }]
 * Returns { applied, missed }.
 */
export async function editPdfText(input, output, edits) {
  const doc = await PDFDocument.load(await fsp.readFile(input), { ignoreEncryption: true, updateMetadata: false });
  if (doc.isEncrypted) throw new Error('This PDF is encrypted, so its text can’t be edited. Remove the protection first and try again.');
  doc.registerFontkit(fontkit);
  const pages = doc.getPages();
  const formCache = new Map();
  const subCache = new Map();
  let applied = 0;
  let missed = 0;

  const byPage = new Map();
  for (const e of edits) {
    if (!pages[e.page]) throw new Error(`Page ${e.page + 1} does not exist`);
    if (!byPage.has(e.page)) byPage.set(e.page, []);
    byPage.get(e.page).push({ ...e });
  }

  for (const [pageIndex, pageEdits] of [...byPage].sort((x, y) => x[0] - y[0])) {
    const page = pages[pageIndex];
    const { pageCtx } = editPage(doc, page, pageEdits, formCache);

    // Rewrite Form XObjects touched while drawing this page.
    for (const fctx of formCache.values()) {
      if (!fctx.dirty || fctx.written) continue;
      const old = doc.context.lookup(fctx.ref);
      const fresh = doc.context.flateStream(Buffer.from(rewrite(fctx), 'latin1'));
      for (const [k, v] of old.dict.entries()) {
        const key = k.decodeText();
        if (key !== 'Length' && key !== 'Filter' && key !== 'DecodeParms') fresh.dict.set(k, v);
      }
      doc.context.assign(fctx.ref, fresh);
      fctx.written = true;
    }

    const extra = [];
    for (const e of pageEdits) {
      if (!e.snap) {
        missed++;
        continue;
      }
      applied++;
      const text = String(e.text ?? '').replace(/[\r\n\t]+/g, ' ');
      if (!text.trim()) continue;
      const s = e.snap;
      const ops = [];
      ops.push('q', `${s.ctm.map(fmt).join(' ')} cm`, 'BT', fillOps(doc, page, s.fill));
      const codes = encodeWithFont(s.font.info, text);
      if (codes) {
        const key = page.node.newFontDictionary('MorphF', s.font.raw);
        ops.push(`${key.toString()} ${fmt(s.Tfs)} Tf`);
        const n = s.font.info.bytes;
        const spaceGap = -250; // a typical word space, in thousandths of an em
        const arr = [];
        let run = '';
        for (const code of codes) {
          if (code === null) {
            if (run) arr.push(hex(run));
            run = '';
            arr.push(String(spaceGap));
          } else run += codeBytes(code, n);
        }
        if (run) arr.push(hex(run));
        ops.push(`${fmt(s.Tc)} Tc ${fmt(s.Tw)} Tw ${fmt(s.Th * 100)} Tz ${fmt(s.Ts)} Ts ${fmt(s.Tr)} Tr`);
        ops.push(`${s.Tm.map(fmt).join(' ')} Tm`, `[${arr.join(' ')}] TJ`);
      } else {
        const font = await substituteFont(doc, classify(doc, s.font.info.dict).key, text, subCache);
        const key = page.node.newFontDictionary('MorphS', font.ref);
        ops.push(`${key.toString()} ${fmt(s.Tfs)} Tf`);
        ops.push(`${fmt(s.Tc)} Tc 0 Tw ${fmt(s.Th * 100)} Tz ${fmt(s.Ts)} Ts ${fmt(s.Tr)} Tr`);
        ops.push(`${s.Tm.map(fmt).join(' ')} Tm`, `${font.encodeText(text).toString()} Tj`);
      }
      ops.push('ET', 'Q');
      extra.push(ops.join('\n'));
    }

    const body = `q\n${rewrite(pageCtx)}\nQ\n${extra.join('\n')}\n`;
    const stream = doc.context.flateStream(Buffer.from(body, 'latin1'));
    page.node.set(PDFName.of('Contents'), doc.context.register(stream));
  }

  if (!applied) throw new Error('We couldn’t find the selected text inside the PDF. It may be part of an image or an unusual text layer.');
  await fsp.writeFile(output, await doc.save({ useObjectStreams: true }));
  return { applied, missed };
}

/** Validates and normalises the edits sent by the browser. */
export function parseEdits(raw) {
  if (!Array.isArray(raw) || !raw.length) throw new Error('No text changes were sent');
  if (raw.length > 2000) throw new Error('Too many edits in one go');
  return raw.map((e) => {
    const t = e?.transform;
    if (!Array.isArray(t) || t.length !== 6 || !t.every(Number.isFinite)) throw new Error('Invalid edit');
    if (!Number.isInteger(e.page) || e.page < 0) throw new Error('Invalid edit');
    return {
      page: e.page,
      transform: t,
      width: Math.max(0, Number(e.width) || 0),
      height: Math.max(0, Number(e.height) || 0),
      text: String(e.text ?? '').slice(0, 5000),
    };
  });
}
