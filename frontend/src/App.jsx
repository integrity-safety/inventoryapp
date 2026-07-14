import { useEffect, useState } from "react";
import { Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import { auth } from "./lib/api.js";
import { flushOutbox, pendingCount } from "./lib/db.js";
import Login from "./screens/Login.jsx";
import Scan from "./screens/Scan.jsx";
import AssetDetail from "./screens/AssetDetail.jsx";
import Inventory from "./screens/Inventory.jsx";

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
  useEffect(() => {
    const tick = () => pendingCount().then(setPending);
    tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, []);
  const tab = (to, label) => (
    <Link to={to} className={loc.pathname === to ? "tab active" : "tab"}>{label}</Link>
  );
  return (
    <header className="topbar">
      <div className="brand">Inventory</div>
      <nav className="tabs">
        {tab("/", "Scan")}
        {tab("/inventory", "Inventory")}
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

  useEffect(() => {
    if (me && me !== "loading") flushOutbox().catch(() => {});
  }, [me]);

  if (me === "loading") return <div className="center muted">Loading…</div>;
  if (!me) return <Login onLogin={setMe} />;

  const logout = () => { auth.logout(); setMe(null); };

  return (
    <div className="app">
      <Nav me={me} onLogout={logout} />
      <main className="content">
        <Routes>
          <Route path="/" element={<Scan />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/asset/:id" element={<AssetDetail me={me} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
