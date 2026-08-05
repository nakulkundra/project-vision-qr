// qr.js — QR generation + scanning (browser-only).
//
//   generation: qrcode-generator (window.qrcode), base45 + Alphanumeric mode
//   scanning:   Scanner class — native BarcodeDetector fast-path (hardware
//               accelerated) with a jsQR fallback that crops to the tracked QR
//               region to keep per-frame decode cost low.
//
// Both scanners read the same base45/alphanumeric frames (see transport.js).

import { encodeBase45, decodeBase45, decodeScanned } from './transport.js';

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

// Build a QR model for the given frame bytes (base45 + Alphanumeric mode).
// version: 0 => auto-pick the smallest that fits; >=1 => force that QR version.
// Forcing a version keeps every frame the SAME physical size, which matters a
// lot: a QR that changes size between frames makes the receiving camera re-hunt
// focus and exposure and invalidates scan-region tracking, costing frames.
export function buildQR(bytes, ecc = 'M', version = 0) {
  const qrcode = getQrLib();
  const qr = qrcode(version, ecc);
  qr.addData(encodeBase45(bytes), 'Alphanumeric');
  qr.make();
  return qr;
}

// QR version <-> module count: modules = 4 * version + 17.
export function versionFromModules(moduleCount) {
  return Math.round((moduleCount - 17) / 4);
}

// The QR version needed to carry `payloadBytes` at `ecc`. Use this once up front
// so every frame (including the smaller META frames) renders at one fixed size.
export function versionForPayload(payloadBytes, ecc = 'M') {
  const probe = buildQR(new Uint8Array(payloadBytes), ecc, 0);
  return versionFromModules(probe.getModuleCount());
}

// Scratch canvas for one-pixel-per-module rendering, reused across frames.
let _tiny = null;

// Render frame bytes as a QR onto a canvas, sizing modules to (roughly) fill maxPx.
//
// Fast path: paint the QR at 1 pixel per module into a tiny offscreen canvas via
// a single putImageData, then scale it up with one drawImage and image smoothing
// disabled. The naive approach issues one fillRect per dark module — 1000-2000+
// calls per frame for a mid-size QR — which caps the achievable frame rate. This
// version is O(1) canvas calls and produces pixel-identical crisp output.
export function renderToCanvas(canvas, bytes, { ecc = 'M', maxPx = 512, margin = 4, version = 0 } = {}) {
  const qr = buildQR(bytes, ecc, version);
  const count = qr.getModuleCount();
  const total = count + margin * 2;
  const moduleSize = Math.max(1, Math.floor(maxPx / total));
  const dim = total * moduleSize;

  if (!_tiny) _tiny = document.createElement('canvas');
  if (_tiny.width !== total || _tiny.height !== total) { _tiny.width = total; _tiny.height = total; }
  const tctx = _tiny.getContext('2d', { willReadFrequently: true });
  const img = tctx.createImageData(total, total);
  const px = img.data;
  px.fill(255); // white, opaque (alpha included)
  for (let r = 0; r < count; r++) {
    const rowBase = ((r + margin) * total + margin) * 4;
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        const o = rowBase + c * 4;
        px[o] = 0; px[o + 1] = 0; px[o + 2] = 0; // alpha already 255
      }
    }
  }
  tctx.putImageData(img, 0, 0);

  if (canvas.width !== dim || canvas.height !== dim) { canvas.width = dim; canvas.height = dim; }
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(_tiny, 0, 0, total, total, 0, 0, dim, dim);
  return qr;
}

// Decode a QR from an ImageData (jsQR). Returns frame bytes, or null.
// Used by the optical self-test and by the Scanner's jsQR fallback.
export function scanImageData(imageData) {
  const jsQR = getJsQR();
  const res = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
  if (!res || !res.data) return null;
  return decodeScanned(res.data);
}

// ---------------------------------------------------------------------------
// Scanner: strategy object for the live camera loop.
//   - Prefers the native BarcodeDetector (fast, hardware-accelerated). It can
//     also return MULTIPLE codes per frame.
//   - Falls back to jsQR, cropping to the last-seen QR bounding box so decode
//     cost tracks the QR size, not the whole camera frame.
// scanVideo(video) returns an array of decoded frame-byte Uint8Arrays.
// ---------------------------------------------------------------------------
export class Scanner {
  constructor() {
    this.detector = null;
    this.mode = 'jsqr';        // 'native' | 'jsqr'
    this._canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    this.roi = null;           // { x, y, w, h } in video pixels, or null = full
    this._miss = 0;
    // Diagnostics + native->jsQR auto-fallback bookkeeping.
    this.rawSeen = 0;          // QR codes the scanner physically detected
    this.decoded = 0;          // of those, ones that base45-decoded to a frame
    this._sinceDecode = 0;     // native scans in a row that produced no frame
    this.autoFellBack = false; // flipped true if we gave up on native
  }

  async init() {
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        if (formats.includes('qr_code')) {
          this.detector = new window.BarcodeDetector({ formats: ['qr_code'] });
          this.mode = 'native';
        }
      } catch { /* fall back to jsQR */ }
    }
    return this;
  }

  async scanVideo(video) {
    if (this.mode === 'native') {
      let codes;
      try {
        codes = await this.detector.detect(video);
      } catch {
        // detect() unavailable/broken on this device — switch to jsQR for good.
        this._fallback();
        return this._scanJsQR(video);
      }
      const out = [];
      for (const c of codes) {
        this.rawSeen++;
        const bytes = decodeScanned(c.rawValue);
        if (bytes) { out.push(bytes); this.decoded++; }
      }
      // If native DETECTS QR codes but none of them decode, it is mangling the
      // payload — hand off to jsQR, which is proven to read these frames.
      // Only count scans that actually saw a code: an empty `codes` array just
      // means the camera is not aimed at a QR yet, and counting those would
      // abandon the fast native path within a fraction of a second of startup.
      if (out.length) {
        this._sinceDecode = 0;
      } else if (codes.length > 0 && ++this._sinceDecode >= 15 && this.decoded === 0) {
        this._fallback();
        return this._scanJsQR(video);
      }
      return out;
    }
    return this._scanJsQR(video);
  }

  _fallback() {
    this.mode = 'jsqr';
    this.autoFellBack = true;
    this.roi = null;
  }

  _scanJsQR(video) {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h || !this._canvas) return [];
    const canvas = this._canvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    // Only resize when the source dimensions actually change: assigning width/
    // height reallocates and clears the backing store every frame otherwise.
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.drawImage(video, 0, 0, w, h);

    let rx = 0, ry = 0, rw = w, rh = h;
    if (this.roi) { rx = this.roi.x; ry = this.roi.y; rw = this.roi.w; rh = this.roi.h; }

    const img = ctx.getImageData(rx, ry, rw, rh);
    const jsQR = getJsQR();
    const res = jsQR(img.data, rw, rh, { inversionAttempts: 'dontInvert' });
    if (res && res.data) {
      this.rawSeen++;
      this._updateROI(res.location, rx, ry, w, h);
      this._miss = 0;
      const bytes = decodeScanned(res.data);
      if (bytes) { this.decoded++; return [bytes]; }
      return [];
    }
    if (++this._miss > 3) this.roi = null; // lost it — widen back to full frame
    return [];
  }

  // Grow the ROI to the QR's bounding box (in full-frame coords) plus padding,
  // so small motion between frames stays inside the crop.
  _updateROI(loc, offX, offY, w, h) {
    if (!loc) { this.roi = null; return; }
    const xs = [loc.topLeftCorner, loc.topRightCorner, loc.bottomLeftCorner, loc.bottomRightCorner].map((p) => p.x + offX);
    const ys = [loc.topLeftCorner, loc.topRightCorner, loc.bottomLeftCorner, loc.bottomRightCorner].map((p) => p.y + offY);
    let minX = Math.min(...xs), maxX = Math.max(...xs);
    let minY = Math.min(...ys), maxY = Math.max(...ys);
    const padX = (maxX - minX) * 0.45, padY = (maxY - minY) * 0.45;
    minX = Math.max(0, Math.floor(minX - padX));
    minY = Math.max(0, Math.floor(minY - padY));
    maxX = Math.min(w, Math.ceil(maxX + padX));
    maxY = Math.min(h, Math.ceil(maxY + padY));
    const rw = maxX - minX, rh = maxY - minY;
    this.roi = rw > 16 && rh > 16 ? { x: minX, y: minY, w: rw, h: rh } : null;
  }
}

export { encodeBase45, decodeBase45, decodeScanned };
