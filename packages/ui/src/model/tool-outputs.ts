import { defineMessages, intlLocale, type AssetRecord, type EditOperation, type Id, type JobRecord, type Sequence, type SpaceEntry, type SpaceEntryKind } from '@baocut/protocol';
import { importAndPlace } from './editor-ops.ts';
import { LINK_IMPORT, linkProvenance } from './link-import.ts';
import { importedMusicBedOperations, jobOnTimeline, type MusicBed } from './music-bed.ts';
import { formatBytes, KIND_LABEL, measureText } from './space.ts';
import { entryJobId, placeKindOf } from './space-actions.ts';
import { spaceKindsOf, toolById, type ToolId } from './tool-catalog.ts';
import { saveDirLabel } from './tool-frame.ts';
import { zhHans } from './tool-outputs.zh-Hans.ts';
import { zhHant } from './tool-outputs.zh-Hant.ts';
import { ja } from './tool-outputs.ja.ts';
import { ko } from './tool-outputs.ko.ts';
import { es } from './tool-outputs.es.ts';
import { fr } from './tool-outputs.fr.ts';
import { de } from './tool-outputs.de.ts';
import { nl } from './tool-outputs.nl.ts';
import { ptBR } from './tool-outputs.pt-BR.ts';
import { it } from './tool-outputs.it.ts';
import { ru } from './tool-outputs.ru.ts';
import { pl } from './tool-outputs.pl.ts';
import { tr } from './tool-outputs.tr.ts';
import { vi } from './tool-outputs.vi.ts';

/** 产物行的文案（译文在 `tool-outputs.<语言>.ts`）。 */
const en = {
  actionLabel: { 'open-movie': 'Open in editor', 'new-movie': 'New video from this', 'add-to-movie': 'Add to video' },
  blockTextOnly: 'Transcripts and subtitles need a video or audio file to make a new video; that isn’t possible from here yet',
  blockTrashed: 'Restore this item from the Trash first',
  blockGenerating: 'Still generating; available when it’s done',
  blockMissing: 'Can’t find this result’s file on this computer',
  /** 「交给 Agent」预填的那句话：用户改写后发送。 */
  handover: {
    subtitle: 'Translate these subtitles into another language, keeping the timecodes unchanged.',
    document: 'Write a summary of this transcript.',
    audio: 'Make a video with this audio.',
    image: 'Make a video with this image as the cover.',
    'video-file': 'Add subtitles to this video.',
    export: 'Add subtitles to this video.',
    video: 'Keep editing this video.',
  } as Partial<Record<SpaceEntryKind, string>>,
  handoverDefault: 'Keep working on this result.',
};
export type ToolOutputsMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/*
 * 工具结果的产物行（产品设计 §2.7「结果与下一步」，设计稿 tool-frame.jsx `ToolOutputRow`、model-tool-runs.js `followUps`、
 * model-tool-handover.js）：一次运行发布进 Space 的条目、每个条目能接着做什么、「交给 Agent」预填的那句话。
 * 结果页、任务详情与生成记录共用。
 */

/**
 * 一次运行的产物：`origin.jobId` 是这几个任务之一的 Space 条目（直接任务的结果、文件到文件的流程发布的文件）。
 * 回收站里的、还在生成或失败的占位（`ref.jobId`）、新建的视频（由「打开编辑」负责）不列。按名字排。
 */
export function entriesOfJob(entries: readonly SpaceEntry[], jobIds: readonly Id[]): SpaceEntry[] {
  const ids = new Set(jobIds);
  return entries
    .filter((e) => {
      const jobId = entryJobId(e);
      if (!jobId || !ids.has(jobId) || e.user.trashedAt || e.kind === 'video') return false;
      return !(e.ref && 'jobId' in e.ref);
    })
    .sort((a, b) => a.name.localeCompare(b.name, intlLocale(), { numeric: true }));
}

/** 产物所在的目录：都在同一个目录时给它（结果页头上写「保存在 …」），否则 null。 */
export function outputsDir(entries: readonly Pick<SpaceEntry, 'file'>[]): string | null {
  const dirs = new Set(entries.map((e) => (e.file?.path ? dirOf(e.file.path) : null)));
  if (dirs.size !== 1) return null;
  return [...dirs][0] ?? null;
}

function dirOf(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, '');
}

/** 产物行的第二行：种类 · 大小 · 时长或画幅 · 所在目录。 */
export function outputDetail(entry: SpaceEntry): string {
  const path = entry.file?.path ?? null;
  const dir = path ? dirOf(path) : null;
  return [KIND_LABEL[entry.kind], entry.size > 0 ? formatBytes(entry.size) : null, measureText(entry), dir ? saveDirLabel(dir) : null]
    .filter(Boolean)
    .join(' · ');
}

export type FollowId = 'open-movie' | 'new-movie' | 'add-to-movie' | ToolId;

export interface FollowUp {
  id: FollowId;
  label: string;
  kind: 'tool' | 'action';
}

const FOLLOW: Partial<Record<SpaceEntryKind, readonly FollowId[]>> = {
  document: ['translate-subtitles', 'synthesize-speech', 'new-movie'],
  subtitle: ['translate-subtitles', 'synthesize-speech', 'new-movie'],
  audio: ['new-movie', 'add-to-movie'],
  // 生成的图片不接「以此新建视频」「加到视频」：放大查看、下载、交给 Agent 就够了（产品设计 §2.7）。
  image: [],
  'video-file': ['new-movie', 'add-to-movie'],
  export: ['new-movie', 'add-to-movie'],
};

/**
 * 写进视频之后：转录接翻译字幕与翻译配音，翻译字幕接翻译配音，只下载没转写的视频接转录（下载时一起转写的按转录算）。
 */
const FOLLOW_MOVIE: Partial<Record<ToolId, readonly FollowId[]>> = {
  transcribe: ['translate-subtitles', 'dub'],
  'translate-subtitles': ['dub'],
  'link-import': ['transcribe'],
};

/**
 * 一个产物接着能做什么。工具项只在那个工具收这种条目时才列（与工具目录的 Space 输入一致）；「在 Space 中查看」
 * 「在文件夹中显示」「交给 Agent」每行都有，不在这里。写进视频的结果（视频条目）先给「打开编辑」，再按产出它的工具接着做。
 */
export function followUps(entry: Pick<SpaceEntry, 'kind'>, fromTool?: ToolId | null): FollowUp[] {
  const ids = entry.kind === 'video' ? ['open-movie' as const, ...((fromTool && FOLLOW_MOVIE[fromTool]) || [])] : (FOLLOW[entry.kind] ?? []);
  return ids.flatMap((id): FollowUp[] => {
    if (id === 'open-movie' || id === 'new-movie' || id === 'add-to-movie') return [{ id, label: M.actionLabel[id], kind: 'action' }];
    const tool = toolById(id);
    return tool && spaceKindsOf(id).includes(entry.kind) ? [{ id, label: tool.name, kind: 'tool' }] : [];
  });
}

/**
 * 「以此新建视频」「加到视频」为什么做不了；能做时 null。音频与视频文件直接成为视频的素材（素材留在原处，只做链接）；
 * 文稿与字幕要先配一份视频或音频，Runtime 还没有这样新建的方法。
 */
export function newMovieBlock(entry: Pick<SpaceEntry, 'kind' | 'status' | 'user'>, path: string | null): string | null {
  if (entry.kind === 'document' || entry.kind === 'subtitle') return M.blockTextOnly;
  if (entry.user.trashedAt) return M.blockTrashed;
  if (entry.status === 'generating') return M.blockGenerating;
  if (entry.status === 'missing' || entry.status === 'failed' || !path) return M.blockMissing;
  return null;
}

/** 直接任务里产出音频的能力：它们的结果是生成记录；文件到文件的流程也记 `generated`，但不是模型生成的。 */
const GENERATED_AUDIO = new Set(['synthesizeSpeech', 'generateMusic']);

/**
 * 结果加进视频时记的来源（架构设计 §7.9「没有视频的 Job」）：生成的结果仍是那条生成记录，只下载的媒体与流程自己导入时同形
 * （任务已经出了账本时读不到，记不了）。别的不给，引擎按用户导入记。
 */
export function outputProvenance(
  entry: Pick<SpaceEntry, 'origin' | 'ref'>,
  job: Pick<JobRecord, 'jobId' | 'pipeline'> | null,
): { origin: string; source?: unknown } | null {
  const origin = entry.origin;
  if (!origin) return null;
  if (origin.capability === LINK_IMPORT) return job ? linkProvenance(job) : null;
  if (origin.source !== 'generated' || !origin.capability || !GENERATED_AUDIO.has(origin.capability)) return null;
  return {
    origin: 'generated',
    source: {
      ...(origin.jobId ? { jobId: origin.jobId } : {}),
      capability: origin.capability,
      ...(origin.provider ?? {}),
      ...(entry.ref && 'artifactId' in entry.ref ? { artifactId: entry.ref.artifactId } : {}),
    },
  };
}

export interface AddToMoviePlan {
  operations: EditOperation[];
  /** 这一笔同时把素材放上了时间线。 */
  placed: boolean;
  /** 音乐铺上了音乐轨时的铺法（提示里写出来）。 */
  bed: Pick<MusicBed, 'layout' | 'totalSec'> | null;
  /** 这段音乐本来就在时间线上，这一笔没有铺。 */
  onTimeline: boolean;
}

/**
 * 「加到视频」那一笔（产品设计 §2.7、§5.9，架构设计 §7.9，设计稿 tool-frame.jsx `AddToMovie`）：导入素材，文件留在原处、视频里只做链接。
 * - 生成音乐的结果同一笔铺上音乐轨，铺法同「生成配乐」（music-bed.ts）；这个任务的音乐已经在时间线上时不再铺。
 * - 别的结果是一次普通的素材导入：时间线还空着时同一笔放上主轨（与从链接导入进已有视频同一条规则），已经有片段时只导入，放不放由用户。
 */
export function addToMovieOperations(
  sequence: Sequence,
  assets: Record<Id, AssetRecord>,
  entry: Pick<SpaceEntry, 'name' | 'fileName' | 'origin' | 'media'>,
  path: string,
  provenance: { origin: string; source?: unknown } | null,
): AddToMoviePlan {
  const imported = (kind: ReturnType<typeof placeKindOf>) =>
    importAndPlace(sequence, [{ path, kind, name: entry.name, ...(provenance ? { provenance } : {}) }], 0);
  const jobId = entry.origin?.capability === 'generateMusic' ? entry.origin.jobId : undefined;
  const pieceSec = entry.media?.durationSec;
  if (jobId && pieceSec) {
    if (jobOnTimeline(sequence, assets, jobId)) return { operations: imported(null), placed: false, bed: null, onTimeline: true };
    // `importAndPlace` 给导入的 `ref`（session.ts 读回执时也认它）。
    const bed = importedMusicBedOperations(sequence, { ref: 'drop0', name: entry.name, pieceSec }, jobId);
    if (bed) return { operations: [...imported(null), ...bed.operations], placed: true, bed: { layout: bed.layout, totalSec: bed.totalSec }, onTimeline: false };
  }
  const kind = placeKindOf(entry.fileName);
  const placed = !!kind && sequence.items.length === 0;
  return { operations: imported(placed ? kind : null), placed, bed: null, onTimeline: false };
}

/** 「交给 Agent」预填的那句话：按结果种类给一句缺省意图，由用户改写后发送，不自动发送。句子里不写路径，引用会带上位置。 */
export function handoverText(entry: Pick<SpaceEntry, 'kind'>): string {
  return M.handover[entry.kind] ?? M.handoverDefault;
}
