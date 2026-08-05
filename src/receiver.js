// receiver.js — consumes decoded QR frames and reconstructs the file.
//
// Locks onto the first META it sees (session, K, block size, hash, name), spins
// up an LT decoder, and feeds every DATA frame in. DATA frames that arrive
// before META are buffered and flushed once parameters are known. When the
// decoder completes, the blocks are concatenated, trimmed to the true file
// size, and verified against the transmitted SHA-256.

import { LTDecoder, robustSolitonCDF } from './fountain.js';
import { parseFrame, sha256, bytesEqual, TYPE_META, TYPE_DATA } from './protocol.js';

export class Receiver {
  constructor(onProgress, onDone) {
    this.onProgress = onProgress || (() => {});
    this.onDone = onDone || (() => {});
    this.meta = null;        // locked transfer parameters
    this.decoder = null;
    this.buffered = [];      // DATA frames seen before META
    this.done = false;
    this.result = null;      // { bytes, filename, verified }
    this.packetsSeen = 0;
    // Resolves with the result once the file is reassembled and verified.
    this.completion = new Promise((resolve) => { this._resolve = resolve; });
  }

  // Feed one decoded frame (raw bytes from a QR). Safe to call with garbage;
  // invalid frames are ignored. Returns true when the transfer just completed.
  onFrame(bytes) {
    if (this.done) return false;
    const frame = parseFrame(bytes);
    if (!frame) return false;

    if (frame.type === TYPE_META) {
      if (!this.meta) this._lock(frame);
      return false;
    }

    if (frame.type === TYPE_DATA) {
      // Ignore frames from a different concurrent session.
      if (this.meta && frame.sessionId !== this.meta.sessionId) return false;
      if (!this.decoder) {
        this.buffered.push(frame);
        return false;
      }
      return this._feed(frame);
    }
    return false;
  }

  _lock(metaFrame) {
    this.meta = metaFrame;
    this.decoder = new LTDecoder(metaFrame.K, metaFrame.blockSize, robustSolitonCDF(metaFrame.K));
    // Flush anything buffered before we knew the parameters.
    const pending = this.buffered;
    this.buffered = [];
    for (const f of pending) {
      if (f.sessionId === this.meta.sessionId) this._feed(f);
    }
    this._emit();
  }

  _feed(frame) {
    this.packetsSeen++;
    this.decoder.addPacket(frame.seed, frame.payload);
    this._emit();
    if (this.decoder.complete) {
      this._finish();
      return true;
    }
    return false;
  }

  _emit() {
    this.onProgress({
      recovered: this.decoder ? this.decoder.recoveredCount : 0,
      K: this.meta ? this.meta.K : null,
      packetsSeen: this.packetsSeen,
      filename: this.meta ? this.meta.filename : null,
    });
  }

  async _finish() {
    const raw = this.decoder.assemble();
    const bytes = raw.slice(0, this.meta.fileSize);
    const digest = await sha256(bytes);
    const verified = bytesEqual(digest, this.meta.sha256);
    this.done = true;
    this.result = { bytes, filename: this.meta.filename, verified, sha256: digest };
    this.onDone(this.result);
    this._resolve(this.result);
    return this.result;
  }
}
