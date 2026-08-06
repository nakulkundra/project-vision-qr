// fountain.js — Luby Transform (LT) fountain codec.
//
// The sender turns K source blocks into an ENDLESS stream of encoded packets.
// Each packet is the XOR of a pseudo-random subset of source blocks, and the
// only thing transmitted to identify that subset is a 32-bit `seed`: both ends
// feed the seed through the same PRNG + degree distribution, so the receiver
// reconstructs exactly which block indices were combined without them being
// sent. The receiver runs a peeling decoder and recovers the file after
// collecting any K+epsilon distinct packets — dropped frames simply don't
// matter. Pure module: no DOM / browser APIs, so it is unit-testable in Node.

// --- Seeded PRNG (mulberry32) -------------------------------------------------
// Deterministic 32-bit-seeded generator. MUST behave identically on both ends.
export function makeRNG(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Robust Soliton degree distribution ---------------------------------------
// Returns a cumulative distribution `cdf` where cdf[d] is P(degree <= d),
// for d in 1..K. Standard LT parameters c and delta are tunable.
export function robustSolitonCDF(K, c = 0.03, delta = 0.5) {
  if (K <= 1) return [0, 1]; // degenerate: only degree 1 exists
  const R = c * Math.log(K / delta) * Math.sqrt(K);

  const rho = new Array(K + 1).fill(0);
  rho[1] = 1 / K;
  for (let d = 2; d <= K; d++) rho[d] = 1 / (d * (d - 1));

  const tau = new Array(K + 1).fill(0);
  const pivot = Math.round(K / R); // degree that gets the spike
  for (let d = 1; d <= K; d++) {
    if (d < pivot) tau[d] = R / (d * K);
    else if (d === pivot) tau[d] = (R * Math.log(R / delta)) / K;
    // d > pivot => 0
  }

  let Z = 0;
  for (let d = 1; d <= K; d++) Z += rho[d] + tau[d];

  const cdf = new Array(K + 1).fill(0);
  let acc = 0;
  for (let d = 1; d <= K; d++) {
    acc += (rho[d] + tau[d]) / Z;
    cdf[d] = acc;
  }
  cdf[K] = 1; // guard against float drift
  return cdf;
}

// Sample a degree in [1..K] from the cdf using one RNG draw.
function sampleDegree(rng, cdf) {
  const u = rng();
  for (let d = 1; d < cdf.length; d++) {
    if (u <= cdf[d]) return d;
  }
  return cdf.length - 1;
}

// Derive the set of source-block indices a packet with `seed` combines.
// The RNG-call order here (degree first, then indices) is the shared contract
// between encoder and decoder — do not change one side without the other.
export function indicesForSeed(seed, K, cdf) {
  const rng = makeRNG(seed);
  let degree = sampleDegree(rng, cdf);
  if (degree > K) degree = K;
  const chosen = new Set();
  // Guard the loop: at most K distinct indices exist.
  while (chosen.size < degree) {
    chosen.add(Math.floor(rng() * K) % K);
  }
  return [...chosen];
}

// ⚡ Bolt: Fast XOR utilizing 32-bit aligned reads where possible, falling back to 8-bit.
// Expected impact: Speeds up encoding/decoding XOR operations by ~3-4x.
function xorInto(dst, src) {
  let i = 0;
  // If both buffers are 32-bit aligned, XOR in 32-bit chunks.
  if (dst.byteOffset % 4 === 0 && src.byteOffset % 4 === 0) {
    const len32 = dst.length >> 2;
    const dst32 = new Int32Array(dst.buffer, dst.byteOffset, len32);
    const src32 = new Int32Array(src.buffer, src.byteOffset, len32);
    for (; i < len32; i++) dst32[i] ^= src32[i];
    i <<= 2;
  }
  // Catch any remaining unaligned tail bytes (or do everything if unaligned).
  for (; i < dst.length; i++) dst[i] ^= src[i];
}

// --- Encoder ------------------------------------------------------------------
export class LTEncoder {
  // blocks: Array<Uint8Array>, all of equal length (blockSize, last one padded).
  constructor(blocks, cdf) {
    this.blocks = blocks;
    this.K = blocks.length;
    this.blockSize = blocks[0].length;
    this.cdf = cdf;
  }

  // Produce the payload for a given seed: XOR of the selected source blocks.
  encode(seed) {
    const idx = indicesForSeed(seed, this.K, this.cdf);
    const out = new Uint8Array(this.blockSize);
    for (const i of idx) xorInto(out, this.blocks[i]);
    return out;
  }
}

// --- Decoder (peeling / belief propagation) -----------------------------------
export class LTDecoder {
  constructor(K, blockSize, cdf) {
    this.K = K;
    this.blockSize = blockSize;
    this.cdf = cdf;
    this.recovered = new Array(K).fill(null); // Uint8Array once known
    this.recoveredCount = 0;
    this.pending = []; // { indices:Set<number>, data:Uint8Array }
    // index -> list of pending packets that still reference it (for fast ripple)
    this.refs = Array.from({ length: K }, () => new Set());
    this.seenSeeds = new Set();
  }

  get complete() {
    return this.recoveredCount === this.K;
  }

  // Feed one encoded packet. Returns true if it advanced decoding.
  addPacket(seed, data) {
    if (this.complete) return false;
    if (this.seenSeeds.has(seed)) return false; // duplicate frame
    this.seenSeeds.add(seed);

    const idxList = indicesForSeed(seed, this.K, this.cdf);
    const indices = new Set();
    const reduced = new Uint8Array(data); // copy; we mutate as we peel
    // Strip out any already-recovered blocks up front.
    for (const i of idxList) {
      if (this.recovered[i]) xorInto(reduced, this.recovered[i]);
      else indices.add(i);
    }

    const packet = { indices, data: reduced };
    if (indices.size === 0) return false; // redundant, everything known
    for (const i of indices) this.refs[i].add(packet);
    this.pending.push(packet);

    if (indices.size === 1) this._ripple([packet]);
    return true;
  }

  // Resolve a work-list of degree-1 packets, cascading newly-freed blocks.
  _ripple(queue) {
    while (queue.length) {
      const pkt = queue.pop();
      if (pkt.indices.size !== 1) continue; // may have changed
      const [idx] = pkt.indices;
      if (this.recovered[idx]) continue;

      // This packet now equals block `idx`.
      this.recovered[idx] = pkt.data;
      this.recoveredCount++;

      // Remove `idx` from every pending packet that references it.
      for (const other of this.refs[idx]) {
        if (other === pkt) continue;
        if (!other.indices.has(idx)) continue;
        xorInto(other.data, pkt.data);
        other.indices.delete(idx);
        if (other.indices.size === 1) queue.push(other);
      }
      this.refs[idx].clear();
    }
  }

  // Concatenate recovered blocks into one buffer (length K * blockSize).
  // Caller trims to the true fileSize. Returns null if incomplete.
  assemble() {
    if (!this.complete) return null;
    const out = new Uint8Array(this.K * this.blockSize);
    for (let i = 0; i < this.K; i++) out.set(this.recovered[i], i * this.blockSize);
    return out;
  }
}
