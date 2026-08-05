// main.js — UI wiring for Send / Receive / Self-test.

import { Sender } from './sender.js';
import { Receiver } from './receiver.js';
import { renderToCanvas, buildQR, Scanner } from './qr.js';
import { toHex } from './protocol.js';
import { codecLoopback, opticalLoopback } from './selftest.js';

const $ = (id) => document.getElementById(id);

// --- tab switching ------------------------------------------------------------
document.querySelectorAll('.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $(btn.dataset.tab).classList.add('active');
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

  const blockSize = Math.max(16, Math.min(2048, +$('blockSize').value || 256));
  const ecc = $('ecc').value;
  const fps = Math.max(1, Math.min(30, +$('fps').value || 12));

  const sender = await new Sender(bytes, file.name, { blockSize }).init();
  frameNo = 0;
  const baseStat =
    `File <b>${escapeHtml(file.name)}</b> · ${bytes.length} bytes · ` +
    `K=<b>${sender.K}</b> blocks · session <b>${sender.sessionId.toString(16).padStart(4, '0')}</b> · ` +
    `SHA-256 <b>${toHex(sender.hash).slice(0, 12)}…</b>`;

  const canvas = $('qr');
  // Use the full available width — bigger modules on screen are the single
  // biggest factor in whether a phone can decode a dense QR.
  const maxPx = Math.min(canvas.parentElement.clientWidth, 640);

  // Density guidance. Measure a representative DATA frame, not the first frame
  // (which is a small META frame and would under-report density — the unsafe
  // direction, since it is the dense DATA frames a camera struggles with).
  // Empirically: 109 modules failed to decode at ~5px/module; 81 decoded fine.
  const perFrame = blockSize + 9; // 5-byte header + 4-byte seed + payload
  const dataModules = buildQR(new Uint8Array(perFrame), ecc).getModuleCount();
  const theoretical = ((perFrame * fps) / 1024).toFixed(1);
  const pxPerModule = (maxPx / (dataModules + 8)).toFixed(1);
  const dense = dataModules >= 100 || pxPerModule < 4;
  const statLine = baseStat +
    ` · QR <b>${dataModules}×${dataModules}</b> (${pxPerModule}px/module) · ~<b>${theoretical} KB/s</b> ceiling` +
    (dense ? ` · <span class="warn">very dense — if the receiver can't read it, tap "Reliable" or lower the block size</span>` : '');
  $('sendStat').innerHTML = statLine;

  const tick = () => {
    const frame = sender.nextFrame();
    renderToCanvas(canvas, frame, { ecc, maxPx });
    frameNo++;
    const kind = frame[4] === 1 ? 'META' : 'DATA';
    $('sendStat').dataset.frame = frameNo;
    $('sendStat').title = `frame #${frameNo} (${kind})`;
  };
  tick();

  sendTimer = setInterval(tick, Math.round(1000 / fps));
  $('startSend').disabled = true;
  $('stopSend').disabled = false;
}

function stopSend() {
  if (sendTimer) clearInterval(sendTimer);
  sendTimer = null;
  $('startSend').disabled = false;
  $('stopSend').disabled = true;
}

$('startSend').addEventListener('click', () => startSend().catch((e) => alert(e.message)));
$('stopSend').addEventListener('click', stopSend);

// One-tap presets. Turbo trades per-frame QR error correction for payload — the
// fountain code already recovers whole dropped frames, so the ECC redundancy is
// largely duplicated work. Reliable is the fallback for poor light/shaky hands.
function applyPreset(blockSize, ecc, fps) {
  $('blockSize').value = String(blockSize);
  $('ecc').value = ecc;
  $('fps').value = String(fps);
  if (sendTimer) { stopSend(); startSend().catch((e) => alert(e.message)); }
}
$('presetSafe')?.addEventListener('click', () => applyPreset(128, 'M', 8));
$('presetTurbo')?.addEventListener('click', () => applyPreset(512, 'L', 15));

// ============================== RECEIVE =======================================
let stream = null;
let scanning = false;
let receiver = null;
let scanner = null;
let scanFps = 0, _scanFrames = 0, _scanFpsAt = 0;
let _rxStart = 0; // timestamp of first progress event, for throughput/ETA

async function startRecv() {
  try {
    // Higher resolution resolves denser QR codes (which is what lets us raise
    // the payload per frame); a high frameRate raises the scan ceiling.
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 1920 }, height: { ideal: 1080 },
        frameRate: { ideal: 30 },
      },
    });
  } catch (e) {
    $('recvHint').innerHTML =
      `<span class="warn">Camera blocked:</span> ${escapeHtml(e.message)}. ` +
      `A camera requires HTTPS or localhost — see the README.`;
    return;
  }
  const video = $('video');
  video.srcObject = stream;
  await video.play();

  receiver = new Receiver(onProgress, onDone);
  scanner = await new Scanner().init();
  scanning = true;
  _scanFrames = 0; _scanFpsAt = performance.now(); scanFps = 0; _rxStart = 0;
  $('startRecv').disabled = true;
  $('stopRecv').disabled = false;
  $('recvResult').innerHTML = '';
  $('recvStat').textContent =
    `Scanning (${scanner.mode === 'native' ? 'native BarcodeDetector' : 'jsQR'})… point at the sender screen.`;
  scanLoop();
}

// Schedule the next scan pass. requestVideoFrameCallback fires once per NEW
// camera frame, so we never burn CPU re-scanning a frame we already read and
// never miss one; requestAnimationFrame (display refresh) is the fallback.
function scheduleScan(video) {
  if (!scanning) return;
  if (typeof video.requestVideoFrameCallback === 'function') {
    video.requestVideoFrameCallback(() => scanLoop());
  } else {
    requestAnimationFrame(() => scanLoop());
  }
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
          `Scanning (${mode}) · ~${scanFps}/s · QRs seen <b>${scanner.rawSeen}</b> · decoded <b>${scanner.decoded}</b>` +
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
    $('recvStat').innerHTML = `Waiting for a META frame… (${p.packetsSeen} data packets buffered)`;
  }
}

function onDone(result) {
  scanning = false;
  stopStream();
  $('startRecv').disabled = false;
  $('stopRecv').disabled = true;
  $('recvBar').style.width = '100%';

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

function stopStream() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
}
function stopRecv() {
  scanning = false;
  stopStream();
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

// ============================== PWA / OFFLINE =================================
// Register the service worker so the app shell is cached for offline use.
if ('serviceWorker' in navigator) {
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
