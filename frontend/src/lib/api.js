// Thin API client with JWT auth and automatic token refresh.
// VITE_API_BASE is the API origin (e.g. https://inventory-api.onrender.com),
// with no trailing /api. Defaults to the local Django dev server.
const BASE = (import.meta.env.VITE_API_BASE || "http://localhost:8000").replace(/\/$/, "");
const API = `${BASE}/api`;

const store = {
  get access() { return localStorage.getItem("access"); },
  get refresh() { return localStorage.getItem("refresh"); },
  set({ access, refresh }) {
    if (access) localStorage.setItem("access", access);
    if (refresh) localStorage.setItem("refresh", refresh);
  },
  clear() { localStorage.removeItem("access"); localStorage.removeItem("refresh"); },
};

export const auth = {
  isLoggedIn: () => !!store.access,
  logout: () => store.clear(),
  async login(username, password) {
    const r = await fetch(`${API}/auth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!r.ok) throw new Error("Invalid username or password");
    store.set(await r.json());
    return this.me();
  },
  async me() {
    return request("/auth/me/");
  },
};

async function refreshToken() {
  if (!store.refresh) return false;
  const r = await fetch(`${API}/auth/refresh/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh: store.refresh }),
  });
  if (!r.ok) { store.clear(); return false; }
  const data = await r.json();
  store.set({ access: data.access });
  return true;
}

// Core request helper. `body` may be a plain object (sent as JSON) or a
// FormData (sent as multipart, for photo uploads). Retries once on 401.
export async function request(path, { method = "GET", body, retry = true } = {}) {
  const headers = {};
  if (store.access) headers["Authorization"] = `Bearer ${store.access}`;
  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const r = await fetch(`${API}${path}`, { method, headers, body: payload });
  if (r.status === 401 && retry && (await refreshToken())) {
    return request(path, { method, body, retry: false });
  }
  if (!r.ok) {
    let detail;
    try { detail = await r.json(); } catch { detail = { detail: r.statusText }; }
    const err = new Error(detail.detail || detail.action || JSON.stringify(detail));
    err.status = r.status;
    err.data = detail;
    throw err;
  }
  if (r.status === 204) return null;
  return r.json();
}

export const api = {
  assets: (params = "") => request(`/assets/${params}`),
  users: () => request("/users/"),
  createTag: (data) => request("/tags/", { method: "POST", body: data }),
  // updateAsset accepts FormData (e.g. to set the item's photo) or a plain object.
  updateAsset: (id, data) => request(`/assets/${id}/`, { method: "PATCH", body: data }),
  jobs: (params = "") => request(`/jobs/${params}`),
  createJob: (data) => request("/jobs/", { method: "POST", body: data }),
  jobAssets: (id) => request(`/jobs/${id}/assets/`),
  bulkTransition: (data) => request("/assets/bulk_transition/", { method: "POST", body: data }),
  consume: (id, data) => request(`/assets/${id}/consume/`, { method: "POST", body: data }),
  summary: () => request("/assets/summary/"),
  asset: (id) => request(`/assets/${id}/`),
  byTag: (uid) => request(`/assets/by-tag/${encodeURIComponent(uid)}/`),
  history: (id) => request(`/assets/${id}/history/`),
  createAsset: (data) => request("/assets/", { method: "POST", body: data }),
  // transition accepts FormData (with optional photo) built by the caller.
  transition: (id, formData) =>
    request(`/assets/${id}/transition/`, { method: "POST", body: formData }),
};

export { BASE, API };
