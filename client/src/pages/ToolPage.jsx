import { LoaderCircle } from 'lucide-react';
import { Suspense, lazy } from 'react';
import { Link, useParams } from 'react-router-dom';
import Converter from '../components/Converter.jsx';
import { CATEGORIES } from '../lib/formats.js';
import { toolBySlug } from '../lib/tools.js';
import NotFound from './NotFound.jsx';

// The PDF editor pulls in pdf.js, so it is only loaded on its own page.
const PdfEditor = lazy(() => import('../components/PdfEditor.jsx'));
const EDITORS = { 'edit-pdf': PdfEditor };

export default function ToolPage() {
  const { slug } = useParams();
  const tool = toolBySlug(slug);
  if (!tool) return <NotFound />;
  const Icon = tool.icon;
  return (
    <div className="container" style={{ maxWidth: tool.kind === 'editor' ? 1000 : 900 }}>
      <div className="page-head" style={{ '--cat': CATEGORIES[tool.cat].color }}>
        <div className="ico"><Icon size={28} /></div>
        <h1>{tool.title}</h1>
        <p>{tool.blurb}</p>
      </div>
      {tool.kind === 'editor' ? (
        <EditorFor key={slug} tool={tool} />
      ) : (
        <Converter key={slug} tool={tool} />
      )}
      <p className="hint" style={{ marginTop: 24 }}><Link to="/tools">See all tools</Link></p>
    </div>
  );
}

function EditorFor({ tool }) {
  const Editor = EDITORS[tool.slug];
  return (
    <Suspense fallback={<div className="panel result-hero"><LoaderCircle size={36} className="spin" style={{ color: 'var(--accent)' }} /></div>}>
      <Editor tool={tool} />
    </Suspense>
  );
}
