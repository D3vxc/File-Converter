import { Moon, Sun } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { SupportButton } from './Support.jsx';

function currentTheme() {
  const t = document.documentElement.dataset.theme;
  if (t) return t;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function Logo({ size = 32 }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6d5dfc" />
          <stop offset="1" stopColor="#ff7a59" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill="url(#lg)" />
      <path d="M20 40c0-9 6-16 14-16h6" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
      <path d="M36 18l7 6-7 6" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="21" cy="44" r="4" fill="#fff" />
    </svg>
  );
}

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [theme, setTheme] = useState(currentTheme);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* private mode */
    }
    setTheme(next);
  };

  return (
    <header className={`nav ${scrolled ? 'scrolled' : ''}`}>
      <div className="container nav-inner">
        <Link to="/" className="brand" aria-label="Morph home">
          <Logo />
          Morph
        </Link>
        <nav className="nav-links">
          <NavLink to="/" end>Convert</NavLink>
          <NavLink to="/tools">Tools</NavLink>
          <NavLink to="/formats" className="hide-sm">Formats</NavLink>
          <NavLink to="/privacy" className="hide-sm">Privacy</NavLink>
        </nav>
        <SupportButton />
        <button className="icon-btn" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={theme}
              initial={{ rotate: -90, opacity: 0, scale: 0.6 }}
              animate={{ rotate: 0, opacity: 1, scale: 1 }}
              exit={{ rotate: 90, opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.25 }}
              style={{ display: 'grid' }}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </motion.span>
          </AnimatePresence>
        </button>
      </div>
    </header>
  );
}
