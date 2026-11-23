// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* Vérifie les contrastes AA des jetons, dans les deux thèmes, à partir de tokens.css. */

const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');

function theme(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const block = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2]]));
}

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const themes = { clair: theme(':root {'), sombre: theme(':root[data-theme="dark"]') };

/** [texte, fond, minimum] : 4,5 pour du texte, 3 pour bordures de contrôle et icônes. */
const pairs: [string, string, number][] = [
  ['ink', 'surface-base', 4.5],
  ['ink', 'surface-raised', 4.5],
  ['ink', 'surface-sunken', 4.5],
  ['ink-muted', 'surface-base', 4.5],
  ['ink-muted', 'surface-raised', 4.5],
  ['ink-muted', 'surface-sunken', 4.5],
  ['accent', 'surface-base', 4.5],
  ['accent', 'surface-raised', 4.5],
  ['accent', 'accent-soft', 4.5],
  ['on-accent', 'accent', 4.5],
  ['ok', 'ok-soft', 4.5],
  ['attention', 'attention-soft', 4.5],
  ['blocked', 'blocked-soft', 4.5],
  ['ok', 'surface-raised', 4.5],
  ['attention', 'surface-raised', 4.5],
  ['blocked', 'surface-raised', 4.5],
  ['ink', 'ok-soft', 4.5],
  ['ink', 'attention-soft', 4.5],
  ['ink', 'blocked-soft', 4.5],
  ['border-strong', 'surface-base', 3],
  ['border-strong', 'surface-raised', 3],
];

describe.each(Object.entries(themes))('contrastes AA, thème %s', (_name, tokens) => {
  it.each(pairs)('%s sur %s ≥ %s:1', (fg, bg, min) => {
    expect(tokens[fg], fg).toBeDefined();
    expect(tokens[bg], bg).toBeDefined();
    expect(ratio(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(min);
  });
});
