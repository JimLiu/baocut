import { defineMessages, live, type Id, type SpaceEntry, type SpaceEntryKind, type ToolInputKind } from '@baocut/protocol';
import { KIND_LABEL } from './space.ts';
import { spaceKindsOf, TOOLS, type ToolId } from './tool-catalog.ts';
import type { PickerRow } from './tool-targets.ts';
import { zhHans } from './tool-space-input.zh-Hans.ts';
import { zhHant } from './tool-space-input.zh-Hant.ts';
import { ja } from './tool-space-input.ja.ts';
import { ko } from './tool-space-input.ko.ts';
import { es } from './tool-space-input.es.ts';
import { fr } from './tool-space-input.fr.ts';
import { de } from './tool-space-input.de.ts';
import { nl } from './tool-space-input.nl.ts';
import { ptBR } from './tool-space-input.pt-BR.ts';
import { it } from './tool-space-input.it.ts';
import { ru } from './tool-space-input.ru.ts';
import { pl } from './tool-space-input.pl.ts';
import { tr } from './tool-space-input.tr.ts';
import { vi } from './tool-space-input.vi.ts';

export { spaceKindsOf };

/**
 * Space 条目作为工具的输入（产品设计 §2.7「页面」第 1 条、§4.5「用工具处理…」；架构设计 §7.9「Space 条目作输入」；
 * 设计稿 model-tool-space-input.js）。纯函数。
 *
 * 哪个工具收哪几种条目只在工具目录（model/tool-catalog.ts 输入的 `kinds`）声明一次，两个方向都从它派生：工具 → 条目
 * （Space 选择器的候选）与条目 → 工具（查看器的「用工具处理…」）。种类是 Runtime 解析 `{ entryId }` 时接受的子集
 * （runtime-core space-inputs.ts：媒体是视频素材、成片与音频，字幕文件翻译是字幕，素材是文档与字幕）；`video` 是可编辑的
 * 视频，候选另从 `tools.candidates` 来（带文稿）。
 */

/** 条目不能选的原因（译文在 `tool-space-input.<语言>.ts`）。 */
const en = {
  reasons: {
    trashed: 'In the Trash',
    generating: 'Still generating; you can choose it when it’s done',
    missing: 'The file is missing; reconnect it before choosing',
    failed: 'The last generation failed',
    textOnly: 'Only text from .txt and .md documents can be read',
    subtitleOnly: 'Only .srt and .vtt subtitles are accepted',
    noPath: 'This item has no file on this computer; a new video has to start from a local file',
  },
  joinKinds: (labels: readonly string[]) => labels.join(', '),
};
export type ToolSpaceInputMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

export const SPACE_INPUT_COPY: ToolSpaceInputMessages['reasons'] = live(() => M.reasons);

/** 「视频、视频素材、成片、音频」。 */
export function spaceKindsText(tool: ToolId): string {
  return M.joinKinds(spaceKindsOf(tool).map((k) => KIND_LABEL[k]));
}

function extOf(entry: Pick<SpaceEntry, 'fileName' | 'name'>): string {
  const name = entry.fileName || entry.name;
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** 条目本身为什么不能当输入（与工具无关的那部分）；能用时 null。种类不合不在这里（不列）。 */
export function entryReason(entry: SpaceEntry): string | null {
  if (entry.user.trashedAt) return SPACE_INPUT_COPY.trashed;
  if (entry.status === 'generating') return SPACE_INPUT_COPY.generating;
  if (entry.status === 'missing') return SPACE_INPUT_COPY.missing;
  if (entry.status === 'failed') return SPACE_INPUT_COPY.failed;
  if (entry.kind === 'document' && !['txt', 'md', 'markdown'].includes(extOf(entry))) return SPACE_INPUT_COPY.textOnly;
  if (entry.kind === 'subtitle' && !['srt', 'vtt'].includes(extOf(entry))) return SPACE_INPUT_COPY.subtitleOnly;
  return null;
}

/** Space 选择器的一行：视频行带 `tools.candidates` 的候选（文稿、标签、置灰原因），别的行带条目。 */
export interface SpaceRow {
  entryId: Id;
  name: string;
  kind: SpaceEntryKind;
  kindLabel: string;
  lastActivityAt: string;
  eligible: boolean;
  reason: string | null;
  entry: SpaceEntry | null;
  video: PickerRow | null;
}

function matches(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || name.toLowerCase().includes(q);
}

/**
 * 工具的 Space 候选：只列这个工具收的种类，回收站里的不列；能选的排前面，同组按最近活动。视频行取自
 * `videoRows`（`tools.candidates` 的行，调用方已按搜索词筛过），其余取自 Space 目录的条目。
 */
export function spaceRows(tool: ToolId, entries: readonly SpaceEntry[], videoRows: readonly PickerRow[], query = ''): SpaceRow[] {
  const kinds = spaceKindsOf(tool);
  const byId = new Map(entries.map((e) => [e.id, e]));
  const rows: SpaceRow[] = [];
  if (kinds.includes('video')) {
    for (const v of videoRows) {
      rows.push({
        entryId: v.entryId,
        name: v.name,
        kind: 'video',
        kindLabel: KIND_LABEL.video,
        lastActivityAt: v.lastActivityAt,
        eligible: v.eligible,
        reason: v.reason,
        entry: byId.get(v.entryId) ?? null,
        video: v,
      });
    }
  }
  for (const e of entries) {
    if (e.kind === 'video' || !kinds.includes(e.kind) || e.user.trashedAt || !matches(e.name, query)) continue;
    const reason = entryReason(e);
    rows.push({ entryId: e.id, name: e.name, kind: e.kind, kindLabel: KIND_LABEL[e.kind], lastActivityAt: e.lastActivityAt, eligible: !reason, reason, entry: e, video: null });
  }
  return rows.sort(
    (a, b) => Number(b.eligible) - Number(a.eligible) || (a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : 0),
  );
}

/**
 * 选中的条目按哪种输入提交（`tools.list` 的可用性与 `executionByInput` 按它选）：可编辑的视频写进它（`video`），
 * 生成语音与文本生成的文档、字幕是素材（`document`），其余当文件用（`file`）。
 */
export function inputKindOf(tool: ToolId, kind: SpaceEntryKind): ToolInputKind {
  if (kind === 'video') return 'video';
  return tool === 'synthesize-speech' || tool === 'generate-text' ? 'document' : 'file';
}

/** 条目 → 收它的工具（Space 查看器「用工具处理…」，§4.5），按目录顺序；回收站里的条目没有。 */
export function toolsForEntry(entry: Pick<SpaceEntry, 'kind' | 'user'>): ToolId[] {
  if (entry.user.trashedAt) return [];
  return TOOLS.filter((t) => !t.planned && spaceKindsOf(t.id).includes(entry.kind)).map((t) => t.id);
}
