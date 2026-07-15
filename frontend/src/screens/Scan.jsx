import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { nfcSupported, scanNfc, scanQr, normalizeUid } from "../lib/scan.js";

export default function Scan() {
  const nav = useNavigate();
  const [mode, setMode] = useState(null); // null | "nfc" | "qr"
  const [status, setStatus] = useState("");
  const [manual, setManual] = useState("");
  const [unknown, setUnknown] = useState(null); // { uid, tagType } for a scanned-but-unregistered tag
  const stopRef = useRef(null);

  useEffect(() => () => { if (stopRef.current) stopRef.current(); }, []);

  async function stopScanner() {
    if (stopRef.current) { await stopRef.current(); stopRef.current = null; }
  }

  async function resolve(uid, tagType = "nfc") {
    setStatus(`Looking up ${uid}…`);
    try {
      const asset = await api.byTag(uid);
      await stopScanner();
      nav(`/asset/${asset.id}`);
    } catch (e) {
      if (e.status === 404) {
        // Unknown tag: offer to register it right here, using the scanned UID.
        await stopScanner();
        setMode(null);
        setStatus("");
        setUnknown({ uid, tagType });
      } else {
        setStatus(e.message || "Lookup failed");
      }
    }
  }

  async function startNfc() {
    setMode("nfc"); setStatus("Hold an NFC tag to the back of the phone…");
    stopRef.current = await scanNfc(
      (uid) => resolve(uid, "nfc"),
      (err) => setStatus(err.message)
    );
  }

  async function startQr() {
    setMode("qr"); setStatus("Point the camera at the QR code or barcode…");
    setTimeout(async () => {
      stopRef.current = await scanQr("qr-reader", (uid) => resolve(uid, "qr"), (err) => setStatus(err.message));
    }, 50);
  }

  async function cancel() {
    await stopScanner();
    setMode(null); setStatus("");
  }

  if (unknown) {
    return <RegisterTag unknown={unknown} onCancel={() => setUnknown(null)} onDone={(id) => nav(`/asset/${id}`)} />;
  }

  return (
    <div className="card">
      <h2>Scan a tag</h2>
      {!mode && (
        <div className="scan-choices">
          {nfcSupported() ? (
            <button className="big" onClick={startNfc}>Tap NFC tag</button>
          ) : (
            <div className="muted small">NFC tap isn't available on this device. Use the QR scanner (this is the normal path on iPhone).</div>
          )}
          <button className="big secondary" onClick={startQr}>Scan QR / barcode</button>
          <div className="divider">or</div>
          <form className="manual" onSubmit={(e) => { e.preventDefault(); if (manual.trim()) resolve(normalizeUid(manual.trim()), "qr"); }}>
            <input placeholder="Enter tag ID manually" value={manual} onChange={(e) => setManual(e.target.value)} />
            <button>Go</button>
          </form>
        </div>
      )}
      {mode === "qr" && <div id="qr-reader" className="qr-reader" />}
      {mode && <button className="linkbtn" onClick={cancel}>Cancel</button>}
      {status && <p className="status">{status}</p>}
    </div>
  );
}

// Register a freshly scanned, unrecognized tag: either create a new asset and
// bind this tag to it, or attach the tag to an existing asset. The scanned UID
// is captured automatically, so nobody has to transcribe it.
function RegisterTag({ unknown, onCancel, onDone }) {
  const { uid, tagType } = unknown;
  const [choice, setChoice] = useState("new"); // "new" | "existing"
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [assets, setAssets] = useState([]);
  const [assetId, setAssetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (choice === "existing" && assets.length === 0) {
      api.assets().then((r) => setAssets(r.results || r)).catch(() => {});
    }
  }, [choice]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      let targetId = assetId;
      if (choice === "new") {
        const asset = await api.createAsset({ code: code.trim(), name: name.trim() });
        targetId = asset.id;
      }
      if (!targetId) throw new Error("Pick an asset to link this tag to.");
      await api.createTag({ asset: targetId, uid, tag_type: tagType });
      onDone(targetId);
    } catch (e2) {
      setErr(e2.message || "Could not register the tag.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>New tag</h2>
      <p className="muted small">
        This tag isn't linked to anything yet. Scanned ID:
      </p>
      <div className="code" style={{ wordBreak: "break-all", marginBottom: 8 }}>{uid}</div>

      <div className="row" style={{ marginBottom: 4 }}>
        <button className={choice === "new" ? "primary" : "secondary"} onClick={() => setChoice("new")}>New asset</button>
        <button className={choice === "existing" ? "primary" : "secondary"} onClick={() => setChoice("existing")}>Existing asset</button>
      </div>

      <form onSubmit={submit}>
        {choice === "new" ? (
          <>
            <label>Asset code
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. TOOL-001" autoFocus />
            </label>
            <label>Name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. DeWalt impact driver" />
            </label>
          </>
        ) : (
          <label>Link to
            <select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              <option value="">Choose an asset…</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
              ))}
            </select>
          </label>
        )}
        {err && <div className="error">{err}</div>}
        <div className="row">
          <button className="primary" disabled={busy || (choice === "new" ? !code.trim() || !name.trim() : !assetId)}>
            {busy ? "Registering…" : "Register tag"}
          </button>
          <button type="button" className="linkbtn" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
