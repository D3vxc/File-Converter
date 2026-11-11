const num = (v) => (v === '' || v === undefined || v === null ? '' : v);

function Field({ label, value, children }) {
  return (
    <label className="field">
      <span>
        {label} {value !== undefined && <b>{value}</b>}
      </span>
      {children}
    </label>
  );
}

function Seg({ value, options, onChange }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map(([v, l]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

function NumberInput({ value, onChange, placeholder, step, min = 0 }) {
  return (
    <input
      className="input"
      type="number"
      inputMode="decimal"
      min={min}
      step={step}
      placeholder={placeholder}
      value={num(value)}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
    />
  );
}

function Trim({ o, set }) {
  return (
    <>
      <Field label="Start (seconds)">
        <NumberInput value={o.trimStart} step={0.1} placeholder="0" onChange={(v) => set({ trimStart: v })} />
      </Field>
      <Field label="End (seconds)">
        <NumberInput value={o.trimEnd} step={0.1} placeholder="Full length" onChange={(v) => set({ trimEnd: v })} />
      </Field>
    </>
  );
}

/** Which options make sense for a conversion. */
export function panelFor(from, to, formats) {
  const fc = formats?.[from]?.cat;
  const tc = formats?.[to]?.cat;
  if ((from === 'pdf' || fc === 'document' || ['xlsx', 'xls', 'ods'].includes(from)) && (to === 'jpg' || to === 'png')) return 'pdfRaster';
  if (fc === 'image' && to === 'pdf') return 'imagesToPdf';
  if (fc === 'video' && to === 'gif') return 'gif';
  if (fc === 'image' && tc === 'image' && to !== 'ico') return 'image';
  if ((fc === 'video' || from === 'gif') && tc === 'video') return 'video';
  if (tc === 'audio') return 'audio';
  return null;
}

export default function OptionsPanel({ panel, options: o = {}, onChange: set, to }) {
  if (!panel) return null;
  return (
    <div className="options">
      {panel === 'image' && (
        <>
          {to !== 'gif' && to !== 'tiff' && (
            <Field label="Quality" value={`${o.quality ?? 82}%`}>
              <input type="range" min={10} max={100} value={o.quality ?? 82} onChange={(e) => set({ quality: Number(e.target.value) })} />
            </Field>
          )}
          <Field label="Width (px)">
            <NumberInput value={o.width} placeholder="Auto" onChange={(v) => set({ width: v })} />
          </Field>
          <Field label="Height (px)">
            <NumberInput value={o.height} placeholder="Auto" onChange={(v) => set({ height: v })} />
          </Field>
          {(o.width || o.height) && (
            <Field label="Fit">
              <select className="select" value={o.fit || 'inside'} onChange={(e) => set({ fit: e.target.value })}>
                <option value="inside">Keep aspect ratio</option>
                <option value="cover">Crop to fill</option>
                <option value="contain">Letterbox</option>
                <option value="fill">Stretch</option>
              </select>
            </Field>
          )}
          <div className="field" style={{ alignContent: 'end', gap: 10 }}>
            <label className="check">
              <input type="checkbox" checked={!!o.grayscale} onChange={(e) => set({ grayscale: e.target.checked })} /> Black &amp; white
            </label>
            <label className="check">
              <input type="checkbox" checked={!!o.keepMetadata} onChange={(e) => set({ keepMetadata: e.target.checked })} /> Keep EXIF / location data
            </label>
          </div>
        </>
      )}

      {panel === 'video' && (
        <>
          <Field label="Quality">
            <Seg value={o.quality || 'medium'} onChange={(v) => set({ quality: v })} options={[['high', 'High'], ['medium', 'Balanced'], ['low', 'Small'], ['tiny', 'Tiny']]} />
          </Field>
          <Field label="Resolution">
            <select className="select" value={o.resolution || ''} onChange={(e) => set({ resolution: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">Original</option>
              <option value="2160">4K (2160p)</option>
              <option value="1080">Full HD (1080p)</option>
              <option value="720">HD (720p)</option>
              <option value="480">SD (480p)</option>
              <option value="360">360p</option>
            </select>
          </Field>
          <Field label="Frame rate">
            <select className="select" value={o.fps || ''} onChange={(e) => set({ fps: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">Original</option>
              {[60, 30, 25, 24, 15].map((f) => <option key={f} value={f}>{f} fps</option>)}
            </select>
          </Field>
          <Trim o={o} set={set} />
          <div className="field" style={{ alignContent: 'end' }}>
            <label className="check">
              <input type="checkbox" checked={!!o.mute} onChange={(e) => set({ mute: e.target.checked })} /> Remove audio
            </label>
          </div>
        </>
      )}

      {panel === 'gif' && (
        <>
          <Field label="Frame rate" value={`${o.fps || 12} fps`}>
            <input type="range" min={5} max={30} value={o.fps || 12} onChange={(e) => set({ fps: Number(e.target.value) })} />
          </Field>
          <Field label="Width" value={`${o.gifWidth || 480}px`}>
            <input type="range" min={160} max={960} step={20} value={o.gifWidth || 480} onChange={(e) => set({ gifWidth: Number(e.target.value) })} />
          </Field>
          <Trim o={o} set={set} />
        </>
      )}

      {(panel === 'audio' || panel === 'trim') && (
        <>
          {panel === 'audio' && to !== 'wav' && to !== 'flac' && to !== 'aiff' && (
            <Field label="Bitrate">
              <select className="select" value={o.audioBitrate || 192} onChange={(e) => set({ audioBitrate: Number(e.target.value) })}>
                {[64, 96, 128, 160, 192, 256, 320].map((b) => <option key={b} value={b}>{b} kbps</option>)}
              </select>
            </Field>
          )}
          {panel === 'audio' && (
            <>
              <Field label="Channels">
                <Seg value={o.channels || ''} onChange={(v) => set({ channels: v || undefined })} options={[['', 'Original'], ['stereo', 'Stereo'], ['mono', 'Mono']]} />
              </Field>
              <Field label="Volume" value={`${o.volume ?? 100}%`}>
                <input type="range" min={10} max={300} step={5} value={o.volume ?? 100} onChange={(e) => set({ volume: Number(e.target.value) })} />
              </Field>
            </>
          )}
          <Trim o={o} set={set} />
        </>
      )}

      {panel === 'pdfRaster' && (
        <Field label="Resolution" value={`${o.dpi || 150} DPI`}>
          <input type="range" min={72} max={300} step={6} value={o.dpi || 150} onChange={(e) => set({ dpi: Number(e.target.value) })} />
        </Field>
      )}

      {panel === 'imagesToPdf' && (
        <Field label="Page size">
          <Seg value={o.pageSize || 'fit'} onChange={(v) => set({ pageSize: v })} options={[['fit', 'Fit image'], ['a4', 'A4'], ['letter', 'Letter']]} />
        </Field>
      )}

      {panel === 'split' && (
        <Field label="Pages to extract">
          <input className="input" placeholder="e.g. 1-3, 5, 8-  (empty = every page)" value={o.ranges || ''} onChange={(e) => set({ ranges: e.target.value })} />
        </Field>
      )}

      {panel === 'compressPdf' && (
        <Field label="Compression">
          <Seg value={o.level || 'ebook'} onChange={(v) => set({ level: v })} options={[['printer', 'Light'], ['ebook', 'Recommended'], ['screen', 'Strong']]} />
        </Field>
      )}
    </div>
  );
}
