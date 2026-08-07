import { Scanner } from '../src/qr.js';
import { decodeScanned, encodeBase45, isFrameShaped, decodeBase45 } from '../src/transport.js';
import { buildMeta, buildData, parseFrame, bytesToLatin1, splitIntoBlocks } from '../src/protocol.js';
import { Receiver } from '../src/receiver.js';
import { Sender } from '../src/sender.js';
import { LTDecoder, robustSolitonCDF, makeRNG } from '../src/fountain.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra='') => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };

// ---- FIX 1: decodeScanned must fail closed on non-frame garbage ----
ok('decodeBase45 rejects invalid length 1', decodeBase45('A') === null);
ok('decodeBase45 rejects invalid length 4', decodeBase45('AAAA') === null);

const garbage = 'ABCDEF0123456789';            // in-alphabet, length%3 != 1
ok('garbage rejected (fail closed)', decodeScanned(garbage) === null, JSON.stringify(decodeScanned(garbage)?.slice(0,6)));
const meta = buildMeta({ sessionId: 0x1234, K: 5, blockSize: 96, fileSize: 400, sha256: new Uint8Array(32).fill(7), filename: 'a.txt' });
ok('real base45 frame accepted', isFrameShaped(decodeScanned(encodeBase45(meta))));
let l1 = ''; for (const b of meta) l1 += String.fromCharCode(b);
ok('legacy latin1 frame accepted', isFrameShaped(decodeScanned(l1)));
// A corrupted header (what a mangling scanner produces) must NOT count as decoded
const corrupt = encodeBase45(meta); const mangled = 'Z' + corrupt.slice(1);
ok('corrupted header rejected', decodeScanned(mangled) === null);

// ---- FIX 4: decodeBase45 must fail on out-of-alphabet characters ----
ok('decodeBase45 rejects out-of-alphabet characters', decodeBase45('abc') === null);
ok('decodeBase45 rejects mixed invalid characters', decodeBase45('012abc') === null);

// ---- FIX 2: receiver recovers when the sender restarts (e.g. a preset tap) ----
// Two paths must both work: re-lock immediately when nothing is at risk, and
// re-lock once the new sender has clearly taken over after real progress.
async function restartScenario(feedUntilProgress) {
  const src = new Uint8Array(40000); for (let i=0;i<src.length;i++) src[i]=i&255;
  const s1 = await new Sender(src, 'a.bin', { blockSize: 128, metaEvery: 8 }).init();
  const rx = new Receiver();
  let fed = 0;
  while (fed < 2000 && !rx.done) {
    rx.onFrame(s1.nextFrame()); fed++;
    if (feedUntilProgress ? rx.recoveredCount > 0 : fed >= 60) break;
  }
  if (rx.done) throw new Error('setup: first session completed too early');
  const before = { recovered: rx.recoveredCount, session: rx.meta.sessionId };
  const s2 = await new Sender(src, 'a.bin', { blockSize: 256, metaEvery: 8 }).init();
  let done = null; rx.completion.then(r => done = r);
  for (let i=0;i<3000 && !rx.done;i++) rx.onFrame(s2.nextFrame());
  await new Promise(r=>setTimeout(r,60));
  return { before, rx, s2, done, src };
}

{ // path A: no progress yet -> immediate re-lock
  const r = await restartScenario(false);
  ok('A: no-progress re-lock', r.rx.meta.sessionId === r.s2.sessionId,
     `recoveredBefore=${r.before.recovered}`);
  ok('A: completes after restart', !!(r.done && r.done.verified &&
     r.done.bytes.every((b,i)=>b===r.src[i])));
}
{ // path B: real progress made -> re-lock once the new sender takes over
  const r = await restartScenario(true);
  ok('B: had real progress before restart', r.before.recovered > 0, `recovered=${r.before.recovered}`);
  ok('B: re-locked onto restarted sender', r.rx.meta.sessionId === r.s2.sessionId,
     `before=${r.before.session.toString(16)} now=${r.rx.meta.sessionId.toString(16)}`);
  ok('B: completes after restart', !!(r.done && r.done.verified &&
     r.done.bytes.every((b,i)=>b===r.src[i])));
}

// ---- FIX 3: _finish must fire onDone exactly once, even with a huge pre-META buffer ----
{
  const src = new Uint8Array(640); for (let i=0;i<src.length;i++) src[i]=(i*7)&255;
  const s = await new Sender(src, 'b.bin', { blockSize: 128, metaEvery: 1000000 }).init();
  s.nextFrame(); // consume the leading META so the rest are DATA
  let calls = 0;
  const rx = new Receiver(()=>{}, ()=>{ calls++; });
  const dataFrames = [];
  for (let i=0;i<300;i++) dataFrames.push(s.nextFrame());
  for (const f of dataFrames) rx.onFrame(f);              // all buffered, no META yet
  const bufferedCount = rx.buffered.length;
  rx.onFrame(buildMeta({ sessionId: s.sessionId, K: s.K, blockSize: 128,
    fileSize: src.length, sha256: s.hash, filename: 'b.bin' }));
  await new Promise(r=>setTimeout(r,80));
  ok('onDone fired exactly once', calls === 1, `calls=${calls} buffered=${bufferedCount}`);
  ok('buffered flush still verifies', !!(rx.result && rx.result.verified));
}

// ---- Unit Test for bytesToLatin1 ----
ok('bytesToLatin1 maps basic ASCII', bytesToLatin1(new Uint8Array([65, 66, 67])) === 'ABC');
ok('bytesToLatin1 maps empty array', bytesToLatin1(new Uint8Array([])) === '');
ok('bytesToLatin1 maps high-byte values correctly', bytesToLatin1(new Uint8Array([255, 128])) === '\xff\x80');
// ---- FIX 4: LTDecoder.assemble with incomplete file ----
{
  const cdf = robustSolitonCDF(10);
  const decoder = new LTDecoder(10, 128, cdf);
  ok('LTDecoder.assemble() returns null for incomplete file', decoder.assemble() === null);
}

// ---- parseFrame malformed input testing ----
{
  ok('parseFrame rejects null', parseFrame(null) === null);
  ok('parseFrame rejects undefined', parseFrame(undefined) === null);
  ok('parseFrame rejects short buffer', parseFrame(new Uint8Array([0x51, 1, 0, 0])) === null);

  const validData = buildData({ sessionId: 0x1234, seed: 0, payload: new Uint8Array(10) });

  const badMagic = new Uint8Array(validData);
  badMagic[0] = 0x99;
  ok('parseFrame rejects bad magic', parseFrame(badMagic) === null);

  const badVersion = new Uint8Array(validData);
  badVersion[1] = 0x99;
  ok('parseFrame rejects bad version', parseFrame(badVersion) === null);
}
// ---- FIX 4: makeRNG tests (deterministic PRNG for fountain codec) ----
{
  const r1 = makeRNG(12345);
  const r1_seq = [r1(), r1(), r1()];

  const r2 = makeRNG(12345);
  const r2_seq = [r2(), r2(), r2()];

  ok('makeRNG is deterministic for same seed',
     r1_seq.every((val, i) => val === r2_seq[i]));

  const r3 = makeRNG(54321);
  const r3_seq = [r3(), r3(), r3()];

  ok('makeRNG produces different sequence for different seed',
     !r1_seq.every((val, i) => val === r3_seq[i]));

  const r_zero = makeRNG(0);
  const r_zero_seq = [r_zero(), r_zero()];
  ok('makeRNG handles seed 0', r_zero_seq.every(val => typeof val === 'number' && val >= 0 && val < 1));

  const r_neg = makeRNG(-1);
  const r_neg_seq = [r_neg(), r_neg()];

  const r_max = makeRNG(0xFFFFFFFF);
  const r_max_seq = [r_max(), r_max()];

  ok('makeRNG treats -1 and 0xFFFFFFFF as equivalent',
     r_neg_seq.every((val, i) => val === r_max_seq[i]));
}

// ---- FIX 4: splitIntoBlocks with empty bytes ----
{
  const empty = new Uint8Array(0);
  const blocks = splitIntoBlocks(empty, 64);
  ok('empty bytes produces one block', blocks.length === 1, `length=${blocks.length}`);
  ok('empty bytes block is zero-filled', blocks[0].every(b => b === 0), `not zero-filled`);
  ok('empty bytes block has correct size', blocks[0].length === 64, `size=${blocks[0].length}`);
}

// ---- robustSolitonCDF edge case K=1 ----
{
  const cdf = robustSolitonCDF(1);
  ok('robustSolitonCDF(1) returns [0, 1]', cdf.length === 2 && cdf[0] === 0 && cdf[1] === 1, `actual=[${cdf}]`);
}

// ---- FIX 4: robustSolitonCDF unit tests ----
{
  const cdf0 = robustSolitonCDF(0);
  ok('robustSolitonCDF(0) returns [0, 1]', cdf0.length === 2 && cdf0[0] === 0 && cdf0[1] === 1);
  const cdf1 = robustSolitonCDF(1);
  ok('robustSolitonCDF(1) returns [0, 1]', cdf1.length === 2 && cdf1[0] === 0 && cdf1[1] === 1);

  const K = 10;
  const cdf10 = robustSolitonCDF(K);
  ok('robustSolitonCDF length is K + 1', cdf10.length === K + 1);
  ok('robustSolitonCDF starts at 0', cdf10[0] === 0);
  ok('robustSolitonCDF exactly terminates at 1', cdf10[K] === 1);

  let isMonotonic = true;
  let allInRange = true;
  for (let i = 1; i <= K; i++) {
    if (cdf10[i] < cdf10[i-1]) isMonotonic = false;
    if (cdf10[i] < 0 || cdf10[i] > 1) allInRange = false;
  }
  ok('robustSolitonCDF elements are monotonically increasing', isMonotonic);
  ok('robustSolitonCDF elements are bounded in [0, 1]', allInRange);
}

// ---- FIX 4: BarcodeDetector init fails cleanly when getSupportedFormats throws ----
{
  const origWindow = global.window;
  global.window = {
    BarcodeDetector: class {
      static async getSupportedFormats() {
        throw new Error('Test error: getSupportedFormats failed');
      }
    }
  };
  const s = new Scanner();
  await s.init();
  ok('Scanner init falls back to jsqr if getSupportedFormats throws', s.mode === 'jsqr', `mode=${s.mode}`);
  global.window = origWindow;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
