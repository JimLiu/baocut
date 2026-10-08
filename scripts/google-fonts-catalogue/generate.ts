// 生成随 Runtime 发布的 Google Fonts 字体目录（`packages/runtime-core/src/fonts/google-fonts-catalogue.json`）。用法见同目录的 README.md。
//
//   node scripts/google-fonts-catalogue/generate.ts [--metadata <文件>] [--licences <文件>] [--out <文件>]

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

/** 公开的字体元数据（不要 API key）。 */
const METADATA_URL = 'https://fonts.google.com/metadata/fonts';
/** google/fonts 仓库的目录树：许可按顶层目录分（`ofl/`、`apache/`、`ufl/`），子目录名是族名去掉空格与符号后的小写。 */
const TREE_API = 'https://api.github.com/repos/google/fonts/' + 'git/trees/';

const LICENCE_DIRS = { ofl: 'OFL-1.1', apache: 'Apache-2.0', ufl: 'UFL-1.0' } as const;
type Licence = (typeof LICENCE_DIRS)[keyof typeof LICENCE_DIRS];

const CATEGORIES: Record<string, string> = {
  'Sans Serif': 'sans-serif',
  Serif: 'serif',
  Display: 'display',
  Handwriting: 'handwriting',
  Monospace: 'monospace',
};

interface MetadataFamily {
  family: string;
  category: string;
  subsets: string[];
  fonts: Record<string, unknown>;
  axes: unknown[];
  popularity: number;
}

/** 目录里的一项（键短，文件小）：f 族名、c 分类、s 字符子集、w 正体字重、i 斜体字重、v 可变字体、l 许可。 */
interface CatalogueFamily {
  f: string;
  c: string;
  s: string[];
  w: number[];
  i?: number[];
  v?: 1;
  l: Licence;
}

const { values } = parseArgs({
  options: {
    metadata: { type: 'string' },
    licences: { type: 'string' },
    out: { type: 'string' },
  },
});

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const out = path.resolve(values.out ?? path.join(repoRoot, 'packages/runtime-core/src/fonts/google-fonts-catalogue.json'));

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { 'User-Agent': 'BaoCut catalogue script' } });
  if (!response.ok) throw new Error(`${url} 返回 HTTP ${response.status}`);
  const text = await response.text();
  return JSON.parse(stripGuard(text));
}

/** 元数据接口的回应以 `)]}'` 开头防 JSON 劫持，去掉再解析。 */
function stripGuard(text: string): string {
  return text.startsWith(")]}'") ? text.slice(4) : text;
}

async function loadMetadata(): Promise<MetadataFamily[]> {
  const raw = values.metadata ? JSON.parse(stripGuard(readFileSync(values.metadata, 'utf8'))) : await getJson(METADATA_URL);
  return (raw as { familyMetadataList: MetadataFamily[] }).familyMetadataList;
}

/** `{ ofl: [目录名…], apache: […], ufl: […] }`。 */
async function loadLicenceDirs(): Promise<Record<string, string[]>> {
  if (values.licences) return JSON.parse(readFileSync(values.licences, 'utf8')) as Record<string, string[]>;
  const root = (await getJson(`${TREE_API}main`)) as { tree: { path: string; sha: string }[] };
  const dirs: Record<string, string[]> = {};
  for (const entry of root.tree) {
    if (!(entry.path in LICENCE_DIRS)) continue;
    const sub = (await getJson(`${TREE_API}${entry.sha}`)) as { tree: { path: string; type: string }[]; truncated: boolean };
    if (sub.truncated) throw new Error(`${entry.path} 的目录树被截断了`);
    dirs[entry.path] = sub.tree.filter((t) => t.type === 'tree').map((t) => t.path);
  }
  return dirs;
}

function dirKey(family: string): string {
  return family.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const metadata = await loadMetadata();
const licenceDirs = await loadLicenceDirs();
const licenceOf = new Map<string, Licence>();
for (const [dir, licence] of Object.entries(LICENCE_DIRS)) for (const name of licenceDirs[dir] ?? []) licenceOf.set(name, licence);

const families: CatalogueFamily[] = [];
const skipped: string[] = [];
for (const meta of [...metadata].sort((a, b) => a.popularity - b.popularity || a.family.localeCompare(b.family))) {
  const licence = licenceOf.get(dirKey(meta.family));
  const category = CATEGORIES[meta.category];
  const keys = Object.keys(meta.fonts);
  const weights = keys.filter((k) => /^\d+$/.test(k)).map(Number);
  const italics = keys.filter((k) => /^\d+i$/.test(k)).map((k) => Number(k.slice(0, -1)));
  // 认不出许可的不收：选字时要能给出许可。
  if (!licence || !category || weights.length + italics.length === 0) {
    skipped.push(meta.family);
    continue;
  }
  families.push({
    f: meta.family,
    c: category,
    s: meta.subsets.filter((s) => s !== 'menu').sort(),
    w: weights.sort((a, b) => a - b),
    ...(italics.length > 0 ? { i: italics.sort((a, b) => a - b) } : {}),
    ...(meta.axes.length > 0 ? { v: 1 as const } : {}),
    l: licence,
  });
}

const lines = families.map((family) => `  ${JSON.stringify(family)}`);
const text = `{"schema":"baocut.google-fonts-catalogue/1","generatedAt":"${new Date().toISOString().slice(0, 10)}","families":[\n${lines.join(',\n')}\n]}\n`;
writeFileSync(out, text);
process.stdout.write(`写了 ${families.length} 个族（${(text.length / 1024).toFixed(0)} KiB）到 ${path.relative(repoRoot, out)}\n`);
if (skipped.length > 0) process.stdout.write(`没收（认不出许可或分类）：${skipped.join('、')}\n`);
