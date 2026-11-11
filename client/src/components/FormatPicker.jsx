import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Search } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CATEGORIES, labelOf } from '../lib/formats.js';
import { useFormats } from '../lib/FormatsContext.jsx';

/** "to [MP4 ▾]" button that opens a searchable, categorised format grid. */
export default function FormatPicker({ from, value, onChange, disabled, targets: forced }) {
  const { formats, conversions, ready } = useFormats();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const pop = useRef(null);

  const targets = forced || conversions[from] || [];
  const groups = useMemo(() => {
    const g = {};
    for (const t of targets) (g[formats[t]?.cat || 'other'] ??= []).push(t);
    return g;
  }, [targets, formats]);
  const cats = Object.keys(groups);
  const shown = targets.filter((t) => (cat === 'all' || (formats[t]?.cat || 'other') === cat) && (!q || t.includes(q.toLowerCase()) || labelOf(t, formats).toLowerCase().includes(q.toLowerCase())));

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current.getBoundingClientRect();
      const w = Math.min(440, window.innerWidth - 24);
      const h = Math.min(440, window.innerHeight * 0.7);
      const left = Math.max(12, Math.min(r.right - w, window.innerWidth - w - 12));
      const below = r.bottom + 8 + h < window.innerHeight;
      setPos({ left, top: below ? r.bottom + 8 : Math.max(12, r.top - 8 - h), origin: below ? 'top' : 'bottom' });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!pop.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!ready && !forced) return <span className="status-text">Loading…</span>;
  if (!targets.length) {
    return <span className="badge badge-err">Not supported</span>;
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`to-btn ${value ? '' : 'empty'}`}
        disabled={disabled}
        onClick={() => {
          setQ('');
          setCat('all');
          setOpen((o) => !o);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="muted">to</span> {value ? labelOf(value, formats) : 'Choose'}
        <ChevronDown size={15} style={{ transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div
              ref={pop}
              className="popover"
              role="dialog"
              aria-label="Choose output format"
              style={{ left: pos.left, top: pos.top, transformOrigin: `${pos.origin} right` }}
              initial={{ opacity: 0, scale: 0.94, y: pos.origin === 'top' ? -6 : 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            >
              <div className="picker-search">
                <Search size={16} />
                <input autoFocus placeholder="Search formats…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <div className="picker-body">
                <div className="picker-cats">
                  {['all', ...cats].map((c) => (
                    <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>
                      {c === 'all' ? 'All' : CATEGORIES[c]?.label.split(' ')[0] || c}
                      <span style={{ opacity: 0.6, fontSize: 11 }}>{c === 'all' ? targets.length : groups[c].length}</span>
                    </button>
                  ))}
                </div>
                <div className="picker-grid">
                  {shown.map((t, i) => (
                    <motion.button
                      key={t}
                      className={`fmt-chip ${t === value ? 'on' : ''}`}
                      style={{ '--cat': CATEGORIES[formats[t]?.cat || 'other'].color }}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.012, 0.2) }}
                      onClick={() => {
                        onChange(t);
                        setOpen(false);
                      }}
                    >
                      {labelOf(t, formats)}
                    </motion.button>
                  ))}
                  {!shown.length && <p style={{ gridColumn: '1/-1', color: 'var(--ink-3)', fontSize: 13, margin: 8 }}>No matching format.</p>}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
