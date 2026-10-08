/**
 * 随渲染内核发布的字体的族名（`crates/frame-render` 的 `BUNDLED_FONT_FILES`，文件在 `crates/render-raster/assets/fonts`）。
 * 排字时这些族总是用内核自带的那一份（本机装的、下载的都不用），所以选字列表把它们标为「随内核」，也不下载。
 * 与文件里的族名对拍的测试在 `bundled-fonts.test.ts`。
 */
export const BUNDLED_FONT_FAMILIES: readonly string[] = [
  'Alata',
  'Anton',
  'Archivo Black',
  'Arimo',
  'Bangers',
  'Bebas Neue',
  'Carter One',
  'Dancing Script',
  'Fredoka One',
  'Inter',
  'Lexend Deca',
  'Montserrat',
  'Noto Sans SC',
  'Oswald',
  'Paytone One',
  'Permanent Marker',
  'Playfair Display',
  'Poppins',
  'Poppins Black',
  'Press Start 2P',
  'Roboto Mono',
  'Rubik',
  'Shrikhand',
  'Source Serif 4',
  'Squada One',
  'VK Code',
  'VK Sans',
];

/**
 * 渲染内核的回退族（`frame_render::FALLBACK_FAMILY`）：点了名、却哪里都没取到的族（没下载、下载失败、自动下载关着），
 * 字由它画。`fonts.usage` 以 Render Worker 报的为准，这里是 Worker 没跑（空的序列）时的同一个值。
 */
export const FALLBACK_FONT_FAMILY = 'Noto Sans SC';

const BUNDLED = new Set(BUNDLED_FONT_FAMILIES.map((family) => family.toLowerCase()));

export function isBundledFamily(family: string): boolean {
  return BUNDLED.has(family.trim().toLowerCase());
}
