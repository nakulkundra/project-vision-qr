import { decodeScanned, encodeBase45, isFrameShaped } from '../src/transport.js';
import { buildMeta, buildData, parseFrame } from '../src/protocol.js';
import { robustSolitonCDF } from '../src/fountain.js';
import { Receiver } from '../src/receiver.js';
import { Sender } from '../src/sender.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra='') => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };

// ---- FIX 1: decodeScanned must fail closed on non-frame garbage ----
const garbage = 'ABCDEF0123456789';            // in-alphabet, length%3 != 1
ok('garbage rejected (fail closed)', decodeScanned(garbage) === null, JSON.stringify(decodeScanned(garbage)?.slice(0,6)));
const meta = buildMeta({ sessionId: 0x1234, K: 5, blockSize: 96, fileSize: 400, sha256: new Uint8Array(32).fill(7), filename: 'a.txt' });
ok('real base45 frame accepted', isFrameShaped(decodeScanned(encodeBase45(meta))));
let l1 = ''; for (const b of meta) l1 += String.fromCharCode(b);
ok('legacy latin1 frame accepted', isFrameShaped(decodeScanned(l1)));
// A corrupted header (what a mangling scanner produces) must NOT count as decoded
const corrupt = encodeBase45(meta); const mangled = 'Z' + corrupt.slice(1);
ok('corrupted header rejected', decodeScanned(mangled) === null);

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
