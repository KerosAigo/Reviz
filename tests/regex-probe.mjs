const re = /(^|\/\.\.(\/|$))/;
for (const p of ['a.png', 'media/x.png', 'media/../x.png', 'x']) {
  console.log(JSON.stringify(p), '→', re.test(p));
}
// décomposons : quel groupe matche ?
const m = re.exec('a.png');
console.log('exec a.png:', m ? JSON.stringify(m.slice(0, 3)) + ` idx=${m.index}` : 'null');
