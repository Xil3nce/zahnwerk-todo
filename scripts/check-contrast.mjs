// Prueft die Design-Tokens gegen WCAG AA (4,5:1 fuer Text).
import { readFileSync } from 'node:fs';

const scss = readFileSync(new URL('../src/styles.scss', import.meta.url), 'utf8');
const block = (start) => {
  const from = scss.indexOf(start);
  return Object.fromEntries(
    [...scss.slice(from, scss.indexOf('}', from)).matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]),
  );
};
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const pairs = [
  ['text', 'bg'], ['text', 'surface'], ['text', 'surface-2'], ['muted', 'bg'], ['muted', 'surface'],
  ['muted', 'surface-2'], ['on-primary', 'primary'], ['accent', 'bg'], ['accent', 'surface'], ['accent', 'surface-2'],
  ['danger', 'bg'], ['danger', 'surface'], ['danger', 'surface-2'],
];
let failed = false;
for (const [name, tokens] of [['hell', block(':root {')], ['dunkel', block('@mixin dark')]]) {
  for (const [fg, bg] of pairs) {
    const value = ratio(tokens[fg], tokens[bg]);
    if (value < 4.5) failed = true;
    console.log(`${value < 4.5 ? 'FAIL' : 'ok  '} ${name} ${fg} auf ${bg}: ${value.toFixed(2)}`);
  }
}
process.exit(failed ? 1 : 0);
