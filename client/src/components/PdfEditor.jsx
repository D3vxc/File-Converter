import { AnimatePresence, motion } from 'framer-motion';
import { Download, FilePen, LoaderCircle, MousePointerClick, RotateCcw, Save, Undo2 } from 'lucide-react';
import { GlobalWorkerOptions, Util, getDocument } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { formatBytes } from '../lib/formats.js';
import { useFormats } from '../lib/FormatsContext.jsx';
import { useConverter } from '../lib/useConverter.js';
import Dropzone from './Dropzone.jsx';
import { Check } from './FileCard.jsx';
import { SupportNudge } from './Support.jsx';

GlobalWorkerOptions.workerSrc = workerUrl;

const keyOf = (page, idx) => `${page}:${idx}`;
const closeDoc = (pdf) => (pdf?.loadingTask?.destroy?.() ?? pdf?.destroy?.())?.catch?.(() => {});

/** Weight, style and a close system fallback for a PDF font, so edits preview in the right style. */
function fontLook(page, fontName, style) {
  let f = null;
  try {
    f = page.commonObjs.has(fontName) ? page.commonObjs.get(fontName) : null;
  } catch {
    /* not loaded */
  }
  const name = String(f?.name || '').replace(/^[A-Z]{6}\+/, '');
  const lower = name.toLowerCase();
  const bold = Boolean(f?.bold || f?.black || /bold|black|heavy|semibold|demi/.test(lower));
  const italic = Boolean(f?.italic || /italic|oblique/.test(lower));
  const generic = style.fontFamily || 'sans-serif';
  const family = name.split(/[-,]/)[0].replace(/(PSMT|MT|PS)$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
  const fallback = family ? `"${family.replace(/"/g, '')}", ` : '';
  return { fontFamily: `"${fontName}", ${fallback}${generic}`, fontWeight: bold ? 700 : 400, fontStyle: italic ? 'italic' : 'normal' };
}

/** Most common colour in a list of [r,g,b] samples (quantised so anti-aliasing doesn't split votes). */
function dominant(samples) {
  const votes = new Map();
  for (const [r, g, b] of samples) {
    const k = `${r >> 3},${g >> 3},${b >> 3}`;
    const v = votes.get(k) || { n: 0, r, g, b };
    v.n++;
    votes.set(k, v);
  }
  let best = null;
  for (const v of votes.values()) if (!best || v.n > best.n) best = v;
  return best ? [best.r, best.g, best.b] : [255, 255, 255];
}
const css = ([r, g, b]) => `rgb(${r}, ${g}, ${b})`;
const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

/** Background (around the run) and ink (inside it) colours, read from the rendered canvas. */
function sampleColors(ctx, box, W, H, scale) {
  const px = (fx, fy) => {
    const x = Math.min(W - 1, Math.max(0, Math.round(fx * scale)));
    const y = Math.min(H - 1, Math.max(0, Math.round(fy * scale)));
    const d = ctx.getImageData(x, y, 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const { left, top, width, height } = box;
  const around = [];
  for (let k = 0; k <= 8; k++) {
    const x = left + (width * k) / 8;
    around.push(px(x, top - 2), px(x, top + height + 2));
  }
  around.push(px(left - 3, top + height / 2), px(left + width + 3, top + height / 2));
  const bg = dominant(around);
  let ink = [0, 0, 0];
  let far = -1;
  for (let k = 1; k < 24; k++) {
    for (const fy of [0.45, 0.6, 0.75]) {
      const c = px(left + (width * k) / 24, top + height * fy);
      const d = dist(c, bg);
      if (d > far) {
        far = d;
        ink = c;
      }
    }
  }
  return { bg: css(bg), ink: far > 60 ? css(ink) : bg[0] + bg[1] + bg[2] > 380 ? '#000' : '#fff' };
}

function useVisible(ref, eager) {
  const [visible, setVisible] = useState(eager);
  useEffect(() => {
    if (visible || !ref.current) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: '800px 0px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [ref, visible]);
  return visible;
}

function EditBox({ run, value, onCommit, onCancel }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    el.textContent = value;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const done = useRef(false);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    onCommit(ref.current.textContent.replace(/\s*\n\s*/g, ' '));
  };
  return (
    <span
      ref={ref}
      className="pe-input"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      style={runStyle(run)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          done.current = true;
          onCancel();
        }
      }}
      onPaste={(e) => {
        e.preventDefault();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/\s*\n\s*/g, ' '));
      }}
    />
  );
}

function runStyle(run) {
  return {
    left: `${run.box.left * 100}%`,
    top: `${run.box.top * 100}%`,
    minWidth: `${run.box.width * 100}%`,
    height: `${run.box.height * 100}%`,
    fontSize: `${run.fontSize * 100}cqw`,
    fontFamily: run.fontFamily,
    fontWeight: run.fontWeight,
    fontStyle: run.fontStyle,
    color: run.ink,
    background: run.bg,
    transform: run.angle ? `rotate(${run.angle}rad)` : undefined,
  };
}

const PdfPage = memo(function PdfPage({ doc, index, edits, active, onActivate, onCommit, onCancel, onNoText }) {
  const wrap = useRef(null);
  const canvas = useRef(null);
  const visible = useVisible(wrap, index < 2);
  const [size, setSize] = useState(null);
  const [runs, setRuns] = useState(null);

  // Page size first, so the layout doesn't jump while scrolling.
  useEffect(() => {
    let cancelled = false;
    doc.getPage(index + 1).then((p) => {
      if (cancelled) return;
      const vp = p.getViewport({ scale: 1 });
      setSize({ w: vp.width, h: vp.height });
    });
    return () => {
      cancelled = true;
    };
  }, [doc, index]);

  useEffect(() => {
    if (!visible || !size) return;
    let cancelled = false;
    let task;
    (async () => {
      const page = await doc.getPage(index + 1);
      const vp1 = page.getViewport({ scale: 1 });
      const cssWidth = wrap.current?.clientWidth || 800;
      const scale = Math.min(4, (cssWidth * (window.devicePixelRatio || 1)) / vp1.width);
      const vp = page.getViewport({ scale });
      const c = canvas.current;
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      task = page.render({ canvas: c, canvasContext: c.getContext('2d'), viewport: vp });
      await task.promise;
      const tc = await page.getTextContent();
      if (cancelled) return;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      const list = [];
      tc.items.forEach((item, idx) => {
        if (!item.str || !item.str.trim() || !item.width) return;
        const style = tc.styles[item.fontName] || {};
        if (style.vertical) return;
        const tx = Util.transform(vp1.transform, item.transform);
        const angle = Math.atan2(tx[1], tx[0]);
        const fontHeight = Math.hypot(tx[2], tx[3]);
        if (!fontHeight) return;
        const ascent = style.ascent ? style.ascent : style.descent ? 1 + style.descent : 0.8;
        const left = angle ? tx[4] + fontHeight * ascent * Math.sin(angle) : tx[4];
        const top = angle ? tx[5] - fontHeight * ascent * Math.cos(angle) : tx[5] - fontHeight * ascent;
        const width = item.width * (Math.hypot(tx[0], tx[1]) / Math.hypot(item.transform[0], item.transform[1]) || 1);
        const px = { left, top, width, height: fontHeight * 1.15 };
        const colors = sampleColors(ctx, px, c.width, c.height, scale);
        list.push({
          key: keyOf(index, idx),
          page: index,
          str: item.str,
          transform: item.transform,
          width: item.width,
          height: item.height,
          angle,
          fontSize: fontHeight / vp1.width,
          ...fontLook(page, item.fontName, style),
          box: { left: left / vp1.width, top: top / vp1.height, width: width / vp1.width, height: (fontHeight * 1.15) / vp1.height },
          ...colors,
        });
      });
      setRuns(list);
      if (!list.length) onNoText(index);
    })().catch((e) => {
      if (e?.name !== 'RenderingCancelledException') console.error(e);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [visible, size, doc, index, onNoText]);

  return (
    <div className="pe-page" ref={wrap} style={size ? { aspectRatio: `${size.w} / ${size.h}` } : { aspectRatio: '1 / 1.414' }}>
      <canvas ref={canvas} />
      {!runs && <div className="pe-loading"><LoaderCircle size={22} className="spin" /></div>}
      {runs?.map((run) =>
        active === run.key ? (
          <EditBox key={run.key} run={run} value={edits.get(run.key)?.text ?? run.str} onCommit={(text) => onCommit(run, text)} onCancel={onCancel} />
        ) : edits.has(run.key) ? (
          <button key={run.key} className="pe-run pe-edited" style={runStyle(run)} onClick={() => onActivate(run.key)} title="Edited — click to change">
            {edits.get(run.key).text || ' '}
          </button>
        ) : (
          <button
            key={run.key}
            className="pe-run"
            aria-label={`Edit text: ${run.str}`}
            onClick={() => onActivate(run.key)}
            style={{ left: `${run.box.left * 100}%`, top: `${run.box.top * 100}%`, width: `${run.box.width * 100}%`, height: `${run.box.height * 100}%`, transform: run.angle ? `rotate(${run.angle}rad)` : undefined }}
          />
        ),
      )}
      <span className="pe-num">{index + 1}</span>
    </div>
  );
});

export default function PdfEditor({ tool }) {
  const { limits } = useFormats();
  const [file, setFile] = useState(null);
  const [doc, setDoc] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const [edits, setEdits] = useState(() => new Map());
  const [active, setActive] = useState(null);
  const [noText, setNoText] = useState(() => new Set());
  const c = useConverter({ mode: 'batch', toolSlug: tool.slug });
  const b = c.batch;

  useEffect(() => () => closeDoc(doc), [doc]);

  const open = async ([f]) => {
    setLoadError('');
    if (!f) return;
    if (!/\.pdf$/i.test(f.name)) return setLoadError(`${f.name} isn't a PDF.`);
    if (limits.maxFileSize && f.size > limits.maxFileSize) return setLoadError(`${f.name} is larger than ${formatBytes(limits.maxFileSize)}.`);
    setLoading(true);
    try {
      const pdf = await getDocument({ data: new Uint8Array(await f.arrayBuffer()), isEvalSupported: false, fontExtraProperties: true }).promise;
      const meta = await pdf.getMetadata().catch(() => null);
      if (meta?.info?.EncryptFilterName) {
        closeDoc(pdf);
        throw new Error('This PDF is encrypted, so its text can’t be changed. Remove the protection first and try again.');
      }
      c.clear();
      c.addFiles([f]);
      setFile(f);
      setDoc(pdf);
      setEdits(new Map());
      setNoText(new Set());
      setActive(null);
    } catch (e) {
      setLoadError(e?.name === 'PasswordException' ? 'This PDF is password-protected. Unlock it first and try again.' : e.message || 'This PDF could not be opened.');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    c.clear();
    setFile(null);
    setDoc(null);
    setEdits(new Map());
    setActive(null);
  };

  const onCommit = useCallback((run, text) => {
    setActive(null);
    setEdits((prev) => {
      const next = new Map(prev);
      if (text === run.str) next.delete(run.key);
      else next.set(run.key, { page: run.page, transform: run.transform, width: run.width, height: run.height, text });
      return next;
    });
  }, []);
  const onCancel = useCallback(() => setActive(null), []);
  const onNoText = useCallback((i) => setNoText((s) => new Set(s).add(i)), []);

  const save = () => c.runBatch({ edits: [...edits.values()] });
  const keepEditing = () => {
    // Back to the editor with the same file and edits; the next save makes a fresh job.
    const f = file;
    c.clear();
    c.addFiles([f]);
  };

  if (!doc) {
    return (
      <div className="panel">
        {loading ? (
          <div className="result-hero">
            <LoaderCircle size={40} className="spin" style={{ color: 'var(--accent)' }} />
            <h3>Opening your PDF…</h3>
          </div>
        ) : (
          <Dropzone onFiles={open} accept={['pdf']} multiple={false} title="Drop a PDF to edit" subtitle="Your PDF opens right here in the browser. Click any text to change it." />
        )}
        {loadError && <div className="notice">{loadError}</div>}
      </div>
    );
  }

  if (b && b.status !== 'error') {
    return (
      <div className="panel">
        <AnimatePresence mode="wait">
          {b.status === 'done' ? (
            <motion.div key="done" className="result-hero" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 15 }} className="pe-ok">
                <Check size={32} />
              </motion.div>
              <h3>Your edited PDF is ready</h3>
              <p style={{ margin: 0, color: 'var(--ink-2)' }}>{b.result.name} · {formatBytes(b.result.size)}</p>
              <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                <a className="btn btn-primary btn-lg" href={b.result.url} download={b.result.name}>
                  <span className="shine" /> <Download size={18} /> Download
                </a>
                <button className="btn btn-ghost btn-lg" onClick={keepEditing}>
                  <FilePen size={16} /> Keep editing
                </button>
                <button className="btn btn-ghost btn-lg" onClick={reset}>
                  <RotateCcw size={16} /> New PDF
                </button>
              </div>
              <SupportNudge />
            </motion.div>
          ) : (
            <motion.div key="busy" className="result-hero" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <LoaderCircle size={40} className="spin" style={{ color: 'var(--accent)' }} />
              <h3>{b.status === 'uploading' ? `Uploading… ${Math.round((b.uploadProgress || 0) * 100)}%` : b.status === 'queued' && b.position > 1 ? `In queue (#${b.position})` : 'Applying your changes…'}</h3>
              <p style={{ margin: 0, color: 'var(--ink-3)' }}>This usually takes a few seconds.</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  const count = edits.size;
  const pages = Array.from({ length: doc.numPages }, (_, i) => i);
  return (
    <div className="panel pe">
      <div className="toolbar pe-bar">
        <span className="meta pe-file" title={file.name}>
          <b>{file.name}</b> · {doc.numPages} page{doc.numPages === 1 ? '' : 's'}
        </span>
        <span className="grow" />
        <span className="meta">{count ? `${count} change${count === 1 ? '' : 's'}` : 'No changes yet'}</span>
        <button className="btn btn-ghost btn-sm" disabled={!count} onClick={() => setEdits(new Map())}>
          <Undo2 size={15} /> Undo all
        </button>
        <button className="btn btn-ghost btn-sm" onClick={reset}>
          <RotateCcw size={15} /> Other PDF
        </button>
        <button className="btn btn-primary btn-sm" disabled={!count} onClick={save}>
          <span className="shine" />
          <Save size={15} /> Save PDF
        </button>
      </div>
      {b?.status === 'error' && <div className="notice">{b.error}</div>}
      <p className="hint" style={{ margin: '4px 0 10px' }}>
        <MousePointerClick size={14} /> Click any text to change it. Press Enter to keep a change, Esc to cancel.
      </p>
      {noText.size > 0 && noText.size >= Math.min(doc.numPages, 3) && (
        <p className="hint">Some pages have no selectable text. They may be scanned images, which can’t be edited as text.</p>
      )}
      <div className="pe-pages">
        {pages.map((i) => (
          <PdfPage key={i} doc={doc} index={i} edits={edits} active={active} onActivate={setActive} onCommit={onCommit} onCancel={onCancel} onNoText={onNoText} />
        ))}
      </div>
    </div>
  );
}
