// sender.js — turns a file into an endless stream of QR frame payloads.
//
// Open-loop by design: there is no back-channel, so the sender just keeps
// emitting fountain packets forever, sprinkling in META frames so a receiver
// that joins late still learns the parameters. main.js pulls nextFrame() on a
// timer and renders each result as a QR code.

import { LTEncoder, robustSolitonCDF } from './fountain.js';
import { splitIntoBlocks, buildMeta, buildData, sha256 } from './protocol.js';

export class Sender {
  constructor(fileBytes, filename, opts = {}) {
    this.fileBytes = fileBytes;
    this.filename = filename;
    this.blockSize = opts.blockSize || 128;
    this.metaEvery = opts.metaEvery || 25; // one META per this many DATA frames

    // Security: Secure random number generation with fallback
    let r1, r2;
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const arr = new Uint16Array(2);
      crypto.getRandomValues(arr);
      r1 = arr[0];
      r2 = arr[1];
    } else {
      r1 = Math.floor(Math.random() * 0x10000);
      r2 = Math.floor(Math.random() * 0x10000);
    }
    this.sessionId = opts.sessionId ?? (r1 & 0xffff);
    this._seed = (r2 << 16) >>> 0; // seed base

    this._dataCount = 0;
    this.ready = false;
  }

  async init() {
    const blocks = splitIntoBlocks(this.fileBytes, this.blockSize);
    this.K = blocks.length;
    // K travels as a u16 in the META frame, so >65535 blocks wraps silently and
    // the receiver reassembles garbage that still "completes". Fail loudly
    // instead. Reachable in practice: at blockSize 16 the ceiling is only 1 MB.
    if (this.K > 0xffff) {
      const maxBytes = 0xffff * this.blockSize;
      throw new Error(
        `File needs ${this.K} blocks but the format allows 65535. ` +
        `At block size ${this.blockSize} the limit is ${(maxBytes / 1024 / 1024).toFixed(1)} MB — ` +
        `use a larger block size or a smaller file.`
      );
    }
    this.cdf = robustSolitonCDF(this.K);
    this.encoder = new LTEncoder(blocks, this.cdf);
    this.hash = await sha256(this.fileBytes);
    this.metaFrame = buildMeta({
      sessionId: this.sessionId,
      K: this.K,
      blockSize: this.blockSize,
      fileSize: this.fileBytes.length,
      sha256: this.hash,
      filename: this.filename,
    });
    this.ready = true;
    return this;
  }

  // Returns the next frame's bytes (Uint8Array). Lead with a META frame, then
  // interleave META every `metaEvery` DATA frames.
  nextFrame() {
    if (!this.ready) throw new Error('Sender.init() not called');
    if (this._dataCount % this.metaEvery === 0) {
      this._dataCount++; // count the slot so cadence stays regular
      return this.metaFrame;
    }
    this._dataCount++;
    const seed = this._seed;
    this._seed = (this._seed + 1) >>> 0;
    const payload = this.encoder.encode(seed);
    return buildData({ sessionId: this.sessionId, seed, payload });
  }
}
