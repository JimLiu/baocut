import type { FontFaceStyle } from '@baocut/protocol';

/**
 * Google Fonts 的公开 CSS 接口（`/css2`，不要 API key）：请求只带族名与字重、斜体；回应是一组 `@font-face`，
 * 用非浏览器的 User-Agent 请求时每个 face 一个完整的 TrueType 文件（`format('truetype')`，中日韩字体也是一个文件）。
 */

export const DEFAULT_CSS_ENDPOINT = 'https://fonts.googleapis.com';
export const DEFAULT_FILE_ENDPOINT = 'https://fonts.gstatic.com';
/** 请求 CSS 的 User-Agent：不像浏览器，接口就给 TrueType 文件（不给 WOFF2 与按字符切开的分片）。 */
export const CSS_USER_AGENT = 'BaoCut';

/** `<基址>/css2?family=<族名>:<轴>@<取值>`：族名的空格写成 `+`；取值按（斜体、字重）升序，接口不接受乱序。 */
export function cssUrl(endpoint: string, family: string, faces: readonly FontFaceStyle[]): string {
  const name = family
    .trim()
    .split(/\s+/)
    .map((part) => encodeURIComponent(part))
    .join('+');
  const sorted = [...faces].sort((a, b) => Number(a.italic) - Number(b.italic) || a.weight - b.weight);
  const unique = sorted.filter((f, i) => i === 0 || f.weight !== sorted[i - 1]!.weight || f.italic !== sorted[i - 1]!.italic);
  const axes = unique.some((f) => f.italic)
    ? `ital,wght@${unique.map((f) => `${f.italic ? 1 : 0},${f.weight}`).join(';')}`
    : `wght@${unique.map((f) => f.weight).join(';')}`;
  return `${endpoint.replace(/\/+$/, '')}/css2?family=${name}:${axes}`;
}

/** 回应里的一个 `@font-face`：族名、字重（可变字体是一个范围）、斜体、文件地址与是否只覆盖一部分字符（`unicode-range`）。 */
export interface CssFontFace {
  family: string;
  weight: [number, number];
  italic: boolean;
  url: string;
  format: string | null;
  partial: boolean;
}

/** 解析回应里的 `@font-face`：读不出族名、字重或地址的块跳过。 */
export function parseFontFaceCss(css: string): CssFontFace[] {
  const faces: CssFontFace[] = [];
  for (const match of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = match[1]!;
    const prop = (name: string) => new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i').exec(body)?.[1]?.trim() ?? null;
    const family = prop('font-family')?.replace(/^['"]|['"]$/g, '');
    const weightText = prop('font-weight');
    const src = prop('src');
    if (!family || !weightText || !src) continue;
    const weights = weightText.split(/\s+/).map(Number);
    if (weights.length === 0 || weights.length > 2 || weights.some((w) => !Number.isInteger(w))) continue;
    const url = /url\(\s*['"]?([^'")\s]+)['"]?\s*\)/.exec(src)?.[1];
    if (!url) continue;
    const format = /format\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(src)?.[1] ?? null;
    faces.push({
      family,
      weight: [weights[0]!, weights[1] ?? weights[0]!],
      italic: /^(italic|oblique)/i.test(prop('font-style') ?? ''),
      url,
      format,
      partial: prop('unicode-range') !== null,
    });
  }
  return faces;
}

/** 文件地址是不是在文件基址下面（`https`、同一个源、路径在基址的路径之下）。 */
export function underEndpoint(url: string, endpoint: string): boolean {
  let file: URL;
  let base: URL;
  try {
    file = new URL(url);
    base = new URL(endpoint);
  } catch {
    return false;
  }
  if (file.protocol !== 'https:' || base.protocol !== 'https:' || file.origin !== base.origin || file.username || file.password)
    return false;
  const prefix = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
  return file.pathname.startsWith(prefix);
}
