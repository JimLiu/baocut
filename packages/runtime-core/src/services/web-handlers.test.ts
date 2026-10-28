import { describe, expect, it } from 'vitest';
import type { ModelBundleStatus, ModelsEvent, ModelsSnapshot, SequencedEvent } from '@baocut/protocol';
import type { TrustedPrincipal } from '../gateway.ts';
import type { RpcHandlers } from '../handlers.ts';
import { webHandlers, type WebHandlerDeps } from './web-handlers.ts';

/** 浏览器里看不到原地引用的本机模型文件在哪（架构设计 §6.3「添加 audio.cpp 模型」）：只留文件名。 */

const FILE = '/Volumes/Disk/models/my-voice.gguf';

const local: ModelBundleStatus = {
  bundleId: 'custom-abc@audio-cpp',
  capability: 'synthesize',
  backend: 'audio-cpp',
  device: 'metal',
  state: 'installed',
  added: { kind: 'local-file', family: 'qwen3_tts', familyName: 'Qwen3-TTS', source: FILE },
  components: [{ component: 'tts', repo: 'audio-cpp-added/custom-abc', revision: 'local', origin: 'local-file', file: FILE, state: 'installed', bytes: 9 }],
} as ModelBundleStatus;

const builtin = {
  bundleId: 'b@audio-cpp',
  capability: 'synthesize',
  backend: 'audio-cpp',
  device: 'metal',
  state: 'installed',
  components: [{ component: 'tts', repo: 'o/r', revision: 'v1', state: 'installed', bytes: 9 }],
} as ModelBundleStatus;

const catalog = { ...builtin, bundleId: 'c@audio-cpp', added: { kind: 'catalog', family: 'yue2', familyName: 'YuE2', source: 'yue2_main_bf16' } } as ModelBundleStatus;

function setup(result: 'snapshot' | 'replay') {
  let listener: ((event: SequencedEvent<unknown>) => void) | null = null;
  const base = {
    methods: { 'models.list': async () => ({ bundles: [local, builtin, catalog] }) },
    subscribe: (topic: string, _after: unknown, l: (event: SequencedEvent<unknown>) => void) => {
      listener = l;
      const events: SequencedEvent<ModelsEvent>[] = [{ seq: '1', event: { type: 'bundle.updated', bundle: local } } as SequencedEvent<ModelsEvent>];
      const snapshot = { capabilities: {}, bundles: [local, builtin] } as unknown as ModelsSnapshot;
      return {
        result: result === 'snapshot' ? { mode: 'snapshot', seq: '1', snapshot: topic === 'models' ? snapshot : { other: FILE } } : { mode: 'replay', seq: '1', events },
        unsubscribe: () => {},
      };
    },
  } as unknown as RpcHandlers;
  const web = webHandlers(base, {} as WebHandlerDeps);
  return { web, emit: (event: SequencedEvent<unknown>) => listener?.(event) };
}

const principal = {} as TrustedPrincipal;

describe('Web 服务里的模型包状态', () => {
  it('models.list：原地引用的文件只留文件名，别的模型包原样', async () => {
    const { web } = setup('snapshot');
    const { bundles } = await web.methods['models.list']({}, principal);
    expect(bundles[0]!.added?.source).toBe('my-voice.gguf');
    expect(bundles[0]!.components?.[0]?.file).toBe('my-voice.gguf');
    expect(bundles[1]).toBe(builtin);
    expect(bundles[2]).toBe(catalog);
    expect(JSON.stringify(bundles)).not.toContain('/Volumes/');
  });

  it('models 主题：快照、补发与之后的事件都去掉路径；别的主题不碰', () => {
    const snap = setup('snapshot');
    const events: SequencedEvent<unknown>[] = [];
    const sub = snap.web.subscribe('models', undefined, (e) => events.push(e));
    expect(JSON.stringify(sub.result)).not.toContain('/Volumes/');
    snap.emit({ seq: '2', event: { type: 'bundle.updated', bundle: local } });
    snap.emit({ seq: '3', event: { type: 'bundle.removed', bundleId: local.bundleId } });
    expect((events[0]!.event as Extract<ModelsEvent, { type: 'bundle.updated' }>).bundle.added?.source).toBe('my-voice.gguf');
    expect(events[1]!.event).toEqual({ type: 'bundle.removed', bundleId: local.bundleId });
    expect(JSON.stringify(events)).not.toContain('/Volumes/');

    const replay = setup('replay').web.subscribe('models', '0' as never, () => {});
    expect(JSON.stringify(replay.result)).not.toContain('/Volumes/');
    expect(replay.result.mode).toBe('replay');

    expect(JSON.stringify(setup('snapshot').web.subscribe('settings', undefined, () => {}).result)).toContain('/Volumes/');
  });
});
