import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { CATEGORIES } from '../lib/formats.js';

const MotionLink = motion.create(Link);

export default function ToolCard({ tool, index = 0, disabled }) {
  const glow = useRef(null);
  const Icon = tool.icon;
  return (
    <MotionLink
      to={`/tools/${tool.slug}`}
      className={`tool-card ${disabled ? 'disabled' : ''}`}
      style={{ '--cat': CATEGORIES[tool.cat].color }}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.5, delay: (index % 4) * 0.06, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -4 }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        if (glow.current) glow.current.style.cssText = `left:${e.clientX - r.left}px;top:${e.clientY - r.top}px`;
      }}
      aria-disabled={disabled || undefined}
    >
      <span className="glow" ref={glow} />
      <div className="ico">
        <Icon size={22} />
      </div>
      <h3>
        {tool.title} <ArrowRight size={16} />
      </h3>
      <p>{disabled ? 'Not available on this server yet.' : tool.blurb}</p>
    </MotionLink>
  );
}
