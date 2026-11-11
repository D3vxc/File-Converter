import { AnimatePresence, Reorder, motion, useDragControls } from 'framer-motion';
import { ArrowRight, Download, GripVertical, LoaderCircle, Lock, RotateCcw, Trash2, Zap } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { extOf, formatBytes, labelOf, suggestTarget } from '../lib/formats.js';
import { useFormats } from '../lib/FormatsContext.jsx';
import { useConverter } from '../lib/useConverter.js';
import Dropzone from './Dropzone.jsx';
import FileCard, { Check } from './FileCard.jsx';
import FormatPicker from './FormatPicker.jsx';
import OptionsPanel, { panelFor } from './OptionsPanel.jsx';

function ReorderRow({ item, children }) {
  const controls = useDragControls();
  return (
    <Reorder.Item value={item} dragListener={false} dragControls={controls} style={{ listStyle: 'none' }}>
      {children(
        <span onPointerDown={(e) => controls.start(e)} style={{ cursor: 'grab', color: 'var(--ink-3)', touchAction: 'none', display: 'grid' }} aria-label="Drag to reorder">
          <GripVertical size={18} />
        </span>,
      )}
    </Reorder.Item>
  );
}

export default function Converter({ tool }) {
  const { formats, conversions, limits, ready, error: loadError } = useFormats();
  const mode = tool?.kind || 'convert';
  const [rejected, setRejected] = useState([]);
  const [batchOptions, setBatchOptions] = useState(tool?.defaults || {});

  const onAdd = useCallback(
    (it) => {
      if (!tool) return { ...it, target: suggestTarget(it.ext, conversions, formats) };
      return { ...it, target: tool.target ? tool.target(it.ext, conversions) : '', options: { ...(tool.defaults || {}) } };
    },
    [tool, conversions, formats],
  );

  const c = useConverter({ mode, toolSlug: tool?.slug, onAdd });

  const add = (files) => {
    const bad = [];
    const ok = files.filter((f) => {
      const ext = extOf(f.name);
      if (limits.maxFileSize && f.size > limits.maxFileSize) return bad.push(`${f.name} is larger than ${formatBytes(limits.maxFileSize)}`), false;
      if (tool?.accept && !tool.accept.includes(ext)) return bad.push(`${f.name} isn't supported by ${tool.title}`), false;
      return true;
    });
    setRejected(bad);
    if (ok.length) c.addFiles(ok);
  };

  const items = c.items;
  const idle = items.filter((i) => (i.status === 'idle' || i.status === 'error') && (mode !== 'convert' || i.target));
  const busy = items.some((i) => ['waiting', 'uploading', 'queued', 'processing'].includes(i.status));
  const done = items.filter((i) => i.status === 'done');
  const missingTarget = mode === 'convert' && items.some((i) => i.status === 'idle' && !i.target && (conversions[i.ext]?.length || 0) > 0);

  // Targets every pending file can convert to, for "convert all to".
  const commonTargets = useMemo(() => {
    if (mode !== 'convert' || tool || items.length < 2) return [];
    const sets = items.filter((i) => i.status === 'idle').map((i) => new Set(conversions[i.ext] || []));
    if (!sets.length) return [];
    return [...sets[0]].filter((t) => sets.every((s) => s.has(t)));
  }, [items, conversions, mode, tool]);

  const downloadAll = () => {
    if (c.zipAllUrl && done.every((d) => !d.result.local)) {
      window.location.href = c.zipAllUrl;
      return;
    }
    done.forEach((d, i) =>
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = d.result.url;
        a.download = d.result.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, i * 350),
    );
  };

  // ---------- batch tools (merge / images → pdf) ----------
  if (mode === 'batch') {
    const b = c.batch;
    const enough = items.length >= (tool.min || 1);
    return (
      <div className="panel">
        <AnimatePresence mode="wait">
          {b?.status === 'done' ? (
            <motion.div key="done" className="result-hero" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 15 }} style={{ width: 64, height: 64, borderRadius: 20, display: 'grid', placeItems: 'center', background: 'var(--ok)', color: '#fff', boxShadow: '0 14px 30px -10px var(--ok)' }}>
                <Check size={32} />
              </motion.div>
              <h3>Your file is ready</h3>
              <p style={{ margin: 0, color: 'var(--ink-2)' }}>{b.result.name} · {formatBytes(b.result.size)}</p>
              <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                <a className="btn btn-primary btn-lg" href={b.result.url} download={b.result.name}>
                  <span className="shine" /> <Download size={18} /> Download
                </a>
                <button className="btn btn-ghost btn-lg" onClick={c.clear}>
                  <RotateCcw size={16} /> Start over
                </button>
              </div>
            </motion.div>
          ) : b && b.status !== 'error' ? (
            <motion.div key="busy" className="result-hero" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <LoaderCircle size={40} className="spin" style={{ color: 'var(--accent)' }} />
              <h3>{b.status === 'uploading' ? `Uploading… ${Math.round((b.uploadProgress || 0) * 100)}%` : b.status === 'queued' && b.position > 1 ? `In queue (#${b.position})` : 'Working on it…'}</h3>
              <p style={{ margin: 0, color: 'var(--ink-3)' }}>This usually takes a few seconds.</p>
            </motion.div>
          ) : (
            <motion.div key="edit" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {!items.length ? (
                <Dropzone onFiles={add} accept={tool.accept} title={`Drop ${tool.accept.length === 1 ? tool.accept[0].toUpperCase() : ''} files here`} />
              ) : (
                <>
                  <p className="hint" style={{ margin: '8px 0 4px' }}>Drag the handles to set the order.</p>
                  <Reorder.Group axis="y" values={items} onReorder={c.reorder} className="file-list" style={{ margin: 0 }}>
                    {items.map((it) => (
                      <ReorderRow key={it.id} item={it}>
                        {(handle) => <FileCard item={it} dragHandle={handle} showPicker={false} onRemove={() => c.remove(it.id)} />}
                      </ReorderRow>
                    ))}
                  </Reorder.Group>
                  <div style={{ padding: '0 6px' }}>
                    <Dropzone compact onFiles={add} accept={tool.accept} />
                  </div>
                  {tool.panel && <OptionsPanel panel={tool.panel} options={batchOptions} onChange={(p) => setBatchOptions((o) => ({ ...o, ...p }))} />}
                  {b?.status === 'error' && <div className="notice">{b.error}</div>}
                  <div className="toolbar">
                    <span className="meta">{items.length} file{items.length === 1 ? '' : 's'} · {formatBytes(items.reduce((n, i) => n + i.size, 0))}</span>
                    <span className="grow" />
                    <button className="btn btn-ghost" onClick={c.clear}><Trash2 size={16} /> Clear</button>
                    <button className="btn btn-primary" disabled={!enough} onClick={() => c.runBatch(batchOptions)}>
                      <span className="shine" />
                      {tool.title} <ArrowRight size={16} />
                    </button>
                  </div>
                  {!enough && <p className="hint">Add at least {tool.min} files.</p>}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ---------- per-file conversion ----------
  return (
    <div className="panel">
      {loadError && !ready && <div className="notice">Can’t reach the conversion server. Retrying…</div>}
      {!items.length ? (
        <Dropzone onFiles={add} accept={tool?.accept} />
      ) : (
        <>
          <div className="file-list">
            <AnimatePresence initial={false}>
              {items.map((it) => (
                <FileCard
                  key={it.id}
                  item={it}
                  panel={tool ? tool.panel : panelFor(it.ext, it.target, formats)}
                  showPicker={!tool}
                  targetLabel={
                    tool?.target ? (
                      <span className="to-btn" style={{ pointerEvents: 'none' }}>
                        <span className="muted">to</span> {labelOf(it.target, formats)}
                      </span>
                    ) : null
                  }
                  onTarget={(t) => c.setTarget(it.id, t)}
                  onOptions={(o) => c.setOptions(it.id, o)}
                  onRemove={() => c.remove(it.id)}
                  onRetry={() => c.convert([it.id])}
                />
              ))}
            </AnimatePresence>
          </div>
          <div style={{ padding: '0 6px' }}>
            <Dropzone compact onFiles={add} accept={tool?.accept} />
          </div>
          <div className="toolbar">
            {commonTargets.length > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-2)' }}>
                Convert all
                <FormatPicker targets={commonTargets} value="" onChange={(t) => c.setAll(() => ({ target: t }))} />
              </span>
            )}
            <span className="grow" />
            <button className="btn btn-ghost" onClick={c.clear} disabled={busy}>
              <Trash2 size={16} /> Clear
            </button>
            {done.length > 1 && (
              <motion.button className="btn btn-ghost" onClick={downloadAll} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
                <Download size={16} /> Download all
              </motion.button>
            )}
            <button className="btn btn-primary" disabled={!idle.length || !ready} onClick={() => c.convert()}>
              <span className="shine" />
              {busy ? <LoaderCircle size={16} className="spin" /> : <Zap size={16} />}
              {tool && mode !== 'convert' ? tool.title : 'Convert'}
              {idle.length > 1 ? ` ${idle.length} files` : ''}
            </button>
          </div>
          {missingTarget && <p className="hint">Pick an output format for each file to continue.</p>}
        </>
      )}
      <AnimatePresence>
        {rejected.length > 0 && (
          <motion.div className="notice" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            {rejected.slice(0, 3).join(' · ')}
            {rejected.length > 3 && ` and ${rejected.length - 3} more`}
          </motion.div>
        )}
      </AnimatePresence>
      <p className="hint" style={{ marginBottom: 6 }}>
        <Lock size={13} /> No sign-up, no watermarks. Uploaded files are deleted automatically after {limits.retentionMinutes || 60} minutes.
      </p>
    </div>
  );
}
