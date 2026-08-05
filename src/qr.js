// qr.js — thin wrappers over the two vendored libraries (browser-only).
//
//   generation: qrcode-generator (window.qrcode), Byte mode + Latin-1 carrier
//   scanning:   jsQR (window.jsQR), using its binaryData output
//
// We deliberately use jsQR's binaryData rather than the native BarcodeDetector:
// BarcodeDetector only reliably returns a decoded *string*, which mangles the
// raw binary payloads this protocol sends. jsQR hands back the exact bytes.

import { bytesToLatin1, latin1ToBytes } from './protocol.js';

function getQrLib() {
  if (typeof window === 'undefined' || !window.qrcode) {
    throw new Error('qrcode-generator not loaded (vendor/qrcode-generator.js)');
  }
  return window.qrcode;
}
function getJsQR() {
  if (typeof window === 'undefined' || !window.jsQR) {
    throw new Error('jsQR not loaded (vendor/jsQR.js)');
  }
  return window.jsQR;
}

// Build a QR model for the given bytes. ecc: 'L' | 'M' | 'Q' | 'H'.
// typeNumber 0 => auto-pick the smallest version that fits.
export function buildQR(bytes, ecc = 'M') {
  const qrcode = getQrLib();
  const qr = qrcode(0, ecc);
  qr.addData(bytesToLatin1(bytes), 'Byte');
  qr.make();
  return qr;
}

// Render bytes as a QR onto a canvas, sizing modules to (roughly) fill maxPx.
// Returns the QR model (useful for reading getModuleCount()).
export function renderToCanvas(canvas, bytes, { ecc = 'M', maxPx = 512, margin = 4 } = {}) {
  const qr = buildQR(bytes, ecc);
  const count = qr.getModuleCount();
  const total = count + margin * 2;
  const moduleSize = Math.max(1, Math.floor(maxPx / total));
  const dim = total * moduleSize;

  canvas.width = dim;
  canvas.height = dim;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, dim, dim);
  ctx.fillStyle = '#000000';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect((c + margin) * moduleSize, (r + margin) * moduleSize, moduleSize, moduleSize);
      }
    }
  }
  return qr;
}

// Decode a QR from an ImageData. Returns Uint8Array of the raw bytes, or null.
export function scanImageData(imageData) {
  const jsQR = getJsQR();
  const result = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'dontInvert',
  });
  if (!result || !result.binaryData || !result.binaryData.length) return null;
  return Uint8Array.from(result.binaryData);
}

// Convenience for the optical self-test: render bytes, read them straight back
// off the canvas, and decode — exercises the full generate→scan path in-page.
export function roundTripThroughCanvas(bytes, canvas, opts = {}) {
  renderToCanvas(canvas, bytes, opts);
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return scanImageData(img);
}

export { bytesToLatin1, latin1ToBytes };
