// main.js — UI wiring for Send / Receive / Self-test.

import { Sender } from './sender.js';
import { Receiver } from './receiver.js';
import { renderToCanvas, Scanner } from './qr.js';
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

  const blockSize = Math.max(16, Math.min(1024, +$('blockSize').value || 128));
  const ecc = $('ecc').value;
  const fps = Math.max(1, Math.min(20, +$('fps').value || 8));

  const sender = await new Sender(bytes, file.name, { blockSize }).init();
  frameNo = 0;
  $('sendStat').innerHTML =
    `File <b>${escapeHtml(file.name)}</b> · ${bytes.length} bytes · ` +
    `K=<b>${sender.K}</b> blocks · session <b>${sender.sessionId.toString(16).padStart(4, '0')}</b> · ` +
    `SHA-256 <b>${toHex(sender.hash).slice(0, 12)}…</b>`;

  const canvas = $('qr');
  const tick = () => {
    const frame = sender.nextFrame();
    renderToCanvas(canvas, frame, { ecc, maxPx: Math.min(canvas.parentElement.clientWidth, 480) });
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

// ============================== RECEIVE =======================================
let stream = null;
let scanning = false;
let receiver = null;
let scanner = null;
let scanFps = 0, _scanFrames = 0, _scanFpsAt = 0;

async function startRecv() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
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
  _scanFrames = 0; _scanFpsAt = performance.now(); scanFps = 0;
  $('startRecv').disabled = true;
  $('stopRecv').disabled = false;
  $('recvResult').innerHTML = '';
  $('recvStat').textContent =
    `Scanning (${scanner.mode === 'native' ? 'native BarcodeDetector' : 'jsQR'})… point at the sender screen.`;
  scanLoop();
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
    }
  }
  if (scanning) requestAnimationFrame(scanLoop);
}

function onProgress(p) {
  if (p.K) {
    const pct = Math.round((p.recovered / p.K) * 100);
    $('recvBar').style.width = pct + '%';
    const rate = scanFps ? ` · ~${scanFps} scans/s (${scanner?.mode === 'native' ? 'native' : 'jsQR'})` : '';
    $('recvStat').innerHTML =
      `Receiving <b>${escapeHtml(p.filename || '')}</b> · ` +
      `recovered <b>${p.recovered}/${p.K}</b> blocks (${pct}%) · ${p.packetsSeen} packets seen${rate}`;
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

// --- small helpers ------------------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
