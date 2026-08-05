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

// Cheap perceptual fingerprint of an ImageData: threshold a sparse 16x16 grid
// of samples into a 256-bit signature, returned as a hex string. Identical
// captures of the same on-screen QR produce identical signatures, so this is
// used only to skip redundant decodes — never to accept or reject data.
function fingerprint(img) {
  const { data, width, height } = img;
  const N = 16;
  let bits = '';
  let acc = 0, n = 0;
  const samples = new Array(N * N);
  for (let gy = 0; gy < N; gy++) {
    const y = Math.min(height - 1, Math.floor(((gy + 0.5) * height) / N));
    for (let gx = 0; gx < N; gx++) {
      const x = Math.min(width - 1, Math.floor(((gx + 0.5) * width) / N));
      const o = (y * width + x) * 4;
      const lum = (data[o] * 299 + data[o + 1] * 587 + data[o + 2] * 114) / 1000;
      samples[n++] = lum;
      acc += lum;
    }
  }
  const mean = acc / n;
  for (let i = 0; i < n; i += 4) {
    let nib = 0;
    for (let k = 0; k < 4; k++) if (samples[i + k] > mean) nib |= 1 << k;
    bits += nib.toString(16);
  }
  return bits;
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
    this._ctx = null;          // cached 2D context (resizing does not void it)
    this._fp = null;           // fingerprint of the last decoded image
    this.skipped = 0;          // frames skipped as pixel-identical
    // jsQR cost scales with pixel count, so bound what we hand it — but CROP,
    // do not SCALE. Measured: handing jsQR a full 1920x1080 frame costs ~615ms
    // per decode (~2 scans/sec, and worse on a phone). Naively downscaling to
    // fit is a trap: it took an 81-module QR to ~3.6px/module and NOTHING
    // decoded at all, because jsQR needs roughly 5px/module at that density.
    // So: crop tightly, and only downscale when the crop is comfortably larger
    // than the ~6px/module a dense (up to ~117-module) code needs.
    this.maxSearchPx = 1280;   // effectively no downscale on a 720p feed
    this.maxLockedPx = 720;    // 720/117 modules ~= 6px/module: safe to scale to
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

    // Source rectangle: the tracked QR region if we have one, else the frame.
    let sx = 0, sy = 0, sw = w, sh = h;
    if (this.roi) { sx = this.roi.x; sy = this.roi.y; sw = this.roi.w; sh = this.roi.h; }

    // Crop AND downscale in a single drawImage. This is the dominant cost lever
    // on the software path: it bounds decode work regardless of camera
    // resolution, which is what makes a 1080p/1440p feed affordable.
    const cap = this.roi ? this.maxLockedPx : this.maxSearchPx;
    const scale = Math.min(1, cap / Math.max(sw, sh));
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));

    const canvas = this._canvas;
    // Only resize when dimensions change: assigning width/height reallocates
    // and clears the backing store.
    if (canvas.width !== dw || canvas.height !== dh) { canvas.width = dw; canvas.height = dh; }
    const ctx = this._ctx || (this._ctx = canvas.getContext('2d', { willReadFrequently: true }));
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);

    const img = ctx.getImageData(0, 0, dw, dh);

    // The same QR stays on screen for several camera frames, so most captures
    // are pixel-identical to one we already decoded. Fingerprint cheaply and
    // skip the decode — that CPU is better spent catching the next frame.
    const fp = fingerprint(img);
    if (this._fp !== null && fp === this._fp) { this.skipped++; return []; }
    this._fp = fp;

    const jsQR = getJsQR();
    const res = jsQR(img.data, dw, dh, { inversionAttempts: 'dontInvert' });
    if (res && res.data) {
      this.rawSeen++;
      this._updateROI(res.location, sx, sy, w, h, scale);
      this._miss = 0;
      const bytes = decodeScanned(res.data);
      if (bytes) { this.decoded++; return [bytes]; }
      return [];
    }
    if (++this._miss > 3) { this.roi = null; this._fp = null; } // lost it — widen out
    return [];
  }

  // Grow the ROI to the QR's bounding box (in full-frame coords) plus padding,
  // so small motion between frames stays inside the crop. `scale` undoes the
  // downscale applied before decoding: jsQR reports coordinates in the
  // downscaled image, so divide by scale before adding the crop offset.
  _updateROI(loc, offX, offY, w, h, scale = 1) {
    if (!loc) { this.roi = null; return; }
    const inv = scale > 0 ? 1 / scale : 1;
    const corners = [loc.topLeftCorner, loc.topRightCorner, loc.bottomLeftCorner, loc.bottomRightCorner];
    const xs = corners.map((p) => p.x * inv + offX);
    const ys = corners.map((p) => p.y * inv + offY);
    let minX = Math.min(...xs), maxX = Math.max(...xs);
    let minY = Math.min(...ys), maxY = Math.max(...ys);
    // Keep the pad tight. At 45% the padded box exceeded the frame whenever the
    // QR filled much of the view, so the "crop" was the whole frame and bought
    // nothing (measured: 1280x720 fed to jsQR even with an ROI locked). 15% is
    // still ample for hand tremor between consecutive frames.
    const padX = (maxX - minX) * 0.15, padY = (maxY - minY) * 0.15;
    minX = Math.max(0, Math.floor(minX - padX));
    minY = Math.max(0, Math.floor(minY - padY));
    maxX = Math.min(w, Math.ceil(maxX + padX));
    maxY = Math.min(h, Math.ceil(maxY + padY));
    const rw = maxX - minX, rh = maxY - minY;
    this.roi = rw > 16 && rh > 16 ? { x: minX, y: minY, w: rw, h: rh } : null;
  }
}

export { encodeBase45, decodeBase45, decodeScanned };
