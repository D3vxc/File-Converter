import { AnimatePresence, motion } from 'framer-motion';
import { Gauge, Infinity as InfinityIcon, Lock, MonitorSmartphone, Plus, ShieldCheck, Sparkles } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import Converter from '../components/Converter.jsx';
import ToolCard from '../components/ToolCard.jsx';
import { formatBytes } from '../lib/formats.js';
import { useFormats } from '../lib/FormatsContext.jsx';
import { TOOLS } from '../lib/tools.js';

const WORDS = ['anything', 'videos', 'images', 'PDFs', 'audio', 'spreadsheets'];

const FEATURES = (mins) => [
  { icon: InfinityIcon, title: 'Free, for real', text: 'No ads, no subscriptions, no daily caps, no watermarks.' },
  { icon: MonitorSmartphone, title: 'On-device when possible', text: 'Simple image conversions run in your browser and never leave your device.' },
  { icon: Lock, title: 'Private by default', text: `Uploads are deleted after ${mins} minutes. Photo EXIF and GPS data is stripped.` },
  { icon: Gauge, title: 'Fair queue', text: 'A round-robin queue means one heavy user can never slow everyone else down.' },
  { icon: Sparkles, title: 'Fine-tuned output', text: 'Quality, resolution, trimming, frame rate, bitrate and more.' },
  { icon: ShieldCheck, title: 'Open source', text: 'Every line of code is public. Host your own copy for free.' },
];

const FAQ = [
  ['Is it really free?', 'Yes. There are no paid plans, ads or sign-ups. The project runs on free hosting and open-source tools.'],
  ['What happens to my files?', ({ mins }) => `Files are processed and then deleted automatically after ${mins} minutes. You can also delete them right away by removing them from the list.`],
  ['How big can my files be?', ({ size }) => `Up to ${size} per file.`],
  ['Why is my file in a queue?', 'When lots of people convert at once, jobs wait their turn fairly. Quick jobs (images, documents) use a separate lane so they are never stuck behind long videos.'],
];

/**
 * The rotating word in the headline. It keeps its own state so the rest of the page doesn't
 * re-render every tick. It sits on its own centred line, so a change of word never moves "Convert".
 * Old and new words share one grid cell, so they cross over in place.
 */
const SwapWord = memo(function SwapWord() {
  const [w, setW] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setW((i) => (i + 1) % WORDS.length), 2200);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="swap">
      <AnimatePresence initial={false}>
        <motion.span key={WORDS[w]} className="swap-word" initial={{ y: '100%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '-100%', opacity: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
          {WORDS[w]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
});

export default function Home() {
  const { totalConversions, capabilities, limits = {} } = useFormats();
  const mins = limits.retentionMinutes || 60;
  const size = limits.maxFileSize ? formatBytes(limits.maxFileSize) : '100 MB';
  const [open, setOpen] = useState(0);

  return (
    <>
      <div className="container hero">
        <motion.span className="eyebrow" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <span className="dot"><Sparkles size={11} /></span> {totalConversions || '390'}+ conversions · free forever
        </motion.span>
        <h1>
          Convert
          <SwapWord />
          into anything.
        </h1>
        <p className="lead">Images, video, audio, documents, spreadsheets and archives. No ads, no account, no catch.</p>
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.6, ease: [0.22, 1, 0.36, 1] }} style={{ maxWidth: 860, margin: '0 auto' }}>
          <Converter />
        </motion.div>
        <div className="stats" style={{ maxWidth: 860, marginInline: 'auto' }}>
          {[[`${totalConversions || '390'}+`, 'conversions'], ['0', 'ads'], [mins >= 60 ? `${mins / 60} h` : `${mins} min`, 'auto-delete'], [size, 'per file']].map(([b, s]) => (
            <div className="stat" key={s}><b>{b}</b><span>{s}</span></div>
          ))}
        </div>
      </div>

      <section className="container" id="tools">
        <div className="section-head">
          <span className="kicker">Tools</span>
          <h2>More than a converter</h2>
          <p>Compress, resize, trim, merge and split, all in one place.</p>
        </div>
        <div className="tools-grid">
          {TOOLS.map((t, i) => <ToolCard key={t.slug} tool={t} index={i} disabled={t.needs && capabilities && capabilities[t.needs] === false} />)}
        </div>
      </section>

      <section className="container">
        <div className="section-head">
          <span className="kicker">Why Morph</span>
          <h2>Built to be fair to everyone</h2>
        </div>
        <div className="features">
          {FEATURES(mins).map(({ icon: Icon, title, text }) => (
            <div className="feature" key={title}>
              <div className="ico"><Icon size={20} /></div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="container">
        <div className="section-head"><span className="kicker">FAQ</span><h2>Questions</h2></div>
        <div className="faq">
          {FAQ.map(([q, a], i) => (
            <div className={`faq-item ${open === i ? 'open' : ''}`} key={q}>
              <button onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}>{q} <Plus size={18} /></button>
              <AnimatePresence initial={false}>
                {open === i && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
                    <div className="answer">{typeof a === 'function' ? a({ mins, size }) : a}</div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
