import { bytesToLatin1 } from '../src/protocol.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra='') => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };

ok('bytesToLatin1 with empty array', bytesToLatin1([]) === '');
ok('bytesToLatin1 with empty Uint8Array', bytesToLatin1(new Uint8Array(0)) === '');

ok('bytesToLatin1 with ascii chars', bytesToLatin1([97, 98, 99]) === 'abc');
ok('bytesToLatin1 with Uint8Array ascii chars', bytesToLatin1(new Uint8Array([97, 98, 99])) === 'abc');

ok('bytesToLatin1 with latin1 chars (above 127)', bytesToLatin1([0xC3, 0xA9]) === '\xC3\xA9');
ok('bytesToLatin1 with Uint8Array latin1 chars', bytesToLatin1(new Uint8Array([0xC3, 0xA9])) === '\xC3\xA9');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
