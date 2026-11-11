import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, CircleAlert, Download, LoaderCircle, MonitorSmartphone, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CATEGORIES, catOf, formatBytes, labelOf } from '../lib/formats.js';
import { useFormats } from '../lib/FormatsContext.jsx';
import FormatPicker from './FormatPicker.jsx';
import OptionsPanel from './OptionsPanel.jsx';

const THUMB = new Set(['jpg', 'png', 'webp', 'gif', 'avif', 'bmp', 'svg']);

export function FileIcon({ ext, formats }) {
  const cat = catOf(ext, formats);
  const { icon: Icon, color } = CATEGORIES[cat];
  return (
    <div className="file-icon" style={{ '--cat': color }}>
      <Icon size={16} strokeWidth={2} />
      {labelOf(ext || '?', formats).slice(0, 5)}
    </div>
  );
}

function useThumb(file, ext) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!THUMB.has(ext) || file.size > 25 * 1024 * 1024) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file, ext]);
  return url;
}

export function Check({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.45, ease: 'easeOut', delay: 0.1 }} />
    </svg>
  );
}

function statusLabel(it) {
  switch (it.status) {
    case 'waiting':
      return it.notice || 'Waiting…';
    case 'uploading':
      return `Uploading ${Math.round((it.uploadProgress || 0) * 100)}%`;
    case 'queued':
      return it.position > 1 ? `In queue · #${it.position}` : 'Starting…';
    case 'processing':
      return it.local ? 'Converting…' : it.progress > 0.01 ? `Converting ${Math.round(it.progress * 100)}%` : 'Converting…';
    default:
      return '';
  }
}

export default function FileCard({ item: it, onTarget, onOptions, onRemove, onRetry, panel, showPicker = true, targetLabel, dragHandle }) {
  const { formats } = useFormats();
  const thumb = useThumb(it.file, it.ext);
  const [showOpts, setShowOpts] = useState(false);
  const busy = ['waiting', 'uploading', 'queued', 'processing'].includes(it.status);
  const pct = it.status === 'uploading' ? (it.uploadProgress || 0) * 0.35 : it.status === 'processing' ? 0.35 + (it.progress || 0) * 0.65 : it.status === 'queued' ? 0.35 : it.status === 'done' ? 1 : 0;
  const saved = it.result && it.size ? 1 - it.result.size / it.size : 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: -30, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      style={{ display: 'grid' }}
    >
      <div className="file-card">
        <motion.div className="progress-bg" animate={{ width: `${pct * 100}%`, opacity: it.status === 'done' ? 0 : 1 }} transition={{ duration: 0.6 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {dragHandle}
          {thumb ? <img className="file-thumb" src={thumb} alt="" /> : <FileIcon ext={it.ext} formats={formats} />}
        </div>
        <div className="file-meta">
          <div className="file-name" title={it.name}>{it.result?.name || it.name}</div>
          <div className="file-sub">
            <span>{formatBytes(it.size)}</span>
            {it.status === 'done' && it.result && (
              <>
                <ArrowRight size={12} />
                <span style={{ color: 'var(--ink)' }}>{formatBytes(it.result.size)}</span>
                {saved > 0.02 && <span className="badge badge-ok">−{Math.round(saved * 100)}%</span>}
                {it.result.local && (
                  <span className="badge badge-local" title="Converted in your browser. This file never left your device.">
                    <MonitorSmartphone size={11} /> On-device
                  </span>
                )}
              </>
            )}
            {it.status === 'error' && (
              <span className="badge-err" style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                <CircleAlert size={13} /> {it.error}
              </span>
            )}
          </div>
        </div>
        <div className="file-actions">
          <AnimatePresence mode="popLayout" initial={false}>
            {busy ? (
              <motion.span key="busy" className="status-text" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                <LoaderCircle size={15} className="spin" style={{ color: 'var(--accent)' }} />
                {statusLabel(it)}
              </motion.span>
            ) : it.status === 'done' ? (
              <motion.a
                key="dl"
                className="btn btn-ok btn-sm"
                href={it.result.url}
                download={it.result.name}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
              >
                <Check size={16} /> Download
              </motion.a>
            ) : (
              <motion.span key="pick" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ display: 'inline-flex', gap: 8 }}>
                {showPicker ? <FormatPicker from={it.ext} value={it.target} onChange={onTarget} /> : targetLabel}
                {panel && (
                  <button type="button" className={`icon-btn ${showOpts ? 'on' : ''}`} onClick={() => setShowOpts((s) => !s)} aria-label="Conversion settings" aria-expanded={showOpts} style={showOpts ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : null}>
                    <SlidersHorizontal size={16} />
                  </button>
                )}
                {it.status === 'error' && (
                  <button type="button" className="icon-btn" onClick={onRetry} aria-label="Retry">
                    <RotateCcw size={16} />
                  </button>
                )}
              </motion.span>
            )}
          </AnimatePresence>
          <button type="button" className="icon-btn" onClick={onRemove} aria-label={`Remove ${it.name}`} title={it.status === 'done' ? 'Remove and delete from server' : 'Remove'}>
            <X size={16} />
          </button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {showOpts && panel && !busy && it.status !== 'done' && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} style={{ overflow: 'hidden' }}>
            <OptionsPanel panel={panel} to={it.target} options={it.options} onChange={onOptions} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
