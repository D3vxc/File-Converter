import { motion } from 'framer-motion';
import { Plus, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

const SHEETS = [
  { tag: 'MP4', color: 'var(--c-video)', rest: { x: -34, y: 6, rotate: -12 }, drag: { x: -58, y: -4, rotate: -20 } },
  { tag: 'PDF', color: 'var(--c-document)', rest: { x: 34, y: 6, rotate: 12 }, drag: { x: 58, y: -4, rotate: 20 } },
  { tag: 'PNG', color: 'var(--c-image)', rest: { x: 0, y: -4, rotate: 0 }, drag: { x: 0, y: -22, rotate: 0 } },
];

export default function Dropzone({ onFiles, accept, compact = false, multiple = true, title, subtitle }) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const input = useRef(null);

  const take = useCallback(
    (list) => {
      const files = [...(list || [])].filter((f) => f.size > 0 || f.type);
      if (files.length) onFiles(multiple ? files : files.slice(0, 1));
    },
    [onFiles, multiple],
  );

  // Paste files from the clipboard anywhere on the page.
  useEffect(() => {
    const onPaste = (e) => {
      if (e.target.closest?.('input, textarea')) return;
      if (e.clipboardData?.files?.length) take(e.clipboardData.files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [take]);

  const handlers = {
    onDragEnter: (e) => {
      e.preventDefault();
      depth.current++;
      setDragging(true);
    },
    onDragOver: (e) => e.preventDefault(),
    onDragLeave: () => {
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setDragging(false);
    },
    onDrop: (e) => {
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      take(e.dataTransfer.files);
    },
    onClick: () => input.current?.click(),
    onKeyDown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input.current?.click()),
  };

  const acceptAttr = accept?.length ? accept.map((e) => `.${e}`).concat(accept.includes('jpg') ? ['.jpeg'] : []).join(',') : undefined;

  const fileInput = (
    <input
      ref={input}
      type="file"
      hidden
      multiple={multiple}
      accept={acceptAttr}
      onChange={(e) => {
        take(e.target.files);
        e.target.value = '';
      }}
    />
  );

  if (compact) {
    return (
      <div className={`dropzone compact ${dragging ? 'dragging' : ''}`} role="button" tabIndex={0} {...handlers}>
        {fileInput}
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-2)', fontWeight: 600, fontSize: 14 }}>
          <Plus size={16} /> {dragging ? 'Drop to add' : 'Add more files'}
          <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>— or drop them here</span>
        </span>
      </div>
    );
  }

  return (
    <div className={`dropzone ${dragging ? 'dragging' : ''}`} role="button" tabIndex={0} aria-label="Choose files to convert" {...handlers}>
      {fileInput}
      <div>
        <motion.div className="drop-art" style={{ margin: '0 auto' }} animate={dragging ? 'drag' : 'rest'} initial="rest" whileHover="hover">
          {SHEETS.map((s, i) => (
            <motion.div
              key={s.tag}
              className="sheet"
              variants={{
                rest: { ...s.rest, scale: 1 },
                hover: { ...s.rest, y: s.rest.y - 6, scale: 1.03 },
                drag: { ...s.drag, scale: 1.08 },
              }}
              transition={{ type: 'spring', stiffness: 260, damping: 18, delay: i * 0.03 }}
            >
              <div className="lines">
                <i />
                <i />
                <i />
              </div>
              <span className="tag" style={{ background: s.color }}>{s.tag}</span>
            </motion.div>
          ))}
        </motion.div>
        <h3>{dragging ? 'Release to upload' : title || 'Drop your files here'}</h3>
        <p>{subtitle || 'or choose from your device — you can also paste with Ctrl + V'}</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 22, flexWrap: 'wrap' }}>
          <motion.span className="btn btn-primary btn-lg" whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}>
            <span className="shine" />
            <Upload size={18} /> Choose files
          </motion.span>
        </div>
      </div>
    </div>
  );
}
