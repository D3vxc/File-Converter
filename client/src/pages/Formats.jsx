import { CATEGORIES } from '../lib/formats.js';
import { useFormats } from '../lib/FormatsContext.jsx';

export default function Formats() {
  const { formats, conversions } = useFormats();
  const byCat = {};
  for (const [ext, f] of Object.entries(formats || {})) if (conversions?.[ext]) (byCat[f.cat] ??= []).push(f.label);
  return (
    <div className="container" style={{ paddingBottom: 72 }}>
      <div className="page-head"><h1>Supported formats</h1><p>Every format you can convert from on this server.</p></div>
      <div className="formats-cloud">
        {Object.entries(byCat).map(([cat, labels]) => {
          const { icon: Icon, label, color } = CATEGORIES[cat] || CATEGORIES.other;
          return (
            <div className="formats-row" key={cat}>
              <h4 style={{ color }}><Icon size={16} /> {label}</h4>
              <div className="chips">{labels.map((l) => <span key={l}>{l}</span>)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
