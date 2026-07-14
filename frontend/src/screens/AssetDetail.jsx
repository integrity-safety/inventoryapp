import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { enqueueTransition, flushOutbox } from "../lib/db.js";

// Which actions are offered for each status. `manager` gates to managers only.
// `fields` lists the inputs the action needs beyond the always-present photo.
const ACTIONS = {
  available: [
    { key: "assign", label: "Assign / check out", fields: ["assignee", "job"] },
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
  maintenance: [{ key: "mark_lost", label: "Mark lost", manager: true, danger: true }],
  lost: [],
};

function getGeo() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      () => resolve({}),
      { timeout: 4000 }
    );
  });
}

export default function AssetDetail({ me }) {
  const { id } = useParams();
  const [asset, setAsset] = useState(null);
  const [history, setHistory] = useState([]);
  const [active, setActive] = useState(null); // the action being performed
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ assignee: "", job: "", note: "" });
  const [photo, setPhoto] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setAsset(await api.asset(id));
      setHistory(await api.history(id));
    } catch (e) { setMsg(e.message); }
  }
  useEffect(() => { load(); api.users().then((r) => setUsers(r.results || r)).catch(() => {}); }, [id]);

  function openAction(a) {
    setActive(a);
    setForm({ assignee: "", job: asset.job_ref || "", note: "" });
    setPhoto(null);
    setMsg("");
  }

  async function submit() {
    setBusy(true); setMsg("");
    const geo = await getGeo();
    const fields = { action: active.key, ...geo, note: form.note };
    if (active.fields?.includes("job")) fields.job_ref = form.job;
    if (active.fields?.includes("assignee") && form.assignee) fields.counterparty = form.assignee;
    try {
      await enqueueTransition(id, fields, photo);
      await flushOutbox();
      setActive(null);
      setMsg("Saved. If you're offline it'll sync automatically when you reconnect.");
      await load();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!asset) return <div className="card muted">{msg || "Loading…"}</div>;

  const actions = (ACTIONS[asset.status] || []).filter((a) => !a.manager || me.is_manager);

  return (
    <div className="stack">
      <div className="card">
        <div className="asset-head">
          <div>
            <div className="code">{asset.code}</div>
            <h2>{asset.name}</h2>
            {asset.category && <div className="muted small">{asset.category}</div>}
          </div>
          <span className={`pill s-${asset.status}`}>{asset.status_display}</span>
        </div>
        {asset.assigned_to && (
          <div className="muted small">Held by {asset.assigned_to.username}{asset.job_ref ? ` · ${asset.job_ref}` : ""}</div>
        )}
        {asset.image && <img className="asset-img" src={asset.image} alt="" />}
      </div>

      {!active && (
        <div className="card">
          <h3>Actions</h3>
          {actions.length === 0 && <div className="muted">No actions available in this state.</div>}
          <div className="actions">
            {actions.map((a) => (
              <button key={a.key}
                className={`action ${a.primary ? "primary" : ""} ${a.danger ? "danger" : ""}`}
                onClick={() => openAction(a)}>{a.label}</button>
            ))}
          </div>
        </div>
      )}

      {active && (
        <div className="card">
          <h3>{active.label}</h3>
          {active.fields?.includes("assignee") && (
            <label>Assign to
              <select value={form.assignee} onChange={(e) => setForm({ ...form, assignee: e.target.value })}>
                <option value="">Myself ({me.username})</option>
                {users.filter((u) => u.id !== me.id).map((u) => (
                  <option key={u.id} value={u.id}>{u.username}</option>
                ))}
              </select>
            </label>
          )}
          {active.fields?.includes("job") && (
            <label>Job / project
              <input value={form.job} onChange={(e) => setForm({ ...form, job: e.target.value })} placeholder="e.g. Job-42, Elm St site" />
            </label>
          )}
          <label>Note (optional)
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </label>
          <label className="photo-label">Photo
            <input type="file" accept="image/*" capture="environment"
              onChange={(e) => setPhoto(e.target.files[0] || null)} />
          </label>
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
                <strong>{t.action.replace(/_/g, " ")}</strong>
                <span className="muted small">{new Date(t.created_at).toLocaleString()}</span>
              </div>
              <div className="muted small">
                {t.actor?.username || "?"}
                {t.counterparty ? ` → ${t.counterparty.username}` : ""}
                {t.job_ref ? ` · ${t.job_ref}` : ""}
                {t.note ? ` · ${t.note}` : ""}
              </div>
              {t.photos?.length > 0 && (
                <div className="thumbs">
                  {t.photos.map((p) => <img key={p.id} src={p.image} alt="" />)}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      <Link className="linkbtn" to="/">← Scan another</Link>
    </div>
  );
}
