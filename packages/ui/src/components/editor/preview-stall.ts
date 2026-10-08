import type { Id } from '@baocut/protocol';
import { EDITOR_COPY as E } from './editor-copy.ts';
import type { StallReport, StallStep } from './preview-watch.ts';

/**
 * 预览载入与卡住（产品设计 §5.1）：舞台上画什么。卡没卡住由预览引擎的卡住诊断判（`preview-watch.ts`，门槛 `STALL_MS`）；
 * 这里只把诊断的步骤换成给人看的一句话（点名素材、字幕文档或字体族），开发细节（元素状态、意外的错）留在开发日志里。
 */

/** 载入这么久还没好才露出转圈（打开很快的视频不闪一下）。 */
export const SPINNER_DELAY_MS = 500;

/** 转换没完成前最多显示 99%：挂着 100% 读起来像卡死（设计稿 model-stage-load.js 的 `MAX_PCT`）。 */
const MAX_PERCENT = 99;

/** 卡住提示说的是哪一类（与设计稿 model-stage-load.js 的步骤同一套）。 */
export type StallTopic = 'engine' | 'video' | 'media' | 'prepare' | 'captions' | 'fonts' | 'paint';

export function stallTopic(step: StallStep): StallTopic {
  switch (step) {
    case 'planner-loading':
      return 'engine';
    case 'no-video':
    case 'video-error':
    case 'no-plan':
      return 'video';
    case 'media-pending':
      return 'media';
    case 'media-preparing':
      return 'prepare';
    case 'documents-pending':
      return 'captions';
    case 'fonts-loading':
      return 'fonts';
    case 'not-painted':
    case 'no-canvas':
      return 'paint';
  }
}

/** 按 ID 查名字（素材记录与文档记录的 `name`）。 */
export interface StallNames {
  asset(id: Id): string | undefined;
  document(id: Id): string | undefined;
}

/** 卡在哪一步的那一句；点名的对象查不到名字时用通用说法。 */
export function stallDetail(report: Pick<StallReport, 'step' | 'media' | 'documents' | 'fonts'>, names: StallNames): string {
  const topic = stallTopic(report.step);
  if (topic === 'media' || topic === 'prepare') {
    const name = firstName(report.media.map((probe) => probe.assetId).filter((id): id is Id => Boolean(id)), names.asset);
    if (topic === 'prepare') return name ? E.stall.prepare(name) : E.stall.prepareUnnamed;
    return name ? E.stall.media(name) : E.stall.mediaUnnamed;
  }
  if (topic === 'captions') {
    const name = firstName(report.documents, names.document);
    return name ? E.stall.captions(name) : E.stall.captionsUnnamed;
  }
  if (topic === 'fonts') {
    const family = report.fonts.find((f) => f.trim());
    return family ? E.stall.fonts(family.trim()) : E.stall.paint;
  }
  return topic === 'engine' ? E.stall.engine : topic === 'video' ? E.stall.video : E.stall.paint;
}

/** 转换进度（0–1）→ 显示的百分比：向下取整、封顶 99；不知道进度是 null（进度条不定）。 */
export function preparePercent(progress: number | null | undefined): number | null {
  if (typeof progress !== 'number' || !(progress >= 0)) return null;
  return Math.min(MAX_PERCENT, Math.floor(progress * 100));
}

/** 已经等了几秒（`now` 与 `since` 是诊断的同一个时钟）。 */
export function waitedSeconds(report: Pick<StallReport, 'since'>, now: number): number {
  return Math.max(0, Math.floor((now - report.since) / 1000));
}

function firstName(ids: readonly Id[], name: (id: Id) => string | undefined): string | null {
  for (const id of ids) {
    const found = name(id)?.trim();
    if (found) return found;
  }
  return null;
}
