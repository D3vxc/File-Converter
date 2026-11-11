// Set VITE_API_URL when the frontend is hosted separately (e.g. Cloudflare Pages).
export const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '') + '/api';

async function json(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

let formatsPromise;
export function getFormats() {
  formatsPromise ??= fetch(`${API}/formats`)
    .then(json)
    .catch((e) => {
      formatsPromise = undefined;
      throw e;
    });
  return formatsPromise;
}

/**
 * Upload with progress. Resolves with the created job.
 * Returns { promise, abort }.
 */
export function uploadJob(endpoint, files, fields, onProgress) {
  const xhr = new XMLHttpRequest();
  const promise = new Promise((resolve, reject) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields || {})) {
      if (v !== undefined) form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
    for (const f of [].concat(files)) form.append('file', f, f.name);
    xhr.open('POST', `${API}${endpoint}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let body = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else {
        const err = new Error(body.error || `Upload failed (${xhr.status})`);
        err.retryAfter = Number(xhr.getResponseHeader('Retry-After')) || 0;
        err.status = xhr.status;
        reject(err);
      }
    };
    xhr.onerror = () => reject(new Error('Network error — check your connection'));
    xhr.onabort = () => reject(Object.assign(new Error('Cancelled'), { cancelled: true }));
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

export async function pollJobs(ids) {
  return json(await fetch(`${API}/jobs?ids=${ids.join(',')}`, { cache: 'no-store' }));
}

export function deleteJob(id) {
  return fetch(`${API}/jobs/${id}`, { method: 'DELETE', keepalive: true }).catch(() => {});
}

export const downloadUrl = (id) => `${API}/jobs/${id}/download`;
export const zipUrl = (ids) => `${API}/download-zip?ids=${ids.join(',')}`;
