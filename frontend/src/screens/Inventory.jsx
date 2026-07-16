import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api.js";

const STATUSES = ["", "available", "assigned", "checked_out", "returned_pending", "maintenance", "lost"];

export default function Inventory({ me }) {
  const [params] = useSearchParams();
  const [items, setItems] = useState([]);
  const [q, setQ] = useState(params.get("q") || "");
  const [statusF, setStatusF] = useState(params.get("status") || "");
  const [quick, setQuick] = useState(params.get("quick") || ""); // "" | "overdue" | "low_stock"
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [assignOpen, setAssignOpen] = useState(false);
  const [users, setUsers] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [form, setForm] = useState({ counterparty: "", job: "", due_at: "", note: "" });
  const [msg, setMsg] = useState("");

  async function load() {
    setLoading(true);
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (statusF) p.set("status", statusF);
    if (quick) p.set(quick, "true");
    try {
      const r = await api.assets(p.toString() ? `?${p}` : "");
      setItems(r.results || r);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [statusF, quick]);
  useEffect(() => {
    api.users().then((r) => setUsers(r.results || r)).catch(() => {});
    api.jobs("?status=active").then((r) => setJobs(r.results || r)).catch(() => {});
  }, []);

  function toggle(id) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function assignSelected() {
    setMsg("");
    try {
      const r = await api.bulkTransition({
        asset_ids: [...selected],
        action: "assign",
        counterparty: form.counterparty || null,
        job: form.job || null,
        due_at: form.due_at || null,
        note: form.note,
      });
      setMsg(`Assigned ${r.applied} of ${r.total}.` + (r.applied < r.total ? " Some weren't available." : ""));
      setSelected(new Set());
      setAssignOpen(false);
      setForm({ counterparty: "", job: "", due_at: "", note: "" });
      await load();
    } catch (e) { setMsg(e.message); }
  }

  return (
    <div className="stack">
      <div className="card">
        <h2>Inventory</h2>
        <form className="filters" onSubmit={(e) => { e.preventDefault(); load(); }}>
          <input placeholder="Search code or name" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={statusF} onChange={(e) => setStatusF(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, " ") : "All statuses"}</option>)}
          </select>
          <button>Search</button>
        </form>
        <div className="chiprow">
          <button className={quick === "" ? "chip on" : "chip"} onClick={() => setQuick("")}>All</button>
          <button className={quick === "overdue" ? "chip on" : "chip"} onClick={() => setQuick("overdue")}>Overdue</button>
          <button className={quick === "low_stock" ? "chip on" : "chip"} onClick={() => setQuick("low_stock")}>Low stock</button>
        </div>
      </div>

      {me.is_manager && selected.size > 0 && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{selected.size} selected</strong>
            <div className="row">
              <button className="primary" onClick={() => setAssignOpen(!assignOpen)}>Assign selected</button>
              <button className="linkbtn" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          </div>
          {assignOpen && (
            <div style={{ marginTop: 10 }}>
              <label>Assign to
                <select value={form.counterparty} onChange={(e) => setForm({ ...form, counterparty: e.target.value })}>
                  <option value="">Myself ({me.username})</option>
                  {users.filter((u) => u.id !== me.id).map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
                </select>
              </label>
              <label>Job (optional)
                <select value={form.job} onChange={(e) => setForm({ ...form, job: e.target.value })}>
                  <option value="">No job</option>
                  {jobs.map((j) => <option key={j.id} value={j.id}>{j.code} — {j.name}</option>)}
                </select>
              </label>
              <label>Due back (optional)
                <input type="datetime-local" value={form.due_at} onChange={(e) => setForm({ ...form, due_at: e.target.value })} />
              </label>
              <label>Note (optional)<input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
              <button className="primary" onClick={assignSelected}>Assign {selected.size} item{selected.size > 1 ? "s" : ""}</button>
            </div>
          )}
        </div>
      )}

      {msg && <div className="card status">{msg}</div>}

      <div className="card">
        {loading ? <div className="muted">Loading…</div> : (
          <ul className="asset-list">
            {items.length === 0 && <li className="muted">No assets match.</li>}
            {items.map((a) => (
              <li key={a.id} className="selrow">
                {me.is_manager && a.status === "available" && (
                  <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
                )}
                <Link to={`/asset/${a.id}`} style={{ flex: 1 }}>
                  <span className="code">{a.code}</span>
                  <span className="name">{a.name}</span>
                  {a.kind === "consumable"
                    ? <span className={`pill ${a.low_stock ? "s-maintenance" : "s-available"}`}>{a.quantity} on hand</span>
                    : a.is_overdue
                      ? <span className="pill s-lost">overdue</span>
                      : <span className={`pill s-${a.status}`}>{a.status_display}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
