import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";

export default function Jobs({ me }) {
  const [jobs, setJobs] = useState([]);
  const [open, setOpen] = useState(null); // job id whose assets are expanded
  const [assets, setAssets] = useState({});
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", site: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    try { setJobs((await api.jobs()).results || []); } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function toggle(id) {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    if (!assets[id]) {
      try {
        const data = await api.jobAssets(id);
        setAssets((m) => ({ ...m, [id]: data }));
      } catch { /* ignore */ }
    }
  }

  async function create(e) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await api.createJob({ code: form.code.trim(), name: form.name.trim(), site: form.site.trim() });
      setForm({ code: "", name: "", site: "" });
      setCreating(false);
      await load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="asset-head">
          <h2>Jobs</h2>
          {me.is_manager && <button className="secondary" onClick={() => setCreating(!creating)}>{creating ? "Close" : "+ New job"}</button>}
        </div>
        {creating && (
          <form onSubmit={create}>
            <label>Job code<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="JOB-42" autoFocus /></label>
            <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Elm St build" /></label>
            <label>Site (optional)<input value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} placeholder="123 Elm St" /></label>
            {err && <div className="error">{err}</div>}
            <button className="primary" disabled={busy || !form.code.trim() || !form.name.trim()}>{busy ? "Saving…" : "Create job"}</button>
          </form>
        )}
      </div>

      {jobs.length === 0 && <div className="card muted">No jobs yet.{me.is_manager ? " Create one above." : ""}</div>}
      {jobs.map((j) => (
        <div className="card" key={j.id}>
          <div className="asset-head" onClick={() => toggle(j.id)} style={{ cursor: "pointer" }}>
            <div>
              <div className="code">{j.code}</div>
              <strong>{j.name}</strong>
              {j.site && <div className="muted small">{j.site}</div>}
            </div>
            <span className={`pill ${j.status === "active" ? "s-available" : "s-lost"}`}>{j.asset_count} items</span>
          </div>
          {open === j.id && (
            <ul className="asset-list" style={{ marginTop: 8 }}>
              {(assets[j.id] || []).length === 0 && <li className="muted small">No items on this job.</li>}
              {(assets[j.id] || []).map((a) => (
                <li key={a.id}>
                  <Link to={`/asset/${a.id}`}>
                    <span className="code">{a.code}</span>
                    <span className="name">{a.name}</span>
                    <span className={`pill s-${a.status}`}>{a.status_display}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
