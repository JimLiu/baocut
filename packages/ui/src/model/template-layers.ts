import type { AssetRecord, EditOperation, Id, Marker, Sequence, TemplateLayer, TemplateLayerKind, TemplateLayers } from '@baocut/protocol';
import { templateCatalog, templateDefinition, templateInfo, templateInstance, type TemplateInfo } from '@baocut/editor-wasm';
import { ratioCanvas } from './property-values.ts';
import { ORIGINAL_RATIO, sourceSize } from './stage-bar.ts';

/**
 * 模板层（视频格式规范 §3.17；原型 model-template.js）的界面判据：目录、摘要、套用时的画幅与画幅锁。规则本身（内置款、
 * 组、定义与实例、字幕避让、校验）在 Rust 的 `timeline::template`，经 editor-wasm 调；这里只把它接到序列与编辑操作上。不碰 React。
 */

type Size = { width: number; height: number };

/** 目录里的一套：定义与它是不是品牌库里的。 */
export interface TemplateEntry {
  doc: TemplateLayers;
  brand: boolean;
}

/** 目录的一组（组名跟界面语言，内置的组名只有简中、繁中、英文、日文四套，别的语言用英文）。 */
export interface TemplateGroup {
  key: string;
  label: string;
  items: TemplateEntry[];
}

/** 层的四类，版面编辑器「加一层」与属性页的分节都按这个次序。 */
export const TEMPLATE_KINDS: readonly TemplateLayerKind[] = ['chapters', 'progress', 'logo', 'text'];

/** 文字层里能写的变量（播放时按播放头换成真值）。 */
export const TEMPLATE_VARS = ['chapter', 'n', 'count', 'time', 'remain', 'total', 'percent', 'title'] as const;

/** 目录：内置十七款加品牌库的定义，按组分节，品牌库那一组在最后。 */
export function templateGroups(lang: string, brand: readonly TemplateLayers[]): TemplateGroup[] {
  return templateCatalog(lang, brand) as unknown as TemplateGroup[];
}

/** 套用：定义的深拷贝，`from` 记它的 ID。 */
export function instanceOf(doc: TemplateLayers): TemplateLayers {
  return templateInstance(doc) as TemplateLayers;
}

/** 存进品牌库的定义：换名字与 ID，去掉 `from` 与内置标记，并经引擎校验（不合规时抛错）。 */
export function definitionOf(doc: TemplateLayers, name: string, id: string): TemplateLayers {
  return templateDefinition(doc, name, id) as TemplateLayers;
}

/** 这套模板里有哪几类层（按第一次出现的次序，摘要用）。 */
export function templateKinds(doc: TemplateLayers): TemplateLayerKind[] {
  const kinds: TemplateLayerKind[] = [];
  for (const layer of doc.layers) if (!kinds.includes(layer.kind)) kinds.push(layer.kind);
  return kinds;
}

/** 水印类（内置的三款与由旧水印导入的）。 */
export function isWatermark(doc: TemplateLayers): boolean {
  return doc.tag === 'watermark';
}

/** 派生量：套用时改成的画幅、锁不锁、字幕抬到哪。 */
export function infoOf(doc: TemplateLayers): TemplateInfo {
  return templateInfo(doc);
}

/** `W:H` 拆成两个正数；`original` 与认不出的写法为 null。 */
export function parseRatio(ratio: string): { w: number; h: number } | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(ratio);
  if (!match) return null;
  const w = Number(match[1]);
  const h = Number(match[2]);
  return w > 0 && h > 0 ? { w, h } : null;
}

/** 画幅档在界面上怎么写：`original` 交给调用方换成「原始」，其余原样。 */
export const isOriginalRatio = (ratio: string): boolean => ratio.trim().toLowerCase() === ORIGINAL_RATIO;

/** 套用时要换成的画布（短边不变）；`original` 没有视频时、或认不出时为 null。 */
export function ratioTargetCanvas(ratio: string, canvas: Size, original: Size | null): Size | null {
  if (isOriginalRatio(ratio)) return original ? ratioCanvas(canvas, original.width, original.height) : null;
  const parsed = parseRatio(ratio);
  return parsed ? ratioCanvas(canvas, parsed.w, parsed.h) : null;
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

/** 画布是不是这一档。 */
export function canvasMatches(ratio: string, canvas: Size, original: Size | null): boolean {
  const target = isOriginalRatio(ratio)
    ? original
    : (() => {
        const parsed = parseRatio(ratio);
        return parsed ? { width: parsed.w, height: parsed.h } : null;
      })();
  return !!target && near(target.width / target.height, canvas.width / canvas.height);
}

/** 画幅锁：模板声明了画幅并且锁上时是那一档，否则 null。 */
export function ratioLockOf(doc: TemplateLayers | undefined | null): { ratio: string; name: string } | null {
  if (!doc) return null;
  const info = infoOf(doc);
  return info.ratioLocked && info.ratioTarget ? { ratio: info.ratioTarget, name: doc.name } : null;
}

/** 改画布前问一声：没锁随便改；锁着只放行锁定的那一档。 */
export function canvasAllowed(doc: TemplateLayers | undefined | null, next: Size, original: Size | null): boolean {
  const lock = ratioLockOf(doc);
  return !lock || canvasMatches(lock.ratio, next, original);
}

/** 套用一套定义要提交的修改：换模板，声明了套用时画幅且与现在不同时再换画布，同一笔撤销。 */
export interface ApplyPlan {
  operations: EditOperation[];
  instance: TemplateLayers;
  /** 换了画布时是哪一档。 */
  ratio: string | null;
  locked: boolean;
}

export function applyPlan(sequence: Sequence, assets: Record<Id, AssetRecord>, doc: TemplateLayers): ApplyPlan {
  const instance = instanceOf(doc);
  const info = infoOf(instance);
  // 先换模板再换画布：旧模板锁着别的画幅时，换画布要等新模板（锁的是它自己那一档）到位才放行。
  const operations: EditOperation[] = [{ type: 'setTemplate', sequenceId: sequence.id, template: instance }];
  let ratio: string | null = null;
  if (info.ratioTarget) {
    const next = ratioTargetCanvas(info.ratioTarget, sequence.canvas, sourceSize(sequence, assets));
    if (next && (next.width !== sequence.canvas.width || next.height !== sequence.canvas.height)) {
      operations.push({ type: 'updateSequence', sequenceId: sequence.id, canvas: next });
      ratio = info.ratioTarget;
    }
  }
  return { operations, instance, ratio, locked: info.ratioLocked };
}

/** 换掉序列模板里的一层（按 ID）。 */
export function withLayer(doc: TemplateLayers, id: string, patch: Partial<TemplateLayer>): TemplateLayers {
  return { ...doc, layers: doc.layers.map((layer) => (layer.id === id ? ({ ...layer, ...patch } as TemplateLayer) : layer)) };
}

/** 一层的不透明度（台标层；缺省 1，夹进 [0.05, 1]）。 */
export function layerOpacity(layer: TemplateLayer): number {
  if (layer.kind !== 'logo' || layer.opacity === undefined) return 1;
  return Math.min(1, Math.max(0.05, layer.opacity));
}

/** 台标在盒子里靠哪边（缺省居中）。 */
export function logoAlign(layer: TemplateLayer): 'left' | 'center' | 'right' {
  return layer.kind === 'logo' ? (layer.align ?? 'center') : 'center';
}

/** 缩略图的示范章节：四章，按 `duration` 秒均分偏前。 */
export function demoMarkers(titles: readonly string[], duration: number, fps = 30): Marker[] {
  const cuts = [0, 0.18, 0.46, 0.74];
  return titles.slice(0, cuts.length).map((label, index) => ({
    id: `thumb_chapter_${index}`,
    frame: Math.round(cuts[index]! * duration * fps),
    label,
    kind: 'chapter' as const,
  }));
}
