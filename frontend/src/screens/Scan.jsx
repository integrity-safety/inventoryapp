import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { nfcSupported, scanNfc, scanQr, normalizeUid } from "../lib/scan.js";

export default function Scan() {
  const nav = useNavigate();
  const [mode, setMode] = useState(null); // null | "nfc" | "qr"
  const [status, setStatus] = useState("");
  const [manual, setManual] = useState("");
  const stopRef = useRef(null);

  useEffect(() => () => { if (stopRef.current) stopRef.current(); }, []);

  async function resolve(uid) {
    setStatus(`Looking up ${uid}…`);
    try {
      const asset = await api.byTag(uid);
      if (stopRef.current) await stopRef.current();
      nav(`/asset/${asset.id}`);
    } catch (e) {
      if (e.status === 404) setStatus(`No asset is linked to "${uid}" yet. Register it in the admin, then tag it.`);
      else setStatus(e.message || "Lookup failed");
    }
  }

  async function startNfc() {
    setMode("nfc"); setStatus("Hold an NFC tag to the back of the phone…");
    stopRef.current = await scanNfc(
      (uid) => resolve(uid),
      (err) => setStatus(err.message)
    );
  }

  async function startQr() {
    setMode("qr"); setStatus("Point the camera at the QR code or barcode…");
    // Defer so the #qr-reader element is mounted before the camera starts.
    setTimeout(async () => {
      stopRef.current = await scanQr("qr-reader", (uid) => resolve(uid), (err) => setStatus(err.message));
    }, 50);
  }

  async function stop() {
    if (stopRef.current) { await stopRef.current(); stopRef.current = null; }
    setMode(null); setStatus("");
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
          <form className="manual" onSubmit={(e) => { e.preventDefault(); if (manual.trim()) resolve(normalizeUid(manual.trim())); }}>
            <input placeholder="Enter tag ID manually" value={manual} onChange={(e) => setManual(e.target.value)} />
            <button>Go</button>
          </form>
        </div>
      )}
      {mode === "qr" && <div id="qr-reader" className="qr-reader" />}
      {mode && <button className="linkbtn" onClick={stop}>Cancel</button>}
      {status && <p className="status">{status}</p>}
    </div>
  );
}
