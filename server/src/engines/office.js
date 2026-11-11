import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { tools } from '../tools.js';
import { markdownToHtml } from './doc.js';
import { run } from './run.js';

const FILTERS = {
  pdf: 'pdf',
  docx: 'docx:MS Word 2007 XML',
  doc: 'doc:MS Word 97',
  epub: 'epub',
  html: 'html:XHTML Writer File:UTF8',
  txt: 'txt:Text (encoded):UTF8',
  xlsx: 'xlsx:Calc MS Excel 2007 XML',
  ods: 'ods',
  ppt: 'ppt:MS PowerPoint 97',
  odt: 'odt',
  rtf: 'rtf',
  pptx: 'pptx:Impress MS PowerPoint 2007 XML',
  odp: 'odp',
};

/** LibreOffice headless conversion. Each job uses its own profile so jobs can run in parallel. */
export async function convertOffice({ input, output, from, to, workDir, signal, title }) {
  if (!tools.soffice) throw new Error('Office conversion is not available on this server');
  let src = input;
  if (from === 'md') {
    src = path.join(workDir, 'source.html');
    await fs.writeFile(src, await markdownToHtml(await fs.readFile(input, 'utf8'), title));
  }
  const outDir = path.join(workDir, 'office-out');
  await fs.mkdir(outDir, { recursive: true });
  const profile = pathToFileURL(path.join(workDir, 'lo-profile')).href;

  await run(
    tools.soffice,
    ['--headless', '--norestore', '--nolockcheck', '--nodefault', `-env:UserInstallation=${profile}`,
      '--convert-to', FILTERS[to] || to, '--outdir', outDir, src],
    { signal, env: { HOME: workDir } },
  );
  const ext = to === 'html' ? ['html', 'xhtml', 'htm'] : [to];
  const produced = (await fs.readdir(outDir)).filter((f) => ext.some((e) => f.toLowerCase().endsWith(`.${e}`)));
  if (!produced.length) throw new Error('The office engine could not convert this file');
  await fs.rename(path.join(outDir, produced[0]), output);
}
