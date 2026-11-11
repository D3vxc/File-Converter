import { Heart } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Logo } from './Nav.jsx';
import { useSupportUrl } from './Support.jsx';

export default function Footer() {
  const support = useSupportUrl();
  return (
    <footer>
      <div className="container row">
        <Link to="/" className="brand" style={{ fontSize: 17 }}>
          <Logo size={26} />
          Morph
        </Link>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <Link to="/tools">Tools</Link>
          <Link to="/formats">Formats</Link>
          <Link to="/privacy">Privacy</Link>
          {support && <a href={support} target="_blank" rel="noopener noreferrer">Support the project</a>}
          <a href="https://github.com/D3vxc/File-Converter" target="_blank" rel="noreferrer">Source code</a>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          Free forever · no ads · no sign-up <Heart size={14} fill="currentColor" style={{ color: 'var(--accent-2)' }} />
        </div>
      </div>
    </footer>
  );
}
