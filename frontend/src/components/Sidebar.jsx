import { useRef, useState } from 'react';
import { api, hasRole } from '../api';
import IngestProgress from './IngestProgress';

const fmtBytes = (n) => (n === 0 ? '0 KB' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const ACCEPT = '.pdf,.docx,.pptx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp';

export default function Sidebar({ org, docs, stats, selected, onToggle, onChanged, onRemoved, onPreview, onToast, open, hidden = false, onClose, onHide }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState([]);
  const nextId = useRef(1);
  const [url, setUrl] = useState('');
  const canWrite = hasRole(org.role, 'member');

  const patchJob = (id, patch) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  const dropJobsLater = (ids, ms) => setTimeout(() => setJobs((js) => js.filter((j) => !ids.includes(j.id))), ms);

  // Files go one at a time: each gets real upload progress, and each appears in the library the moment it
  // is ready instead of the whole batch waiting on the slowest file.
  async function upload(files) {
    if (!files.length) return;
    setBusy(true);
    const batch = files.map((f) => ({ id: nextId.current++, name: f.name, size: f.size, kind: 'file', phase: 'queued', pct: 0 }));
    setJobs((js) => [...js, ...batch]);
    let added = 0;
    const failures = [];
    for (let i = 0; i < files.length; i += 1) {
      const id = batch[i].id;
      patchJob(id, { phase: 'uploading' });
      try {
        const res = await api.uploadFile(org.id, files[i], {
          onProgress: (p) => patchJob(id, { pct: p }),
          onSent: () => patchJob(id, { phase: 'processing', pct: 1 }),
        });
        if (res.errors?.length) throw new Error(res.errors.map((e) => e.error).join('; '));
        added += res.documents.length;
        patchJob(id, { phase: 'done', chunks: res.documents[0]?.chunk_count ?? 0 });
        onChanged();
      } catch (e) {
        failures.push(`${files[i].name}: ${e.message}`);
        patchJob(id, { phase: 'error', error: e.message });
      }
    }
    if (failures.length) onToast(failures.join('\n'), 'error');
    else onToast(`Added ${added} document${added === 1 ? '' : 's'}.`);
    dropJobsLater(batch.map((b) => b.id), failures.length ? 8000 : 3500);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function addUrl(e) {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    const id = nextId.current++;
    setJobs((js) => [...js, { id, name: url.trim(), size: 0, kind: 'url', phase: 'processing', pct: 1 }]);
    try {
      const doc = await api.ingestUrl(org.id, url.trim());
      setUrl('');
      patchJob(id, { phase: 'done', chunks: doc.chunk_count });
      onToast('Page added to your library.');
      onChanged();
    } catch (err) {
      patchJob(id, { phase: 'error', error: err.message });
      onToast(err.message, 'error');
    } finally {
      dropJobsLater([id], 3500);
      setBusy(false);
    }
  }

  async function remove(doc) {
    if (!window.confirm(`Remove "${doc.name}" from the library?`)) return;
    try {
      await api.deleteDocument(org.id, doc.id);
      onRemoved?.([doc.id]); // disappear from the list at once; the refetch below only refreshes the totals
      onToast(`Removed "${doc.name}".`);
    } catch (e) {
      onToast(e.message, 'error');
    } finally {
      onChanged();
    }
  }

  const pct = stats ? Math.min(100, Math.round((stats.storage_bytes / stats.storage_limit_bytes) * 100)) : 0;

  return (
    <>
      {open && <div className="responsive-backdrop" onClick={onClose} />}
      <aside className={`sidebar-wrapper glass-panel side-panel ${open ? 'open' : ''} ${hidden ? 'is-hidden' : ''}`} aria-hidden={hidden || undefined}>
        <div className="side-head">
          <h2>Library <span className="muted small">· {docs.length}</span></h2>
          <button className="icon-btn lib-hide-btn" onClick={onHide} aria-label="Hide library" title="Hide library">«</button>
          <button className="mobile-sidebar-close-btn" onClick={onClose} aria-label="Close sidebar">✕</button>
        </div>

        {canWrite ? (
          <div className="side-actions">
            <input ref={fileRef} type="file" multiple accept={ACCEPT} hidden onChange={(e) => upload([...e.target.files])} />
            <button className="btn btn-primary" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? 'Adding to your library…' : 'Upload files'}
            </button>
            <form onSubmit={addUrl} className="url-form">
              <input type="url" placeholder="https://… add a web page" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={2000} />
              <button className="btn btn-ghost" disabled={busy || !url.trim()}>Add</button>
            </form>
            <IngestProgress jobs={jobs} />
          </div>
        ) : (
          <p className="muted small pad">Viewers can search and chat but not change the library.</p>
        )}

        <div className="doc-list">
          {docs.length === 0 && <p className="muted small pad">No documents yet. Upload PDFs (scanned ones too), Word, PowerPoint, text, images or add a web page.</p>}
          {docs.map((d) => (
            <div key={d.id} className={`doc-card-item ${selected.has(d.id) ? 'selected' : ''}`}>
              <label className="doc-check" title="Restrict answers to the ticked documents">
                <input type="checkbox" checked={selected.has(d.id)} onChange={() => onToggle(d.id)} />
              </label>
              <button className="doc-main" onClick={() => onPreview(d)} title="Preview chunks">
                <span className="doc-name">{d.name}</span>
                <span className="muted small">
                  {d.kind.toUpperCase()} · {fmtBytes(d.size_bytes)} · {d.chunk_count} chunks
                  {d.suspicious_chunks > 0 && <span className="warn" title="Contains text that looks like instructions to an AI"> ⚠ {d.suspicious_chunks} flagged</span>}
                </span>
              </button>
              {canWrite && <button className="icon-btn" onClick={() => remove(d)} aria-label={`Delete ${d.name}`}>🗑</button>}
            </div>
          ))}
        </div>

        {stats && (
          <div className="side-foot muted small">
            <div className="bar"><div style={{ width: `${pct}%` }} /></div>
            {fmtBytes(stats.storage_bytes)} of {fmtBytes(stats.storage_limit_bytes)} used · {stats.queries_today}/{stats.query_quota} questions today
            {selected.size > 0 && <div>Answering only from {selected.size} selected document{selected.size === 1 ? '' : 's'}.</div>}
          </div>
        )}
      </aside>
    </>
  );
}
