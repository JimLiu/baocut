import {
  FONT_CATEGORIES,
  FONT_SCRIPTS,
  live,
  localizeText,
  type DownloadedFontFace,
  type FontCategory,
  type FontFamilyState,
  type FontFamilyStatus,
  type FontFaceStyle,
  type FontRemoveResult,
  type FontScript,
} from '@baocut/protocol';
import { M } from './fonts-copy.ts';
import { formatBytes } from './models-output.ts';

/**
 * `baocut fonts …` 的参数与输出（架构设计 §9.1 的按需下载字体）。从 main.ts 分出来，单独可测。
 * 下载只给族名与字重、斜体；不列地址。
 */

export type FontsCommand =
  | { kind: 'downloaded' }
  | { kind: 'search'; query: string; category?: FontCategory; script?: FontScript; limit: number }
  | { kind: 'download'; family: string; faces?: FontFaceStyle[] }
  | { kind: 'remove'; family: string }
  | { kind: 'clear' };

/** `baocut fonts <子命令> …`。族名里有空格时整个加引号，或者分开写（按空格拼回去）。 */
export function parseFontsArgs(
  args: string[],
  flags: {
    weights?: string | undefined;
    italic?: boolean | undefined;
    category?: string | undefined;
    script?: string | undefined;
    limit?: string | undefined;
  },
): FontsCommand {
  const [action, ...words] = args;
  const family = () => {
    const name = words.join(' ').trim();
    if (!name) throw new Error(M.usage);
    return name;
  };
  switch (action) {
    case undefined:
    case 'downloaded':
      if (words.length > 0) throw new Error(M.usage);
      return { kind: 'downloaded' };
    case 'search': {
      if (flags.category !== undefined && !(FONT_CATEGORIES as readonly string[]).includes(flags.category)) {
        throw new Error(M.categoryChoices(FONT_CATEGORIES));
      }
      if (flags.script !== undefined && !(FONT_SCRIPTS as readonly string[]).includes(flags.script)) {
        throw new Error(M.scriptChoices(FONT_SCRIPTS));
      }
      const limit = flags.limit === undefined ? 20 : Number(flags.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error(M.limitRange);
      return {
        kind: 'search',
        query: words.join(' ').trim(),
        ...(flags.category ? { category: flags.category as FontCategory } : {}),
        ...(flags.script ? { script: flags.script as FontScript } : {}),
        limit,
      };
    }
    case 'download': {
      const name = family();
      if (flags.weights === undefined) {
        if (flags.italic) throw new Error(M.italicNeedsWeights);
        return { kind: 'download', family: name };
      }
      const weights = flags.weights.split(',').map((w) => Number(w.trim()));
      if (weights.length === 0 || weights.some((w) => !Number.isInteger(w) || w < 1 || w > 1000))
        throw new Error(M.weightsFormat);
      return { kind: 'download', family: name, faces: weights.map((weight) => ({ weight, italic: flags.italic === true })) };
    }
    case 'remove':
      return { kind: 'remove', family: family() };
    case 'clear':
      if (words.length > 0) throw new Error(M.usage);
      return { kind: 'clear' };
    default:
      throw new Error(M.usage);
  }
}

const STATE_LABELS: Readonly<Record<FontFamilyState, string>> = live(() => M.stateLabels);

export function faceLabel(face: FontFaceStyle): string {
  return M.face(face.weight, Boolean(face.italic));
}

/** 下载缓存：每个族一行（字重、大小、许可），最后是总大小。 */
export function formatDownloadedFonts(faces: readonly DownloadedFontFace[], totalBytes: number): string[] {
  if (faces.length === 0) return [M.noDownloads];
  const families = new Map<string, DownloadedFontFace[]>();
  for (const face of faces) families.set(face.family, [...(families.get(face.family) ?? []), face]);
  const lines = [...families].map(([family, list]) => {
    const size = list.reduce((sum, f) => sum + f.sizeBytes, 0);
    return `${family}  ${list.map(faceLabel).join(M.listSep)}  ${formatBytes(size)}  ${list[0]!.licence}`;
  });
  return [...lines, M.downloadedTotal(families.size, faces.length, formatBytes(totalBytes))];
}

/** 选字列表的一页：族名、状态（下载中带进度，失败带原因）、分类、文字与许可。 */
export function formatFontFamilies(families: readonly FontFamilyStatus[], total: number): string[] {
  if (families.length === 0) return [M.noMatches];
  const lines = families.map((f) => {
    let state = STATE_LABELS[f.state];
    if (f.state === 'downloading' && f.job) {
      state += f.job.totalBytes ? ` ${Math.floor((f.job.doneBytes / f.job.totalBytes) * 100)}%` : ` ${formatBytes(f.job.doneBytes)}`;
    }
    if (f.state === 'failed' && f.error) state = M.failedWithReason(state, localizeText(f.error.message, f.error.messageRef));
    if (f.state === 'downloaded') state += ` ${f.downloaded.map(faceLabel).join(M.listSep)}`;
    const meta = [f.category, f.scripts.filter((s) => s !== 'other').join('/'), f.licence].filter(Boolean).join(' · ');
    return `${f.family}  [${state}]${meta ? `  ${meta}` : ''}`;
  });
  return total > families.length ? [...lines, M.truncated(total, families.length)] : lines;
}

export function formatFontRemoval(result: FontRemoveResult): string[] {
  const lines = [
    result.removed.length > 0 ? M.removed(result.removed.length, formatBytes(result.freedBytes)) : M.nothingToRemove,
  ];
  if (result.kept.length > 0) {
    lines.push(M.kept(result.kept.length, result.kept.map((f) => `${f.family} ${faceLabel(f)}`)));
  }
  return lines;
}
