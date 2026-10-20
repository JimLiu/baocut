// @vitest-environment happy-dom
import { COMPOSITION_BRIDGE_CHANNEL, type CompositionBridgeMessage, type CompositionBridgeRequest } from '@baocut/protocol';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { LiveCandidate } from '../../model/live-composition.ts';
import type { LiveLayer } from '../../render/frame-plan.ts';
import { LiveLayerHost, canvasToIntrinsic, intrinsicRectToCanvas, readBridgePick, type BridgePort } from './live-layer.ts';

/** 假的页面：记下父页面发来的请求，由测试决定怎么回。 */
class FakePage implements BridgePort {
  readonly requests: CompositionBridgeRequest[] = [];
  #listener: ((message: CompositionBridgeMessage) => void) | null = null;
  post(request: CompositionBridgeRequest): void {
    this.requests.push(request);
  }
  subscribe(listener: (message: CompositionBridgeMessage) => void): () => void {
    this.#listener = listener;
    return () => {
      this.#listener = null;
    };
  }
  hello(): void {
    this.#listener?.({ channel: COMPOSITION_BRIDGE_CHANNEL, kind: 'hello' });
  }
  reply(id: number, result: { ok: true; value: unknown } | { ok: false; code: string; message: string }): void {
    this.#listener?.({ channel: COMPOSITION_BRIDGE_CHANNEL, kind: 'result', id, result });
  }
  /** 回掉最近一个某种请求。 */
  answer(kind: CompositionBridgeRequest['kind'], value: unknown = {}): CompositionBridgeRequest {
    const request = [...this.requests].reverse().find((r) => r.kind === kind);
    if (!request) throw new Error(`no ${kind} request`);
    this.reply(request.id, { ok: true, value });
    return request;
  }
  get seeks(): number[] {
    return this.requests.flatMap((r) => (r.kind === 'seek' ? [r.seconds] : []));
  }
}

const candidate = (itemId: string, start = 0): LiveCandidate => ({
  itemId,
  asset: { id: `asset_${itemId}`, revision: '1' },
  start,
  end: start + 2,
  contract: 'hyperframes/1',
  width: 1280,
  height: 720,
  fps: { num: 30, den: 1 },
  durationFrames: 60,
});

const layer = (itemId: string, sourceSeconds: number, opacity = 1): LiveLayer => ({
  itemId,
  asset: { id: `asset_${itemId}`, revision: '1' },
  sourceSeconds,
  sourceRate: 1,
  matrix: [1920, 0, 0, 1080, 0, 0],
  opacity,
  width: 1280,
  height: 720,
  standIn: 'none',
});

function setup(options: { readyTimeoutMs?: number; pickTimeoutMs?: number; maxMounted?: number } = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const pages = new Map<string, FakePage>();
  const resolved: string[] = [];
  const failures: [string, string][] = [];
  const host = new LiveLayerHost(
    root,
    (asset) => {
      resolved.push(asset.id);
      return Promise.resolve({ url: `/bundle/h_${asset.id}/`, entry: 'index.html', expiresAt: '2099-01-01T00:00:00Z' });
    },
    {
      ...options,
      port: (element) => {
        const page = new FakePage();
        pages.set(element.dataset.liveItem!, page);
        return page;
      },
    },
  );
  host.onFailure((itemId, reason) => failures.push([itemId, reason]));
  const frames = () => [...root.querySelectorAll('iframe')] as HTMLIFrameElement[];
  return { root, host, pages, resolved, failures, frames, page: (id: string) => pages.get(id)! };
}

beforeEach(() => {
  vi.useFakeTimers();
  // happy-dom 会真的去拉 iframe 的地址；这里只看属性，不要网络。
  type Settings = { happyDOM: { settings: { navigation: { disableChildFrameNavigation: boolean } } } };
  (window as unknown as Settings).happyDOM.settings.navigation.disableChildFrameNavigation = true;
});
afterEach(() => vi.useRealTimers());

test('挂上的是不开同源的沙箱 iframe，按固有尺寸布置、指针进不去；地址按目录句柄拼，就位后先画第 0 帧', async () => {
  const { host, page, resolved, frames } = setup();
  host.prepare([candidate('a')]);
  const [iframe] = frames();
  expect(iframe).toBeTruthy();
  expect(iframe!.getAttribute('sandbox')).toBe('allow-scripts');
  expect(iframe!.hasAttribute('inert')).toBe(true);
  expect(iframe!.style.pointerEvents).toBe('none');
  expect([iframe!.style.width, iframe!.style.height, iframe!.style.opacity]).toEqual(['1280px', '720px', '0']);
  await Promise.resolve();
  expect(resolved).toEqual(['asset_a']);
  expect(iframe!.getAttribute('src')).toBe('/bundle/h_asset_a/index.html');

  page('a').hello();
  const ready = page('a').requests[0]!;
  expect(ready).toMatchObject({
    kind: 'ready',
    contract: 'hyperframes/1',
    context: { width: 1280, height: 720, fps: { num: 30, den: 1 }, durationFrames: 60 },
  });
  expect('compositionId' in ready).toBe(false);
  page('a').answer('ready', { compositionId: 'main' });
  await Promise.resolve();
  expect(page('a').seeks).toEqual([0]);
  expect(host.mounted.get('a')?.state).toBe('ready');
  page('a').answer('seek');
  await Promise.resolve();
  expect(host.mounted.get('a')?.arrived).toBe(0);
  host.dispose();
  expect(frames()).toHaveLength(0);
  expect(page('a').requests.at(-1)?.kind).toBe('dispose');
});

test('在视的按矩阵与显示比例摆、同一帧只定位一次、路上没回来时只记最新的；不在视的不显示', async () => {
  const { host, page, frames } = setup();
  host.setScale(0.5);
  host.prepare([candidate('a'), candidate('b', 10)]);
  await Promise.resolve();
  page('a').hello();
  page('a').answer('ready', {});
  await Promise.resolve();
  page('a').answer('seek');
  await Promise.resolve();
  expect(page('a').seeks).toEqual([0]);

  host.show(layer('a', 0.5, 0.8), 15);
  const [a, b] = frames();
  expect(a!.style.transform).toBe('matrix(0.75, 0, 0, 0.75, 0, 0)');
  expect(a!.style.opacity).toBe('0.8');
  expect(b!.style.opacity).toBe('0');
  expect(page('a').seeks).toEqual([0, 0.5]);
  // 同一帧再叫：不重送。
  host.show(layer('a', 0.5, 0.8), 15);
  expect(page('a').seeks).toEqual([0, 0.5]);
  // 路上还没回来又换了两帧：只记最新的，回来再发它。
  host.show(layer('a', 0.5333, 0.8), 16);
  host.show(layer('a', 0.5667, 0.8), 17);
  expect(page('a').seeks).toEqual([0, 0.5]);
  page('a').answer('seek');
  await Promise.resolve();
  expect(page('a').seeks).toEqual([0, 0.5, 0.5667]);
  // 显示比例变了：在视的重新摆。
  host.setScale(1);
  expect(a!.style.transform).toBe('matrix(1.5, 0, 0, 1.5, 0, 0)');
  // 这一帧没有实时层：藏起来。
  host.show(null, 18);
  expect(a!.style.opacity).toBe('0');
  host.dispose();
});

test('最多挂三个，不在列表里的拆掉，换了素材版本的重挂', async () => {
  const { host, frames, resolved } = setup();
  host.prepare([candidate('a'), candidate('b'), candidate('c'), candidate('d')]);
  expect(frames().map((f) => f.dataset.liveItem)).toEqual(['a', 'b', 'c']);
  host.prepare([candidate('c'), { ...candidate('b'), asset: { id: 'asset_b', revision: '2' } }]);
  expect(frames().map((f) => f.dataset.liveItem)).toEqual(['c', 'b']);
  await Promise.resolve();
  expect(resolved).toEqual(['asset_a', 'asset_b', 'asset_c', 'asset_b']);
  host.dispose();
});

test('就绪超时、ready 报错、定位报错都报给引擎，那个 iframe 不再显示', async () => {
  const { host, page, failures, frames } = setup({ readyTimeoutMs: 3000 });
  host.prepare([candidate('a'), candidate('b'), candidate('c')]);
  await Promise.resolve();
  // b：ready 报错。
  page('b').hello();
  page('b').reply(page('b').requests[0]!.id, { ok: false, code: 'COMPOSITION_TIMELINE_MISSING', message: 'no timeline' });
  await Promise.resolve();
  expect(failures).toEqual([['b', 'ready:COMPOSITION_TIMELINE_MISSING']]);
  // c：就绪了，定位时抛错。
  page('c').hello();
  page('c').answer('ready', {});
  await Promise.resolve();
  page('c').reply(page('c').requests.at(-1)!.id, { ok: false, code: 'COMPOSITION_SCRIPT_ERROR', message: 'renderAt threw' });
  await Promise.resolve();
  expect(failures.at(-1)).toEqual(['c', 'seek:COMPOSITION_SCRIPT_ERROR']);
  host.show(layer('c', 0), 0);
  expect(frames().find((f) => f.dataset.liveItem === 'c')!.style.opacity).toBe('0');
  // a：3 秒内没就绪。
  vi.advanceTimersByTime(3000);
  expect(failures.at(-1)).toEqual(['a', 'ready-timeout']);
  expect(host.mounted.get('a')?.state).toBe('failed');
  host.dispose();
});

test('在视的还没画出第一帧时报在载入：就位、第一次定位回信才撤；换到没载好的那一章再报，失败与不在视都不算', async () => {
  const { host, page } = setup({ readyTimeoutMs: 3000 });
  const loading: boolean[] = [];
  host.onLoading((value) => loading.push(value));
  expect(loading).toEqual([false]);
  host.prepare([candidate('a'), candidate('b', 2)]);
  await Promise.resolve();
  // 只是预载、没在视：不算。
  expect(loading.at(-1)).toBe(false);
  host.show(layer('a', 0), 0);
  expect(loading.at(-1)).toBe(true);
  page('a').hello();
  page('a').answer('ready', {});
  await Promise.resolve();
  // 就位了，第一帧还没画好。
  expect(loading.at(-1)).toBe(true);
  page('a').answer('seek');
  await Promise.resolve();
  expect(loading).toEqual([false, true, false]);
  // 同一章里往后播：不再报。
  host.show(layer('a', 0.5), 15);
  expect(loading.at(-1)).toBe(false);
  // 换到还没载好的那一章：再报；它就绪超时失败了就撤（引擎退回替身）。
  host.show(layer('b', 0), 60);
  expect(loading.at(-1)).toBe(true);
  vi.advanceTimersByTime(3000);
  expect(loading.at(-1)).toBe(false);
  host.show(null, 61);
  expect(loading).toEqual([false, true, false, true, false]);
  host.dispose();
});

describe('选择元素的拾取（lite-editor §11 第 12 条）', () => {
  const placed = (itemId: string): LiveLayer => ({ ...layer(itemId, 0), matrix: [960, 0, 0, 540, 100, 50] });
  const node = { selector: 'div#box', w: 320, h: 180, name: 'Box', focusable: false, rect: { x: 0, y: 360, w: 320, h: 180 } };
  async function shown(options: { pickTimeoutMs?: number } = {}) {
    const ctx = setup(options);
    ctx.host.prepare([candidate('a')]);
    await Promise.resolve();
    ctx.page('a').hello();
    ctx.page('a').answer('ready', {});
    await Promise.resolve();
    ctx.page('a').answer('seek');
    await Promise.resolve();
    ctx.host.show(placed('a'), 0);
    return ctx;
  }
  const picks = (page: FakePage) => page.requests.filter((r) => r.kind === 'pick');

  test('没有在视的、还没就绪、点不在合成里：立刻 null，不问页面', async () => {
    const { host, page } = setup();
    expect(await host.pick({ x: 10, y: 10 })).toBeNull();
    host.prepare([candidate('a')]);
    host.show(placed('a'), 0);
    expect(await host.pick({ x: 580, y: 320 })).toBeNull();
    expect(picks(page('a'))).toHaveLength(0);
    host.dispose();

    const ready = await shown();
    expect(await ready.host.pick({ x: 50, y: 320 })).toBeNull();
    expect(await ready.host.pick({ x: 580, y: 700 })).toBeNull();
    expect(picks(ready.page('a'))).toHaveLength(0);
    ready.host.dispose();
  });

  test('画布像素按矩阵反推成固有像素再问；回来的框换回画布像素', async () => {
    const { host, page } = await shown();
    const pending = host.pick({ x: 580, y: 320 });
    const [request] = picks(page('a'));
    expect(request).toMatchObject({ kind: 'pick', x: 640, y: 360 });
    page('a').reply(request!.id, { ok: true, value: node });
    expect(await pending).toEqual({ itemId: 'a', rect: { x: 100, y: 320, w: 240, h: 135 }, node });
    host.dispose();
  });

  test('一次只一个在路上：路上来的只记最新的，更早没发的兑现 null', async () => {
    const { host, page } = await shown();
    const first = host.pick({ x: 580, y: 320 });
    const second = host.pick({ x: 200, y: 100 });
    const third = host.pick({ x: 1000, y: 455 });
    expect(picks(page('a'))).toHaveLength(1);
    expect(await second).toBeNull();
    page('a').answer('pick', node);
    expect((await first)?.node).toEqual(node);
    expect(picks(page('a'))).toHaveLength(2);
    expect(picks(page('a'))[1]).toMatchObject({ x: 1200, y: 540 });
    page('a').answer('pick', null);
    expect(await third).toBeNull();
    host.dispose();
  });

  test('超时兑现 null、晚到的回信不算，名额让出来；页面报错或回的形状不对也是 null，都不算失败', async () => {
    const { host, page, failures } = await shown({ pickTimeoutMs: 300 });
    const slow = host.pick({ x: 580, y: 320 });
    vi.advanceTimersByTime(300);
    expect(await slow).toBeNull();
    page('a').reply(picks(page('a'))[0]!.id, { ok: true, value: node });

    const failed = host.pick({ x: 580, y: 320 });
    expect(picks(page('a'))).toHaveLength(2);
    page('a').reply(picks(page('a'))[1]!.id, { ok: false, code: 'COMPOSITION_SCRIPT_ERROR', message: 'boom' });
    expect(await failed).toBeNull();

    for (const value of [
      { ...node, selector: 1 },
      { ...node, w: Number.NaN },
      { ...node, rect: { x: 0, y: 0, w: 1 } },
      { ...node, name: 3 },
      'div',
    ]) {
      const bad = host.pick({ x: 580, y: 320 });
      page('a').answer('pick', value);
      expect(await bad).toBeNull();
    }
    expect(failures).toEqual([]);
    expect(host.mounted.get('a')?.state).toBe('ready');
    host.dispose();
  });

  test('拆掉时挂着的拾取兑现 null', async () => {
    const { host } = await shown();
    const inFlight = host.pick({ x: 580, y: 320 });
    const queued = host.pick({ x: 600, y: 320 });
    host.dispose();
    expect(await inFlight).toBeNull();
    expect(await queued).toBeNull();
  });

  test('验形只留协议的字段；矩阵的正反变换互逆，转过的框取外包盒', () => {
    expect(readBridgePick({ ...node, extra: 'x', role: 'img' })).toEqual({ ...node, role: 'img' });
    expect(readBridgePick({ ...node, name: '' })).toEqual({ selector: 'div#box', w: 320, h: 180, focusable: false, rect: node.rect });
    expect(readBridgePick(null)).toBeNull();
    expect(readBridgePick({ ...node, focusable: 'yes' })).toBeNull();
    const size = { width: 1280, height: 720 };
    // 转 90°：单位方块的 u 轴朝下、v 轴朝左。
    const turned: LiveLayer['matrix'] = [0, 1080, -1920, 0, 1920, 0];
    const at = canvasToIntrinsic(turned, size, { x: 1440, y: 270 })!;
    expect([at.x, at.y]).toEqual([320, 180]);
    expect(intrinsicRectToCanvas(turned, size, { x: 0, y: 0, w: 640, h: 360 })).toEqual({ x: 960, y: 0, w: 960, h: 540 });
    expect(canvasToIntrinsic([0, 0, 0, 0, 0, 0], size, { x: 1, y: 1 })).toBeNull();
  });
});
