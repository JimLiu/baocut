import type { TemplateBox, TemplateLayer, TemplateLayerKind, TemplateLayers } from '@baocut/protocol';
import { templateBlank, templateBox, templateHit, templateNewLayer } from '@baocut/editor-wasm';
import { withLayer } from './template-layers.ts';

/**
 * 版面编辑器的会话（原型 editor-template.jsx 的 `tplStudio`、panel-template-studio.jsx）：改的是草稿，「完成」才写回。
 * 草稿写回到哪里看 `source`：
 * - `video`：这部视频里套着的那一份（一笔 `setTemplate`）；
 * - `new-video`：从空白做一套，套进这部视频；
 * - `brand`：品牌库里的一条定义（按条目 ID 改）；
 * - `new-brand`：从空白做一条品牌库定义。
 * 框的几何（夹取、拖动、八把手拉伸）与命中在 Rust 的 `timeline::template`，经 editor-wasm 调；这里不碰 React。
 */
export type StudioSource = 'video' | 'new-video' | 'brand' | 'new-brand';

export interface TemplateStudio {
  source: StudioSource;
  /** `brand` 时是品牌库条目的 ID。 */
  entryId: string | null;
  /** 打开时的样子：返回时比对它，决定要不要说「已放弃改动」。 */
  base: TemplateLayers;
  draft: TemplateLayers;
  /** 选中的那一层。 */
  layer: string | null;
}

export type StudioHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** 八个拉伸把手，原型 `TPL.HANDLES` 的次序。 */
export const STUDIO_HANDLES: readonly StudioHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** 打开一次会话：给了 `doc` 就改它的深拷贝，否则从空白开始；先选中第一层开着的。 */
export function openStudio(source: StudioSource, doc: TemplateLayers | null, entryId: string | null, blankName: string): TemplateStudio {
  const base = doc ? (structuredClone(doc) as TemplateLayers) : blankTemplate(blankName);
  return { source, entryId, base, draft: base, layer: base.layers.find((l) => l.on !== false)?.id ?? null };
}

/** 空白模板（16:9，没有层）。 */
export function blankTemplate(name: string, canvas: '16:9' | '9:16' = '16:9'): TemplateLayers {
  return templateBlank<TemplateLayers>(canvas, name);
}

/** 草稿与打开时不同。 */
export function studioDirty(studio: TemplateStudio): boolean {
  return JSON.stringify(studio.base) !== JSON.stringify(studio.draft);
}

/** 改整套的字段（名字、画幅、套用时画幅、锁）。`ratio` 清掉时锁一并去掉：没有画幅就没得锁。 */
export function setDraft(studio: TemplateStudio, patch: Partial<TemplateLayers>): TemplateStudio {
  const draft: TemplateLayers = { ...studio.draft, ...patch };
  for (const key of Object.keys(patch) as (keyof TemplateLayers)[]) if (patch[key] === undefined) delete draft[key];
  if (!draft.ratio) delete draft.lockRatio;
  if (draft.lockRatio === false) delete draft.lockRatio;
  return { ...studio, draft };
}

/** 加一层（按界面语言给默认参数，ID 不与已有的重），放在最上面并选中它。 */
export function addLayer(studio: TemplateStudio, kind: TemplateLayerKind, lang: string): TemplateStudio {
  const layer = templateNewLayer<TemplateLayer>(
    kind,
    lang,
    studio.draft.layers.map((l) => l.id),
  );
  return { ...studio, draft: { ...studio.draft, layers: [...studio.draft.layers, layer] }, layer: layer.id };
}

/** 删一层；删的是选中的那层时不再选中。 */
export function removeLayer(studio: TemplateStudio, id: string): TemplateStudio {
  return {
    ...studio,
    draft: { ...studio.draft, layers: studio.draft.layers.filter((l) => l.id !== id) },
    layer: studio.layer === id ? null : studio.layer,
  };
}

/** 往上（`1`，盖住更多）或往下（`-1`）挪一层；到头了不动。 */
export function moveLayer(studio: TemplateStudio, id: string, dir: 1 | -1): TemplateStudio {
  const layers = [...studio.draft.layers];
  const i = layers.findIndex((l) => l.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= layers.length) return studio;
  [layers[i], layers[j]] = [layers[j]!, layers[i]!];
  return { ...studio, draft: { ...studio.draft, layers } };
}

/** 改一层的字段。 */
export function patchStudioLayer(studio: TemplateStudio, id: string, patch: Partial<TemplateLayer>): TemplateStudio {
  return { ...studio, draft: withLayer(studio.draft, id, patch) };
}

/** 换一层的框（先经引擎夹进画面、取一位小数）。 */
export function setLayerBox(studio: TemplateStudio, id: string, box: TemplateBox): TemplateStudio {
  return patchStudioLayer(studio, id, { box: clampBox(box) });
}

/** 夹进画面：尺寸不小于下限、位置不出画、一位小数。 */
export function clampBox(box: TemplateBox): TemplateBox {
  return templateBox({ op: 'clamp', box });
}

/** 拖动：像素位移折成画面百分比，整体平移。 */
export function dragBox(box: TemplateBox, dx: number, dy: number, frame: { width: number; height: number }): TemplateBox {
  return templateBox({ op: 'drag', box, dx, dy, frame });
}

/** 拉伸：被拖的边跟手，对边不动。 */
export function resizeBox(
  box: TemplateBox,
  handle: StudioHandle,
  dx: number,
  dy: number,
  frame: { width: number; height: number },
): TemplateBox {
  return templateBox({ op: 'resize', box, handle, dx, dy, frame });
}

/** 画面百分比坐标上最上面那一层开着的（自顶向下）。 */
export function hitLayer(doc: TemplateLayers, x: number, y: number): string | null {
  return templateHit(doc, x, y);
}

/** 几何段的快捷：整宽、贴顶、贴底、水平居中。 */
export type BoxQuick = 'full' | 'top' | 'bottom' | 'center';

export function quickBox(box: TemplateBox, quick: BoxQuick): TemplateBox {
  if (quick === 'full') return clampBox({ ...box, x: 0, w: 100 });
  if (quick === 'top') return clampBox({ ...box, y: 0 });
  if (quick === 'bottom') return clampBox({ ...box, y: 100 - box.h });
  return clampBox({ ...box, x: (100 - box.w) / 2 });
}
