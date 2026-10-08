import { FONT_CATEGORIES, fontScriptsOf, type FontCategory, type FontFaceStyle, type FontLicence, type FontScript } from '@baocut/protocol';
import builtinCatalogue from './google-fonts-catalogue.json' with { type: 'json' };
import { RcFonts } from '@baocut/protocol/messages/runtime-core';

/**
 * 随 Runtime 发布的 Google Fonts 字体目录（架构设计 §9.1）：`scripts/google-fonts-catalogue` 生成的
 * `google-fonts-catalogue.json`，只有元数据（族名、分类、字符子集、字重、许可），不含字体文件。离线可用。
 */

const LICENCES: readonly FontLicence[] = ['OFL-1.1', 'Apache-2.0', 'UFL-1.0'];

/** 目录里的一个族。 */
export interface CatalogueFamily {
  family: string;
  category: FontCategory;
  subsets: string[];
  scripts: FontScript[];
  /** 有正体的字重、有斜体的字重（升序）。 */
  weights: number[];
  italics: number[];
  variable: boolean;
  licence: FontLicence;
  /** 热门程度的名次（0 最热门）。 */
  rank: number;
}

interface RawFamily {
  f: string;
  c: string;
  s: string[];
  w: number[];
  i?: number[];
  v?: 1;
  l: string;
}

const weightList = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((w) => Number.isInteger(w) && w >= 1 && w <= 1000);

export class FontCatalogue {
  readonly date: string;
  readonly #families: readonly CatalogueFamily[];
  readonly #byName: ReadonlyMap<string, CatalogueFamily>;

  private constructor(date: string, families: CatalogueFamily[]) {
    this.date = date;
    this.#families = families;
    this.#byName = new Map(families.map((entry) => [entry.family.toLowerCase(), entry]));
  }

  /** 读一份目录（生成脚本的格式）；格式不对的项跳过，整体不对时报错。 */
  static parse(json: unknown): FontCatalogue {
    const root = json as { schema?: unknown; generatedAt?: unknown; families?: unknown };
    if (root?.schema !== 'baocut.google-fonts-catalogue/1' || !Array.isArray(root.families)) throw new Error(RcFonts.catalogueInvalid().text);
    const families: CatalogueFamily[] = [];
    for (const raw of root.families as RawFamily[]) {
      if (typeof raw?.f !== 'string' || raw.f.trim() === '' || raw.f.length > 200) continue;
      if (!(FONT_CATEGORIES as readonly string[]).includes(raw.c) || !(LICENCES as readonly string[]).includes(raw.l)) continue;
      if (!Array.isArray(raw.s) || !raw.s.every((s) => typeof s === 'string')) continue;
      const italics = raw.i ?? [];
      if (!weightList(raw.w) || !weightList(italics) || raw.w.length + italics.length === 0) continue;
      families.push({
        family: raw.f,
        category: raw.c as FontCategory,
        subsets: [...raw.s],
        scripts: fontScriptsOf(raw.s),
        weights: [...raw.w].sort((a, b) => a - b),
        italics: [...italics].sort((a, b) => a - b),
        variable: raw.v === 1,
        licence: raw.l as FontLicence,
        rank: families.length,
      });
    }
    return new FontCatalogue(typeof root.generatedAt === 'string' ? root.generatedAt : '', families);
  }

  static #builtin: FontCatalogue | null = null;

  /** 随 Runtime 发布的那一份。 */
  static builtin(): FontCatalogue {
    FontCatalogue.#builtin ??= FontCatalogue.parse(builtinCatalogue);
    return FontCatalogue.#builtin;
  }

  families(): readonly CatalogueFamily[] {
    return this.#families;
  }

  /** 按族名找（不分大小写）。 */
  get(family: string): CatalogueFamily | null {
    return this.#byName.get(family.trim().toLowerCase()) ?? null;
  }
}

/**
 * 按 CSS 的字体匹配把要的字重与斜体对到这个族实际有的 face（与排版引擎挑 face 的规则相同，所以下载这一个之后引擎挑到的
 * 就是它）：要斜体而有斜体时在斜体里挑，否则在正体里挑；字重相同的优先；要 400–500 时先往上到 500、再往下、再往上；
 * 要小于 400 时先往下再往上；要大于 500 时先往上再往下。
 */
export function snapFace(entry: CatalogueFamily, weight: number, italic: boolean): FontFaceStyle {
  const useItalic = italic ? entry.italics.length > 0 : entry.weights.length === 0;
  const list = useItalic ? entry.italics : entry.weights;
  return { weight: nearestWeight(list, weight), italic: useItalic };
}

function nearestWeight(available: readonly number[], wanted: number): number {
  if (available.includes(wanted)) return wanted;
  const below = available.filter((w) => w < wanted).sort((a, b) => b - a);
  const above = available.filter((w) => w > wanted).sort((a, b) => a - b);
  if (wanted >= 400 && wanted <= 500) {
    const upTo500 = above.filter((w) => w <= 500);
    return upTo500[0] ?? below[0] ?? above[0]!;
  }
  if (wanted < 400) return below[0] ?? above[0]!;
  return above[0] ?? below[0]!;
}

/** 选了一个族、没说要哪些 face 时下载的：正体的常规与粗体（对到这个族实际有的字重，相同的只算一次）。 */
export function defaultFaces(entry: CatalogueFamily): FontFaceStyle[] {
  const faces = [snapFace(entry, 400, false), snapFace(entry, 700, false)];
  return faces.filter((face, i) => faces.findIndex((f) => f.weight === face.weight && f.italic === face.italic) === i);
}
