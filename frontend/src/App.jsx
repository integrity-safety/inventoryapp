import { useEffect, useState } from "react";
import { Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import { auth, api } from "./lib/api.js";
import { flushOutbox, pendingCount } from "./lib/db.js";
import Login from "./screens/Login.jsx";
import Home from "./screens/Home.jsx";
import Scan from "./screens/Scan.jsx";
import AssetDetail from "./screens/AssetDetail.jsx";
import Inventory from "./screens/Inventory.jsx";
import Jobs from "./screens/Jobs.jsx";
import Manage from "./screens/Manage.jsx";

function useAuth() {
  const [me, setMe] = useState(auth.isLoggedIn() ? "loading" : null);
  useEffect(() => {
    if (auth.isLoggedIn()) auth.me().then(setMe).catch(() => { auth.logout(); setMe(null); });
  }, []);
  return [me, setMe];
}

function Nav({ me, onLogout }) {
  const loc = useLocation();
  const [pending, setPending] = useState(0);
  const [alerts, setAlerts] = useState(0);
  useEffect(() => {
    const tick = () => {
      pendingCount().then(setPending);
      api.summary().then((s) => {
        const c = s.counts || {};
        setAlerts((c.my_pending || 0) + (c.overdue || 0) + (c.to_inspect || 0) + (c.low_stock || 0));
      }).catch(() => {});
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, [loc.pathname]);
  const tab = (to, label, badge) => (
    <Link to={to} className={loc.pathname === to ? "tab active" : "tab"}>
      {label}{badge > 0 && <span className="tabbadge">{badge}</span>}
    </Link>
  );
  return (
    <header className="topbar">
      <div className="brand">Inventory</div>
      <nav className="tabs">
        {tab("/", "Home", alerts)}
        {tab("/scan", "Scan")}
        {tab("/inventory", "Inventory")}
        {tab("/jobs", "Jobs")}
        {me.is_manager && tab("/manage", "Manage")}
      </nav>
      <div className="who">
        {pending > 0 && <span className="badge" title="Queued offline">{pending} queued</span>}
        <span className="user">{me.username}{me.is_manager ? " (mgr)" : ""}</span>
        <button className="linkbtn" onClick={onLogout}>Log out</button>
      </div>
    </header>
  );
}

export default function App() {
  const [me, setMe] = useAuth();
  useEffect(() => { if (me && me !== "loading") flushOutbox().catch(() => {}); }, [me]);

  if (me === "loading") return <div className="center muted">Loading…</div>;
  if (!me) return <Login onLogin={setMe} />;

  const logout = () => { auth.logout(); setMe(null); };

  return (
    <div className="app">
      <Nav me={me} onLogout={logout} />
      <main className="content">
        <Routes>
          <Route path="/" element={<Home me={me} />} />
          <Route path="/scan" element={<Scan />} />
          <Route path="/inventory" element={<Inventory me={me} />} />
          <Route path="/jobs" element={<Jobs me={me} />} />
          <Route path="/manage" element={<Manage me={me} />} />
          <Route path="/asset/:id" element={<AssetDetail me={me} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
