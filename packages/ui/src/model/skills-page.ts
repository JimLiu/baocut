import {
  isSkillAssetPath,
  isSkillScriptPath,
  SKILL_FILE,
  skillFileKind,
  type ProjectBrandSummary,
  type SkillFileChange,
  type SkillFileEntry,
  type SkillFileKind,
  type SkillPackageInspection,
  type SkillPackagePick,
  type SkillSummary,
} from '@baocut/protocol';
import { filterSkills } from './agent-skills.ts';

/**
 * Skills 页（产品设计 §6.9；原型 model-skill-package.js）的纯逻辑：列表分段、素材与文件树、上传候选的默认选择。
 * 文案在组件里；这里只给结构与数字。
 */

export interface SkillSections {
  /** 个人与从 GitHub 导入的。 */
  mine: SkillSummary[];
  /** 有 `BRAND.md` 的项目。 */
  brands: ProjectBrandSummary[];
  builtin: SkillSummary[];
}

/** 三段：我的 → 项目品牌 → BaoCut 内置；搜索词同时筛三段（品牌按项目名与一句话）。 */
export function skillSections(skills: readonly SkillSummary[], brands: readonly ProjectBrandSummary[], query: string): SkillSections {
  const rows = filterSkills(skills, query, 'all');
  const q = query.trim().toLocaleLowerCase();
  return {
    mine: rows.filter((s) => s.origin !== 'builtin'),
    brands: brands.filter((b) => !q || [b.projectName, b.summary].some((v) => v.toLocaleLowerCase().includes(q))),
    builtin: rows.filter((s) => s.origin === 'builtin'),
  };
}

export type AssetKind = 'image' | 'audio' | 'video' | 'font';

export interface SkillAsset extends SkillFileEntry {
  kind: SkillFileKind;
  name: string;
}

const ASSET_ORDER: Partial<Record<SkillFileKind, number>> = { svg: 0, image: 0, audio: 1, video: 2, font: 3 };

/** 文件清单里的素材，按图片（含 svg）→ 音频 → 视频 → 字体排，同类按路径。 */
export function skillAssets(files: readonly SkillFileEntry[]): SkillAsset[] {
  return files
    .filter((f) => isSkillAssetPath(f.path))
    .map((f) => ({ ...f, kind: skillFileKind(f.path), name: baseName(f.path) }))
    .sort((a, b) => (ASSET_ORDER[a.kind] ?? 9) - (ASSET_ORDER[b.kind] ?? 9) || a.path.localeCompare(b.path));
}

/** 素材按大类计数（svg 算图片），只留有的，按图片 → 音频 → 视频 → 字体。 */
export function assetCounts(assets: readonly SkillAsset[]): { kind: AssetKind; count: number }[] {
  const counts = new Map<AssetKind, number>();
  for (const a of assets) {
    const kind = assetKindOf(a.kind);
    if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return (['image', 'audio', 'video', 'font'] as const).flatMap((kind) => (counts.has(kind) ? [{ kind, count: counts.get(kind)! }] : []));
}

export function assetKindOf(kind: SkillFileKind): AssetKind | null {
  if (kind === 'svg' || kind === 'image') return 'image';
  return kind === 'audio' || kind === 'video' || kind === 'font' ? kind : null;
}

export function scriptPaths(files: readonly SkillFileEntry[]): string[] {
  return files.filter((f) => isSkillScriptPath(f.path)).map((f) => f.path);
}

export function totalBytes(files: readonly SkillFileEntry[]): number {
  return files.reduce((sum, f) => sum + f.size, 0);
}

export type FileTreeNode =
  | { kind: 'dir'; path: string; name: string; depth: number }
  | { kind: 'file'; path: string; name: string; depth: number; file: SkillFileEntry };

/**
 * 文件树：`SKILL.md`（或 `BRAND.md`）在最前，其余文件夹在前、文件在后，各按名字排；文件夹作为一行出现在它的文件前面。
 */
export function fileTree(files: readonly SkillFileEntry[], first: string = SKILL_FILE): FileTreeNode[] {
  const sorted = [...files].sort((a, b) => {
    if (a.path === first) return -1;
    if (b.path === first) return 1;
    const as = a.path.split('/');
    const bs = b.path.split('/');
    for (let i = 0; i < Math.min(as.length, bs.length); i++) {
      if (as[i] === bs[i]) continue;
      const aDir = i < as.length - 1;
      const bDir = i < bs.length - 1;
      if (aDir !== bDir) return aDir ? -1 : 1;
      return as[i]!.localeCompare(bs[i]!);
    }
    return as.length - bs.length;
  });
  const out: FileTreeNode[] = [];
  const seen = new Set<string>();
  for (const file of sorted) {
    const parts = file.path.split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      const dir = parts.slice(0, i + 1).join('/');
      if (seen.has(dir)) continue;
      seen.add(dir);
      out.push({ kind: 'dir', path: dir, name: parts[i]!, depth: i });
    }
    out.push({ kind: 'file', path: file.path, name: parts[parts.length - 1]!, depth: parts.length - 1, file });
  }
  return out;
}

/** 在应用里加进 skill 的文件放在哪：素材进 `assets/`，其余进 `references/`（品牌一律进 `brand/`）。 */
export function addedFilePath(name: string, brand = false): string {
  const clean = baseName(name);
  if (brand) return `brand/${clean}`;
  return `${isSkillAssetPath(clean) ? 'assets' : 'references'}/${clean}`;
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * 上传对话框的默认选择：能装的候选都勾上；同名的个人 skill 默认「更新为新版本」，同名的内置或第三方只能「另存为副本」。
 */
export function defaultPicks(inspection: SkillPackageInspection): SkillPackagePick[] {
  return inspection.candidates
    .filter((c) => !c.issue)
    .map((c) => ({ prefix: c.prefix, mode: c.conflict ? (c.conflict.canUpdate ? 'update' : 'copy') : 'new' }));
}

/** 素材预览按什么画：图片画出来，音频、视频给播放器，字体与其余只给信息。 */
export function previewOf(path: string): 'markdown' | 'svg' | 'image' | 'audio' | 'video' | 'text' | 'binary' {
  const kind = skillFileKind(path);
  if (kind === 'skill' || (kind === 'doc' && /\.(md|markdown)$/i.test(path))) return 'markdown';
  if (kind === 'svg') return 'svg';
  if (kind === 'image') return 'image';
  if (kind === 'audio') return 'audio';
  if (kind === 'video') return 'video';
  if (kind === 'doc' || kind === 'data' || kind === 'script' || kind === 'code') return 'text';
  return 'binary';
}

/** `2026-10-14T…` → 当地日期（列表右侧的日期）。 */
export function dateLabel(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }).format(date);
}

/**
 * 编辑中的改动（文件页签的「编辑」，产品设计 §6.9「在应用里编辑与版本」）：改过的文本、从本机加进来的文件、删掉的文件。
 * 存的时候变成 `skills.write` / `brands.write` 的 `changes`。
 */
export interface FileDraft {
  texts: Readonly<Record<string, string>>;
  added: Readonly<Record<string, { from: string; size: number }>>;
  removed: readonly string[];
}

export const EMPTY_DRAFT: FileDraft = { texts: {}, added: {}, removed: [] };

/** 编辑中看到的文件清单：删掉的不在，加进来的接在后面（同名的换成新的）。 */
export function draftFiles(files: readonly SkillFileEntry[], draft: FileDraft): SkillFileEntry[] {
  const added = Object.entries(draft.added);
  return [
    ...files.filter((f) => !draft.removed.includes(f.path) && !draft.added[f.path]),
    ...added.map(([path, a]) => ({ path, size: a.size, text: false })),
  ];
}

/** 存的改动；`original` 是读到过的原文（没改过的文本不算改动）。 */
export function draftChanges(draft: FileDraft, original: Readonly<Record<string, string>>): SkillFileChange[] {
  return [
    ...Object.entries(draft.texts)
      .filter(([path, text]) => !draft.removed.includes(path) && original[path] !== text)
      .map(([path, text]) => ({ path, text })),
    ...Object.entries(draft.added).map(([path, a]) => ({ path, from: a.from })),
    ...draft.removed.filter((path) => !draft.added[path]).map((path) => ({ path, remove: true as const })),
  ];
}

/** 拆开开头的 front matter（不含两条 `---`）与正文；没有 front matter 时 `front` 为 null。 */
export function splitFrontMatter(content: string): { front: string | null; body: string } {
  const text = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  return match ? { front: match[1]!, body: text.slice(match[0].length).replace(/^\n+/, '') } : { front: null, body: text };
}
