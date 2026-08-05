// selftest.js — loopback verification with no camera and no second device.
//
// codecLoopback: sender frame bytes -> (lossy channel) -> receiver, exercising
//   the fountain codec + protocol. Runs in Node AND the browser (no DOM used),
//   and is the primary automated proof that the protocol survives dropped
//   frames and reconstructs a byte-identical, SHA-verified file.
//
// opticalLoopback: additionally renders each frame to a real QR on a canvas and
//   scans it back with jsQR before feeding the receiver — browser only, slower,
//   proves the generate->scan path (qr.js) too.

import { Sender } from './sender.js';
import { Receiver } from './receiver.js';
import { toHex } from './protocol.js';

export function randomBytes(n) {
  const out = new Uint8Array(n);
  // Web Crypto is available in browsers and Node >= 20 (globalThis.crypto).
  const CHUNK = 65536;
  for (let off = 0; off < n; off += CHUNK) {
    crypto.getRandomValues(out.subarray(off, Math.min(off + CHUNK, n)));
  }
  return out;
}

// Run one sender frame through a simulated lossy channel into the receiver.
// Returns a report object.
export async function codecLoopback({
  size = 20000,
  blockSize = 128,
  dropRate = 0.3,
  metaEvery = 25,
} = {}) {
  const source = randomBytes(size);
  const sender = await new Sender(source, 'selftest.bin', { blockSize, metaEvery }).init();
  const receiver = new Receiver();

  const maxFrames = sender.K * 6 + 500; // generous cap so a bug can't hang us
  let sent = 0;
  let delivered = 0;
  for (let i = 0; i < maxFrames && !receiver.decoder?.complete; i++) {
    const frame = sender.nextFrame();
    sent++;
    // META frames always get through in this sim so params are learned quickly;
    // DATA frames are dropped at `dropRate`.
    const isMeta = frame[4] === 1;
    if (!isMeta && Math.random() < dropRate) continue;
    delivered++;
    receiver.onFrame(frame);
  }

  const result = await Promise.race([
    receiver.completion,
    Promise.resolve(receiver.result), // in case it finished synchronously-ish
  ]).then((r) => r || receiver.completion);

  const identical =
    result && result.bytes.length === source.length &&
    result.bytes.every((b, i) => b === source[i]);

  return {
    ok: !!(result && result.verified && identical),
    K: sender.K,
    size,
    blockSize,
    dropRate,
    framesSent: sent,
    framesDelivered: delivered,
    packetsSeen: receiver.packetsSeen,
    overhead: receiver.decoder ? +(receiver.packetsSeen / sender.K).toFixed(3) : null,
    verified: !!(result && result.verified),
    identical,
    sha256: result ? toHex(result.sha256) : null,
  };
}

// Browser-only: full generate -> canvas -> jsQR -> decode path.
export async function opticalLoopback({
  size = 3000,
  blockSize = 96,
  dropRate = 0.15,
  ecc = 'M',
  maxPx = 400,
} = {}) {
  const { renderToCanvas, scanImageData } = await import('./qr.js');
  const source = randomBytes(size);
  const sender = await new Sender(source, 'optical.bin', { blockSize, metaEvery: 15 }).init();
  const receiver = new Receiver();

  const canvas = document.createElement('canvas');
  const maxFrames = sender.K * 8 + 500;
  let sent = 0, decoded = 0;
  for (let i = 0; i < maxFrames && !receiver.decoder?.complete; i++) {
    const frame = sender.nextFrame();
    sent++;
    renderToCanvas(canvas, frame, { ecc, maxPx });
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const bytes = scanImageData(img);
    if (!bytes) continue; // scan failure counts like a dropped frame
    const isMeta = bytes[4] === 1;
    if (!isMeta && Math.random() < dropRate) continue;
    decoded++;
    receiver.onFrame(bytes);
  }

  const result = await receiver.completion;
  const identical =
    result.bytes.length === source.length && result.bytes.every((b, i) => b === source[i]);

  return {
    ok: !!(result.verified && identical),
    K: sender.K, size, blockSize, ecc,
    framesRendered: sent, framesDecoded: decoded,
    packetsSeen: receiver.packetsSeen,
    verified: result.verified, identical,
  };
}
