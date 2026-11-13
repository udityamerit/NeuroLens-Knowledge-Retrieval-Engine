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
          <strong>{org.name}</strong>
          <span className="muted small"> · {docCount} document{docCount === 1 ? '' : 's'}{selectedIds.length ? ` · ${selectedIds.length} selected` : ''}</span>
        </div>
        {messages.length > 0 && <button className="btn btn-ghost" onClick={() => setMessages([])}>Clear chat</button>}
      </header>

      <div className="chat-feed responsive-feed" ref={feedRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="welcome">
            <h2 className="responsive-welcome-title">Ask your documents anything</h2>
            <p className="muted">
              {docCount === 0
                ? 'Your library is empty. Upload files or add a web page from the sidebar, then ask questions here.'
                : 'Answers are grounded in your organisation’s library and cite their sources.'}
            </p>
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
