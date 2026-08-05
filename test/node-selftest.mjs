// Node runner for the codec/protocol loopback (no DOM, no camera).
// Usage: npm test   (or: node test/node-selftest.mjs)
//
// Verifies that a fountain-coded transfer reconstructs a byte-identical,
// SHA-256-verified file across a range of sizes even with heavy frame loss.

import { codecLoopback } from '../src/selftest.js';

const cases = [
  { size: 1,      blockSize: 128, dropRate: 0.0 },   // tiny / single block
  { size: 500,    blockSize: 128, dropRate: 0.3 },
  { size: 5000,   blockSize: 128, dropRate: 0.3 },
  { size: 20000,  blockSize: 128, dropRate: 0.4 },
  { size: 50000,  blockSize: 192, dropRate: 0.5 },   // ~50KB, half the frames lost
  { size: 100000, blockSize: 256, dropRate: 0.3 },   // 100KB upper target
];

let allOk = true;
for (const c of cases) {
  const r = await codecLoopback(c);
  allOk = allOk && r.ok;
  const status = r.ok ? 'PASS' : 'FAIL';
  console.log(
    `${status}  size=${String(r.size).padStart(6)}  K=${String(r.K).padStart(4)}  ` +
    `drop=${(r.dropRate * 100).toFixed(0).padStart(2)}%  ` +
    `sent=${String(r.framesSent).padStart(5)} delivered=${String(r.framesDelivered).padStart(5)} ` +
    `packets=${String(r.packetsSeen).padStart(4)}  overhead=${r.overhead}x  ` +
    `verified=${r.verified} identical=${r.identical}`
  );
}

console.log(allOk ? '\nALL TESTS PASSED' : '\nSOME TESTS FAILED');
process.exit(allOk ? 0 : 1);
