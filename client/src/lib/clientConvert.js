// Simple image conversions run right in the browser: instant for the user,
// zero load on the server, and the file never leaves the device.

const INPUTS = new Set(['jpg', 'png', 'webp', 'bmp']);
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

let webpOk;
function canEncodeWebp() {
  if (webpOk === undefined) {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      webpOk = c.toDataURL('image/webp').startsWith('data:image/webp');
    } catch {
      webpOk = false;
    }
  }
  return webpOk;
}

export function canConvertLocally(from, to, options = {}) {
  if (typeof createImageBitmap !== 'function') return false;
  if (!INPUTS.has(from) || !MIME[to]) return false;
  if (to === 'webp' && !canEncodeWebp()) return false;
  // The server's PNG encoder (palette, zlib 9) beats canvas for compression jobs.
  if (to === 'png' && (from === 'png' || options.compress)) return false;
  if (options.keepMetadata || options.grayscale || (options.fit && options.fit !== 'inside')) return false;
  return true;
}

export async function convertLocally(file, to, options = {}) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  let w = bmp.width;
  let h = bmp.height;
  const mw = Number(options.width) || 0;
  const mh = Number(options.height) || 0;
  if (mw || mh) {
    const s = Math.min(mw ? mw / w : Infinity, mh ? mh / h : Infinity, options.enlarge ? Infinity : 1);
    w = Math.max(1, Math.round(w * s));
    h = Math.max(1, Math.round(h * s));
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (to === 'jpg') {
    ctx.fillStyle = options.background || '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const q = Math.min(100, Math.max(1, Number(options.quality) || 82)) / 100;
  const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Encoding failed'))), MIME[to], q));
  canvas.width = canvas.height = 0; // free memory
  return blob;
}
