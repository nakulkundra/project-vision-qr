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
    this.sessionId = opts.sessionId ?? (Math.floor(Math.random() * 0x10000) & 0xffff);

    this._seed = (Math.floor(Math.random() * 0x10000) << 16) >>> 0; // seed base
    this._dataCount = 0;
    this.ready = false;
  }

  async init() {
    const blocks = splitIntoBlocks(this.fileBytes, this.blockSize);
    this.K = blocks.length;
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
