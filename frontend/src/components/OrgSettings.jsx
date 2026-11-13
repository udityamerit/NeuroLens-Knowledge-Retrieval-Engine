import { useEffect, useState } from 'react';
import { api, hasRole } from '../api';

const PROVIDERS = ['groq', 'openai', 'openrouter'];
const ROLES = ['viewer', 'member', 'admin', 'owner'];
const fmtDate = (s) => new Date(s).toLocaleString();

function useLoad(fn, key) {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState({ data: null, error: '' });
  useEffect(() => {
    let live = true;
    fn().then((data) => live && setState({ data, error: '' })).catch((e) => live && setState({ data: null, error: e.message }));
    return () => { live = false; };
    // fn is re-created every render; the key (+ explicit reloads) decides when to refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  return [state, () => setTick((t) => t + 1)];
}

function General(props) {
  const [{ data, error }, reload] = useLoad(() => api.getOrg(props.org.id), props.org.id);
  if (error) return <p className="error-msg">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  return <GeneralForm key={data.id} data={data} reload={reload} {...props} />;
}

function GeneralForm({ data, reload, org, canAdmin, onToast, onOrgChanged, onClose }) {
  const [form, setForm] = useState({ ...data, sso_domain: data.sso_domain || '' });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const owner = org.role === 'owner';

  async function save(e) {
    e.preventDefault();
    try {
      const body = {
        name: form.name, llm_provider: form.llm_provider, llm_model: form.llm_model,
        temperature: Number(form.temperature), retrieval_k: Number(form.retrieval_k), redact_pii: form.redact_pii,
      };
      if (owner) { body.sso_domain = form.sso_domain; body.sso_default_role = form.sso_default_role; }
      await api.updateOrg(org.id, body);
      onToast('Settings saved.');
      reload();
      onOrgChanged();
    } catch (err) { onToast(err.message, 'error'); }
  }

  async function del() {
    if (window.prompt(`This permanently deletes "${org.name}", its documents and members.\nType the organisation name to confirm:`) !== org.name) return;
    try { await api.deleteOrg(org.id); onToast('Organisation deleted.'); await onOrgChanged(null); onClose(); } catch (err) { onToast(err.message, 'error'); }
  }

  return (
    <form onSubmit={save} className="form-grid">
      <label>Name<input value={form.name} onChange={(e) => set('name', e.target.value)} disabled={!canAdmin || form.is_personal} minLength={2} maxLength={120} /></label>
      <label>Language-model provider
        <select value={form.llm_provider} onChange={(e) => set('llm_provider', e.target.value)} disabled={!canAdmin}>
          {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <label>Model id<input value={form.llm_model} onChange={(e) => set('llm_model', e.target.value)} disabled={!canAdmin} maxLength={120} /></label>
      <label>Temperature ({Number(form.temperature).toFixed(2)})
        <input type="range" min="0" max="1" step="0.05" value={form.temperature} onChange={(e) => set('temperature', e.target.value)} disabled={!canAdmin} />
      </label>
      <label>Passages retrieved per question
        <input type="number" min="1" max="15" value={form.retrieval_k} onChange={(e) => set('retrieval_k', e.target.value)} disabled={!canAdmin} />
      </label>
      <label className="check"><input type="checkbox" checked={form.redact_pii} onChange={(e) => set('redact_pii', e.target.checked)} disabled={!canAdmin} />
        Redact personal data (emails, phone numbers, card numbers) from questions before they reach the model</label>
      {!form.is_personal && owner && (
        <>
          <label>Single sign-on domain
            <input value={form.sso_domain} onChange={(e) => set('sso_domain', e.target.value)} placeholder="example.com" />
            <span className="muted small">People who sign in through SSO with a verified address on this domain join automatically.</span>
          </label>
          <label>Role for auto-joined people
            <select value={form.sso_default_role} onChange={(e) => set('sso_default_role', e.target.value)}>
              {ROLES.filter((r) => r !== 'owner').map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
        </>
      )}
      {canAdmin && <button className="btn btn-primary">Save changes</button>}
      {!form.is_personal && owner && <button type="button" className="btn btn-danger" onClick={del}>Delete organisation</button>}
    </form>
  );
}

function Members({ org, user, canAdmin, onToast, onOrgChanged, onClose }) {
  const [{ data, error }, reload] = useLoad(() => api.members(org.id), org.id);
  if (error) return <p className="error-msg">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  const act = async (fn, ok) => { try { await fn(); onToast(ok); reload(); } catch (e) { onToast(e.message, 'error'); } };
  return (
    <table className="data-table">
      <thead><tr><th>Person</th><th>Role</th><th>Joined</th><th /></tr></thead>
      <tbody>
        {data.map((m) => {
          const isMe = m.user_id === user.id;
          const manage = canAdmin && !(m.role === 'owner' && org.role !== 'owner');
          return (
            <tr key={m.user_id}>
              <td>{m.name || m.email}<div className="muted small">{m.email}</div></td>
              <td>
                {manage ? (
                  <select value={m.role} onChange={(e) => act(() => api.setRole(org.id, m.user_id, e.target.value), 'Role updated.')}>
                    {ROLES.filter((r) => r !== 'owner' || org.role === 'owner').map((r) => <option key={r}>{r}</option>)}
                  </select>
                ) : m.role}
              </td>
              <td className="muted small">{fmtDate(m.joined_at)}</td>
              <td>
                {(manage || isMe) && !org.is_personal && (
                  <button className="btn btn-ghost" onClick={async () => {
                    if (!window.confirm(isMe ? 'Leave this organisation?' : `Remove ${m.email}?`)) return;
                    await act(() => api.removeMember(org.id, m.user_id), isMe ? 'You left the organisation.' : 'Member removed.');
                    if (isMe) { await onOrgChanged(null); onClose(); }
                  }}>{isMe ? 'Leave' : 'Remove'}</button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Invites({ org, onToast }) {
  const [{ data, error }, reload] = useLoad(() => api.invites(org.id), org.id);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [link, setLink] = useState('');
  if (org.is_personal) return <p className="muted">Personal workspaces are private. Create a team organisation from the organisation menu to invite people.</p>;

  async function create(e) {
    e.preventDefault();
    try {
      const inv = await api.createInvite(org.id, email, role);
      setLink(inv.accept_url || `${window.location.origin}${import.meta.env.BASE_URL}?invite=${inv.token}`);
      setEmail(''); reload();
    } catch (err) { onToast(err.message, 'error'); }
  }

  return (
    <>
      <form onSubmit={create} className="inline-form">
        <input type="email" required placeholder="colleague@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.filter((r) => r !== 'owner' || org.role === 'owner').map((r) => <option key={r}>{r}</option>)}</select>
        <button className="btn btn-primary">Create invite</button>
      </form>
      {link && (
        <div className="info-msg">
          Share this link with them. It works once, only for that email address, and is shown only now.
          <input readOnly value={link} onFocus={(e) => e.target.select()} />
          <button className="btn btn-ghost" onClick={() => navigator.clipboard?.writeText(link).then(() => onToast('Link copied.'))}>Copy</button>
        </div>
      )}
      {error && <p className="error-msg">{error}</p>}
      {data && (
        <table className="data-table">
          <thead><tr><th>Email</th><th>Role</th><th>Status</th><th /></tr></thead>
          <tbody>
            {data.length === 0 && <tr><td colSpan="4" className="muted">No invitations yet.</td></tr>}
            {data.map((i) => (
              <tr key={i.id}>
                <td>{i.email}</td><td>{i.role}</td>
                <td className="muted small">{i.accepted_at ? 'Accepted' : new Date(i.expires_at) < new Date() ? 'Expired' : `Expires ${fmtDate(i.expires_at)}`}</td>
                <td>{!i.accepted_at && <button className="btn btn-ghost" onClick={() => api.revokeInvite(org.id, i.id).then(reload).catch((e) => onToast(e.message, 'error'))}>Revoke</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function Keys({ org, onToast }) {
  const [{ data, error }, reload] = useLoad(() => api.getOrg(org.id), org.id);
  const [values, setValues] = useState({});
  if (error) return <p className="error-msg">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  async function save(p) {
    try {
      await api.setProviderKey(org.id, p, values[p]);
      setValues((v) => ({ ...v, [p]: '' }));
      onToast(`${p} key saved. It is encrypted and never shown again.`);
      reload();
    } catch (e) { onToast(e.message, 'error'); }
  }

  return (
    <div className="form-grid">
      <p className="muted small">Keys are encrypted on the server and cannot be read back, only replaced or removed. Without an organisation key the platform key (if any) is used.</p>
      {PROVIDERS.map((p) => {
        const cfg = data.configured_providers[p];
        return (
          <div key={p} className="key-row">
            <strong>{p}</strong>
            <span className="muted small">{cfg ? `${cfg.source === 'org' ? 'Organisation key' : 'Platform key'} …${cfg.last4}` : 'Not configured'}</span>
            <input type="password" autoComplete="off" placeholder="Paste a new API key" value={values[p] || ''} onChange={(e) => setValues((v) => ({ ...v, [p]: e.target.value }))} />
            <button className="btn btn-primary" disabled={(values[p] || '').length < 8} onClick={() => save(p)}>Save</button>
            {cfg?.source === 'org' && <button className="btn btn-ghost" onClick={() => api.deleteProviderKey(org.id, p).then(() => { onToast('Key removed.'); reload(); }).catch((e) => onToast(e.message, 'error'))}>Remove</button>}
          </div>
        );
      })}
    </div>
  );
}

function Audit({ org }) {
  const [{ data, error }] = useLoad(() => api.audit(org.id), org.id);
  if (error) return <p className="error-msg">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  return (
    <table className="data-table">
      <thead><tr><th>When</th><th>Action</th><th>Target</th><th>IP</th></tr></thead>
      <tbody>
        {data.length === 0 && <tr><td colSpan="4" className="muted">Nothing recorded yet.</td></tr>}
        {data.map((a) => (
          <tr key={a.id}><td className="muted small">{fmtDate(a.created_at)}</td><td>{a.action}</td><td className="small">{a.target}</td><td className="muted small">{a.ip}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

function Account({ user, onToast, onSignedOut }) {
  const [pw, setPw] = useState({ current: '', next: '' });
  const [delPw, setDelPw] = useState('');

  async function change(e) {
    e.preventDefault();
    try {
      await api.changePassword({ current_password: pw.current, new_password: pw.next });
      setPw({ current: '', next: '' });
      onToast('Password changed. Other devices have been signed out.');
    } catch (err) { onToast(err.message, 'error'); }
  }
  async function del() {
    if (!window.confirm('Delete your account permanently? Organisations you solely own are deleted with it. This cannot be undone.')) return;
    try { await api.deleteAccount(user.has_password ? delPw : undefined); onSignedOut(); } catch (err) { onToast(err.message, 'error'); }
  }

  return (
    <div className="form-grid">
      <p>Signed in as <strong>{user.email}</strong>{user.providers?.length ? <span className="muted small"> · linked: {user.providers.join(', ')}</span> : null}</p>
      {user.has_password && (
        <form onSubmit={change} className="form-grid">
          <h3>Change password</h3>
          <label>Current password<input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required /></label>
          <label>New password<input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required />
            <span className="muted small">At least 10 characters using three of: lowercase, uppercase, digits, symbols.</span></label>
          <button className="btn btn-primary">Change password</button>
        </form>
      )}
      <h3>Delete account</h3>
      {user.has_password && <label>Confirm with your password<input type="password" autoComplete="current-password" value={delPw} onChange={(e) => setDelPw(e.target.value)} /></label>}
      <button className="btn btn-danger" onClick={del} disabled={user.has_password && !delPw}>Delete my account</button>
    </div>
  );
}

export default function OrgSettings({ org, user, canAdmin, onClose, onToast, onOrgChanged, onSignedOut }) {
  const tabs = [
    ['general', 'General'], ['members', 'Members'],
    ...(canAdmin ? [['invites', 'Invites'], ['keys', 'API keys'], ['audit', 'Audit log']] : []),
    ['account', 'Account'],
  ];
  const [tab, setTab] = useState('general');
  const common = { org, user, canAdmin: hasRole(org.role, 'admin'), onToast, onOrgChanged, onClose };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="glass-panel modal wide animate-slide-up" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <div className="modal-head"><h2>{org.is_personal ? 'Personal workspace' : org.name}</h2><button className="icon-btn" onClick={onClose} aria-label="Close">✕</button></div>
        <nav className="tabs">
          {tabs.map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}
        </nav>
        <div className="modal-body">
          {tab === 'general' && <General {...common} />}
          {tab === 'members' && <Members {...common} />}
          {tab === 'invites' && <Invites {...common} />}
          {tab === 'keys' && <Keys {...common} />}
          {tab === 'audit' && <Audit {...common} />}
          {tab === 'account' && <Account user={user} onToast={onToast} onSignedOut={onSignedOut} />}
        </div>
      </div>
    </div>
  );
}
