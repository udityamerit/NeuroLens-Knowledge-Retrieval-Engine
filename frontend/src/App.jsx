import { useCallback, useEffect, useRef, useState } from 'react';
import Logo from './components/Logo';
import AuthorModal from './components/AuthorModal';
import Sidebar from './components/Sidebar';
import ChatPanel from './components/ChatPanel';
import OrgSettings from './components/OrgSettings';
import AuthPage from './pages/AuthPage';
import { api, refreshSession, setAuthLostHandler, hasRole } from './api';
import './App.css';

const INVITE_KEY = 'nl_pending_invite';
const ORG_KEY = 'nl_last_org';
const LIB_HIDDEN_KEY = 'nl_library_hidden';

/** Read one-time values the SSO/invite flows leave in the URL, then scrub them from the address bar. */
function consumeUrlParams() {
  const p = new URLSearchParams(window.location.search);
  const out = { error: p.get('sso_error'), invite: p.get('invite') };
  if (out.invite) sessionStorage.setItem(INVITE_KEY, out.invite);
  if (p.has('sso') || p.has('sso_error') || p.has('invite')) window.history.replaceState({}, '', window.location.pathname);
  return out;
}

// Runs once at module load (not in render/effects) so StrictMode double-invocation cannot lose the values.
const URL_PARAMS = consumeUrlParams();

function Toast({ toast, onDone }) {
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(onDone, toast.kind === 'error' ? 7000 : 3500);
    return () => clearTimeout(t);
  }, [toast, onDone]);
  if (!toast) return null;
  return <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>;
}

export default function App() {
  const [phase, setPhase] = useState('loading'); // loading | anon | authed
  const [session, setSession] = useState(null); // { user, orgs }
  const [orgId, setOrgId] = useState(null);
  const [lib, setLib] = useState({ orgId: null, docs: [], stats: null });
  const [selected, setSelected] = useState(new Set());
  const [toast, setToast] = useState(null);
  const [notice, setNotice] = useState(URL_PARAMS.error ? { error: URL_PARAMS.error } : null);
  const [inviteToken, setInviteToken] = useState(() => URL_PARAMS.invite || sessionStorage.getItem(INVITE_KEY));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [libHidden, setLibHidden] = useState(() => localStorage.getItem(LIB_HIDDEN_KEY) === '1');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [authorOpen, setAuthorOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const booted = useRef(false);

  const showToast = useCallback((text, kind = 'info') => setToast({ text, kind, at: Date.now() }), []);
  const clearToast = useCallback(() => setToast(null), []);

  const applySession = useCallback((data) => {
    setSession({ user: data.user, orgs: data.orgs });
    setPhase('authed');
    setOrgId((cur) => {
      const wanted = cur || localStorage.getItem(ORG_KEY);
      return data.orgs.find((o) => o.id === wanted)?.id || data.orgs[0]?.id || null;
    });
  }, []);

  const goAnon = useCallback((info) => {
    setSession(null); setOrgId(null); setLib({ orgId: null, docs: [], stats: null }); setSelected(new Set());
    setSettingsOpen(false); setPhase('anon');
    if (info) setNotice({ info });
  }, []);

  // Bootstrap once: pick up SSO/invite params, then try to resume via the refresh cookie.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    setAuthLostHandler(() => goAnon('Your session has expired. Please sign in again.'));
    refreshSession().then(applySession).catch(() => setPhase('anon'));
  }, [applySession, goAnon]);

  // Accept a pending invitation as soon as we are signed in.
  useEffect(() => {
    if (phase !== 'authed' || !inviteToken) return;
    api.acceptInvite(inviteToken)
      .then(async (org) => {
        showToast(`You joined ${org.name}.`);
        applySession(await api.me());
        setOrgId(org.id);
      })
      .catch((e) => showToast(e.message, 'error'))
      .finally(() => { sessionStorage.removeItem(INVITE_KEY); setInviteToken(null); });
  }, [phase, inviteToken, applySession, showToast]);

  const org = session?.orgs.find((o) => o.id === orgId) || null;
  const fresh = lib.orgId === orgId;
  const docs = fresh ? lib.docs : [];
  const stats = fresh ? lib.stats : null;

  const loadLibrary = useCallback(async (id) => {
    try {
      const [d, s] = await Promise.all([api.documents(id), api.stats(id)]);
      setLib({ orgId: id, docs: d, stats: s });
    } catch (e) {
      showToast(e.message, 'error');
    }
  }, [showToast]);

  useEffect(() => {
    if (!orgId) return;
    localStorage.setItem(ORG_KEY, orgId);
    let live = true;
    Promise.all([api.documents(orgId), api.stats(orgId)])
      .then(([d, st]) => { if (live) setLib({ orgId, docs: d, stats: st }); })
      .catch((e) => { if (live) showToast(e.message, 'error'); });
    return () => { live = false; };
  }, [orgId, showToast]);

  // Desktop: show/hide the library column (remembered). Phones use the slide-in drawer instead.
  const toggleLibrary = () => setLibHidden((h) => {
    localStorage.setItem(LIB_HIDDEN_KEY, h ? '0' : '1');
    return !h;
  });

  async function logout() {
    try { await api.logout(); } catch { /* cookie may already be gone */ }
    goAnon();
  }

  async function createOrg() {
    const name = window.prompt('Name for the new organisation:');
    if (!name || name.trim().length < 2) return;
    try {
      const created = await api.createOrg(name.trim());
      applySession(await api.me());
      setOrgId(created.id);
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function refreshAccount(nextOrgId) {
    const data = await api.me();
    applySession(data);
    if (nextOrgId !== undefined) setOrgId(data.orgs.find((o) => o.id === nextOrgId)?.id || data.orgs[0]?.id || null);
  }

  if (phase === 'loading') return <div className="boot"><Logo size={56} className="animate-pulse-glow" /></div>;
  if (phase === 'anon') {
    return (
      <AuthPage
        notice={notice}
        inviteToken={inviteToken}
        onAuthed={(data) => { setNotice(null); applySession(data); }}
      />
    );
  }

  const selectedIds = [...selected].filter((id) => docs.some((d) => d.id === id));
  const toggleDoc = (id) => setSelected((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="app-shell">
      <header className="topbar glass-panel">
        <div className="brand"><Logo size={28} /></div>
        <div className="topbar-right">
          <select
            className="org-select"
            aria-label="Organisation"
            value={orgId || ''}
            onChange={(e) => (e.target.value === '__new' ? createOrg() : setOrgId(e.target.value))}
          >
            {session.orgs.map((o) => <option key={o.id} value={o.id}>{o.is_personal ? 'Personal' : o.name} · {o.role}</option>)}
            <option value="__new">+ New organisation…</option>
          </select>
          <button className="btn btn-ghost" onClick={() => setSettingsOpen(true)}>Settings</button>
          <button className="btn btn-ghost" onClick={() => setAuthorOpen(true)}>About</button>
          <span className="muted small user-chip" title={session.user.email}>{session.user.name || session.user.email}</span>
          <button className="btn btn-ghost" onClick={logout}>Sign out</button>
        </div>
      </header>

      {org ? (
        <div className="workspace">
          <Sidebar
            org={org}
            docs={docs}
            stats={stats}
            selected={new Set(selectedIds)}
            onToggle={toggleDoc}
            onChanged={() => loadLibrary(org.id)}
            onRemoved={(ids) => setLib((l) => (l.orgId === org.id ? { ...l, docs: l.docs.filter((d) => !ids.includes(d.id)) } : l))}
            onPreview={setPreview}
            onToast={showToast}
            open={sidebarOpen}
            hidden={libHidden}
            onClose={() => setSidebarOpen(false)}
            onHide={toggleLibrary}
          />
          <ChatPanel
            org={org}
            docCount={docs.length}
            docNames={docs.map((d) => d.name)}
            selectedIds={selectedIds}
            onMenu={() => setSidebarOpen(true)}
            libHidden={libHidden}
            onToggleLibrary={toggleLibrary}
            onChanged={() => api.stats(org.id).then((st) => setLib((l) => (l.orgId === org.id ? { ...l, stats: st } : l))).catch(() => {})}
          />
        </div>
      ) : (
        <div className="boot"><p className="muted">You are not a member of any organisation.</p></div>
      )}

      {settingsOpen && org && (
        <OrgSettings
          org={org}
          user={session.user}
          onClose={() => setSettingsOpen(false)}
          onToast={showToast}
          onOrgChanged={refreshAccount}
          onSignedOut={() => goAnon('Your account was deleted.')}
          canAdmin={hasRole(org.role, 'admin')}
        />
      )}
      {preview && org && <DocPreview orgId={org.id} doc={preview} onClose={() => setPreview(null)} />}
      <AuthorModal isOpen={authorOpen} onClose={() => setAuthorOpen(false)} />
      <Toast toast={toast} onDone={clearToast} />
    </div>
  );
}

function DocPreview({ orgId, doc, onClose }) {
  const [chunks, setChunks] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api.chunks(orgId, doc.id).then(setChunks).catch((e) => setErr(e.message));
  }, [orgId, doc.id]);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="glass-panel modal wide animate-slide-up" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={doc.name}>
        <div className="modal-head"><h2>{doc.name}</h2><button className="icon-btn" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="modal-body">
          {err && <p className="error-msg">{err}</p>}
          {!chunks && !err && <p className="muted">Loading…</p>}
          {chunks?.map((c) => (
            <div key={c.ordinal} className={`chunk ${c.suspicious ? 'flagged' : ''}`}>
              <div className="muted small">Chunk {c.ordinal + 1}{c.page ? ` · page ${c.page}` : ''}{c.suspicious ? ' · ⚠ looks like instructions to an AI' : ''}</div>
              <p className="plain">{c.content}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
