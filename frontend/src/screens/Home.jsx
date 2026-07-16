import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";

function Section({ title, items, tone, empty }) {
  if (!items || items.length === 0) {
    return null;
  }
  return (
    <div className="card">
      <h3>{title} <span className={`count ${tone || ""}`}>{items.length}</span></h3>
      <ul className="asset-list">
        {items.map((a) => (
          <li key={a.id}>
            <Link to={`/asset/${a.id}`}>
              <span className="code">{a.code}</span>
              <span className="name">{a.name}</span>
              {a.is_overdue && <span className="pill s-lost">overdue</span>}
              {a.low_stock && <span className="pill s-maintenance">{a.quantity} left</span>}
              {!a.is_overdue && !a.low_stock && <span className={`pill s-${a.status}`}>{a.status_display}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Home({ me }) {
  const nav = useNavigate();
  const [s, setS] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.summary().then(setS).catch((e) => setErr(e.message));
  }, []);

  const nothing = s && Object.values(s.counts || {}).every((n) => n === 0);

  return (
    <div className="stack">
      <div className="card">
        <button className="big" onClick={() => nav("/scan")}>Scan a tag</button>
      </div>
      {err && <div className="card error">{err}</div>}
      {!s && !err && <div className="card muted">Loading…</div>}
      {nothing && <div className="card muted">You're all caught up. Nothing needs attention.</div>}
      {s && <Section title="Waiting for you to accept" items={s.my_pending} tone="warn" />}
      {s && me.is_manager && <Section title="Returned, needs inspection" items={s.to_inspect} tone="accent" />}
      {s && <Section title="Overdue" items={s.overdue} tone="danger" />}
      {s && <Section title="Low stock" items={s.low_stock} tone="warn" />}
    </div>
  );
}
