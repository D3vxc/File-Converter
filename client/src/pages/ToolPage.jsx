import { Link, useParams } from 'react-router-dom';
import Converter from '../components/Converter.jsx';
import { CATEGORIES } from '../lib/formats.js';
import { toolBySlug } from '../lib/tools.js';
import NotFound from './NotFound.jsx';

export default function ToolPage() {
  const { slug } = useParams();
  const tool = toolBySlug(slug);
  if (!tool) return <NotFound />;
  const Icon = tool.icon;
  return (
    <div className="container" style={{ maxWidth: 900 }}>
      <div className="page-head" style={{ '--cat': CATEGORIES[tool.cat].color }}>
        <div className="ico"><Icon size={28} /></div>
        <h1>{tool.title}</h1>
        <p>{tool.blurb}</p>
      </div>
      <Converter key={slug} tool={tool} />
      <p className="hint" style={{ marginTop: 24 }}><Link to="/tools">See all tools</Link></p>
    </div>
  );
}
