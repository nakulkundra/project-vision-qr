// main.js — UI wiring for Send / Receive / Self-test.
//
// BUILD must match the data-build attribute on <body> in index.html. index.html
// and main.js are fetched separately, so a stale cache can pair fresh HTML with
// stale JS — which looks like "the buttons are visible but do nothing". When the
// stamps disagree we say so and offer a one-tap hard refresh.
export const BUILD = 'v9';

import { Sender } from './sender.js';
import { Receiver } from './receiver.js';
import { renderToCanvas, versionForPayload, Scanner } from './qr.js';
import { toHex } from './protocol.js';
import { codecLoopback, opticalLoopback } from './selftest.js';

const $ = (id) => document.getElementById(id);

// --- tab switching ------------------------------------------------------------
const tabButtons = [...document.querySelectorAll('.tabs button')];

function selectTab(btn, focus = false) {
  for (const b of tabButtons) {
    const on = b === btn;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
    // Roving tabindex: only the selected tab is in the tab order, which is what
    // role="tab" requires — arrow keys move between tabs, Tab leaves the strip.
    b.setAttribute('tabindex', on ? '0' : '-1');
  }
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
  $(btn.dataset.tab).classList.add('active');
  if (focus) btn.focus();
}

tabButtons.forEach((btn, i) => {
  btn.addEventListener('click', () => selectTab(btn));
  btn.addEventListener('keydown', (e) => {
    const last = tabButtons.length - 1;
    let target = null;
    if (e.key === 'ArrowRight') target = tabButtons[i === last ? 0 : i + 1];
    else if (e.key === 'ArrowLeft') target = tabButtons[i === 0 ? last : i - 1];
    else if (e.key === 'Home') target = tabButtons[0];
    else if (e.key === 'End') target = tabButtons[last];
    if (target) { e.preventDefault(); selectTab(target, true); }
  });
});

// ============================== SEND ==========================================
let sendTimer = null;
let frameNo = 0;

async function startSend() {
  const fileInput = $('file');
  if (!fileInput.files.length) { alert('Choose a file first.'); return; }
  const file = fileInput.files[0];
  const bytes = new Uint8Array(await file.arrayBuffer());

  const blockSize = Math.max(16, Math.min(2048, +$('blockSize').value || 128));
  const ecc = $('ecc').value;
  const fps = Math.max(1, Math.min(30, +$('fps').value || 8));

  const sender = await new Sender(bytes, file.name, { blockSize }).init();
  frameNo = 0;
  const baseStat =
    `File <b>${escapeHtml(file.name)}</b> · ${bytes.length} bytes · ` +
    `K=<b>${sender.K}</b> blocks · session <b>${sender.sessionId.toString(16).padStart(4, '0')}</b> · ` +
    `SHA-256 <b>${toHex(sender.hash).slice(0, 12)}…</b>`;

  const canvas = $('qr');
  // Use the full available width — bigger modules on screen are the single
  // biggest factor in whether a phone can decode a dense QR.
  // Measure the PANEL, not canvas.parentElement: the parent is the white
  // .qr-plate, which is width:fit-content and therefore sized BY the canvas —
  // measuring it would be circular and collapse the code to a few pixels.
  const host = canvas.closest('.panel') || canvas.parentElement;
  const PANEL_PAD = 32, PLATE_PAD = 24; // horizontal padding either side of each
  const avail = host.clientWidth - PANEL_PAD - PLATE_PAD;
  const maxPx = Math.min(Math.max(220, avail), 640);

  // Density guidance. Measure a representative DATA frame, not the first frame
  // (which is a small META frame and would under-report density — the unsafe
  // direction, since it is the dense DATA frames a camera struggles with).
  // Empirically: 109 modules failed to decode at ~5px/module; 81 decoded fine.
  const perFrame = blockSize + 9; // 5-byte header + 4-byte seed + payload
  // Lock one QR version for the whole session so the code never changes size
  // mid-stream (see buildQR). Sized for the largest frame — the DATA frames.
  let fixedVersion = versionForPayload(perFrame, ecc);
  // QR version 23 at ECC L is not decodable by the vendored jsQR (verified by
  // sweeping versions 5-40 at L and M: L fails only at 23, for every mask and
  // at 2-5px/module). Nudge to the next version so the config can never be a
  // silent 100% failure on the software-decode path (which is every iPhone).
  if (fixedVersion === 23 && ecc === 'L') fixedVersion = 24;
  const dataModules = 4 * fixedVersion + 17;
  const theoretical = ((perFrame * fps) / 1024).toFixed(1);
  const pxPerModule = (maxPx / (dataModules + 8)).toFixed(1);
  const dense = dataModules >= 100 || pxPerModule < 4;
  const statLine = baseStat +
    ` · QR <b>${dataModules}×${dataModules}</b> (${pxPerModule}px/module) · ~<b>${theoretical} KB/s</b> ceiling` +
    (dense ? ` · <span class="warn">very dense — if the receiver can't read it, tap "Reliable" or lower the block size</span>` : '');
  $('sendStat').innerHTML = statLine;

  const tick = () => {
    const frame = sender.nextFrame();
    renderToCanvas(canvas, frame, { ecc, maxPx, version: fixedVersion });
    frameNo++;
    const kind = frame[4] === 1 ? 'META' : 'DATA';
    $('sendStat').dataset.frame = frameNo;
    $('sendStat').title = `frame #${frameNo} (${kind})`;
  };
  tick();

  sendTimer = setInterval(tick, Math.round(1000 / fps));
  $('startSend').disabled = true;
  $('stopSend').disabled = false;
  syncWakeLock();
}

function stopSend() {
  if (sendTimer) clearInterval(sendTimer);
  sendTimer = null;
  $('startSend').disabled = false;
  $('stopSend').disabled = true;
  syncWakeLock();
}

$('startSend').addEventListener('click', () => startSend().catch((e) => alert(e.message)));
$('stopSend').addEventListener('click', stopSend);

// One-tap presets. Turbo trades per-frame QR error correction for payload — the
// fountain code already recovers whole dropped frames, so the ECC redundancy is
// largely duplicated work. Reliable is the fallback for poor light/shaky hands.
function applyPreset(blockSize, ecc, fps, activeId) {
  $('blockSize').value = String(blockSize);
  $('ecc').value = ecc;
  $('fps').value = String(fps);
  // Reflect which preset is selected (drives the segmented-control styling).
  for (const id of ['presetSafe', 'presetTurbo']) {
    $(id)?.setAttribute('aria-pressed', String(id === activeId));
  }
  if (sendTimer) { stopSend(); startSend().catch((e) => alert(e.message)); }
}
$('presetSafe')?.addEventListener('click', () => applyPreset(128, 'M', 8, 'presetSafe'));
$('presetTurbo')?.addEventListener('click', () => applyPreset(512, 'L', 15, 'presetTurbo'));
// Manual edits to the advanced fields mean neither preset is active any more.
for (const id of ['blockSize', 'ecc', 'fps']) {
  $(id)?.addEventListener('input', () => {
    $('presetSafe')?.setAttribute('aria-pressed', 'false');
    $('presetTurbo')?.setAttribute('aria-pressed', 'false');
  });
}

// ============================== RECEIVE =======================================
let stream = null;
let scanning = false;
let receiver = null;
let scanner = null;
let scanFps = 0, _scanFrames = 0, _scanFpsAt = 0;
let _rxStart = 0; // timestamp of first progress event, for throughput/ETA
let camInfo = '';  // actual granted camera resolution/fps, for diagnostics
let _scanArmedAt = 0, _scanWatchdog = null; // scan-loop stall watchdog

async function startRecv() {
  // Decide the decoder FIRST, because it dictates the affordable resolution.
  // The native BarcodeDetector is hardware-accelerated, so a 1080p feed is
  // nearly free and buys resolution for denser (higher-payload) codes. jsQR is
  // pure JS and its cost scales with pixels: a full 1080p frame measured ~615ms
  // per decode (~2 scans/sec), so the software path gets 720p instead. Asking
  // for 1080p on the jsQR path was a real throughput regression.
  scanner = await new Scanner().init();
  const wantHiRes = scanner.mode === 'native';
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: wantHiRes ? 1920 : 1280 },
        height: { ideal: wantHiRes ? 1080 : 720 },
        frameRate: { ideal: 30 },
      },
    });
  } catch (e) {
    $('recvHint').innerHTML =
      `<span class="warn">Camera blocked:</span> ${escapeHtml(e.message)}. ` +
      `A camera requires HTTPS or localhost — see the README.`;
    // recvHint is not a live region, so mirror the failure into one that is.
    $('recvStat').textContent = `Camera could not start: ${e.message}`;
    return;
  }
  const video = $('video');
  video.srcObject = stream;
  await video.play();

  // Report what the camera actually granted. Requested constraints are only a
  // hint — a feed can silently come back at 15fps or a lower resolution, which
  // caps throughput no matter what the sender does.
  try {
    const s = stream.getVideoTracks()[0]?.getSettings?.() || {};
    camInfo = `${s.width || '?'}×${s.height || '?'}@${Math.round(s.frameRate || 0) || '?'}fps`;
  } catch { camInfo = ''; }

  receiver = new Receiver(onProgress, onDone);
  scanning = true;
  _scanFrames = 0; _scanFpsAt = performance.now(); scanFps = 0; _rxStart = 0;
  $('startRecv').disabled = true;
  $('stopRecv').disabled = false;
  $('recvResult').innerHTML = '';
  $('recvStat').textContent =
    `Scanning (${scanner.mode === 'native' ? 'native BarcodeDetector' : 'jsQR'})… point at the sender screen.`;
  scanLoop();
  startScanWatchdog();
  syncWakeLock();
}

// Schedule the next scan pass. requestVideoFrameCallback fires once per NEW
// camera frame, so we never burn CPU re-scanning a frame we already read and
// never miss one; requestAnimationFrame (display refresh) is the fallback.
function scheduleScan(video) {
  if (!scanning) return;
  _scanArmedAt = performance.now();
  if (typeof video.requestVideoFrameCallback === 'function') {
    video.requestVideoFrameCallback(() => { _scanArmedAt = 0; scanLoop(); });
  } else {
    requestAnimationFrame(() => { _scanArmedAt = 0; scanLoop(); });
  }
}

// Watchdog. requestVideoFrameCallback only fires when the camera produces a new
// frame, so if the track stalls (backgrounded tab, device hiccup) the loop is
// never re-armed and scanning dies silently with the UI still saying "Scanning".
// If nothing has fired for a while, kick it with a timer instead.
function startScanWatchdog() {
  clearInterval(_scanWatchdog);
  _scanWatchdog = setInterval(() => {
    if (!scanning) { clearInterval(_scanWatchdog); _scanWatchdog = null; return; }
    if (_scanArmedAt && performance.now() - _scanArmedAt > 1500) {
      _scanArmedAt = 0;
      scanLoop(); // re-enter; scheduleScan will re-arm
    }
  }, 1000);
}

async function scanLoop() {
  if (!scanning) return;
  const video = $('video');
  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    try {
      const frames = await scanner.scanVideo(video);
      for (const bytes of frames) receiver.onFrame(bytes);
    } catch { /* transient scan error — skip this frame */ }
    // Rolling scan-rate estimate (frames processed per second).
    _scanFrames++;
    const now = performance.now();
    if (now - _scanFpsAt >= 500) {
      scanFps = Math.round((_scanFrames * 1000) / (now - _scanFpsAt));
      _scanFrames = 0; _scanFpsAt = now;
      // Live diagnostics before a transfer locks on — shows whether the camera
      // is detecting QRs at all, and whether they are decoding.
      if (!receiver?.meta) {
        const mode = scanner.autoFellBack ? 'jsQR (auto)' : (scanner.mode === 'native' ? 'native' : 'jsQR');
        $('recvStat').innerHTML =
          `Scanning (<b>${mode}</b>) · cam ${camInfo} · ~${scanFps}/s · ` +
          `QRs seen <b>${scanner.rawSeen}</b> · decoded <b>${scanner.decoded}</b> · skipped ${scanner.skipped}` +
          (scanner.rawSeen > 0 && scanner.decoded === 0
            ? ' <span class="warn">— seeing QRs but can\'t decode; hold steady / move closer</span>' : '');
      }
    }
  }
  scheduleScan(video);
}

function onProgress(p) {
  if (p.K) {
    const pct = Math.round((p.recovered / p.K) * 100);
    $('recvBar').style.width = pct + '%';
    $('recvBarWrap')?.setAttribute('aria-valuenow', String(pct));
    // Effective throughput: useful bytes recovered per second since lock-on.
    if (!_rxStart) _rxStart = performance.now();
    const secs = (performance.now() - _rxStart) / 1000;
    const gotBytes = p.recovered * (receiver?.meta?.blockSize || 0);
    const kbs = secs > 0.5 ? (gotBytes / 1024 / secs).toFixed(1) : null;
    const mode = scanner?.autoFellBack ? 'jsQR' : (scanner?.mode === 'native' ? 'native' : 'jsQR');
    const rate = scanFps ? ` · ~${scanFps} scans/s (${mode})` : '';
    const thru = kbs ? ` · <b>${kbs} KB/s</b>` : '';
    const eta = (kbs > 0 && p.recovered > 0)
      ? ` · ETA ${Math.max(0, Math.round(((p.K - p.recovered) * (receiver.meta.blockSize)) / (gotBytes / secs)))}s` : '';
    $('recvStat').innerHTML =
      `Receiving <b>${escapeHtml(p.filename || '')}</b> · ` +
      `recovered <b>${p.recovered}/${p.K}</b> blocks (${pct}%) · ${p.packetsSeen} packets${rate}${thru}${eta}`;
  } else {
    $('recvStat').innerHTML =
      `Waiting for the sender's info frame… ${p.buffered || 0} data packets buffered ` +
      `<span class="hint">(keep pointing at the screen — it is sent every couple of seconds)</span>`;
  }
  // The sender restarted (e.g. a preset was tapped) after we had real progress.
  if (p.sessionChanged) {
    $('recvStat').innerHTML +=
      ` · <span class="warn">sender restarted mid-transfer — switching to the new one…</span>`;
  }
}

function onDone(result) {
  scanning = false;
  clearScanWatchdog();
  stopStream();
  syncWakeLock();
  $('startRecv').disabled = false;
  $('stopRecv').disabled = true;
  $('recvBar').style.width = '100%';
  $('recvBarWrap')?.setAttribute('aria-valuenow', '100');

  const blob = new Blob([result.bytes]);
  const url = URL.createObjectURL(blob);
  const cls = result.verified ? 'ok' : 'bad';
  const badge = result.verified ? '✓ SHA-256 verified' : '⚠ SHA-256 MISMATCH — file may be corrupt';
  $('recvResult').innerHTML =
    `<div class="result ${cls}"><div><b>${badge}</b></div>` +
    `<div class="stat">${escapeHtml(result.filename || 'file')} · ${result.bytes.length} bytes</div>` +
    `<a class="download" href="${url}" download="${escapeAttr(result.filename || 'received.bin')}">Download file</a></div>`;
  $('recvStat').textContent = 'Transfer complete.';
}

function clearScanWatchdog() {
  if (_scanWatchdog) { clearInterval(_scanWatchdog); _scanWatchdog = null; }
  _scanArmedAt = 0;
}

function stopStream() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
}
function stopRecv() {
  scanning = false;
  clearScanWatchdog();
  stopStream();
  syncWakeLock();
  $('startRecv').disabled = false;
  $('stopRecv').disabled = true;
  $('recvStat').textContent = 'Camera stopped.';
}

$('startRecv').addEventListener('click', startRecv);
$('stopRecv').addEventListener('click', stopRecv);

// ============================== SELF-TEST =====================================
function logLine(s) { $('testLog').textContent += '\n' + s; }
function clearLog() { $('testLog').textContent = 'Running…'; }

$('runCodec').addEventListener('click', async () => {
  clearLog();
  const cases = [
    { size: 5000, blockSize: 128, dropRate: 0.3 },
    { size: 20000, blockSize: 128, dropRate: 0.4 },
    { size: 50000, blockSize: 192, dropRate: 0.5 },
  ];
  let ok = true;
  for (const c of cases) {
    const r = await codecLoopback(c);
    ok = ok && r.ok;
    logLine(`${r.ok ? 'PASS' : 'FAIL'}  size=${r.size} K=${r.K} drop=${r.dropRate * 100}% ` +
      `packets=${r.packetsSeen} overhead=${r.overhead}x verified=${r.verified}`);
  }
  logLine(ok ? '\nALL PASSED ✓' : '\nSOME FAILED ✗');
});

$('runOptical').addEventListener('click', async () => {
  clearLog();
  logLine('Rendering + scanning real QR codes (this takes a few seconds)…');
  try {
    const r = await opticalLoopback({ size: 2500, blockSize: 96, dropRate: 0.1 });
    logLine(`${r.ok ? 'PASS' : 'FAIL'}  size=${r.size} K=${r.K} ecc=${r.ecc} ` +
      `rendered=${r.framesRendered} decoded=${r.framesDecoded} verified=${r.verified} identical=${r.identical}`);
    logLine(r.ok ? '\nOPTICAL PATH OK ✓' : '\nOPTICAL PATH FAILED ✗');
  } catch (e) {
    logLine('ERROR: ' + e.message);
  }
});

// ============================== SCREEN WAKE LOCK ==============================
// Neither device is touched during a transfer, so the sender's screen dims and
// sleeps and the QR stream stops. Hold a wake lock while sending or receiving.
// The API drops the lock whenever the page is hidden, so re-acquire on
// visibilitychange. Unsupported browsers (notably iOS < 16.4) just no-op.
let _wakeLock = null;
let _wakeWanted = false;

async function acquireWakeLock() {
  _wakeWanted = true;
  if (!('wakeLock' in navigator)) return;
  if (_wakeLock) return;
  try {
    _wakeLock = await navigator.wakeLock.request('screen');
    _wakeLock.addEventListener('release', () => { _wakeLock = null; });
  } catch { /* denied (e.g. low battery) — transfer still works, screen may sleep */ }
}

async function releaseWakeLock() {
  _wakeWanted = false;
  try { await _wakeLock?.release(); } catch { /* already gone */ }
  _wakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && _wakeWanted) acquireWakeLock();
});

// True while either direction is active, so one side stopping does not release
// a lock the other side still needs.
function syncWakeLock() {
  if (sendTimer || scanning) acquireWakeLock();
  else releaseWakeLock();
}

// ============================== BUILD INTEGRITY ===============================
// Nuke every cache + service worker and reload from the network. This is the
// escape hatch when an installed PWA is stuck on stale code.
async function hardRefresh() {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
    await Promise.all(regs.map((r) => r.unregister()));
  } catch { /* ignore */ }
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch { /* ignore */ }
  location.replace(location.pathname + '?fresh=' + Date.now());
}
$('forceUpdate')?.addEventListener('click', hardRefresh);

let _mixedBuild = false;
(function checkBuild() {
  const htmlBuild = document.body.dataset.build;
  if (htmlBuild && htmlBuild !== BUILD) {
    _mixedBuild = true;
    const el = $('offlineStatus');
    if (el) {
      el.innerHTML =
        `<span class="warn">Mixed build: page ${escapeHtml(htmlBuild)} but script ${BUILD} — ` +
        `some controls may not work.</span> `;
      const b = document.createElement('button');
      b.textContent = 'Fix now';
      b.style.cssText = 'margin-left:6px;padding:2px 8px;border-radius:6px;border:1px solid var(--border);background:var(--accent);color:#04211c;font-weight:600;cursor:pointer;';
      b.addEventListener('click', hardRefresh);
      el.appendChild(b);
    }
  }
})();

// ============================== PWA / OFFLINE =================================
// Register the service worker so the app shell is cached for offline use.
if ('serviceWorker' in navigator) {
  // When a new service worker takes control, reload once so the page is not
  // left pairing fresh HTML with stale cached modules.
  let _swReloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (_swReloaded) return;
    _swReloaded = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').then((reg) => {
      const ready = reg.active || reg.waiting;
      if (ready) markOfflineReady();
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (sw) sw.addEventListener('statechange', () => { if (sw.state === 'activated') markOfflineReady(); });
      });
    }).catch(() => { /* offline caching unavailable; app still works online */ });
  });
}
function markOfflineReady() {
  // Never clobber the mixed-build warning: the service worker registers on
  // 'load', i.e. AFTER checkBuild() runs, so overwriting here used to delete
  // the "Fix now" recovery button moments after it appeared — removing the one
  // affordance that repairs the very state being reported.
  if (_mixedBuild) return;
  const el = $('offlineStatus');
  if (el) el.innerHTML = '✓ Ready to work offline';
}

// Installability: capture the prompt and expose an Install button.
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  const btn = $('installBtn');
  if (btn) btn.style.display = '';
});
$('installBtn')?.addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
  $('installBtn').style.display = 'none';
});
window.addEventListener('appinstalled', () => {
  deferredInstall = null;
  const btn = $('installBtn');
  if (btn) btn.style.display = 'none';
  const el = $('offlineStatus');
  if (el) el.innerHTML = '✓ Installed · ready to work offline';
});

// --- small helpers ------------------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
