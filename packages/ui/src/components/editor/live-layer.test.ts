// @vitest-environment happy-dom
import {
  COMPOSITION_BRIDGE_CHANNEL,
  type BundleHandle,
  type CompositionBridgeMessage,
  type CompositionBridgeRequest,
} from '@baocut/protocol';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { LiveCandidate } from '../../model/live-composition.ts';
import type { LiveLayer } from '../../render/frame-plan.ts';
import {
  LiveLayerHost,
  canvasToIntrinsic,
  intrinsicRectToCanvas,
  readBridgeCapture,
  readBridgePick,
  type BridgePort,
} from './live-layer.ts';

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

type SetupOptions = {
  loadTimeoutMs?: number;
  readyTimeoutMs?: number;
  pickTimeoutMs?: number;
  captureTimeoutMs?: number;
  maxMounted?: number;
};

const handle = (assetId: string): BundleHandle => ({
  url: `/bundle/h_${assetId}/`,
  entry: 'index.html',
  expiresAt: '2099-01-01T00:00:00Z',
});

/** `resolve` 默认立刻给地址；测试要它慢就传自己的。 */
function setup(options: SetupOptions = {}, resolve: (assetId: string) => Promise<BundleHandle> = (id) => Promise.resolve(handle(id))) {
  const root = document.createElement('div');
  document.body.append(root);
  const pages = new Map<string, FakePage>();
  const resolved: string[] = [];
  const failures: [string, string][] = [];
  const host = new LiveLayerHost(
    root,
    (asset) => {
      resolved.push(asset.id);
      return resolve(asset.id);
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

test('句柄在代码包专用来源上且与页面不同源时才开 allow-same-origin；同源或没标 isolation 的照旧不开', async () => {
  const page = window.location.origin;
  const cases: [BundleHandle, string][] = [
    [{ url: 'http://127.0.0.1:53111/bundle/h/', entry: 'index.html', expiresAt: '2099-01-01T00:00:00Z', isolation: 'origin' }, 'allow-scripts allow-same-origin'],
    [{ url: `${page}/bundle/h/`, entry: 'index.html', expiresAt: '2099-01-01T00:00:00Z', isolation: 'origin' }, 'allow-scripts'],
    [{ url: 'http://127.0.0.1:53111/bundle/h/', entry: 'index.html', expiresAt: '2099-01-01T00:00:00Z' }, 'allow-scripts'],
  ];
  for (const [bundle, sandbox] of cases) {
    const { host, frames } = setup({}, () => Promise.resolve(bundle));
    host.prepare([candidate('a')]);
    await Promise.resolve();
    const iframe = frames()[0]!;
    expect(iframe.getAttribute('src')).toBe(bundle.url + 'index.html');
    expect(iframe.getAttribute('sandbox')).toBe(sandbox);
    host.dispose();
  }
});

test('挂上的是不开同源的沙箱 iframe，按固有尺寸布置、指针进不去；地址按目录句柄拼，拿到地址才挂进页面，就位后先画第 0 帧', async () => {
  const { host, page, resolved, frames } = setup();
  host.prepare([candidate('a')]);
  // 有的宿主内置浏览器按挂上那一刻的 sandbox 拦 iframe：拿到地址、定好 sandbox 之前不挂。
  expect(frames()).toEqual([]);
  await Promise.resolve();
  const [iframe] = frames();
  expect(iframe).toBeTruthy();
  expect(iframe!.getAttribute('sandbox')).toBe('allow-scripts');
  expect(iframe!.hasAttribute('inert')).toBe(true);
  expect(iframe!.style.pointerEvents).toBe('none');
  expect([iframe!.style.width, iframe!.style.height, iframe!.style.opacity]).toEqual(['1280px', '720px', '0']);
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
  await Promise.resolve();
  expect(frames().map((f) => f.dataset.liveItem)).toEqual(['a', 'b', 'c']);
  host.prepare([candidate('c'), { ...candidate('b'), asset: { id: 'asset_b', revision: '2' } }]);
  expect(frames().map((f) => f.dataset.liveItem)).toEqual(['c']);
  await Promise.resolve();
  expect(frames().map((f) => f.dataset.liveItem)).toEqual(['c', 'b']);
  expect(resolved).toEqual(['asset_a', 'asset_b', 'asset_c', 'asset_b']);
  host.dispose();
});

test('载入超时、ready 报错、定位报错都报给引擎，那个 iframe 不再显示', async () => {
  const { host, page, failures, frames } = setup({ loadTimeoutMs: 3000 });
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
  // a：页面 3 秒内没发 hello。
  vi.advanceTimersByTime(3000);
  expect(failures.at(-1)).toEqual(['a', 'load-timeout']);
  expect(host.mounted.get('a')?.state).toBe('failed');
  host.dispose();
});

test('计时分两段：要地址的那一程不算进载入；hello 之后按 readyTimeoutMs 等就绪，页面的注册轮询用同一个数', async () => {
  const gate: { give?: () => void } = {};
  const { host, page, failures, frames } = setup(
    { loadTimeoutMs: 3000, readyTimeoutMs: 20_000 },
    (id) => new Promise((done) => (gate.give = () => done(handle(id)))),
  );
  host.prepare([candidate('a')]);
  // 要地址慢：2.5 秒才给。
  vi.advanceTimersByTime(2500);
  gate.give!();
  await Promise.resolve();
  expect(frames()[0]!.getAttribute('src')).toBe('/bundle/h_asset_a/index.html');
  // 地址设好后载入重新计时：再过 2.5 秒（从挂上算已 5 秒）没超时。
  vi.advanceTimersByTime(2500);
  expect(failures).toEqual([]);
  page('a').hello();
  const ready = page('a').requests[0]!;
  expect(ready).toMatchObject({ kind: 'ready', timeoutMs: 20_000 });
  // 页面在载两份大字体、跑 initialize：远超 3 秒也照等。
  vi.advanceTimersByTime(8000);
  expect(failures).toEqual([]);
  expect(host.mounted.get('a')?.state).toBe('loading');
  page('a').answer('ready', {});
  await Promise.resolve();
  expect(host.mounted.get('a')?.state).toBe('ready');
  host.dispose();
});

test('要地址也有期限；hello 之后的就绪超过 readyTimeoutMs（加一点余量让页面先报）才算超时', async () => {
  const { host, page, failures } = setup({ loadTimeoutMs: 3000, readyTimeoutMs: 20_000 }, (id) =>
    id === 'asset_a' ? new Promise(() => {}) : Promise.resolve(handle(id)),
  );
  host.prepare([candidate('a'), candidate('b')]);
  await Promise.resolve();
  page('b').hello();
  vi.advanceTimersByTime(3000);
  expect(failures).toEqual([['a', 'load-timeout']]);
  // 页面重新载入又发 hello：照旧回 ready，但不重新计时。
  vi.advanceTimersByTime(10_000);
  page('b').hello();
  expect(page('b').requests.filter((r) => r.kind === 'ready')).toHaveLength(2);
  vi.advanceTimersByTime(7999);
  expect(failures).toEqual([['a', 'load-timeout']]);
  vi.advanceTimersByTime(1000);
  expect(failures).toEqual([
    ['a', 'load-timeout'],
    ['b', 'ready-timeout'],
  ]);
  expect(host.mounted.get('b')?.state).toBe('failed');
  host.dispose();
});

test('在视的还没画出第一帧时报在载入：就位、第一次定位回信才撤；换到没载好的那一章再报，失败与不在视都不算', async () => {
  const { host, page } = setup({ loadTimeoutMs: 3000 });
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
  // 换到还没载好的那一章：再报；它载入超时失败了就撤（引擎退回替身）。
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

describe('Web 截图模式的取图（lite-editor §4.1、§11 第 14 条）', () => {
  const placed: LiveLayer = { ...layer('a', 0, 0.8), matrix: [960, 0, 0, 540, 100, 50] };
  const png = () => new Blob(['png'], { type: 'image/png' });
  async function shown(options: { captureTimeoutMs?: number } = {}) {
    const ctx = setup(options);
    ctx.host.prepare([candidate('a')]);
    await Promise.resolve();
    ctx.page('a').hello();
    ctx.page('a').answer('ready', {});
    await Promise.resolve();
    ctx.page('a').answer('seek');
    await Promise.resolve();
    ctx.host.show(placed, 0);
    return ctx;
  }
  const captures = (page: FakePage) => page.requests.filter((r) => r.kind === 'capture');

  test('没有在视的、还没就绪或还没画出第一帧：立刻 null，不问页面', async () => {
    const { host, page } = setup();
    expect(await host.capture()).toBeNull();
    host.prepare([candidate('a')]);
    host.show(placed, 0);
    expect(await host.capture()).toBeNull();
    await Promise.resolve();
    page('a').hello();
    page('a').answer('ready', {});
    await Promise.resolve();
    expect(host.mounted.get('a')?.arrived).toBeNull();
    expect(await host.capture()).toBeNull();
    expect(captures(page('a'))).toHaveLength(0);
    host.dispose();
  });

  test('问在视的那个要这一帧：回来的 PNG 连同此刻的摆法（matrix、opacity）；同时再要就等同一个', async () => {
    const { host, page } = await shown();
    const first = host.capture();
    const second = host.capture();
    expect(captures(page('a'))).toHaveLength(1);
    const image = png();
    page('a').answer('capture', { width: 1280, height: 720, image });
    const got = await first;
    expect(got).toEqual({ itemId: 'a', image, matrix: [960, 0, 0, 540, 100, 50], opacity: 0.8 });
    expect(await second).toEqual(got);
    // 兑现后名额让出来，再要就再问一次
    const third = host.capture();
    expect(captures(page('a'))).toHaveLength(2);
    page('a').answer('capture', null);
    expect(await third).toBeNull();
    host.dispose();
  });

  test('超时、报错、回的形状不对都是 null，不算失败；拆掉时挂着的兑现 null', async () => {
    const { host, page, failures } = await shown({ captureTimeoutMs: 500 });
    const slow = host.capture();
    vi.advanceTimersByTime(500);
    expect(await slow).toBeNull();
    page('a').reply(captures(page('a'))[0]!.id, { ok: true, value: { width: 1280, height: 720, image: png() } });

    const failed = host.capture();
    page('a').reply(captures(page('a'))[1]!.id, { ok: false, code: 'COMPOSITION_SCRIPT_ERROR', message: 'boom' });
    expect(await failed).toBeNull();

    for (const value of [
      { width: 1280, height: 720, image: 'png' },
      { width: 1280, height: 720, image: new Blob(['x'], { type: 'image/jpeg' }) },
      { width: 1280, height: 720, image: new Blob([], { type: 'image/png' }) },
      { width: 0, height: 720, image: png() },
      { width: 1280.5, height: 720, image: png() },
      { width: 9000, height: 720, image: png() },
      'png',
    ]) {
      const bad = host.capture();
      page('a').answer('capture', value);
      expect(await bad).toBeNull();
    }
    expect(failures).toEqual([]);
    expect(host.mounted.get('a')?.state).toBe('ready');

    const pending = host.capture();
    host.dispose();
    expect(await pending).toBeNull();
  });

  test('验形只留协议的字段', () => {
    const image = png();
    expect(readBridgeCapture({ width: 4, height: 2, image, extra: 1 })).toEqual({ width: 4, height: 2, image });
    expect(readBridgeCapture(null)).toBeNull();
  });
});
