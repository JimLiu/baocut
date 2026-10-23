import { describe, expect, it } from 'vitest';
import { panelRects, type AssetRecord, type Sequence, type SequenceItem, type VideoPanel } from '@baocut/protocol';
import { patchItem } from './item-draft.ts';
import {
  applyPanelsTo,
  applyPanelsToAll,
  defaultPanels,
  hasPanels,
  panPanel,
  panelAt,
  panelSource,
  panelsOperations,
  singleOperations,
  soloFocal,
  soloOperations,
  splitOperations,
  swapPanels,
  upscaledPanels,
  withPanelFocal,
  type PanelledVideo,
} from './panels.ts';
import { fillFramingOperations, framedPose, freeFramingOperations, isFramed, isPanelled, stagePose } from './stage-framing.ts';
import { gesturePatch, panGesture, stepGesture } from './stage-gesture.ts';
import { applyFramingToAll, framingPieces } from './stage-shots.ts';

/** 9:16 的子视频画布，16:9 的源：两格上下各是 9:8。 */
const canvas = { width: 1080, height: 1920 };
const source = { width: 1920, height: 1080 };
const assets = {
  a1: {
    id: 'a1',
    kind: 'video',
    revisions: { r1: { video: { displayWidth: 1920, displayHeight: 1080, rotation: 0, pixelAspectRatio: { num: 1, den: 1 } } } },
  },
} as unknown as Record<string, AssetRecord>;

const video = (id: string, fromFrame: number, over: Record<string, unknown> = {}) =>
  ({
    id,
    type: 'video',
    trackId: 'v1',
    mode: 'fullscreen',
    fit: 'cover',
    place: {},
    span: { fromFrame, durationFrames: 90 },
    assetRef: { id: 'a1', revision: 'r1' },
    ...over,
  }) as unknown as SequenceItem;
const split = (id: string, fromFrame: number, panels: VideoPanel[] = defaultPanels()) => video(id, fromFrame, { panels }) as PanelledVideo;
const seq = (items: SequenceItem[]) => ({ id: 's1', fps: { num: 30, den: 1 }, canvas, items }) as unknown as Sequence;

describe('分屏的片段在画布上', () => {
  it('带格子的铺满 cover 视频算按原片取景；选中框是整块画布；不能填满、不能改成自由摆放', () => {
    const item = split('a', 0);
    expect(hasPanels(item)).toBe(true);
    expect(isFramed(item)).toBe(true);
    expect(isPanelled(item)).toBe(true);
    expect(isPanelled(video('b', 0, { focalPoint: { x: 0.3, y: 0.5 } }))).toBe(false);
    expect(framedPose(item, canvas, assets)).toEqual({ cx: 540, cy: 960, w: 1080, h: 1920, rotation: 0 });
    expect(stagePose(item, canvas, assets)).toEqual({ cx: 540, cy: 960, w: 1080, h: 1920, rotation: 0 });
    expect(fillFramingOperations('s1', item)).toEqual([]);
    expect(freeFramingOperations('s1', item, canvas, assets)).toEqual([]);
  });

  it('按下的那一点落在哪一格', () => {
    const panels = defaultPanels();
    expect(panelAt(panels, { x: 540, y: 400 }, canvas)).toBe(0);
    expect(panelAt(panels, { x: 540, y: 1500 }, canvas)).toBe(1);
    expect(panelAt(panels, { x: -10, y: 400 }, canvas)).toBe(-1);
  });

  it('在一格里拖：画面跟着手走（往右拖取景点往左），只改这一格；拖过原片边缘停住并标出', () => {
    const panels = defaultPanels();
    const right = panPanel(panels, 0, { x: 100, y: 0 }, source, canvas);
    expect(right.edge).toBe(false);
    expect(right.panels[0]!.focalPoint.x).toBeLessThan(0.25);
    expect(right.panels[0]!.focalPoint.zoom).toBe(1.4);
    expect(right.panels[1]).toEqual(panels[1]);
    const far = panPanel(panels, 0, { x: 5000, y: 0 }, source, canvas);
    expect(far.edge).toBe(true);
    expect(far.panels[0]!.focalPoint.x).toBe(0);
    const down = panPanel(panels, 1, { x: 0, y: 60 }, source, canvas);
    expect(down.panels[1]!.focalPoint.y).toBeLessThan(0.4);
  });

  it('拖动手势：起手看按在哪一格，草稿只叠格子，松手写一笔 setStyle；不知道源尺寸时不起手', () => {
    const item = split('a', 0);
    const g = panGesture(item, { x: 540, y: 1500 }, canvas, assets)!;
    expect(g).toMatchObject({ kind: 'pan', cell: 1, source });
    expect(panGesture(item, { x: 540, y: 1500 }, canvas, undefined)).toBeNull();
    const frame = stepGesture(g, { x: 440, y: 1500 }, { shift: false, alt: false }, { canvas, others: [], pxScale: 1 });
    expect(frame.hit).toBeNull();
    expect(frame.poses[0]).toEqual(g.member.start);
    expect(frame.panels![0]).toEqual(item.panels[0]);
    expect(frame.panels![1]!.focalPoint.x).toBeGreaterThan(0.75);
    const patch = gesturePatch(item, frame.poses[0]!, 1, canvas, assets, undefined, frame.panels);
    expect(patch).toEqual({ panels: frame.panels });
    expect((patchItem(item, patch) as PanelledVideo).panels).toEqual(frame.panels);
    expect(panelsOperations('s1', item, frame.panels!)).toEqual([
      { type: 'setStyle', sequenceId: 's1', itemId: 'a', panels: frame.panels },
    ]);
    expect(panelsOperations('s1', item, item.panels)).toEqual([]);
  });

  it('草稿里的 `null` 去掉格子', () => {
    expect('panels' in patchItem(split('a', 0), { panels: null })).toBe(false);
  });
});

describe('属性面板「版式」', () => {
  it('互换、改一格的取景、套到另一段：格子不动，只动取景点；放大夹在上限，位置夹在 0–1', () => {
    const panels = defaultPanels();
    const swapped = swapPanels(panels);
    expect(swapped.map((p) => p.rect)).toEqual(panels.map((p) => p.rect));
    expect(swapped[0]!.focalPoint.x).toBe(0.75);
    expect(withPanelFocal(panels, 1, { zoom: 9 })[1]!.focalPoint.zoom).toBe(4);
    expect(withPanelFocal(panels, 0, { x: -1 })[0]!.focalPoint.x).toBe(0);
    expect(withPanelFocal(panels, 0, { zoom: 1 })[0]!.focalPoint).toEqual({ x: 0.25, y: 0.4 });
    expect(applyPanelsTo(swapped, panels)![0]!.focalPoint.x).toBe(0.75);
    const grid = panelRects('grid', 4)!.map((rect) => ({ rect, focalPoint: { x: 0.5, y: 0.5 } }));
    expect(applyPanelsTo(swapped, grid)).toBeNull();
  });

  it('放大太多的格子标出来（与派生的 panel-upscaled 同一个门槛）', () => {
    expect(upscaledPanels(defaultPanels(), source, canvas)).toEqual([false, false]);
    expect(upscaledPanels(withPanelFocal(defaultPanels(), 1, { zoom: 4 }), source, canvas)).toEqual([false, true]);
    expect(upscaledPanels(defaultPanels(), null, canvas)).toEqual([false, false]);
  });

  it('交给格子的源尺寸按实例的裁剪留下的那块', () => {
    expect(panelSource(split('a', 0), assets)).toEqual(source);
    expect(panelSource(video('a', 0, { crop: { left: 0.25, top: 0, right: 0.25, bottom: 0.5 } }) as PanelledVideo, assets)).toEqual({
      width: 960,
      height: 540,
    });
    expect(panelSource(split('a', 0), undefined)).toBeNull();
  });

  it('一人 ↔ 分屏：分屏用默认两格；换回一人用实例自己的取景点，派生的分屏段没有时按上格的人对准', () => {
    const single = video('a', 0, { focalPoint: { x: 0.3, y: 0.5 } }) as PanelledVideo;
    expect(splitOperations('s1', single)).toEqual([{ type: 'setStyle', sequenceId: 's1', itemId: 'a', panels: defaultPanels() }]);
    expect(splitOperations('s1', split('b', 0))).toEqual([]);
    const derived = split('b', 0);
    const [back] = singleOperations('s1', derived, source, canvas);
    expect(back).toMatchObject({ type: 'setStyle', itemId: 'b', panels: null, focalPoint: soloFocal(derived.panels[0]!, source, canvas) });
    expect(soloFocal(derived.panels[0]!, source, canvas).x).toBeLessThan(0.5);
    const own = video('c', 0, { focalPoint: { x: 0.7, y: 0.5 }, panels: defaultPanels() }) as PanelledVideo;
    expect(singleOperations('s1', own, source, canvas)).toEqual([{ type: 'setStyle', sequenceId: 's1', itemId: 'c', panels: null }]);
  });

  it('只留这一格的人：这个人仍在原片里原来的横向位置，不放大', () => {
    const item = split('a', 0);
    const [bottom] = soloOperations('s1', item, 1, source, canvas);
    const focal = (bottom as { focalPoint: { x: number; zoom?: number } }).focalPoint;
    expect(focal.x).toBeGreaterThan(0.5);
    expect(focal.zoom).toBeUndefined();
    expect(soloOperations('s1', item, 5, source, canvas)).toEqual([]);
  });

  it('套到整支：只写同格数的其它分屏段，一人段与格数不同的不动；一人段的「套到整支」也跳过分屏段', () => {
    const here = split('a', 0, withPanelFocal(defaultPanels(), 0, { zoom: 2 }));
    const twin = split('b', 90);
    const one = video('c', 180, { focalPoint: { x: 0.5, y: 0.5 } });
    const grid = split(
      'd',
      270,
      panelRects('grid', 4)!.map((rect) => ({ rect, focalPoint: { x: 0.5, y: 0.5 } })),
    );
    const pieces = framingPieces(seq([here, twin, one, grid]), here);
    expect(pieces.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
    const { operations, count } = applyPanelsToAll('s1', here, pieces);
    expect(count).toBe(1);
    expect(operations).toEqual([{ type: 'setStyle', sequenceId: 's1', itemId: 'b', panels: applyPanelsTo(here.panels, twin.panels) }]);
    const zoomed = video('e', 360, { focalPoint: { x: 0.5, y: 0.5, zoom: 1.5 } }) as PanelledVideo;
    expect(applyFramingToAll('s1', zoomed, [...pieces, zoomed]).map((op) => (op as { itemId: string }).itemId)).toEqual(['c']);
  });
});
