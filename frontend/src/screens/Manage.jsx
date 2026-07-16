import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../lib/api.js";

const UOM = [
  "each", "box", "case", "pack", "roll", "foot", "meter",
  "gallon", "liter", "pound", "kilogram", "set",
];
const LOC_KINDS = [
  ["warehouse", "Warehouse"],
  ["bin", "Bin / shelf"],
  ["vehicle", "Truck / vehicle"],
  ["yard", "Yard"],
  ["other", "Other"],
];

const SECTIONS = [
  ["items", "Items"],
  ["consumables", "Consumables"],
  ["categories", "Categories"],
  ["locations", "Locations"],
  ["suppliers", "Suppliers"],
];

function unwrap(r) {
  return r.results || r;
}

// A select of managed picklist entries, with an inline "+ Add new" that creates
// one on the fly and selects it.
function Picker({ label, items, value, onChange, onCreate }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function add() {
    if (!name.trim()) return;
    setBusy(true); setErr("");
    try {
      const created = await onCreate(name.trim());
      onChange(created.id);
      setAdding(false); setName("");
    } catch (e) { setErr(e.message || "Could not add"); }
    finally { setBusy(false); }
  }

  return (
    <label>{label}
      {!adding ? (
        <select
          value={value || ""}
          onChange={(e) => (e.target.value === "__new__" ? setAdding(true) : onChange(e.target.value))}
        >
          <option value="">None</option>
          {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          <option value="__new__">+ Add new…</option>
        </select>
      ) : (
        <div className="row">
          <input autoFocus value={name} placeholder={`New ${label.toLowerCase()}`}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
          <button type="button" className="primary" disabled={busy} onClick={add}>Add</button>
          <button type="button" className="linkbtn" onClick={() => { setAdding(false); setErr(""); }}>Cancel</button>
        </div>
      )}
      {err && <span className="error small">{err}</span>}
    </label>
  );
}

const emptyForm = {
  code: "", name: "", description: "", category_id: "", location_id: "", supplier_id: "",
  manufacturer: "", model_number: "", unit_cost: "",
  unit_of_measure: "each", quantity: "0", min_quantity: "0", max_quantity: "",
};

function AssetForm({ kind, asset, picklists, onSaved, onCancel }) {
  const isConsumable = kind === "consumable";
  const [form, setForm] = useState(() => (asset ? {
    code: asset.code || "", name: asset.name || "", description: asset.description || "",
    category_id: asset.category?.id || "", location_id: asset.location?.id || "",
    supplier_id: asset.supplier?.id || "", manufacturer: asset.manufacturer || "",
    model_number: asset.model_number || "", unit_cost: asset.unit_cost ?? "",
    unit_of_measure: asset.unit_of_measure || "each",
    quantity: String(asset.quantity ?? 0), min_quantity: String(asset.min_quantity ?? 0),
    max_quantity: asset.max_quantity ?? "",
  } : { ...emptyForm }));
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  function buildPayload() {
    const p = {
      code: form.code.trim(), name: form.name.trim(), kind,
      description: form.description || "",
      category_id: form.category_id || null,
      location_id: form.location_id || null,
      supplier_id: form.supplier_id || null,
      manufacturer: form.manufacturer || "",
      model_number: form.model_number || "",
      unit_cost: form.unit_cost === "" ? null : form.unit_cost,
    };
    if (isConsumable) {
      p.unit_of_measure = form.unit_of_measure || "each";
      p.quantity = Number(form.quantity || 0);
      p.min_quantity = Number(form.min_quantity || 0);
      p.max_quantity = form.max_quantity === "" ? null : Number(form.max_quantity);
    }
    return p;
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const payload = buildPayload();
      let body = payload;
      // A photo forces multipart; drop nulls so they aren't sent as "".
      if (photo) {
        const fd = new FormData();
        Object.entries(payload).forEach(([k, v]) => { if (v !== null && v !== undefined) fd.append(k, v); });
        fd.append("image", photo);
        body = fd;
      }
      if (asset) await api.updateAsset(asset.id, body);
      else await api.createAsset(body);
      onSaved();
    } catch (e2) { setErr(e2.message || "Could not save"); }
    finally { setBusy(false); }
  }

  return (
    <form className="card manage-form" onSubmit={submit}>
      <h3>{asset ? "Edit" : isConsumable ? "Add consumable" : "Add item"}</h3>
      <div className="form-grid">
        <label>Code / SKU *
          <input value={form.code} onChange={set("code")} placeholder="e.g. TOOL-001" autoFocus />
        </label>
        <label>Name *
          <input value={form.name} onChange={set("name")} placeholder="e.g. DeWalt impact driver" />
        </label>
        <Picker label="Category" items={picklists.categories} value={form.category_id}
          onChange={(v) => setForm({ ...form, category_id: v })} onCreate={picklists.createCategory} />
        <Picker label="Location" items={picklists.locations} value={form.location_id}
          onChange={(v) => setForm({ ...form, location_id: v })} onCreate={picklists.createLocation} />
        <Picker label="Supplier" items={picklists.suppliers} value={form.supplier_id}
          onChange={(v) => setForm({ ...form, supplier_id: v })} onCreate={picklists.createSupplier} />
        <label>Unit cost
          <input type="number" step="0.01" min="0" value={form.unit_cost} onChange={set("unit_cost")} placeholder="0.00" />
        </label>
        <label>Manufacturer
          <input value={form.manufacturer} onChange={set("manufacturer")} />
        </label>
        <label>Model number
          <input value={form.model_number} onChange={set("model_number")} />
        </label>
        {isConsumable && (
          <>
            <label>Unit of measure
              <select value={form.unit_of_measure} onChange={set("unit_of_measure")}>
                {UOM.map((u) => <option key={u} value={u}>{u[0].toUpperCase() + u.slice(1)}</option>)}
              </select>
            </label>
            <label>On hand
              <input type="number" min="0" value={form.quantity} onChange={set("quantity")} />
            </label>
            <label>Reorder point (min)
              <input type="number" min="0" value={form.min_quantity} onChange={set("min_quantity")} />
            </label>
            <label>Target / max
              <input type="number" min="0" value={form.max_quantity} onChange={set("max_quantity")} placeholder="optional" />
            </label>
          </>
        )}
      </div>
      <label>Description
        <textarea rows="2" value={form.description} onChange={set("description")} />
      </label>
      <label className="photo-label">Photo (optional)
        <input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files[0] || null)} />
      </label>
      {photo && <img className="preview" src={URL.createObjectURL(photo)} alt="preview" />}
      {err && <div className="error">{err}</div>}
      <div className="row">
        <button className="primary" disabled={busy || !form.code.trim() || !form.name.trim()}>
          {busy ? "Saving…" : asset ? "Save changes" : "Create"}
        </button>
        <button type="button" className="linkbtn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function AssetsSection({ kind, picklists }) {
  const isConsumable = kind === "consumable";
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState(null); // null | "new" | asset object
  const [msg, setMsg] = useState("");

  async function load() {
    setLoading(true);
    const p = new URLSearchParams({ kind });
    if (showArchived) p.set("archived", "all");
    try { setItems(unwrap(await api.assets(`?${p}`))); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [kind, showArchived]);

  async function archive(a, val) {
    setMsg("");
    try { await api.updateAsset(a.id, { archived: val }); await load(); }
    catch (e) { setMsg(e.message); }
  }
  async function del(a) {
    setMsg("");
    try { await api.deleteAsset(a.id); await load(); }
    catch (e) { setMsg(e.message); }
  }

  if (editing) {
    return (
      <AssetForm
        kind={kind}
        asset={editing === "new" ? null : editing}
        picklists={picklists}
        onCancel={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }}
      />
    );
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <button className="primary" onClick={() => setEditing("new")}>
          + Add {isConsumable ? "consumable" : "item"}
        </button>
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>
      {msg && <div className="card status">{msg}</div>}
      <div className="card">
        {loading ? <div className="muted">Loading…</div> : (
          <ul className="manage-list">
            {items.length === 0 && <li className="muted">Nothing here yet.</li>}
            {items.map((a) => (
              <li key={a.id} className={a.archived ? "archived" : ""}>
                <div className="ml-main">
                  <span className="code">{a.code}</span>
                  <span className="name">{a.name}</span>
                  <span className="muted small">
                    {a.category?.name || "Uncategorized"}
                    {a.location?.name ? ` · ${a.location.name}` : ""}
                    {isConsumable ? ` · ${a.quantity} ${a.unit_of_measure_display}${a.low_stock ? " · low" : ""}` : ""}
                    {a.archived ? " · archived" : ""}
                  </span>
                </div>
                <div className="ml-actions">
                  <button className="linkbtn" onClick={() => setEditing(a)}>Edit</button>
                  {a.archived
                    ? <button className="linkbtn" onClick={() => archive(a, false)}>Unarchive</button>
                    : <button className="linkbtn" onClick={() => archive(a, true)}>Archive</button>}
                  <button className="linkbtn danger" onClick={() => del(a)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="muted small">
        Items with activity history can't be deleted (the audit trail is protected). Archive them instead;
        archived items disappear from lists and the dashboard but keep their history.
      </p>
    </div>
  );
}

// Generic manager for a simple named picklist (Category / Location / Supplier).
function PicklistSection({ title, listFn, createFn, updateFn, deleteFn, extraFields = [], onChanged }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", ...Object.fromEntries(extraFields.map((f) => [f.key, f.default ?? ""])) });
  const [editId, setEditId] = useState(null);
  const [msg, setMsg] = useState("");

  async function load() {
    setLoading(true);
    try { setItems(unwrap(await listFn("?archived=all"))); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function blank() {
    return { name: "", ...Object.fromEntries(extraFields.map((f) => [f.key, f.default ?? ""])) };
  }
  async function submit(e) {
    e.preventDefault();
    setMsg("");
    try {
      if (editId) await updateFn(editId, form);
      else await createFn(form);
      setForm(blank()); setEditId(null);
      await load(); onChanged && onChanged();
    } catch (e2) { setMsg(e2.message); }
  }
  function edit(it) {
    setEditId(it.id);
    setForm({ name: it.name, ...Object.fromEntries(extraFields.map((f) => [f.key, it[f.key] ?? (f.default ?? "")])) });
  }
  async function toggleArchive(it) {
    setMsg("");
    try { await updateFn(it.id, { archived: !it.archived }); await load(); onChanged && onChanged(); }
    catch (e) { setMsg(e.message); }
  }
  async function remove(it) {
    setMsg("");
    try { await deleteFn(it.id); await load(); onChanged && onChanged(); }
    catch (e) { setMsg(e.message); }
  }

  return (
    <div className="stack">
      <form className="card manage-form" onSubmit={submit}>
        <h3>{editId ? `Edit ${title.toLowerCase()}` : `Add ${title.toLowerCase()}`}</h3>
        <div className="form-grid">
          <label>Name *
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          {extraFields.map((f) => (
            <label key={f.key}>{f.label}
              {f.type === "select" ? (
                <select value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}>
                  {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              ) : (
                <input value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
              )}
            </label>
          ))}
        </div>
        {msg && <div className="error">{msg}</div>}
        <div className="row">
          <button className="primary" disabled={!form.name.trim()}>{editId ? "Save" : "Add"}</button>
          {editId && <button type="button" className="linkbtn" onClick={() => { setEditId(null); setForm(blank()); }}>Cancel</button>}
        </div>
      </form>
      <div className="card">
        {loading ? <div className="muted">Loading…</div> : (
          <ul className="manage-list">
            {items.length === 0 && <li className="muted">None yet.</li>}
            {items.map((it) => (
              <li key={it.id} className={it.archived ? "archived" : ""}>
                <div className="ml-main">
                  <span className="name">{it.name}</span>
                  <span className="muted small">
                    {it.kind_display ? it.kind_display : ""}
                    {it.contact ? ` · ${it.contact}` : ""}
                    {it.phone ? ` · ${it.phone}` : ""}
                    {typeof it.asset_count === "number" ? ` · ${it.asset_count} item${it.asset_count === 1 ? "" : "s"}` : ""}
                    {it.archived ? " · archived" : ""}
                  </span>
                </div>
                <div className="ml-actions">
                  <button className="linkbtn" onClick={() => edit(it)}>Edit</button>
                  <button className="linkbtn" onClick={() => toggleArchive(it)}>{it.archived ? "Unarchive" : "Archive"}</button>
                  <button className="linkbtn danger" onClick={() => remove(it)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function Manage({ me }) {
  const [tab, setTab] = useState("items");
  // Active picklists shared with the Add/Edit form pickers.
  const [cats, setCats] = useState([]);
  const [locs, setLocs] = useState([]);
  const [sups, setSups] = useState([]);

  async function reloadPicklists() {
    api.categories().then((r) => setCats(unwrap(r))).catch(() => {});
    api.locations().then((r) => setLocs(unwrap(r))).catch(() => {});
    api.suppliers().then((r) => setSups(unwrap(r))).catch(() => {});
  }
  useEffect(() => { reloadPicklists(); }, []);

  if (!me.is_manager) return <Navigate to="/" replace />;

  const picklists = {
    categories: cats, locations: locs, suppliers: sups,
    createCategory: async (name) => { const it = await api.createCategory({ name }); await reloadPicklists(); return it; },
    createLocation: async (name) => { const it = await api.createLocation({ name, kind: "warehouse" }); await reloadPicklists(); return it; },
    createSupplier: async (name) => { const it = await api.createSupplier({ name }); await reloadPicklists(); return it; },
  };

  return (
    <div className="stack">
      <div className="card">
        <h2>Manage</h2>
        <div className="subtabs">
          {SECTIONS.map(([key, label]) => (
            <button key={key} className={tab === key ? "subtab on" : "subtab"} onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>
      </div>

      {tab === "items" && <AssetsSection kind="serialized" picklists={picklists} />}
      {tab === "consumables" && <AssetsSection kind="consumable" picklists={picklists} />}
      {tab === "categories" && (
        <PicklistSection title="Category"
          listFn={api.categories} createFn={api.createCategory} updateFn={api.updateCategory} deleteFn={api.deleteCategory}
          onChanged={reloadPicklists} />
      )}
      {tab === "locations" && (
        <PicklistSection title="Location"
          listFn={api.locations} createFn={api.createLocation} updateFn={api.updateLocation} deleteFn={api.deleteLocation}
          extraFields={[
            { key: "kind", label: "Kind", type: "select", options: LOC_KINDS, default: "warehouse" },
            { key: "note", label: "Note", type: "text" },
          ]}
          onChanged={reloadPicklists} />
      )}
      {tab === "suppliers" && (
        <PicklistSection title="Supplier"
          listFn={api.suppliers} createFn={api.createSupplier} updateFn={api.updateSupplier} deleteFn={api.deleteSupplier}
          extraFields={[
            { key: "contact", label: "Contact", type: "text" },
            { key: "phone", label: "Phone", type: "text" },
            { key: "note", label: "Note", type: "text" },
          ]}
          onChanged={reloadPicklists} />
      )}
    </div>
  );
}
