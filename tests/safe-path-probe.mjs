import { safePath } from '../src/format/reviz.js';
const t = [
  ['a.png', true],
  ['media/x.png', true],
  ['media/a b.png', true],
  ['media/../x.png', false],
  ['../etc/passwd', false],
  ['/abs', false],
  ['C:\\x', false],
  ['media/nord..png', false],
];
let bad = 0;
for (const [p, expected] of t) {
  const got = safePath(p);
  const ok = got === expected;
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${JSON.stringify(p)} → ${got} (attendu ${expected})`);
}
console.log(bad ? `${bad} échec(s)` : 'TOUT PASS');
