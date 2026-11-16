import {
  itemRangeSeconds,
  mediaTimeToSeconds,
  newId,
  type AssetRecord,
  type DocumentChange,
  type EditOperation,
  type Fx,
  type Id,
  type LinkGroup,
  type RecordingBody,
  type RecordingPointerMode,
  type RecordingStreamRole,
  type ScreenPointerStyle,
  type ScreenViewBody,
  type ScreenZoom,
  type Sequence,
  type SequenceItem,
  type VideoItem,
} from '@baocut/protocol';

/*
 * 编辑录制（屏幕录制设计 §5「录完之后怎么编辑」，视频格式规范 §3.18、§4.9）：读屏幕取景文档与录制清单、把缩放区间投到
 * 序列上、把界面上的改动写成 `patchDocument`，以及联动组、摄像头布局与演示样式这几样只读快照就能算的东西。
 *
 * 时钟：取景文档的时刻写在内容的时钟上。录制的屏幕用录制时间，屏幕素材的源时间 `s` 对应录制时间 `start + s`
 * （`start` 是清单里屏幕流的起点）；普通视频用素材的源时钟，偏移是 0。
 */

/** 取景文档的格式名。 */
export const SCREEN_VIEW_SCHEMA = 'baocut.screen-view/1';
/** 缩放倍率的范围（规范 §4.9：(1, 8]）；界面最小给到 1.1。 */
export const ZOOM_MIN = 1.1;
export const ZOOM_MAX = 8;
/** 新加一段缩放的缺省倍率与最短长度（秒）。 */
export const ZOOM_DEFAULT = 2;
export const ZOOM_MIN_SECONDS = 0.2;
/** 光标大小的范围（规范 §4.9）。 */
export const POINTER_SIZE_MIN = 0.25;
export const POINTER_SIZE_MAX = 8;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** 取景文档的正文；不是这个格式时 null。 */
export function readScreenView(body: unknown): ScreenViewBody | null {
  if (!isRecord(body) || body.schema !== SCREEN_VIEW_SCHEMA || !Array.isArray(body.zooms)) return null;
  if (!(typeof body.timescale === 'number' && body.timescale > 0)) return null;
  return body as unknown as ScreenViewBody;
}

/** 录制清单的正文；不是这个格式时 null。 */
export function readRecording(body: unknown): RecordingBody | null {
  if (!isRecord(body) || body.schema !== 'baocut.recording/1' || !Array.isArray(body.streams)) return null;
  if (!(typeof body.timescale === 'number' && body.timescale > 0)) return null;
  return body as unknown as RecordingBody;
}

/** 整数刻度（十进制字符串）→ 秒。 */
export function ticksToSeconds(ticks: string, timescale: number): number {
  const n = Number(ticks);
  return Number.isFinite(n) ? n / timescale : 0;
}

/** 秒 → 整数刻度（十进制字符串），不小于 0。 */
export function secondsToTicks(seconds: number, timescale: number): string {
  return String(Math.max(0, Math.round(seconds * timescale)));
}

/** 光标能不能另画：清单说光标录进了画面（`baked`）或没有光标时不能。清单还没取到时按能。 */
export function pointerMode(recording: RecordingBody | null): RecordingPointerMode {
  return recording?.pointer?.mode ?? 'separate';
}

/**
 * 内容时钟上 0 落在屏幕素材源时间的哪一刻之前（秒）：录制时钟是清单里这个素材那一路流的 `start`，
 * 源时钟是 0。找不到那一路流时按 0。
 */
export function contentOffset(view: ScreenViewBody, recording: RecordingBody | null, assetId: Id): number {
  if (view.clock !== 'recording' || !recording) return 0;
  const stream = recording.streams.find((s) => s.assetRef.id === assetId);
  return stream ? ticksToSeconds(stream.start, recording.timescale) : 0;
}

/** 一段缩放在内容时钟上的区间（秒）。 */
export function zoomSeconds(view: ScreenViewBody, zoom: ScreenZoom): { t0: number; t1: number } {
  return { t0: ticksToSeconds(zoom.t0, view.timescale), t1: ticksToSeconds(zoom.t1, view.timescale) };
}

function linearMap(item: SequenceItem): { sourceIn: number; rate: number } | null {
  if (item.type !== 'video' || item.timeMap.kind !== 'linear') return null;
  const rate = item.timeMap.rate.num / item.timeMap.rate.den;
  return rate > 0 ? { sourceIn: mediaTimeToSeconds(item.timeMap.sourceIn), rate } : null;
}

/** 用这份取景文档的视频实例（按序列上的先后）。 */
export function screenItems(sequence: Sequence, documentId: Id): VideoItem[] {
  return sequence.items
    .filter((item): item is VideoItem => item.type === 'video' && item.screenView?.documentId === documentId)
    .sort((a, b) => a.span.fromFrame - b.span.fromFrame);
}

/** 内容时钟（秒）与这个实例在序列上的时间（秒）互换；变速不是线性的实例没有。 */
export interface ContentClock {
  item: VideoItem;
  /** 实例在序列上的区间（秒）。 */
  start: number;
  end: number;
  toSequence(content: number): number;
  toContent(time: number): number;
}

export function contentClock(item: VideoItem, sequence: Sequence, offset: number): ContentClock | null {
  const map = linearMap(item);
  if (!map) return null;
  const { start, end } = itemRangeSeconds(item, sequence.fps);
  return {
    item,
    start,
    end,
    toSequence: (content) => start + (content - offset - map.sourceIn) / map.rate,
    toContent: (time) => offset + map.sourceIn + (time - start) * map.rate,
  };
}

/** 一段缩放在一个实例里看得见的部分（序列时间，秒）。`clipStart` / `clipEnd`：这一头被实例的边裁掉了。 */
export interface PlacedZoom {
  key: string;
  zoom: ScreenZoom;
  itemId: Id;
  start: number;
  end: number;
  clipStart: boolean;
  clipEnd: boolean;
}

/** 缩放区间经用这份文档的各个实例投到序列上（拆开、变速之后各段只画自己源区间里的部分）。 */
export function placeZooms(view: ScreenViewBody, clocks: readonly ContentClock[]): PlacedZoom[] {
  const placed: PlacedZoom[] = [];
  for (const clock of clocks) {
    for (const zoom of view.zooms) {
      const { t0, t1 } = zoomSeconds(view, zoom);
      const a = clock.toSequence(t0);
      const b = clock.toSequence(t1);
      const start = Math.max(a, clock.start);
      const end = Math.min(b, clock.end);
      if (end - start <= 1e-6) continue;
      placed.push({ key: `${clock.item.id}:${zoom.id}`, zoom, itemId: clock.item.id, start, end, clipStart: start > a + 1e-6, clipEnd: end < b - 1e-6 });
    }
  }
  return placed.sort((x, y) => x.start - y.start);
}

/** 一段缩放的两端能挪到哪里（内容时钟，秒）：不与前后两段重叠。 */
export function zoomRoom(view: ScreenViewBody, id: Id): { min: number; max: number } {
  const index = view.zooms.findIndex((z) => z.id === id);
  const prev = index > 0 ? view.zooms[index - 1] : undefined;
  const next = index >= 0 ? view.zooms[index + 1] : undefined;
  return {
    min: prev ? ticksToSeconds(prev.t1, view.timescale) : 0,
    max: next ? ticksToSeconds(next.t0, view.timescale) : Number.POSITIVE_INFINITY,
  };
}

/** 一段缩放要改的字段（时刻用秒）。 */
export interface ZoomPatch {
  t0?: number;
  t1?: number;
  scale?: number;
  focus?: ScreenZoom['focus'];
  rampIn?: number | null;
  rampOut?: number | null;
}

export function clampZoomScale(scale: number): number {
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale)) * 100) / 100;
}

/**
 * 改一段缩放：只写变了的字段；自动生成、还没改过的区间同时记上 `edited`（重新生成时保留它）。时刻夹在前后两段之间，
 * 至少 {@link ZOOM_MIN_SECONDS} 长。没有变化时返回空表。
 */
export function zoomChanges(view: ScreenViewBody, id: Id, patch: ZoomPatch): DocumentChange[] {
  const zoom = view.zooms.find((z) => z.id === id);
  if (!zoom) return [];
  const room = zoomRoom(view, id);
  const cur = zoomSeconds(view, zoom);
  let t0 = patch.t0 ?? cur.t0;
  let t1 = patch.t1 ?? cur.t1;
  t0 = Math.max(room.min, t0);
  t1 = Math.min(room.max, t1);
  if (t1 - t0 < ZOOM_MIN_SECONDS) {
    if (patch.t0 !== undefined && patch.t1 === undefined) t0 = t1 - ZOOM_MIN_SECONDS;
    else t1 = t0 + ZOOM_MIN_SECONDS;
  }
  const path = (field: string) => ['zooms', { id }, field];
  const changes: DocumentChange[] = [];
  const t0Ticks = secondsToTicks(t0, view.timescale);
  const t1Ticks = secondsToTicks(t1, view.timescale);
  if (t0Ticks !== zoom.t0) changes.push({ path: path('t0'), value: t0Ticks });
  if (t1Ticks !== zoom.t1) changes.push({ path: path('t1'), value: t1Ticks });
  if (patch.scale !== undefined) {
    const scale = clampZoomScale(patch.scale);
    if (scale !== zoom.scale) changes.push({ path: path('scale'), value: scale });
  }
  if (patch.focus !== undefined && JSON.stringify(patch.focus) !== JSON.stringify(zoom.focus)) {
    changes.push({ path: path('focus'), value: patch.focus });
  }
  for (const key of ['rampIn', 'rampOut'] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value === null) {
      if (zoom[key] !== undefined) changes.push({ path: path(key), remove: true });
      continue;
    }
    const ticks = secondsToTicks(value, view.timescale);
    if (ticks !== zoom[key]) changes.push({ path: path(key), value: ticks });
  }
  if (changes.length && zoom.origin === 'auto' && !zoom.edited) changes.push({ path: path('edited'), value: true });
  return changes;
}

/**
 * 在内容时钟的 `[t0, t1)` 加一段手动缩放：夹进所在的空档（压在已有区间上时不加，返回 null），按 `t0` 排进去。
 */
export function addZoomChange(view: ScreenViewBody, t0: number, t1: number, id: Id = newId('zoom')): { id: Id; change: DocumentChange } | null {
  const from = Math.max(0, Math.min(t0, t1));
  let to = Math.max(t0, t1);
  const next = view.zooms.find((z) => ticksToSeconds(z.t0, view.timescale) >= from);
  const prev = [...view.zooms].reverse().find((z) => ticksToSeconds(z.t0, view.timescale) < from);
  if (prev && ticksToSeconds(prev.t1, view.timescale) > from) return null;
  if (next) to = Math.min(to, ticksToSeconds(next.t0, view.timescale));
  if (to - from < ZOOM_MIN_SECONDS) return null;
  const zoom: ScreenZoom = {
    id,
    t0: secondsToTicks(from, view.timescale),
    t1: secondsToTicks(to, view.timescale),
    scale: ZOOM_DEFAULT,
    focus: { kind: 'pointer' },
    origin: 'manual',
  };
  return { id, change: { path: ['zooms', { id }], value: zoom, beforeId: next?.id ?? null } };
}

export function removeZoomChange(id: Id): DocumentChange {
  return { path: ['zooms', { id }], remove: true };
}

/** 跟随的两个滑块（规范 §4.9 的缺省都是 0.5）。 */
export function followValue(view: ScreenViewBody, key: 'safeArea' | 'smoothing'): number {
  return view.follow?.[key] ?? 0.5;
}

export function followChange(view: ScreenViewBody, key: 'safeArea' | 'smoothing', value: number): DocumentChange {
  const clamped = key === 'safeArea' ? Math.min(0.95, Math.max(0, value)) : Math.min(1, Math.max(0, value));
  return view.follow ? { path: ['follow', key], value: clamped } : { path: ['follow'], value: { [key]: clamped } };
}

/** 光标样式里的一项；`null` 去掉（回到缺省）。 */
export function pointerChange<K extends keyof ScreenPointerStyle>(view: ScreenViewBody, key: K, value: ScreenPointerStyle[K] | null): DocumentChange {
  if (!view.pointer) return { path: ['pointer'], value: value === null ? {} : { [key]: value } };
  return value === null ? { path: ['pointer', key], remove: true } : { path: ['pointer', key], value };
}

/** 取景文档的一笔修改。 */
export function patchView(documentId: Id, changes: DocumentChange[]): EditOperation {
  return { type: 'patchDocument', documentId, changes };
}

// ---- 联动组 ----

/** 实例所在的、登记过的联动组（旧的 `linkGroupId` 没有登记的不算）。 */
export function linkGroupOf(sequence: Sequence, item: SequenceItem): LinkGroup | null {
  if (!item.linkGroupId) return null;
  return sequence.linkGroups?.find((group) => group.id === item.linkGroupId) ?? null;
}

/** 组里的实例。 */
export function linkGroupMembers(sequence: Sequence, groupId: Id): SequenceItem[] {
  return sequence.items.filter((item) => item.linkGroupId === groupId);
}

/** 这几件加上它们所在联动组的其余成员（拖动时整组一起动；引擎对同一组只移动一次）。 */
export function withLinkedMembers(sequence: Sequence, ids: readonly Id[]): Id[] {
  const groups = new Set(
    ids.flatMap((id) => {
      const item = sequence.items.find((candidate) => candidate.id === id);
      const group = item ? linkGroupOf(sequence, item) : null;
      return group ? [group.id] : [];
    }),
  );
  if (!groups.size) return [...ids];
  const out = new Set(ids);
  for (const item of sequence.items) if (item.linkGroupId && groups.has(item.linkGroupId)) out.add(item.id);
  return [...out];
}

// ---- 录制的各路 ----

/** 素材是录制的哪一路（导入时写在出处里）；不是录制的素材没有。 */
export function recordingRole(asset: AssetRecord | undefined): RecordingStreamRole | null {
  const provenance = asset?.revisions[asset.currentRevision]?.provenance;
  if (provenance?.origin !== 'recording') return null;
  const source = provenance.source as { recording?: { role?: unknown } } | undefined;
  const role = source?.recording?.role;
  return typeof role === 'string' ? (role as RecordingStreamRole) : null;
}

/** 视频实例是不是录制的摄像头。 */
export function isCameraItem(item: SequenceItem, assets: Record<Id, AssetRecord>): item is VideoItem {
  return item.type === 'video' && recordingRole(assets[item.assetRef.id]) === 'camera';
}

// ---- 摄像头布局 ----

export type CameraLayout = 'corner-circle' | 'corner-rounded' | 'split' | 'camera-full' | 'hidden';
export const CAMERA_LAYOUTS: readonly CameraLayout[] = ['corner-circle', 'corner-rounded', 'split', 'camera-full', 'hidden'];

interface Size {
  width: number;
  height: number;
}

/** 把源裁成 `aspect`（宽/高）居中的一块。 */
function cropTo(source: Size, aspect: number): { left: number; right: number; top: number; bottom: number } | null {
  if (!(source.width > 0 && source.height > 0 && aspect > 0)) return null;
  const own = source.width / source.height;
  if (Math.abs(own - aspect) < 1e-3) return null;
  if (own > aspect) {
    const side = (1 - aspect / own) / 2;
    return { left: side, right: side, top: 0, bottom: 0 };
  }
  const top = (1 - own / aspect) / 2;
  return { left: 0, right: 0, top, bottom: top };
}

/**
 * 摄像头布局预设（屏幕录制设计 §5）：都落在摄像头实例已有的 `place`、`mask`、圆角、裁剪与 `enabled` 上。
 * 左右分屏同时把屏幕实例摆到左半边。`source` 是摄像头画面的尺寸，`canvas` 是序列画布。
 */
export function cameraLayoutOps(
  layout: CameraLayout,
  sequence: Sequence,
  camera: VideoItem,
  source: Size,
  screens: readonly VideoItem[],
): EditOperation[] {
  const sequenceId = sequence.id;
  const itemId = camera.id;
  const canvas = sequence.canvas;
  const show: EditOperation[] = camera.enabled ? [] : [{ type: 'updateItem', sequenceId, itemId, enabled: true }];
  const screensFull = (): EditOperation[] =>
    screens
      .filter((s) => s.mode === 'pip' && s.place.w === 50 && s.place.x === 25)
      .flatMap((s): EditOperation[] => [
        { type: 'setStyle', sequenceId, itemId: s.id, mode: 'fullscreen' },
        { type: 'setTransform', sequenceId, itemId: s.id, x: null, y: null, w: null },
      ]);
  switch (layout) {
    case 'corner-circle':
      return [
        ...show,
        ...screensFull(),
        { type: 'setStyle', sequenceId, itemId, mode: 'pip', fit: 'cover', mask: { shape: 'ellipse' }, radius: null, crop: cropTo(source, 1) },
        { type: 'setTransform', sequenceId, itemId, x: 85, y: 80, w: 22 },
      ];
    case 'corner-rounded':
      return [
        ...show,
        ...screensFull(),
        { type: 'setStyle', sequenceId, itemId, mode: 'pip', fit: 'cover', mask: null, radius: 24, crop: cropTo(source, 4 / 3) },
        { type: 'setTransform', sequenceId, itemId, x: 17, y: 78, w: 26 },
      ];
    case 'split': {
      const half = canvas.width > 0 && canvas.height > 0 ? canvas.width / 2 / canvas.height : 8 / 9;
      return [
        ...show,
        { type: 'setStyle', sequenceId, itemId, mode: 'pip', fit: 'cover', mask: null, radius: null, crop: cropTo(source, half) },
        { type: 'setTransform', sequenceId, itemId, x: 75, y: 50, w: 50 },
        ...screens.flatMap((s): EditOperation[] => [
          { type: 'setStyle', sequenceId, itemId: s.id, mode: 'pip', fit: 'contain', radius: null },
          { type: 'setTransform', sequenceId, itemId: s.id, x: 25, y: 50, w: 50 },
        ]),
      ];
    }
    case 'camera-full':
      return [
        ...show,
        { type: 'setStyle', sequenceId, itemId, mode: 'fullscreen', fit: 'cover', mask: null, radius: null, crop: null },
        { type: 'setTransform', sequenceId, itemId, x: null, y: null, w: null },
      ];
    case 'hidden':
      return camera.enabled ? [{ type: 'updateItem', sequenceId, itemId, enabled: false }] : [];
  }
}

/** 摄像头现在是哪一种布局（对得上预设时）；对不上是 null。 */
export function cameraLayoutOf(camera: VideoItem): CameraLayout | null {
  if (!camera.enabled) return 'hidden';
  if (camera.mode === 'fullscreen') return 'camera-full';
  const { x, y, w } = camera.place;
  if (camera.mask?.shape === 'ellipse' && x === 85 && y === 80 && w === 22) return 'corner-circle';
  if (!camera.mask && x === 17 && y === 78 && w === 26) return 'corner-rounded';
  if (!camera.mask && x === 75 && y === 50 && w === 50) return 'split';
  return null;
}

// ---- 演示样式 ----

export type PresentationStyle = 'full' | 'inset';
export const PRESENTATION_STYLES: readonly PresentationStyle[] = ['full', 'inset'];

/** 缩小留边时的阴影（540 短边下的像素）。 */
const INSET_SHADOW: NonNullable<Fx['shadow']> = { offsetX: 0, offsetY: 8, blur: 24, color: '#000000', opacity: 0.35 };
const INSET_WIDTH = 86;
const INSET_RADIUS = 16;

/**
 * 屏幕的演示样式预设（屏幕录制设计 §5）：全屏，或缩小留边、圆角、投影；底色是画布底色。落在屏幕实例的
 * `place`、圆角与 `fx.shadow` 上，`fx` 其余字段不动。
 */
export function presentationOps(styleKey: PresentationStyle, sequence: Sequence, screen: VideoItem): EditOperation[] {
  const sequenceId = sequence.id;
  const itemId = screen.id;
  const { shadow: _shadow, ...rest } = screen.fx ?? {};
  if (styleKey === 'full') {
    return [
      { type: 'setStyle', sequenceId, itemId, mode: 'fullscreen', radius: null },
      { type: 'setTransform', sequenceId, itemId, x: null, y: null, w: null },
      { type: 'setEffects', sequenceId, itemId, fx: Object.keys(rest).length ? rest : null },
    ];
  }
  return [
    { type: 'setStyle', sequenceId, itemId, mode: 'pip', fit: 'contain', radius: INSET_RADIUS },
    { type: 'setTransform', sequenceId, itemId, x: 50, y: 50, w: INSET_WIDTH },
    { type: 'setEffects', sequenceId, itemId, fx: { ...rest, shadow: INSET_SHADOW } },
  ];
}

export function presentationOf(screen: VideoItem): PresentationStyle | null {
  if (screen.mode !== 'pip') return 'full';
  return screen.place.w === INSET_WIDTH && screen.place.radius === INSET_RADIUS ? 'inset' : null;
}
