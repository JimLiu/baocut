import { defineMessages, live, localizeText, type DocumentRecord, type ExportKind, type Id } from '@baocut/protocol';
import { formatRangeTime } from './export-range.ts';
import { fmtSize } from './task-facts.ts';
import { zhHans } from './export-rejection.zh-Hans.ts';
import { zhHant } from './export-rejection.zh-Hant.ts';
import { ja } from './export-rejection.ja.ts';
import { ko } from './export-rejection.ko.ts';
import { es } from './export-rejection.es.ts';
import { fr } from './export-rejection.fr.ts';
import { de } from './export-rejection.de.ts';
import { nl } from './export-rejection.nl.ts';
import { ptBR } from './export-rejection.pt-BR.ts';
import { it } from './export-rejection.it.ts';
import { ru } from './export-rejection.ru.ts';
import { pl } from './export-rejection.pl.ts';
import { tr } from './export-rejection.tr.ts';
import { vi } from './export-rejection.vi.ts';
import { refIn, remedyText } from './localized-text.ts';

/** 导出被拒或失败的文案（英文是键与类型的来源，译文在 `export-rejection.zh-Hans.ts`）。Runtime 的原话不经这里。 */
const en = {
  portableReason: {
    missing: 'File not found',
    changed: 'Content differs from when it was added',
    unreadable: 'Can’t be read',
  } as Record<string, string>,
  titles: {
    VIDEO_NOT_OPEN: 'The video isn’t open',
    EXPORT_KIND_UNSUPPORTED: 'This version can’t export this kind of content yet',
    EXPORT_SOURCE_UNSUPPORTED: 'This document can’t be exported this way',
    EXPORT_NOTHING_TO_EXPORT: 'Nothing in the range can be exported',
    EXPORT_SOURCE_NOT_FOUND: 'No document can be exported',
    EXPORT_SOURCE_AMBIGUOUS: 'Several documents can be exported',
    EXPORT_TOOL_MISSING: 'This computer is missing a tool needed for export',
    EXPORT_UNSUPPORTED_CONTENT: 'Some content can’t be rendered for export',
    ASSET_MISSING: 'Some assets can’t be read',
    ASSET_CHANGED: 'Some assets have changed',
    ENTITY_NOT_FOUND: 'The sequence doesn’t exist',
    DUB_GROUP_NOT_FOUND: 'This voice-over group can’t be found',
    EXPORT_PACKAGE_LOCAL_PATH: 'Some documents contain paths on this computer',
    EXPORT_PACKAGE_UNSUPPORTED: 'Some files can’t go into a portable package',
    EXPORT_INSUFFICIENT_SPACE: 'Not enough space on the export location’s disk',
    EXPORT_DESTINATION_EXISTS: 'A file with the same name already exists',
    EXPORT_DESTINATION_UNWRITABLE: 'Can’t write to the export location',
    EXPORT_RENDER_FAILED: 'The video couldn’t be rendered',
    EXPORT_VALIDATION_FAILED: 'The exported file didn’t pass validation',
    EXPORT_PUBLISH_FAILED: 'The files couldn’t be saved to the export location',
    EXPORT_PARTIALLY_PUBLISHED: 'Only some files were saved',
    RESOURCE_ADMISSION_UNSATISFIABLE: 'This computer doesn’t have enough resources for this export',
  } as Record<string, string>,
  resources: {
    memory: 'Memory',
    gpuMemory: 'GPU memory',
    cpuThreads: 'CPU threads',
    scratchDisk: 'Disk space for temporary files',
  } as Record<string, string>,
  problemSeparator: '; ',
  fileProblems: (file: string, problems: string) => `${file}: ${problems}`,
  notStarted: 'Export didn’t start',
  failed: 'Export failed',
  missingTool: (tool: string) => `Missing: ${tool}`,
  assetMissingHint: 'Find the file or relink it in Assets, then export again.',
  assetChangedHint: 'Relink this asset or put the original file back, then export again.',
  nothingHint: 'Pick a different range, or put something on the timeline first.',
  space: (required: string, available: string) => `Needs about ${required}; only ${available} left`,
  notEnough: (resource: string) => `Not enough: ${resource}`,
  resourceHint: 'Export a shorter range or choose a lower resolution, then try again.',
};
export type ExportRejectionMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 导出被拒或失败时，界面上说什么、能做什么（架构设计 §9.11 的预检与失败码，Runtime 的 export-service.ts）。
 *
 * - 提交时被拒：`exports.create` 抛 RPC 错误，`details.code` 是导出的拒绝码，没有建任务。
 * - 跑到一半失败：任务记录的 `error.code` 是 `TaskFailure` 的码（渲染、校验、发布失败，或只发布了一部分）。
 *
 * 两种都整理成同一个形状：一句标题、Runtime 原话、逐项清单、Runtime 给的补救说明（`details.remedy` / `details.recovery`），
 * 以及界面能直接做的那一步（跳过画不出来的内容重提、跳过缺失的素材重提、换个位置、指定一份文档）。
 */

export type ExportRemedy =
  /** 成片：`onUnsupported: 'skip'` 重提，画不出来的逐项跳过并记警告。 */
  | { kind: 'skip-unsupported' }
  /** 便携包：`missingAssets: 'skip'` 重提，清单里如实标缺失。 */
  | { kind: 'skip-missing-assets' }
  /** 换一个导出位置。 */
  | { kind: 'pick-dir' }
  /** 有几份文档都能导出：选一份。 */
  | { kind: 'choose-document'; candidates: { documentId: Id; name: string; language: string | null }[] };

export interface ExportProblem {
  code: string | null;
  title: string;
  /** Runtime 的原话。 */
  message: string;
  /** 逐项：画不出来的内容、读不到的素材、没保存成的文件…… */
  items: string[];
  /** Runtime 给的补救说明（原话）。 */
  hint: string | null;
  remedy: ExportRemedy | null;
}

interface ErrorLike {
  message?: string;
  code?: string;
  details?: unknown;
}

const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(record) : []);

/** 提交时 RPC 错误的拒绝码在 `details.code`；任务失败的码在 `error.code`。 */
export function exportErrorCode(error: unknown): string | null {
  const e = record(error);
  return text(record(e.details).code) ?? (typeof e.code === 'string' && /^[A-Z_]+$/.test(e.code) ? e.code : null);
}

const PORTABLE_REASON: Record<string, string> = live(() => M.portableReason);

const TITLES: Record<string, string> = live(() => M.titles);

/** 资源准入缺的维度（架构设计 §7.7，Runtime 的 `ResourceDimension`）。 */
const RESOURCE_LABEL: Record<string, string> = live(() => M.resources);

export interface ExplainContext {
  kind: ExportKind;
  /** 是提交时被拒（还没建任务）还是任务失败。 */
  stage: 'rejected' | 'failed';
  documents?: Record<Id, DocumentRecord>;
}

export function explainExportError(error: ErrorLike | unknown, ctx: ExplainContext): ExportProblem {
  const e = record(error);
  const details = record(e.details);
  const code = exportErrorCode(error);
  const message = localizeText(text(e.message), refIn(e.messageRef)) ?? '';
  // Runtime 的补救说明（`remedyRef`）与引擎的（`recoveryRef`）带引用，按当前语言显示。
  const hint = remedyText(details) ?? text(localizeText(text(details.recovery), refIn(details.recoveryRef)));
  // 任务失败（TaskFailure）时没保存成的文件逐个列在 `details.failed`。
  const failed = list(details.failed).map((f) => {
    const problems = Array.isArray(f.problems) ? (f.problems as unknown[]).filter((p) => typeof p === 'string').join(M.problemSeparator) : '';
    const fileName = text(f.fileName);
    return fileName && problems ? M.fileProblems(fileName, problems) : (fileName ?? problems);
  });
  const docName = (id: unknown) => (typeof id === 'string' ? (ctx.documents?.[id]?.name ?? id) : '');
  const base: ExportProblem = {
    code,
    title: (code && TITLES[code]) ?? (ctx.stage === 'rejected' ? M.notStarted : M.failed),
    message,
    items: failed,
    hint,
    remedy: null,
  };
  switch (code) {
    case 'EXPORT_UNSUPPORTED_CONTENT':
      return {
        ...base,
        items: list(details.items).map((i) => text(i.message) ?? String(i.itemId ?? '')),
        remedy: ctx.kind === 'video' ? { kind: 'skip-unsupported' } : null,
      };
    case 'EXPORT_TOOL_MISSING':
      return { ...base, items: text(details.missing) ? [M.missingTool(details.missing as string)] : [] };
    case 'ASSET_MISSING': {
      const items = list(details.items);
      if (items.length) {
        return {
          ...base,
          items: items.map((i) => {
            const reason = typeof i.reason === 'string' ? (PORTABLE_REASON[i.reason] ?? i.reason) : '';
            return [text(i.name) ?? text(i.path) ?? String(i.assetId ?? ''), reason].filter(Boolean).join(' · ');
          }),
          remedy: ctx.kind === 'portable' ? { kind: 'skip-missing-assets' } : null,
        };
      }
      return { ...base, items: text(details.path) ? [details.path as string] : [], hint: hint ?? M.assetMissingHint };
    }
    case 'ASSET_CHANGED':
      return { ...base, items: text(details.path) ? [details.path as string] : [], hint: hint ?? M.assetChangedHint };
    case 'EXPORT_SOURCE_AMBIGUOUS': {
      const candidates = list(details.candidates).map((c) => ({
        documentId: String(c.documentId ?? ''),
        name: text(c.name) ?? String(c.documentId ?? ''),
        language: text(c.language),
      }));
      return {
        ...base,
        items: candidates.map((c) => (c.language ? `${c.name} · ${c.language}` : c.name)),
        remedy: candidates.length ? { kind: 'choose-document', candidates } : null,
      };
    }
    case 'EXPORT_NOTHING_TO_EXPORT': {
      const range = record(details.range);
      const items =
        typeof range.start === 'number' && typeof range.end === 'number' ? [`${formatRangeTime(range.start)}–${formatRangeTime(range.end)}`] : [];
      return { ...base, items, hint: hint ?? M.nothingHint };
    }
    case 'EXPORT_PACKAGE_LOCAL_PATH':
      return { ...base, items: list(details.items).map((i) => docName(i.documentId)) };
    case 'EXPORT_PACKAGE_UNSUPPORTED':
      return { ...base, items: list(details.items).map((i) => [text(i.path), text(i.reason)].filter(Boolean).join(' · ')) };
    case 'EXPORT_INSUFFICIENT_SPACE': {
      const items =
        typeof details.required === 'number' && typeof details.available === 'number'
          ? [M.space(fmtSize(details.required), fmtSize(details.available))]
          : text(details.dir)
            ? [details.dir as string]
            : [];
      return { ...base, items, remedy: { kind: 'pick-dir' } };
    }
    case 'EXPORT_DESTINATION_EXISTS':
    case 'EXPORT_DESTINATION_UNWRITABLE':
      return { ...base, items: text(details.path) ? [details.path as string] : failed, remedy: { kind: 'pick-dir' } };
    case 'EXPORT_PUBLISH_FAILED':
      return { ...base, remedy: { kind: 'pick-dir' } };
    case 'RESOURCE_ADMISSION_UNSATISFIABLE': {
      const dims = Array.isArray(details.dimensions) ? (details.dimensions as unknown[]).filter((d): d is string => typeof d === 'string') : [];
      return { ...base, items: dims.map((d) => M.notEnough(RESOURCE_LABEL[d] ?? d)), hint: hint ?? M.resourceHint };
    }
    default:
      return base;
  }
}
