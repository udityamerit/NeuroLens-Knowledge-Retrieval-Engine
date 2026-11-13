// Thin API client. The short-lived access token lives only in memory (never localStorage);
// the long-lived refresh token is an HttpOnly cookie the browser sends automatically.
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const CSRF = { 'X-Requested-With': 'neurolens' };

let accessToken = null;
let refreshPromise = null;
let onAuthLost = () => {};

export class ApiError extends Error {
  constructor(status, detail) {
    super(detail || `Request failed (${status})`);
    this.status = status;
  }
}

export const setAuthLostHandler = (fn) => { onAuthLost = fn; };
export const setAccessToken = (t) => { accessToken = t; };

async function parse(res) {
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : null;
    throw new ApiError(res.status, detail || (res.status >= 500 ? 'Server error. Please try again.' : `Request failed (${res.status})`));
  }
  return data;
}

/** Exchange the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = fetch(`${BASE}/api/auth/refresh`, { method: 'POST', credentials: 'include', headers: CSRF })
      .then(parse)
      .then((data) => { accessToken = data.access_token; return data; })
      .catch((e) => { accessToken = null; throw e; })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function request(path, { method = 'GET', json, form, auth = true, signal } = {}, retried = false) {
  const headers = { ...CSRF };
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  else if (form) body = form;
  const res = await fetch(`${BASE}${path}`, { method, headers, body, credentials: 'include', signal });
  if (res.status === 401 && auth && !retried) {
    try {
      await refreshSession();
    } catch {
      onAuthLost();
      throw new ApiError(401, 'Your session has expired. Please sign in again.');
    }
    return request(path, { method, json, form, auth, signal }, true);
  }
  return parse(res);
}

/** Single-file upload with real byte-level progress (fetch cannot report upload progress; XHR can). */
function xhrUpload(path, form, { onProgress, onSent, signal } = {}, retried = false) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}${path}`);
    xhr.withCredentials = true;
    xhr.responseType = 'text';
    for (const [k, v] of Object.entries(CSRF)) xhr.setRequestHeader(k, v);
    if (accessToken) xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.upload.onload = () => onSent?.();
    xhr.onerror = () => reject(new ApiError(0, 'Network error while uploading. Check your connection and try again.'));
    xhr.onabort = () => reject(new ApiError(0, 'Upload cancelled.'));
    xhr.onload = async () => {
      if (xhr.status === 401 && !retried) {
        try { await refreshSession(); } catch { onAuthLost(); reject(new ApiError(401, 'Your session has expired. Please sign in again.')); return; }
        xhrUpload(path, form, { onProgress, onSent, signal }, true).then(resolve, reject);
        return;
      }
      resolve(parse(new Response(xhr.responseText, { status: xhr.status })));
    };
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

const orgPath = (orgId, p = '') => `/api/orgs/${orgId}${p}`;

export const api = {
  // auth
  register: (b) => request('/api/auth/register', { method: 'POST', json: b, auth: false }),
  login: (b) => request('/api/auth/login', { method: 'POST', json: b, auth: false }),
  logout: () => request('/api/auth/logout', { method: 'POST', auth: false }),
  me: () => request('/api/auth/me'),
  ssoProviders: () => request('/api/auth/sso/providers', { auth: false }),
  ssoUrl: (provider) => `${BASE}/api/auth/sso/${provider}/login`,
  changePassword: (b) => request('/api/auth/change-password', { method: 'POST', json: b }),
  deleteAccount: (password) => request('/api/auth/me', { method: 'DELETE', json: { password } }),
  // orgs
  createOrg: (name) => request('/api/orgs', { method: 'POST', json: { name } }),
  getOrg: (id) => request(orgPath(id)),
  updateOrg: (id, b) => request(orgPath(id), { method: 'PATCH', json: b }),
  deleteOrg: (id) => request(orgPath(id), { method: 'DELETE' }),
  members: (id) => request(orgPath(id, '/members')),
  setRole: (id, uid, role) => request(orgPath(id, `/members/${uid}`), { method: 'PATCH', json: { role } }),
  removeMember: (id, uid) => request(orgPath(id, `/members/${uid}`), { method: 'DELETE' }),
  invites: (id) => request(orgPath(id, '/invites')),
  createInvite: (id, email, role) => request(orgPath(id, '/invites'), { method: 'POST', json: { email, role } }),
  revokeInvite: (id, inv) => request(orgPath(id, `/invites/${inv}`), { method: 'DELETE' }),
  acceptInvite: (token) => request('/api/invites/accept', { method: 'POST', json: { token } }),
  setProviderKey: (id, provider, api_key) => request(orgPath(id, `/provider-keys/${provider}`), { method: 'PUT', json: { api_key } }),
  deleteProviderKey: (id, provider) => request(orgPath(id, `/provider-keys/${provider}`), { method: 'DELETE' }),
  audit: (id) => request(orgPath(id, '/audit')),
  // documents
  documents: (id) => request(orgPath(id, '/documents')),
  stats: (id) => request(orgPath(id, '/documents/stats')),
  upload: (id, files) => {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    return request(orgPath(id, '/documents'), { method: 'POST', form });
  },
  /** Upload one file; `opts.onProgress(0..1)` fires while bytes are sent, `opts.onSent()` when the server starts processing. */
  uploadFile: (id, file, opts) => {
    const form = new FormData();
    form.append('files', file);
    return xhrUpload(orgPath(id, '/documents'), form, opts);
  },
  ingestUrl: (id, url) => request(orgPath(id, '/documents/url'), { method: 'POST', json: { url } }),
  chunks: (id, docId) => request(orgPath(id, `/documents/${docId}/chunks`)),
  deleteDocument: (id, docId) => request(orgPath(id, `/documents/${docId}`), { method: 'DELETE' }),
  clearDocuments: (id) => request(orgPath(id, '/documents'), { method: 'DELETE' }),
  // chat
  chat: (id, body, signal) => request(orgPath(id, '/chat'), { method: 'POST', json: body, signal }),
};

export const ROLE_RANK = { viewer: 0, member: 1, admin: 2, owner: 3 };
export const hasRole = (role, min) => (ROLE_RANK[role] ?? -1) >= ROLE_RANK[min];
