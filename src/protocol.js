// protocol.js — QR frame framing, metadata, and integrity helpers.
//
// Every QR code carries exactly one binary frame. Two frame types share a
// 5-byte header; META describes the transfer, DATA carries one fountain packet.
// No per-frame CRC: the QR code's own Reed-Solomon error correction already
// rejects/repairs in-frame corruption, so a decoded frame is trustworthy — we
// only sanity-check lengths. Pure module (crypto.subtle + TextEncoder), so it
// runs in both the browser and Node.

export const MAGIC = 0x51; // 'Q'
export const VERSION = 1;
export const TYPE_META = 1;
export const TYPE_DATA = 2;

const HEADER_LEN = 5; // magic, version, sessionId hi, sessionId lo, type
const SHA_LEN = 32;

// --- byte <-> latin1-string bridge -------------------------------------------
// qrcode-generator's default Byte mode encodes str.charCodeAt(i) & 0xff, and
// jsQR returns binaryData as an array of byte values, so a Latin-1 string is a
// lossless carrier for raw bytes through the optical channel.
export function bytesToLatin1(bytes) {
  return Array.from(bytes, x => String.fromCharCode(x)).join('');
}

// --- integrity ----------------------------------------------------------------
export async function sha256(bytes) {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(buf);
}

const HEX_TABLE = new Array(256);
for (let n = 0; n <= 255; ++n) {
  HEX_TABLE[n] = n.toString(16).padStart(2, '0');
}

export function toHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; ++i) {
    s += HEX_TABLE[bytes[i]];
  }
  return s;
}
export function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// --- file splitting -----------------------------------------------------------
// Split into K blocks of exactly blockSize, zero-padding the final block.
export function splitIntoBlocks(bytes, blockSize) {
  const K = Math.max(1, Math.ceil(bytes.length / blockSize));
  const blocks = [];
  for (let i = 0; i < K; i++) {
    const block = new Uint8Array(blockSize); // zero-filled
    block.set(bytes.subarray(i * blockSize, (i + 1) * blockSize));
    blocks.push(block);
  }
  return blocks;
}

// --- frame builders -----------------------------------------------------------
function writeHeader(view, sessionId, type) {
  view[0] = MAGIC;
  view[1] = VERSION;
  view[2] = (sessionId >>> 8) & 0xff;
  view[3] = sessionId & 0xff;
  view[4] = type & 0xff;
}

// META: [header][K u16][blockSize u16][fileSize u32][sha256 32][nameLen u8][name]
export function buildMeta({ sessionId, K, blockSize, fileSize, sha256: hash, filename }) {
  const nameBytes = new TextEncoder().encode(filename || '');
  const nameLen = Math.min(nameBytes.length, 255);
  const buf = new Uint8Array(HEADER_LEN + 2 + 2 + 4 + SHA_LEN + 1 + nameLen);
  writeHeader(buf, sessionId, TYPE_META);
  let o = HEADER_LEN;
  buf[o++] = (K >>> 8) & 0xff; buf[o++] = K & 0xff;
  buf[o++] = (blockSize >>> 8) & 0xff; buf[o++] = blockSize & 0xff;
  buf[o++] = (fileSize >>> 24) & 0xff; buf[o++] = (fileSize >>> 16) & 0xff;
  buf[o++] = (fileSize >>> 8) & 0xff; buf[o++] = fileSize & 0xff;
  buf.set(hash, o); o += SHA_LEN;
  buf[o++] = nameLen;
  buf.set(nameBytes.subarray(0, nameLen), o);
  return buf;
}

// DATA: [header][seed u32][payload blockSize]
export function buildData({ sessionId, seed, payload }) {
  const buf = new Uint8Array(HEADER_LEN + 4 + payload.length);
  writeHeader(buf, sessionId, TYPE_DATA);
  let o = HEADER_LEN;
  buf[o++] = (seed >>> 24) & 0xff; buf[o++] = (seed >>> 16) & 0xff;
  buf[o++] = (seed >>> 8) & 0xff; buf[o++] = seed & 0xff;
  buf.set(payload, o);
  return buf;
}

// --- frame parser -------------------------------------------------------------
function parseMetaFrame(bytes, sessionId, o) {
  if (bytes.length < o + 2 + 2 + 4 + SHA_LEN + 1) return null;
  const K = (bytes[o] << 8) | bytes[o + 1]; o += 2;
  const blockSize = (bytes[o] << 8) | bytes[o + 1]; o += 2;
  const fileSize = ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0; o += 4;
  const hash = bytes.slice(o, o + SHA_LEN); o += SHA_LEN;
  const nameLen = bytes[o++];
  if (bytes.length < o + nameLen) return null;
  const filename = new TextDecoder().decode(bytes.slice(o, o + nameLen));
  return { type: TYPE_META, sessionId, K, blockSize, fileSize, sha256: hash, filename };
}

function parseDataFrame(bytes, sessionId, o) {
  if (bytes.length < o + 4) return null;
  const seed = ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0; o += 4;
  const payload = bytes.slice(o);
  return { type: TYPE_DATA, sessionId, seed, payload };
}

// Returns a typed object, or null if the bytes aren't a valid frame.
export function parseFrame(bytes) {
  if (!bytes || bytes.length < HEADER_LEN) return null;
  if (bytes[0] !== MAGIC || bytes[1] !== VERSION) return null;
  const sessionId = (bytes[2] << 8) | bytes[3];
  const type = bytes[4];
  const o = HEADER_LEN;

  if (type === TYPE_META) return parseMetaFrame(bytes, sessionId, o);
  if (type === TYPE_DATA) return parseDataFrame(bytes, sessionId, o);

  return null;
}
