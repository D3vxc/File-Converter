import ToolCard from '../components/ToolCard.jsx';
import { useFormats } from '../lib/FormatsContext.jsx';
import { TOOLS } from '../lib/tools.js';

export default function ToolsIndex() {
  const { capabilities } = useFormats();
  return (
    <div className="container" style={{ paddingBottom: 72 }}>
      <div className="page-head"><h1>All tools</h1><p>Everything you need for your files, free.</p></div>
      <div className="tools-grid">
        {TOOLS.map((t, i) => <ToolCard key={t.slug} tool={t} index={i} disabled={t.needs && capabilities && capabilities[t.needs] === false} />)}
      </div>
    </div>
  );
}
