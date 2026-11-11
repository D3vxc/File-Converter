import { motion } from 'framer-motion';
import { Coffee } from 'lucide-react';
import { useFormats } from '../lib/FormatsContext.jsx';

/** Donation link (Ko-fi or Buy Me a Coffee). Renders nothing until one is configured on the server. */
export function useSupportUrl() {
  const { support } = useFormats();
  return support?.kofi || support?.buyMeACoffee || null;
}

export function SupportButton({ compact }) {
  const url = useSupportUrl();
  if (!url) return null;
  return (
    <a className={`support-btn ${compact ? 'compact' : ''}`} href={url} target="_blank" rel="noopener noreferrer" aria-label="Support this free tool">
      <Coffee size={16} />
      <span>Support</span>
    </a>
  );
}

/** Gentle thank-you shown after a successful conversion. */
export function SupportNudge() {
  const url = useSupportUrl();
  if (!url) return null;
  return (
    <motion.div className="support-nudge" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
      <Coffee size={18} />
      <span>
        <b style={{ color: 'var(--ink)' }}>Glad that worked!</b> Morph is free, ad-free and run by one person. If it saved you some time,
        a coffee helps keep the servers running.
      </span>
      <a className="btn btn-sm btn-ghost" href={url} target="_blank" rel="noopener noreferrer">Buy me a coffee</a>
    </motion.div>
  );
}
