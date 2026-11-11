import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteJob, downloadUrl, pollJobs, uploadJob, zipUrl } from './api.js';
import { canConvertLocally, convertLocally } from './clientConvert.js';
import { extOf } from './formats.js';

const MAX_PARALLEL_UPLOADS = 3;
let seq = 0;

/**
 * Item lifecycle: idle → waiting → uploading → queued → processing → done | error
 * mode: 'convert' | 'each' | 'batch'
 */
export function useConverter({ mode = 'convert', toolSlug, onAdd } = {}) {
  const [items, setItems] = useState([]);
  const [batch, setBatch] = useState(null); // for mode 'batch': single job state
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const uploads = useRef(new Map()); // itemId -> abort()
  const blobUrls = useRef(new Set());

  const patch = useCallback((id, p) => {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...(typeof p === 'function' ? p(it) : p) } : it)));
  }, []);

  const addFiles = useCallback(
    (fileList) => {
      const added = [...fileList].map((file) => {
        const ext = extOf(file.name);
        return { id: `f${++seq}`, file, name: file.name, size: file.size, ext, target: '', options: {}, status: 'idle', progress: 0 };
      });
      const prepared = onAdd ? added.map(onAdd) : added;
      setItems((list) => [...list, ...prepared]);
      return prepared;
    },
    [onAdd],
  );

  const remove = useCallback((id) => {
    const it = itemsRef.current.find((i) => i.id === id);
    uploads.current.get(id)?.();
    if (it?.jobId) deleteJob(it.jobId);
    if (it?.result?.local) URL.revokeObjectURL(it.result.url);
    setItems((list) => list.filter((i) => i.id !== id));
  }, []);

  const clear = useCallback(() => {
    for (const it of itemsRef.current) {
      uploads.current.get(it.id)?.();
      if (it.jobId) deleteJob(it.jobId);
      if (it.result?.local) URL.revokeObjectURL(it.result.url);
    }
    if (batch?.jobId) deleteJob(batch.jobId);
    setItems([]);
    setBatch(null);
  }, [batch]);

  const reorder = useCallback((next) => setItems(next), []);

  // ---------- running ----------
  const pump = useCallback(() => {
    const list = itemsRef.current;
    let active = list.filter((i) => i.status === 'uploading').length;
    for (const it of list) {
      if (active >= MAX_PARALLEL_UPLOADS) break;
      if (it.status !== 'waiting') continue;
      active++;
      start(it);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(
    async (it) => {
      // In-browser fast path.
      if (mode === 'convert' && !it.forceServer && canConvertLocally(it.ext, it.target, it.options)) {
        itemsRef.current = itemsRef.current.map((x) => (x.id === it.id ? { ...x, status: 'processing' } : x));
        patch(it.id, { status: 'processing', progress: 0.5, local: true });
        try {
          const blob = await convertLocally(it.file, it.target, it.options);
          const name = it.name.replace(/\.[^.]+$/, '') + '.' + it.target;
          const url = URL.createObjectURL(blob);
          blobUrls.current.add(url);
          patch(it.id, { status: 'done', progress: 1, result: { name, size: blob.size, url, local: true } });
        } catch {
          // Fall back to the server.
          patch(it.id, { status: 'waiting', local: false, forceServer: true });
          setTimeout(pump, 0);
        }
        return;
      }

      itemsRef.current = itemsRef.current.map((x) => (x.id === it.id ? { ...x, status: 'uploading' } : x));
      patch(it.id, { status: 'uploading', progress: 0, uploadProgress: 0, error: null });
      const endpoint = mode === 'convert' ? '/convert' : `/tools/${toolSlug}`;
      const fields = mode === 'convert' ? { target: it.target, options: it.options } : { options: it.options };
      const { promise, abort } = uploadJob(endpoint, it.file, fields, (p) => patch(it.id, { uploadProgress: p }));
      uploads.current.set(it.id, abort);
      try {
        const job = await promise;
        patch(it.id, { status: job.status, jobId: job.id, position: job.position, progress: 0 });
      } catch (e) {
        if (e.cancelled) return;
        if (e.status === 429 || e.status === 503) {
          // Server is busy: wait and retry automatically.
          patch(it.id, { status: 'waiting', notice: 'Server busy — retrying shortly…' });
          setTimeout(pump, (e.retryAfter || 10) * 1000);
        } else patch(it.id, { status: 'error', error: e.message });
      } finally {
        uploads.current.delete(it.id);
        setTimeout(pump, 0);
      }
    },
    [mode, toolSlug, patch, pump],
  );

  const convert = useCallback(
    (ids) => {
      const want = ids ? new Set(ids) : null;
      const next = itemsRef.current.map((it) =>
        (!want || want.has(it.id)) && ['idle', 'error'].includes(it.status) && (mode !== 'convert' || it.target)
          ? { ...it, status: 'waiting', error: null, notice: null }
          : it,
      );
      itemsRef.current = next;
      setItems(next);
      setTimeout(pump, 0);
    },
    [mode, pump],
  );

  const runBatch = useCallback(
    async (options) => {
      const files = itemsRef.current.map((i) => i.file);
      setBatch({ status: 'uploading', uploadProgress: 0 });
      const { promise } = uploadJob(`/tools/${toolSlug}`, files, { options }, (p) => setBatch((b) => ({ ...b, uploadProgress: p })));
      try {
        const job = await promise;
        setBatch({ status: job.status, jobId: job.id, progress: 0, position: job.position });
      } catch (e) {
        setBatch({ status: 'error', error: e.message });
      }
    },
    [toolSlug],
  );

  // ---------- polling (one request for all active jobs) ----------
  const active = items.filter((i) => i.jobId && (i.status === 'queued' || i.status === 'processing')).map((i) => i.jobId);
  if (batch?.jobId && (batch.status === 'queued' || batch.status === 'processing')) active.push(batch.jobId);
  const activeKey = active.join(',');

  useEffect(() => {
    if (!activeKey) return;
    let stop = false;
    let timer;
    const ids = activeKey.split(',');
    const tick = async () => {
      try {
        const res = await pollJobs(ids);
        if (stop) return;
        setItems((list) =>
          list.map((it) => {
            const j = it.jobId && res[it.jobId];
            if (!j) return it;
            if (j.status === 'missing') return { ...it, status: 'error', error: 'This file expired. Please convert it again.' };
            return {
              ...it,
              status: j.status,
              progress: j.progress,
              position: j.position,
              error: j.error,
              result: j.result ? { ...j.result, url: downloadUrl(j.id) } : it.result,
            };
          }),
        );
        setBatch((b) => {
          const j = b?.jobId && res[b.jobId];
          return j ? { ...b, ...j, result: j.result ? { ...j.result, url: downloadUrl(j.id) } : null } : b;
        });
        const anyQueued = Object.values(res).some((j) => j.status === 'queued');
        timer = setTimeout(tick, anyQueued ? 1500 : 700);
      } catch {
        if (!stop) timer = setTimeout(tick, 3000);
      }
    };
    timer = setTimeout(tick, 400);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [activeKey]);

  // Free object URLs when leaving the page.
  useEffect(() => () => blobUrls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const doneServer = items.filter((i) => i.status === 'done' && i.jobId).map((i) => i.jobId);
  return {
    items,
    batch,
    addFiles,
    remove,
    clear,
    reorder,
    convert,
    runBatch,
    setTarget: (id, target) => patch(id, { target, status: 'idle', result: null, jobId: null }),
    setOptions: (id, options) => patch(id, (it) => ({ options: { ...it.options, ...options }, ...(it.status === 'done' ? { status: 'idle', result: null } : {}) })),
    setAll: useCallback((fn) => setItems((list) => list.map((it) => (it.status === 'idle' || it.status === 'error' ? { ...it, ...fn(it) } : it))), []),
    zipAllUrl: doneServer.length > 1 ? zipUrl(doneServer) : null,
  };
}
