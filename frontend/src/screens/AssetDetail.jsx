import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { enqueueTransition, flushOutbox } from "../lib/db.js";

const ACTIONS = {
  available: [
    { key: "assign", label: "Assign / check out", fields: ["assignee", "job", "due"] },
    { key: "to_maintenance", label: "Send to maintenance", manager: true },
    { key: "mark_lost", label: "Mark lost", manager: true, danger: true },
  ],
  assigned: [
    { key: "confirm_checkout", label: "Confirm checkout (I have it)", primary: true },
    { key: "mark_lost", label: "Mark lost", manager: true, danger: true },
  ],
  checked_out: [
    { key: "confirm_return", label: "Return this item", primary: true },
    { key: "to_maintenance", label: "Send to maintenance", manager: true },
  ],
  in_transit: [{ key: "confirm_return", label: "Confirm return", primary: true }],
  returned_pending: [
    { key: "accept_return", label: "Accept return (inspected)", manager: true, primary: true },
    { key: "to_maintenance", label: "Send to maintenance", manager: true },
  ],
  maintenance: [
    { key: "accept_return", label: "Return to available", manager: true, primary: true },
    { key: "mark_lost", label: "Mark lost", manager: true, danger: true },
  ],
  lost: [],
};

function getGeo() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      () => resolve({}), { timeout: 4000 }
    );
  });
}

export default function AssetDetail({ me }) {
  const { id } = useParams();
  const [asset, setAsset] = useState(null);
  const [history, setHistory] = useState([]);
  const [active, setActive] = useState(null);
  const [users, setUsers] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [form, setForm] = useState({ assignee: "", job: "", due: "", note: "" });
  const [photo, setPhoto] = useState(null);
  const [cons, setCons] = useState({ mode: "issue", qty: 1, note: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setAsset(await api.asset(id));
      setHistory(await api.history(id));
    } catch (e) { setMsg(e.message); }
  }
  useEffect(() => {
    load();
    api.users().then((r) => setUsers(r.results || r)).catch(() => {});
    api.jobs("?status=active").then((r) => setJobs(r.results || r)).catch(() => {});
  }, [id]);

  async function setAssetPhoto(file) {
    if (!file) return;
    setMsg("Uploading photo…");
    const fd = new FormData(); fd.append("image", file);
    try { await api.updateAsset(id, fd); setMsg(""); await load(); }
    catch (e) { setMsg(e.message || "Photo upload failed"); }
  }

  function openAction(a) {
    setActive(a);
    setForm({ assignee: "", job: asset.job?.id || "", due: "", note: "" });
    setPhoto(null); setMsg("");
  }

  async function submit() {
    setBusy(true); setMsg("");
    const geo = await getGeo();
    const fields = { action: active.key, ...geo, note: form.note };
    if (active.fields?.includes("job")) fields.job = form.job || null;
    if (active.fields?.includes("due") && form.due) fields.due_at = form.due;
    if (active.fields?.includes("assignee") && form.assignee) fields.counterparty = form.assignee;
    try {
      await enqueueTransition(id, fields, photo);
      await flushOutbox();
      setActive(null);
      setMsg("Saved. Offline actions sync automatically when you reconnect.");
      await load();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  async function doConsume() {
    setBusy(true); setMsg("");
    try {
      await api.consume(id, { action: cons.mode, quantity: Number(cons.qty), note: cons.note });
      setCons({ mode: "issue", qty: 1, note: "" });
      await load();
      setMsg("Done.");
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  if (!asset) return <div className="card muted">{msg || "Loading…"}</div>;

  const isConsumable = asset.kind === "consumable";
  const actions = (ACTIONS[asset.status] || []).filter((a) => !a.manager || me.is_manager);
  const dueStr = asset.due_at ? new Date(asset.due_at).toLocaleString() : null;

  return (
    <div className="stack">
      <div className="card">
        <div className="asset-head">
          <div>
            <div className="code">{asset.code}</div>
            <h2>{asset.name}</h2>
            {asset.category && <div className="muted small">{asset.category.name}</div>}
          </div>
          {isConsumable
            ? <span className={`pill ${asset.low_stock ? "s-maintenance" : "s-available"}`}>{asset.quantity} on hand</span>
            : asset.is_overdue
              ? <span className="pill s-lost">overdue</span>
              : <span className={`pill s-${asset.status}`}>{asset.status_display}</span>}
        </div>
        {asset.assigned_to && <div className="muted small">Held by {asset.assigned_to.username}</div>}
        {asset.job && <div className="muted small">Job: {asset.job.code} — {asset.job.name}</div>}
        {dueStr && <div className={asset.is_overdue ? "small" : "muted small"} style={asset.is_overdue ? { color: "var(--danger)" } : null}>Due back: {dueStr}</div>}
        {asset.location && <div className="muted small">Location: {asset.location.name}</div>}
        {(asset.manufacturer || asset.model_number) && (
          <div className="muted small">{[asset.manufacturer, asset.model_number].filter(Boolean).join(" ")}</div>
        )}
        {asset.supplier && <div className="muted small">Supplier: {asset.supplier.name}</div>}
        {asset.unit_cost && <div className="muted small">Unit cost: ${asset.unit_cost}</div>}
        {isConsumable && <div className="muted small">Counted in: {asset.unit_of_measure_display}</div>}
        {isConsumable && asset.min_quantity > 0 && <div className="muted small">Reorder point: {asset.min_quantity}{asset.max_quantity ? ` · target ${asset.max_quantity}` : ""}</div>}
        {asset.image && <img className="asset-img" src={asset.image} alt="" />}
        <label className="photo-label small">{asset.image ? "Change item photo" : "Add a photo of this item"}
          <input type="file" accept="image/*" capture="environment" onChange={(e) => setAssetPhoto(e.target.files[0])} />
        </label>
      </div>

      {isConsumable && (
        <div className="card">
          <h3>Stock</h3>
          <div className="row">
            <button className={cons.mode === "issue" ? "primary" : "secondary"} onClick={() => setCons({ ...cons, mode: "issue" })}>Issue</button>
            {me.is_manager && <button className={cons.mode === "restock" ? "primary" : "secondary"} onClick={() => setCons({ ...cons, mode: "restock" })}>Restock</button>}
          </div>
          <label>Quantity<input type="number" min="1" value={cons.qty} onChange={(e) => setCons({ ...cons, qty: e.target.value })} /></label>
          <label>Note (optional)<input value={cons.note} onChange={(e) => setCons({ ...cons, note: e.target.value })} /></label>
          <button className="primary" disabled={busy} onClick={doConsume}>{busy ? "Saving…" : (cons.mode === "issue" ? "Issue" : "Restock")} {cons.qty}</button>
        </div>
      )}

      {!isConsumable && !active && (
        <div className="card">
          <h3>Actions</h3>
          {actions.length === 0 && <div className="muted">No actions available in this state.</div>}
          <div className="actions">
            {actions.map((a) => (
              <button key={a.key} className={`action ${a.primary ? "primary" : ""} ${a.danger ? "danger" : ""}`} onClick={() => openAction(a)}>{a.label}</button>
            ))}
          </div>
        </div>
      )}

      {!isConsumable && active && (
        <div className="card">
          <h3>{active.label}</h3>
          {active.fields?.includes("assignee") && (
            <label>Assign to
              <select value={form.assignee} onChange={(e) => setForm({ ...form, assignee: e.target.value })}>
                <option value="">Myself ({me.username})</option>
                {users.filter((u) => u.id !== me.id).map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
              </select>
            </label>
          )}
          {active.fields?.includes("job") && (
            <label>Job (optional)
              <select value={form.job} onChange={(e) => setForm({ ...form, job: e.target.value })}>
                <option value="">No job</option>
                {jobs.map((j) => <option key={j.id} value={j.id}>{j.code} — {j.name}</option>)}
              </select>
            </label>
          )}
          {active.fields?.includes("due") && (
            <label>Due back (optional)
              <input type="datetime-local" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} />
            </label>
          )}
          <label>Note (optional)<input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
          <label className="photo-label">Photo<input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files[0] || null)} /></label>
          {photo && <img className="preview" src={URL.createObjectURL(photo)} alt="preview" />}
          <div className="row">
            <button className="primary" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Confirm"}</button>
            <button className="linkbtn" onClick={() => setActive(null)}>Cancel</button>
          </div>
        </div>
      )}

      {msg && <div className="card status">{msg}</div>}

      <div className="card">
        <h3>History</h3>
        {history.length === 0 && <div className="muted">No activity yet.</div>}
        <ul className="history">
          {history.map((t) => (
            <li key={t.id}>
              <div className="h-line">
                <strong>{t.action.replace(/_/g, " ")}{t.quantity_delta ? ` ${t.quantity_delta > 0 ? "+" : ""}${t.quantity_delta}` : ""}</strong>
                <span className="muted small">{new Date(t.created_at).toLocaleString()}</span>
              </div>
              <div className="muted small">
                {t.actor?.username || "?"}
                {t.counterparty ? ` → ${t.counterparty.username}` : ""}
                {t.job ? ` · ${t.job.code}` : ""}
                {t.note ? ` · ${t.note}` : ""}
              </div>
              {t.photos?.length > 0 && (
                <div className="thumbs">{t.photos.map((p) => <img key={p.id} src={p.image} alt="" />)}</div>
              )}
            </li>
          ))}
        </ul>
      </div>

      <Link className="linkbtn" to="/scan">← Scan another</Link>
    </div>
  );
}
