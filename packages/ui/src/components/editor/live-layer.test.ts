// @vitest-environment happy-dom
import { COMPOSITION_BRIDGE_CHANNEL, type CompositionBridgeMessage, type CompositionBridgeRequest } from '@baocut/protocol';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { LiveCandidate } from '../../model/live-composition.ts';
import type { LiveLayer } from '../../render/frame-plan.ts';
import { LiveLayerHost, type BridgePort } from './live-layer.ts';

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

function setup(options: { readyTimeoutMs?: number; maxMounted?: number } = {}) {
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
