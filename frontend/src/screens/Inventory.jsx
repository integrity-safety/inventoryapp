import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";

const STATUSES = ["", "available", "assigned", "checked_out", "returned_pending", "maintenance", "lost"];

export default function Inventory() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    const qs = params.toString() ? `?${params}` : "";
    try {
      const r = await api.assets(qs);
      setItems(r.results || r);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [status]);

  return (
    <div className="card">
      <h2>Inventory</h2>
      <form className="filters" onSubmit={(e) => { e.preventDefault(); load(); }}>
        <input placeholder="Search code or name" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, " ") : "All statuses"}</option>)}
        </select>
        <button>Search</button>
      </form>
      {loading ? <div className="muted">Loading…</div> : (
        <ul className="asset-list">
          {items.length === 0 && <li className="muted">No assets. Add some in the admin.</li>}
          {items.map((a) => (
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
  );
}
