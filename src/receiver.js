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
    this._finishing = false; // re-entry guard for _finish (see below)
    this.result = null;      // { bytes, filename, verified }
    this.packetsSeen = 0;
    this.foreignPackets = 0; // DATA frames dropped for a mismatched session
    this.sessionChanged = false; // sender restarted after we made progress
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
      if (!this.meta) {
        this._lock(frame);
      } else if (frame.sessionId !== this.meta.sessionId) {
        // The sender restarted (Stop/Start, or the Reliable/Turbo presets, which
        // build a fresh Sender with a new random sessionId). Without this the
        // receiver would sit forever at whatever percentage it had reached:
        // it dropped all DATA from the new session AND refused to re-lock. That
        // is a trap, because the app's own density warning tells the user to tap
        // "Reliable" — which would have made the transfer unrecoverable.
        // Adopt the new session, but only while nothing is at risk of being
        // thrown away: after real progress, prefer to keep going and just say so.
        // Re-lock immediately if nothing is lost, or once the new sender has
        // clearly taken over (its DATA frames keep arriving and being dropped).
        // The old session can never complete once its sender is gone, so
        // stalling forever is strictly worse than starting the new one.
        // 8, not 30: the software scan rate can be only a few frames/sec, so a
        // larger threshold would leave the user staring at a frozen bar for
        // ~10s before recovery kicked in.
        if (this.recoveredCount === 0 || this.foreignPackets >= 8) {
          this._relock(frame);
        } else {
          this.sessionChanged = true;
          this._emit();
        }
      }
      return false;
    }

    if (frame.type === TYPE_DATA) {
      // Ignore frames from a different concurrent session.
      if (this.meta && frame.sessionId !== this.meta.sessionId) {
        this.foreignPackets++;
        return false;
      }
      if (!this.decoder) {
        this.buffered.push(frame);
        // Emit while buffering so the UI can show that frames ARE arriving and
        // we are only waiting on a META frame — otherwise this state is silent.
        this.packetsSeen++;
        this._emit();
        return false;
      }
      return this._feed(frame);
    }
    return false;
  }

  get recoveredCount() {
    return this.decoder ? this.decoder.recoveredCount : 0;
  }

  _lock(metaFrame) {
    this.meta = metaFrame;
    this.decoder = new LTDecoder(metaFrame.K, metaFrame.blockSize, robustSolitonCDF(metaFrame.K));
    // Flush anything buffered before we knew the parameters.
    const pending = this.buffered;
    this.buffered = [];
    for (const f of pending) {
      if (this.done) break; // completing mid-flush must not re-enter _finish
      if (f.sessionId === this.meta.sessionId) this._feed(f);
    }
    this._emit();
  }

  // Abandon the current session and lock onto a new one from scratch.
  _relock(metaFrame) {
    this.buffered = [];
    this.decoder = null;
    this.meta = null;
    this.sessionChanged = false;
    this.foreignPackets = 0;
    this._lock(metaFrame);
  }

  _feed(frame) {
    this.packetsSeen++;
    // addPacket returns false for a duplicate seed (already-seen packet). Only
    // repaint the UI when something actually changed: emitting on every
    // duplicate rewrites innerHTML and restarts a CSS transition tens of times
    // a second, on the same thread that has to decode the next camera frame.
    const advanced = this.decoder.addPacket(frame.seed, frame.payload);
    if (advanced) this._emit();
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
      buffered: this.buffered.length,
      sessionChanged: this.sessionChanged,
      foreignPackets: this.foreignPackets,
    });
  }

  async _finish() {
    // Synchronous re-entry guard, set BEFORE the first await. `done` is only set
    // after `await sha256(...)`, so during a synchronous buffered flush every
    // remaining frame re-entered here — measured 281 onDone calls for one
    // transfer, each allocating a never-revoked blob URL and rewriting the DOM.
    if (this._finishing) return this.result;
    this._finishing = true;
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
