import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { formatStructuredMessage } from './MathRenderer';

const FLAG_NOTES = {
  suspicious_document_content: 'Some retrieved text looked like instructions to an AI and was treated as plain data.',
  secret_in_input: 'A credential-like string in your message was removed before it was sent.',
  pii_redacted: 'Personal data in your message was redacted (organisation policy).',
  secret_in_output: 'A credential-like string was removed from the answer.',
  system_prompt_leak: 'The answer was withheld because it tried to reveal internal instructions.',
  truncated: 'The answer was shortened to the maximum length.',
};

export default function ChatPanel({ org, docCount, docNames = [], selectedIds, onMenu, libHidden = false, onToggleLibrary, onChanged }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const feedRef = useRef(null);
  const abortRef = useRef(null);

  // Conversations are per organisation: switching orgs must never carry context across tenants.
  useEffect(() => { setMessages([]); abortRef.current?.abort(); }, [org.id]);
  useEffect(() => { feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, busy]);

  async function send(e) {
    e?.preventDefault();
    const query = input.trim();
    if (!query || busy) return;
    const history = messages.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content })).slice(-12);
    setMessages((m) => [...m, { role: 'user', content: query }]);
    setInput('');
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await api.chat(org.id, { query, history, document_ids: selectedIds.length ? selectedIds : null }, ctrl.signal);
      setMessages((m) => [...m, { role: 'assistant', content: res.answer, sources: res.sources, flags: res.flags, model: res.model }]);
      onChanged?.();
    } catch (err) {
      if (err.name !== 'AbortError') setMessages((m) => [...m, { role: 'assistant', content: err.message, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="chat-main">
      <header className="chat-head">
        <button className="mobile-hamburger-btn" onClick={onMenu} aria-label="Open library">☰</button>
        {libHidden && (
          <button className="btn btn-ghost lib-show-btn" onClick={onToggleLibrary} aria-label="Show library" title="Show library">
            » Library
          </button>
        )}
        <div className="chat-title">
          <span className="pulse-dot" /><strong>{org.name}</strong>
          <span className="muted small"> · {docCount} document{docCount === 1 ? '' : 's'}{selectedIds.length ? ` · ${selectedIds.length} selected` : ''}</span>
        </div>
        {messages.length > 0 && <button className="btn btn-ghost" onClick={() => setMessages([])}>Clear chat</button>}
      </header>

      <div className="chat-feed responsive-feed" ref={feedRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="welcome animate-fade-in">
            <div className="welcome-icon animate-float">
              <svg width="84" height="84" viewBox="0 0 100 100" fill="none" aria-hidden="true">
                <defs>
                  <linearGradient id="welcome-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#9d4edd" />
                    <stop offset="100%" stopColor="#00f5d4" />
                  </linearGradient>
                  <radialGradient id="welcome-glow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#00f5d4" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#9d4edd" stopOpacity="0" />
                  </radialGradient>
                </defs>
                <circle cx="50" cy="50" r="40" fill="url(#welcome-glow)" />
                <circle cx="50" cy="50" r="42" stroke="url(#welcome-grad)" strokeWidth="3" strokeDasharray="10 15 30 15" />
                <circle cx="50" cy="50" r="26" stroke="url(#welcome-grad)" strokeWidth="2.5" strokeDasharray="4 4" />
                <line x1="50" y1="50" x2="28" y2="35" stroke="#9d4edd" strokeWidth="1.5" strokeOpacity="0.75" />
                <line x1="50" y1="50" x2="72" y2="35" stroke="#9d4edd" strokeWidth="1.5" strokeOpacity="0.75" />
                <line x1="50" y1="50" x2="35" y2="70" stroke="#00f5d4" strokeWidth="1.5" strokeOpacity="0.75" />
                <line x1="50" y1="50" x2="65" y2="70" stroke="#00f5d4" strokeWidth="1.5" strokeOpacity="0.75" />
                <line x1="28" y1="35" x2="72" y2="35" stroke="#9d4edd" strokeWidth="1" strokeOpacity="0.45" strokeDasharray="3 3" />
                <line x1="35" y1="70" x2="65" y2="70" stroke="#00f5d4" strokeWidth="1" strokeOpacity="0.45" strokeDasharray="3 3" />
                <circle cx="50" cy="50" r="8" fill="#00f5d4" />
                <circle cx="28" cy="35" r="4" fill="#9d4edd" />
                <circle cx="72" cy="35" r="4" fill="#9d4edd" />
                <circle cx="35" cy="70" r="4" fill="#00f5d4" />
                <circle cx="65" cy="70" r="4" fill="#00f5d4" />
              </svg>
            </div>
            <h2 className="responsive-welcome-title">Unveil Document <span>Insights</span></h2>
            <p className="muted">
              NeuroLens maps your organisation’s documents with hybrid semantic + keyword search and answers only from what it finds, citing every source.
            </p>
            <div className="welcome-card animate-pulse-glow">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <div>
                <strong>{docCount === 0 ? 'To get started:' : 'Ready when you are:'}</strong>
                <p>
                  {docCount === 0
                    ? 'Upload files (PDF, Word, PowerPoint, text, images – scanned pages too) or add a web page from the library, then ask questions here.'
                    : 'Ask anything about your library. Tick documents in the library to limit answers to just those.'}
                </p>
                <div className="welcome-chips">
                  <span className="chip">Cited answers</span>
                  <span className="chip">Per-organisation privacy</span>
                </div>
              </div>
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`bubble responsive-bubble ${m.role} ${m.error ? 'error' : ''}`}>
            {m.role === 'assistant' && !m.error ? formatStructuredMessage(m.content) : <p className="plain">{m.content}</p>}
            {m.flags?.some((f) => FLAG_NOTES[f]) && (
              <div className="notes">{m.flags.filter((f) => FLAG_NOTES[f]).map((f) => <div key={f}>ⓘ {FLAG_NOTES[f]}</div>)}</div>
            )}
            {m.sources?.length > 0 && (
              <details className="sources">
                <summary>{m.sources.length} source{m.sources.length === 1 ? '' : 's'}</summary>
                {m.sources.map((s) => (
                  <div key={s.id} className="source">
                    <strong>{s.id}. {s.document}{s.page ? ` · p.${s.page}` : ''}</strong>
                    {!docNames.includes(s.document) && <span className="badge-removed" title="This document was deleted from the library after this answer was written">removed</span>}
                    <p className="plain muted small">{s.snippet}</p>
                  </div>
                ))}
              </details>
            )}
          </div>
        ))}
        {busy && <div className="bubble assistant typing" aria-label="Thinking">Thinking…</div>}
      </div>

      <form className="chat-form responsive-form" onSubmit={send}>
        <textarea
          className="responsive-input"
          rows={1}
          placeholder="Ask a question about your documents…"
          value={input}
          maxLength={8000}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }}
        />
        <button className="btn btn-primary" disabled={busy || !input.trim()}>Send</button>
      </form>
    </main>
  );
}
