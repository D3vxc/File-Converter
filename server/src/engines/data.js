import fs from 'node:fs/promises';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import * as yaml from 'js-yaml';
import * as XLSX from 'xlsx';
import { htmlPage } from './doc.js';

const TREE = new Set(['json', 'yaml', 'xml']);
const BOOK_TYPES = { xlsx: 'xlsx', ods: 'ods' };

function parseTree(from, text) {
  if (from === 'json') return JSON.parse(text.replace(/^﻿/, ''));
  if (from === 'yaml') return yaml.load(text);
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', parseTagValue: true, trimValues: true });
  return parser.parse(text);
}

function xmlSafe(value) {
  if (Array.isArray(value)) return value.map(xmlSafe);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('@')) {
        out[k] = v;
        continue;
      }
      let key = k.replace(/[^A-Za-z0-9_.-]/g, '_');
      if (!/^[A-Za-z_]/.test(key)) key = `_${key}`;
      out[key] = xmlSafe(v);
    }
    return out;
  }
  return value;
}

function serializeTree(to, tree) {
  if (to === 'json') return JSON.stringify(tree, null, 2) + '\n';
  if (to === 'yaml') return yaml.dump(tree, { lineWidth: 120 });
  let doc = xmlSafe(tree);
  const keys = doc && typeof doc === 'object' && !Array.isArray(doc) ? Object.keys(doc).filter((k) => k !== '?xml') : [];
  if (Array.isArray(doc)) doc = { root: { item: doc } };
  else if (keys.length !== 1 || Array.isArray(doc[keys[0]])) doc = { root: doc };
  const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@', format: true, indentBy: '  ' });
  const body = builder.build(doc);
  return body.startsWith('<?xml') ? body : `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
}

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) flatten(v, key, out);
    else if (Array.isArray(v)) out[key] = v.every((x) => x === null || typeof x !== 'object') ? v.join(', ') : JSON.stringify(v);
    else out[key] = v;
  }
  return out;
}

function findRows(tree) {
  if (Array.isArray(tree)) return tree;
  if (tree && typeof tree === 'object') {
    for (const v of Object.values(tree)) {
      const rows = findRows(v);
      if (rows) return rows;
    }
  }
  return null;
}

function treeToWorkbook(tree) {
  const wb = XLSX.utils.book_new();
  const toSheet = (rows) =>
    XLSX.utils.json_to_sheet(rows.map((r) => (r && typeof r === 'object' ? flatten(r) : { value: r })));
  // { Sheet1: [...], Sheet2: [...] } becomes a multi-sheet workbook
  if (tree && typeof tree === 'object' && !Array.isArray(tree) && Object.values(tree).length > 1 && Object.values(tree).every(Array.isArray)) {
    for (const [name, rows] of Object.entries(tree)) XLSX.utils.book_append_sheet(wb, toSheet(rows), name.slice(0, 31) || 'Sheet');
    return wb;
  }
  const rows = findRows(tree) ?? [tree];
  XLSX.utils.book_append_sheet(wb, toSheet(rows), 'Sheet1');
  return wb;
}

function workbookToTree(wb) {
  const sheets = wb.SheetNames.map((n) => [n, XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null, raw: true })]);
  if (sheets.length === 1) return sheets[0][1];
  return Object.fromEntries(sheets);
}

export async function convertData({ input, output, from, to, title }) {
  const buf = await fs.readFile(input);
  let tree;
  let wb;
  if (TREE.has(from)) tree = parseTree(from, buf.toString('utf8'));
  else if (from === 'csv' || from === 'tsv') {
    wb = XLSX.read(buf.toString('utf8').replace(/^﻿/, ''), { type: 'string', raw: false, FS: from === 'tsv' ? '\t' : undefined });
  } else wb = XLSX.read(buf, { type: 'buffer', cellDates: true });

  if (TREE.has(to)) {
    if (!tree) tree = workbookToTree(wb);
    await fs.writeFile(output, serializeTree(to, tree), 'utf8');
    return;
  }
  if (!wb) wb = treeToWorkbook(tree);
  const first = wb.Sheets[wb.SheetNames[0]];
  if (to === 'csv') return fs.writeFile(output, '﻿' + XLSX.utils.sheet_to_csv(first), 'utf8');
  if (to === 'tsv') return fs.writeFile(output, XLSX.utils.sheet_to_csv(first, { FS: '\t' }), 'utf8');
  if (to === 'html') {
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const tables = wb.SheetNames.map((n) => `<h2>${esc(n)}</h2>\n${XLSX.utils.sheet_to_html(wb.Sheets[n], { header: '', footer: '' })}`);
    return fs.writeFile(output, htmlPage(tables.join('\n'), title), 'utf8');
  }
  await fs.writeFile(output, XLSX.write(wb, { bookType: BOOK_TYPES[to], type: 'buffer', compression: true }));
}
