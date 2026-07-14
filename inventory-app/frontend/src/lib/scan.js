// Scanning layer. Two independent paths:
//   NFC  -> Web NFC (NDEFReader). Chrome for Android only, HTTPS only.
//   QR   -> html5-qrcode, which uses the camera + a JS decoder. Works on
//           Android AND iOS Safari, so it is the universal fallback and the
//           entire scan path on iPhones.
// Both resolve to a single string "uid" that we look up via /assets/by-tag/.
import { Html5Qrcode } from "html5-qrcode";

export const nfcSupported = () => typeof window !== "undefined" && "NDEFReader" in window;

// Start an NFC scan. Calls onRead(uid, records) when a tag is tapped.
// Returns an abort function. Requires a user gesture to call.
export async function scanNfc(onRead, onError) {
  if (!nfcSupported()) {
    onError && onError(new Error("This device/browser can't read NFC. Use the QR scanner."));
    return () => {};
  }
  const reader = new NDEFReader();
  const controller = new AbortController();
  try {
    await reader.scan({ signal: controller.signal });
    reader.onreading = (event) => {
      // Prefer any URL/text record payload; fall back to the chip serial.
      let payload = null;
      for (const record of event.message.records) {
        if (record.recordType === "url" || record.recordType === "text") {
          try {
            payload = new TextDecoder(record.encoding || "utf-8").decode(record.data);
            break;
          } catch { /* ignore */ }
        }
      }
      const uid = payload || event.serialNumber;
      onRead(normalizeUid(uid), { serialNumber: event.serialNumber, payload });
    };
    reader.onreadingerror = () => onError && onError(new Error("Couldn't read that tag. Try again."));
  } catch (e) {
    onError && onError(e);
  }
  return () => controller.abort();
}

// Start a QR/barcode camera scan into the element with id=elementId.
// Returns a stop() function. onRead(uid) fires on the first successful decode.
export async function scanQr(elementId, onRead, onError) {
  const scanner = new Html5Qrcode(elementId, { verbose: false });
  try {
    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 240, height: 240 } },
      (decoded) => onRead(normalizeUid(decoded)),
      () => {} // per-frame decode failures are normal; ignore
    );
  } catch (e) {
    onError && onError(new Error("Couldn't open the camera. Check permissions."));
  }
  return async () => {
    try { await scanner.stop(); scanner.clear(); } catch { /* ignore */ }
  };
}

// If the tag encodes a full deep-link URL (e.g. https://app/scan/UID or
// .../by-tag/UID), pull out the trailing identifier. Otherwise use as-is.
export function normalizeUid(raw) {
  if (!raw) return raw;
  const s = String(raw).trim();
  const m = s.match(/(?:scan|by-tag|t)\/([^/?#]+)\/?$/i);
  return m ? decodeURIComponent(m[1]) : s;
}
