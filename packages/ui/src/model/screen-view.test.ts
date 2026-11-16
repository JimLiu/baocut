import type { RecordingBody, ScreenViewBody, Sequence, VideoItem } from '@baocut/protocol';
import { describe, expect, it } from 'vitest';
import {
  addZoomChange,
  cameraLayoutOf,
  cameraLayoutOps,
  contentClock,
  contentOffset,
  followChange,
  placeZooms,
  pointerChange,
  presentationOf,
  presentationOps,
  zoomChanges,
} from './screen-view.ts';

const view = (zooms: ScreenViewBody['zooms'] = []): ScreenViewBody => ({ schema: 'baocut.screen-view/1', timescale: 1000, clock: 'recording', solver: 1, zooms });
const zoom = (id: string, t0: number, t1: number, origin: 'auto' | 'manual' = 'auto'): ScreenViewBody['zooms'][number] => ({
  id,
  t0: String(t0),
  t1: String(t1),
  scale: 2,
  focus: { kind: 'pointer' },
  origin,
});

const video = (over: Partial<VideoItem> = {}): VideoItem =>
  ({
    id: 'item_screen',
    type: 'video',
    trackId: 't',
    enabled: true,
    locked: false,
    paintOrder: 1,
    followPolicy: { kind: 'follow-cuts' },
    assetRef: { id: 'asset_screen', revision: '1' },
    span: { fromFrame: 30, durationFrames: 90 },
    timeMap: { kind: 'linear', rate: { num: 1, den: 1 }, sourceIn: { ticks: '1', timescale: 1 } },
    place: {},
    mode: 'fullscreen',
    fit: 'contain',
    embeddedAudio: { enabled: true, volume: 1 },
    screenView: { documentId: 'doc_view' },
    ...over,
  }) as VideoItem;

const sequence = (items: VideoItem[]): Sequence =>
  ({ id: 'seq', fps: { num: 30, den: 1 }, canvas: { width: 1920, height: 1080 }, items, tracks: [], linkGroups: [] }) as unknown as Sequence;

describe('zoomChanges', () => {
  it('改自动区间时记上 edited，手动的不记', () => {
    const v = view([zoom('a', 1000, 2000), zoom('b', 3000, 4000, 'manual')]);
    expect(zoomChanges(v, 'a', { scale: 3 })).toEqual([
      { path: ['zooms', { id: 'a' }, 'scale'], value: 3 },
      { path: ['zooms', { id: 'a' }, 'edited'], value: true },
    ]);
    expect(zoomChanges(v, 'b', { scale: 3 })).toEqual([{ path: ['zooms', { id: 'b' }, 'scale'], value: 3 }]);
  });

  it('已经改过的自动区间不重复记；没变化时是空表', () => {
    const v = view([{ ...zoom('a', 1000, 2000), edited: true }]);
    expect(zoomChanges(v, 'a', { t1: 2.5 })).toEqual([{ path: ['zooms', { id: 'a' }, 't1'], value: '2500' }]);
    expect(zoomChanges(v, 'a', { scale: 2, t0: 1 })).toEqual([]);
  });

  it('两端夹在前后两段之间，至少留最短长度；倍率夹进 (1, 8]', () => {
    const v = view([zoom('a', 1000, 2000), zoom('b', 3000, 4000), zoom('c', 5000, 6000)]);
    expect(zoomChanges(v, 'b', { t0: 1.5, t1: 7 })).toEqual([
      { path: ['zooms', { id: 'b' }, 't0'], value: '2000' },
      { path: ['zooms', { id: 'b' }, 't1'], value: '5000' },
      { path: ['zooms', { id: 'b' }, 'edited'], value: true },
    ]);
    expect(zoomChanges(v, 'b', { t0: 3.95 })[0]).toEqual({ path: ['zooms', { id: 'b' }, 't0'], value: '3800' });
    expect(zoomChanges(v, 'b', { scale: 20 })[0]).toEqual({ path: ['zooms', { id: 'b' }, 'scale'], value: 8 });
  });
});

describe('addZoomChange', () => {
  it('新区间是手动的，按 t0 排进去、夹进空档', () => {
    const v = view([zoom('a', 1000, 2000), zoom('c', 5000, 6000)]);
    const added = addZoomChange(v, 2.5, 9, 'n')!;
    expect(added.change).toEqual({
      path: ['zooms', { id: 'n' }],
      value: { id: 'n', t0: '2500', t1: '5000', scale: 2, focus: { kind: 'pointer' }, origin: 'manual' },
      beforeId: 'c',
    });
    expect(addZoomChange(v, 6.5, 7, 'm')!.change).toMatchObject({ beforeId: null });
  });

  it('起点压在已有区间上、或空档太短时不加', () => {
    const v = view([zoom('a', 1000, 2000), zoom('c', 2100, 3000)]);
    expect(addZoomChange(v, 1.5, 1.8)).toBeNull();
    expect(addZoomChange(v, 2, 2.1)).toBeNull();
  });
});

describe('placeZooms', () => {
  const recording = { streams: [{ id: 's', role: 'screen', segmentId: 's1', assetRef: { id: 'asset_screen', revision: '1' }, start: '500000' }], timescale: 1000000 } as unknown as RecordingBody;

  it('录制时间经流的起点与实例的源入点投到序列上，越过实例的部分裁掉', () => {
    const v = view([zoom('a', 1000, 2000), zoom('b', 2500, 9000)]);
    const offset = contentOffset(v, recording, 'asset_screen');
    expect(offset).toBe(0.5);
    // 实例从第 1 秒（30 帧）起，源入点 1 秒，长 3 秒：录制时间 r 在序列上是 1 + (r − 0.5 − 1)。
    const item = video();
    const clock = contentClock(item, sequence([item]), offset)!;
    const placed = placeZooms(v, [clock]);
    expect(placed.map((p) => [p.zoom.id, p.start, p.end, p.clipStart, p.clipEnd])).toEqual([
      ['a', 1, 1.5, true, false],
      ['b', 2, 4, false, true],
    ]);
  });

  it('拆开、两倍速的实例各画自己的部分', () => {
    const v = view([zoom('a', 2000, 4000)]);
    const left = video({ id: 'l', span: { fromFrame: 0, durationFrames: 60 }, timeMap: { kind: 'linear', rate: { num: 1, den: 1 }, sourceIn: { ticks: '0', timescale: 1 } } });
    const right = video({ id: 'r', span: { fromFrame: 60, durationFrames: 30 }, timeMap: { kind: 'linear', rate: { num: 2, den: 1 }, sourceIn: { ticks: '3', timescale: 1 } } });
    const seq = sequence([left, right]);
    const placed = placeZooms(v, [contentClock(left, seq, 0)!, contentClock(right, seq, 0)!]);
    // 左段只到源时间 2 秒，碰不到；右段源入点 3 秒、两倍速：录制时间 4 秒在序列上是 2 + (4 − 3) / 2 = 2.5。
    expect(placed.map((p) => [p.itemId, p.start, p.end, p.clipStart])).toEqual([['r', 2, 2.5, true]]);
  });
});

describe('follow 与光标', () => {
  it('没有 follow / pointer 时整块写入，有时只改一项；null 去掉', () => {
    expect(followChange(view(), 'smoothing', 0.8)).toEqual({ path: ['follow'], value: { smoothing: 0.8 } });
    expect(followChange({ ...view(), follow: {} }, 'safeArea', 2)).toEqual({ path: ['follow', 'safeArea'], value: 0.95 });
    expect(pointerChange(view(), 'size', 2)).toEqual({ path: ['pointer'], value: { size: 2 } });
    expect(pointerChange({ ...view(), pointer: { size: 2 } }, 'size', null)).toEqual({ path: ['pointer', 'size'], remove: true });
  });
});

describe('摄像头布局与演示样式', () => {
  it('角落圆形把横的摄像头裁成正方，认得出来', () => {
    const camera = video({ id: 'cam', screenView: undefined, mode: 'pip' });
    const seq = sequence([camera]);
    const ops = cameraLayoutOps('corner-circle', seq, camera, { width: 1280, height: 720 }, []);
    expect(ops).toContainEqual(
      expect.objectContaining({ type: 'setStyle', itemId: 'cam', mask: { shape: 'ellipse' }, crop: { left: 0.21875, right: 0.21875, top: 0, bottom: 0 } }),
    );
    expect(cameraLayoutOf({ ...camera, mask: { shape: 'ellipse' }, place: { x: 85, y: 80, w: 22 } })).toBe('corner-circle');
  });

  it('左右分屏同时把屏幕摆到左半边；隐藏只关掉摄像头', () => {
    const camera = video({ id: 'cam', screenView: undefined });
    const screen = video();
    const seq = sequence([camera, screen]);
    const ops = cameraLayoutOps('split', seq, camera, { width: 1280, height: 720 }, [screen]);
    expect(ops).toContainEqual({ type: 'setTransform', sequenceId: 'seq', itemId: 'item_screen', x: 25, y: 50, w: 50 });
    expect(cameraLayoutOps('hidden', seq, camera, { width: 1, height: 1 }, [screen])).toEqual([
      { type: 'updateItem', sequenceId: 'seq', itemId: 'cam', enabled: false },
    ]);
  });

  it('缩小留边加圆角与投影，保留别的效果；全屏去掉投影', () => {
    const screen = video({ fx: { brightness: 0.2 } });
    const seq = sequence([screen]);
    expect(presentationOps('inset', seq, screen)).toContainEqual({
      type: 'setEffects',
      sequenceId: 'seq',
      itemId: 'item_screen',
      fx: { brightness: 0.2, shadow: { offsetX: 0, offsetY: 8, blur: 24, color: '#000000', opacity: 0.35 } },
    });
    expect(presentationOps('full', seq, { ...screen, fx: { shadow: { offsetX: 0, offsetY: 8, blur: 24, color: '#000000', opacity: 0.35 } } })).toContainEqual({
      type: 'setEffects',
      sequenceId: 'seq',
      itemId: 'item_screen',
      fx: null,
    });
    expect(presentationOf(screen)).toBe('full');
    expect(presentationOf({ ...screen, mode: 'pip', place: { w: 86, radius: 16 } })).toBe('inset');
  });
});
