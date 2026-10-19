// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompositionItem, DocumentRecord, Sequence } from '@baocut/protocol';
import type { MarkupPick } from '../../model/markup.ts';
import type { LiteSegment } from '../../model/lite-segments.ts';
import type { CaptionHit } from '../../render/render-planner.ts';
import { RuntimeContext } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useDraftVideoAnnotations } from '../../state/draft-video-annotations-store.ts';
import { useEditor } from '../../state/editor-store.ts';
import { useMarkup } from '../../state/markup-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useVideo, type OpenVideo } from '../../state/video-store.ts';
import { sequence } from '../../testing/sequence-records.ts';
import { EditorContext, type EditorActions } from './editor-context.tsx';
import { MarkupLayer } from './markup.tsx';

/** 轻量视图的标记层（docs/design/lite-editor §4.1–§4.3）：手势画成标记、选中拖动、撤销、整组添加到对话、评论立刻发出并带截图。 */

const seq = sequence([], []); // 画布 1920×1080，画面 640×360：画布像素是画面像素的 3 倍
const frame = { left: 0, top: 0, width: 640, height: 360 };
const target = { conversationId: 'c1', path: 'talk' };
const lines = [
  { id: 's1:l1', start: 0, end: 2, text: '第一句' },
  { id: 's1:l2', start: 2, end: 5, text: '第二句' },
];
const segments: LiteSegment[] = [{ id: 's1', index: 0, source: 'chapter', title: '钩子', start: 0, end: 10, lines }];
const engine = { captionHits: [] as CaptionHit[], plan: null as unknown };
const documents = { d1: { id: 'd1', currentRevision: 'r1' } } as unknown as Record<string, DocumentRecord>;
const body = { schema: 'baocut.caption/1', timescale: 1, cues: [{ id: 'q1', start: 0, end: 5, text: '你好' }] };
const runtime = { videos: { documents: { peek: () => body } }, host: { platform: 'desktop' } } as unknown as RuntimeSession;
const actions = { engine, seek: vi.fn(), pause: vi.fn(), apply: vi.fn(async () => null) } as unknown as EditorActions;
const initialEditor = useEditor.getState();
const initialVideo = useVideo.getState();
const initialShell = useShell.getState();
let container: HTMLDivElement;
let root: Root;
let canvas: HTMLCanvasElement;

const layer = () => document.querySelector<HTMLDivElement>('[data-markup]')!;
const marks = () => useMarkup.getState().markup.marks;
const setTool = (tool: 'element' | 'comment' | 'pen' | 'shape' | 'text', shape?: 'line' | 'arrow' | 'box' | 'ellipse' | 'pin') =>
  act(() => useMarkup.setState((s) => ({ markup: { ...s.markup, tool, shape: shape ?? s.markup.shape } })));
async function pointer(type: string, x: number, y: number, el: EventTarget = layer()) {
  await act(() => el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 })));
}
async function drag(from: [number, number], to: [number, number], el: EventTarget = layer()) {
  await pointer('pointerdown', ...from, el);
  await pointer('pointermove', (from[0] + to[0]) / 2, (from[1] + to[1]) / 2, window);
  await pointer('pointermove', ...to, window);
  await pointer('pointerup', ...to, window);
}
async function key(k: string, opts: KeyboardEventInit = {}) {
  await act(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...opts })));
}
const press = async (el: Element) => {
  await act(async () => {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' }));
    (el as HTMLElement).click();
  });
};
const button = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === name || b.getAttribute('aria-label') === name)!;

let pickLive = vi.fn(async (_point: { x: number; y: number }): Promise<MarkupPick | null> => null);
/** jsdom 的 Image 不解码 blob: 地址：留下的帧 PNG 由它「解码」成一张与画布同大的图（截图归标注所有，草稿里按底图重画）。 */
const stubImage = () =>
  vi.stubGlobal(
    'Image',
    class {
      width = 1920;
      height = 1080;
      onload: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    },
  );

async function mount(over: { sequence?: Sequence; live?: boolean } = {}) {
  await act(() =>
    root.render(
      createElement(
        RuntimeContext.Provider,
        { value: runtime },
        createElement(
          EditorContext.Provider,
          { value: actions },
          createElement(MarkupLayer, {
            videoId: 'v1',
            sequence: over.sequence ?? seq,
            assets: {},
            documents,
            segments,
            frame,
            canvasRef: { current: canvas },
            live: over.live ?? false,
            pickLive,
          }),
        ),
      ),
    ),
  );
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  useVideo.setState({ video: { videoId: 'v1', target, status: 'ready', state: { video: { revision: '3' } } } as unknown as OpenVideo });
  useEditor.setState({ annotating: true, playhead: 3, view: 'lite' });
  useShell.setState({ route: { tab: 'home', conversationId: 'c1', projectId: null } });
  useMarkup.setState({ videoId: null });
  engine.captionHits = [];
  engine.plan = null;
  pickLive = vi.fn(async () => null);
  canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  useEditor.setState(initialEditor, true);
  useVideo.setState(initialVideo, true);
  useShell.setState(initialShell, true);
  useDraftVideoAnnotations.setState({ annotations: {}, shots: {} });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MarkupLayer', () => {
  it('画笔与形状的手势画成标记，带当前颜色与粗细；点一下不算框', async () => {
    await mount();
    await drag([64, 36], [128, 72]);
    expect(marks()).toHaveLength(1);
    expect(marks()[0]).toMatchObject({ kind: 'pen', color: 'red', width: 4 });
    expect(marks()[0]!.points!.length).toBeGreaterThanOrEqual(2);
    expect(layer().innerHTML).toContain('<polyline');

    await setTool('shape', 'box');
    await pointer('pointerdown', 300, 200);
    await pointer('pointerup', 301, 200, window);
    expect(marks()).toHaveLength(1);
    await drag([320, 180], [384, 216]);
    expect(marks()[1]).toMatchObject({ kind: 'box', x: 0.5, y: 0.5, w: 0.1, h: 0.1 });

    await setTool('shape', 'pin');
    await pointer('pointerdown', 64, 300);
    await pointer('pointerup', 64, 300, window);
    await pointer('pointerdown', 128, 300);
    await pointer('pointerup', 128, 300, window);
    expect(marks().filter((m) => m.kind === 'pin')).toHaveLength(2);
    expect([...layer().querySelectorAll('[data-mark="pin"]')].map((el) => el.textContent)).toEqual(['1', '2']);
  });

  it('按下已有的标记就选中并拖动，松手记一次历史；⌘Z 撤的是标记，Delete 删掉选中的', async () => {
    await mount();
    await setTool('shape', 'box');
    await drag([320, 180], [384, 216]);
    const id = marks()[0]!.id;
    const hit = layer().querySelector('[data-mark="box"] rect[stroke="transparent"]')!;
    await drag([320, 180], [384, 216], hit);
    expect(marks()[0]).toMatchObject({ id, x: 0.6, y: 0.6, w: 0.1, h: 0.1 });
    expect(useMarkup.getState().markup.sel).toBe(id);
    // 选中的框有八枚把手；拖右下角放大
    expect(layer().querySelectorAll('[data-handle]')).toHaveLength(8);
    await drag([448, 252], [512, 288], layer().querySelector('[data-handle="se"]')!);
    expect(marks()[0]).toMatchObject({ x: 0.6, y: 0.6, w: 0.2, h: 0.2 });

    const editorKeys = vi.fn();
    window.addEventListener('keydown', editorKeys);
    await key('z', { metaKey: true, ctrlKey: true, code: 'KeyZ' });
    expect(marks()[0]).toMatchObject({ x: 0.6, y: 0.6, w: 0.1, h: 0.1 });
    await key('z', { metaKey: true, ctrlKey: true, code: 'KeyZ' });
    expect(marks()[0]).toMatchObject({ x: 0.5, y: 0.5 });
    await key('z', { metaKey: true, ctrlKey: true, shiftKey: true, code: 'KeyZ' });
    expect(marks()[0]).toMatchObject({ x: 0.6, y: 0.6, w: 0.1 });
    expect(editorKeys).not.toHaveBeenCalled();
    window.removeEventListener('keydown', editorKeys);

    await act(() => useMarkup.getState().apply((s) => ({ ...s, sel: id })));
    await key('Delete');
    expect(marks()).toHaveLength(0);
  });

  it('选择元素点中字幕：记一条元素标记，框是那一句字幕的位置，带字幕的字', async () => {
    engine.captionHits = [{ layerId: 'L', itemId: 'cap', documentId: 'd1', cueId: 'q1', cx: 960, cy: 900, w: 600, h: 90, rotation: 0 }];
    await mount();
    await key('s', { metaKey: true, ctrlKey: true, shiftKey: true, code: 'KeyS' });
    expect(useMarkup.getState().markup.tool).toBe('element');
    await pointer('pointermove', 320, 300);
    expect(document.querySelector('[data-pick-card]')?.textContent).toContain('你好');
    expect(document.querySelector('[data-pick-card]')?.textContent).toContain('600 × 90');
    await pointer('pointerdown', 320, 300);
    expect(marks()[0]).toMatchObject({ kind: 'element', element: { kind: 'caption', id: 'cap:q1', text: '你好' }, x: 0.344, y: 0.792 });
    // 空白处什么也不记
    await pointer('pointerdown', 20, 20);
    expect(marks()).toHaveLength(1);
  });

  it('选择元素在 HTML 动画视频上：问实时合成层里的节点，卡片照 DevTools，点下记 html；回信晚了的不用，问不到退回元素', async () => {
    const comp = {
      id: 'comp',
      type: 'composition',
      enabled: true,
      trackId: 'tc',
      span: { fromFrame: 0, durationFrames: 300 },
      place: {},
      mode: 'fullscreen',
      source: { kind: 'bundle', assetRef: { id: 'bundle', revision: '1' } },
      parameterValues: {},
      timeMap: { kind: 'identity' },
    } as unknown as CompositionItem;
    const withComp = { ...seq, items: [comp] } as Sequence;
    engine.plan = {
      layers: [],
      live: {
        itemId: 'comp',
        asset: { id: 'bundle', revision: '1' },
        matrix: [1920, 0, 0, 1080, 0, 0],
        opacity: 1,
        width: 1280,
        height: 720,
      },
    };
    const play: MarkupPick = {
      rect: { x: 300, y: 600, w: 300, h: 150 },
      element: { kind: 'html', selector: 'button#play.icon', w: 100, h: 50, name: 'Play', role: 'button', focusable: true },
    };
    const box: MarkupPick = {
      rect: { x: 900, y: 300, w: 150, h: 150 },
      element: { kind: 'html', selector: 'div#box', w: 100, h: 100, focusable: false },
    };
    pickLive = vi.fn(async () => play);
    await mount({ sequence: withComp });
    await setTool('element');
    await pointer('pointermove', 320, 300);
    expect(pickLive).toHaveBeenLastCalledWith({ x: 960, y: 900 });
    const card = () => document.querySelector('[data-pick-card]')?.textContent ?? '';
    expect(card()).toContain('button#play.icon');
    expect(card()).toContain('100 × 50');
    expect(card()).toContain('Play');
    expect(card()).toContain('✓');
    // 按下的点就是悬停拾过的那一点：直接用，不再问
    await pointer('pointerdown', 320, 300);
    expect(pickLive).toHaveBeenCalledTimes(1);
    expect(marks()[0]).toMatchObject({ kind: 'element', element: play.element, x: 0.156, y: 0.556, w: 0.156, h: 0.139 });

    // 先问的回得晚：只认最新的一次
    let late: (pick: MarkupPick | null) => void = () => {};
    pickLive = vi.fn(() => new Promise<MarkupPick | null>((resolve) => (late = resolve)));
    await mount({ sequence: withComp });
    await pointer('pointermove', 100, 100);
    pickLive.mockImplementation(async () => box);
    await pointer('pointermove', 330, 120);
    expect(card()).toContain('div#box');
    await act(async () => late(play));
    expect(card()).toContain('div#box');
    expect(card()).not.toContain('button#play');

    // iframe 里没拾到：退回实时合成层那件的元素命中
    pickLive.mockImplementation(async () => null);
    await pointer('pointermove', 200, 200);
    expect(card()).not.toContain('div#box');
    await pointer('pointerdown', 210, 200);
    expect(marks().at(-1)).toMatchObject({ kind: 'element', element: { kind: 'element', id: 'comp' } });
  });

  it('添加到对话：整组换成视频标注，记播放头、版本、段与句，清空并退出', async () => {
    await mount();
    await setTool('shape', 'arrow');
    await drag([64, 36], [320, 180]);
    await setTool('shape', 'box');
    await drag([320, 180], [384, 216]);
    await press(button('添加到对话'));
    const notes = useDraftVideoAnnotations.getState().annotations.v1 ?? [];
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({
      videoId: 'v1',
      video: target,
      revision: '3',
      timeMs: 3000,
      kind: 'arrow',
      to: { x: 0.5, y: 0.5 },
      style: { color: 'red', width: 4 },
      segment: { id: 's1', kind: 'chapter', index: 0, title: '钩子' },
      line: { id: 's1:l2', index: 2, text: '第二句' },
      shot: { timeMs: 3000 },
      text: '',
    });
    expect(notes[1]?.label).toContain('第 2 句');
    expect(marks()).toHaveLength(0);
    expect(useEditor.getState().annotating).toBe(false);
  });

  it('每条标记属于画它时的那一帧：播放头走开就不画、回来再画，添加到对话时各带自己的时刻，每帧一张截图', async () => {
    const ctx = {
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    HTMLCanvasElement.prototype.toBlob ??= function () {};
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(new Blob(['png'], { type: 'image/png' })));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:frame');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    stubImage();
    await mount();
    await drag([64, 36], [128, 72]);
    expect(marks()[0]).toMatchObject({ kind: 'pen', timeMs: 3000 });
    expect(document.querySelectorAll('[data-mark]')).toHaveLength(1);
    await act(() => useEditor.setState({ playhead: 20 }));
    expect(document.querySelectorAll('[data-mark]')).toHaveLength(0);
    // 不在这一帧上的选中项 Delete 不删
    await act(() => useMarkup.getState().apply((s) => ({ ...s, sel: marks()[0]!.id })));
    await key('Delete');
    expect(marks()).toHaveLength(1);
    await drag([320, 180], [384, 216]);
    expect(marks()).toHaveLength(2);
    expect(marks()[1]).toMatchObject({ timeMs: 20000 });
    expect(document.querySelectorAll('[data-mark]')).toHaveLength(1);
    await act(() => useEditor.setState({ playhead: 3 }));
    expect(document.querySelectorAll('[data-mark]')).toHaveLength(1);
    expect(Object.keys(useMarkup.getState().frames).map(Number)).toEqual([3000, 20000]);
    await press(button('添加到对话'));
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    const notes = useDraftVideoAnnotations.getState().annotations.v1 ?? [];
    expect(notes.map((n) => [n.timeMs, n.line?.id ?? null, n.shot])).toEqual([
      [3000, 's1:l2', { timeMs: 3000 }],
      [20000, null, { timeMs: 20000 }],
    ]);
    expect(marks()).toHaveLength(0);
    expect(useMarkup.getState().frames).toEqual({});
    // 每一帧的截图跟着这一帧的标注走（lite-editor §4.1），不是输入框里另一张图片
    const shots = () => useDraftVideoAnnotations.getState().shots.v1 ?? {};
    expect(Object.keys(shots()).map(Number)).toEqual([3000, 20000]);
    expect(shots()[3000]?.file?.name).toBe('frame-3000.png');
    expect(Object.keys(shots()[20000]?.marks ?? {})).toEqual([notes[1]!.id]);
    await act(() => useDraftVideoAnnotations.getState().remove('v1', notes[0]!.id));
    expect(Object.keys(shots()).map(Number)).toEqual([20000]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:frame');
  });

  it('实时合成层露着时截窗口：藏起标记层、工具条与评论框再请宿主截预览那一块，截到的字节当这一帧的底图', async () => {
    HTMLCanvasElement.prototype.toBlob ??= function () {};
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(new Blob(['png'], { type: 'image/png' })));
    const ctx = {
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:frame');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    stubImage();
    // 同 preview.tsx：画布、标记层与工具条都在 `[data-preview-stage]` 里；评论框在 body 下的 portal 里
    container.setAttribute('data-preview-stage', '');
    canvas.getBoundingClientRect = () => ({
      left: 10,
      top: 20,
      right: 650,
      bottom: 380,
      width: 640,
      height: 360,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    });
    // jsdom 里 setComment(null) 在截图前就把评论框关了（没有退场动画）：另放一个 body 下的「portal」装着评论框，看它整个被藏起来
    const portal = document.createElement('div');
    portal.innerHTML = '<div role="dialog"><div data-comment-form></div></div>';
    document.body.append(portal);
    const hiddenAt: string[] = [];
    const captureFrame = vi.fn(async (_rect: { x: number; y: number; width: number; height: number }) => {
      for (const el of document.querySelectorAll<HTMLElement>('[data-markup], [data-markup-bar]'))
        if (el.style.visibility === 'hidden') hiddenAt.push(el.dataset.markup !== undefined ? 'layer' : 'bar');
      if (portal.style.visibility === 'hidden') hiddenAt.push('form');
      return new Uint8Array([137, 80, 78, 71]);
    });
    (runtime.host as unknown as Record<string, unknown>).captureFrame = captureFrame;
    try {
      await mount({ live: true });
      container.append(canvas); // 首次 render 会清空容器，画布要在它之后挂进去
      await setTool('comment');
      await pointer('pointerdown', 320, 180);
      const area = document.querySelector<HTMLTextAreaElement>('[data-comment-form] textarea')!;
      await act(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, '慢一点');
        area.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await press(button('发送'));
      await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
      expect(captureFrame).toHaveBeenCalledWith({ x: 10, y: 20, width: 640, height: 360 });
      expect(hiddenAt).toEqual(expect.arrayContaining(['layer', 'bar', 'form']));
      expect(layer().style.visibility).toBe('');
      expect(portal.style.visibility).toBe('');
      const shot = useDraftVideoAnnotations.getState().shots.v1?.[3000];
      expect(shot?.base.type).toBe('image/png');
      expect(shot?.base.size).toBe(4);
      expect(shot?.file?.name).toBe('frame-3000.png');
    } finally {
      portal.remove();
      delete (runtime.host as unknown as Record<string, unknown>).captureFrame;
    }
  });

  it('Esc：有没发的标记先问「放弃这些标记？」，没有就直接退出', async () => {
    await mount();
    await drag([64, 36], [128, 72]);
    await key('Escape');
    expect(useMarkup.getState().markup.ask).toBe(true);
    expect(useEditor.getState().annotating).toBe(true);
    expect(document.body.textContent).toContain('放弃这些标记？');
    await press(button('放弃'));
    expect(marks()).toHaveLength(0);
    expect(useEditor.getState().annotating).toBe(false);

    await act(() => useEditor.setState({ annotating: true }));
    await key('Escape');
    expect(useEditor.getState().annotating).toBe(false);
  });

  it('评论勾着「发给智能体」发送：立刻进草稿，带一帧截图进会话的输入框', async () => {
    const ctx = {
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    HTMLCanvasElement.prototype.toBlob ??= function () {};
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(new Blob(['png'], { type: 'image/png' })));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:shot');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    stubImage();
    await mount();
    await setTool('comment');
    await pointer('pointerdown', 320, 180);
    const area = document.querySelector<HTMLTextAreaElement>('[data-comment-form] textarea')!;
    expect(area).toBeTruthy();
    // 空的发不出去
    expect(button('发送').hasAttribute('disabled') || button('发送').getAttribute('aria-disabled') === 'true').toBe(true);
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, '慢一点');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await press(button('发送'));
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    const notes = useDraftVideoAnnotations.getState().annotations.v1 ?? [];
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      kind: 'comment',
      text: '慢一点',
      shot: { timeMs: 3000, stamp: { x: 0.5, y: 0.5 } },
      line: { id: 's1:l2' },
    });
    expect(ctx.drawImage).toHaveBeenCalledWith(canvas, 0, 0);
    expect(ctx.fillText).toHaveBeenCalledWith('我', expect.any(Number), expect.any(Number));
    expect(toBlob).toHaveBeenCalled();
    const shots = useDraftVideoAnnotations.getState().shots.v1 ?? {};
    expect(Object.keys(shots)).toEqual(['3000']);
    expect(shots[3000]?.file?.type).toBe('image/png');
    expect(Object.keys(shots[3000]?.marks ?? {})).toEqual([notes[0]!.id]);
    // 发出去的不留在标记里
    expect(marks()).toHaveLength(0);
  });
});
