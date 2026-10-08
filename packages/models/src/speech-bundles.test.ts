import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ModelBundleStatus } from '@baocut/protocol';
import { BUNDLES, backendSupported, type BundleDefinition } from './bundle-registry.ts';
import { localSpeechModelInfo, LOCAL_SPEECH_MAX_CHARS } from './local-speech.ts';
import { ModelCatalog } from './model-catalog.ts';
import { REPO_MANIFESTS, repoManifestFor } from './repo-manifests.ts';
import { SPEECH_BUNDLES } from './speech-bundles.ts';
import { BUILTIN_VOICES } from './speech-voices.ts';
import { SPEECH_COMPONENTS } from './worker-contract.ts';

/** 本地语音合成模型包的登记（架构设计 §6.3）：每个文件有哈希与大小，共用组件按引用保留，许可随模型描述给出。 */

const MLX_IDS = [
  'qwen3-tts-0.6b-base@mlx-8bit',
  'qwen3-tts-0.6b-customvoice@mlx-bf16',
  'qwen3-tts-1.7b-base@mlx-8bit',
  'qwen3-tts-1.7b-customvoice@mlx-8bit',
  'qwen3-tts-1.7b-voicedesign@mlx-8bit',
  'indextts2@mlx-fp16',
  'index-tts2.5@mlx-fp16',
  'gpt-sovits-v2@mlx-fp16',
  'voxcpm2@mlx-int8',
  'omnivoice@mlx-int8',
];
/** 每个 MLX 模型包都有 candle 变体：同一仓库，Apple Silicon 以外的平台列出。 */
const CANDLE_IDS = MLX_IDS.map((id) => `${id.split('@')[0]}@candle`);
const EXPECTED_IDS = [...MLX_IDS, ...CANDLE_IDS];

const componentsOf = (def: BundleDefinition) => Object.entries(def.components).filter(([, source]) => source !== undefined);
const status = { detail: undefined } as unknown as ModelBundleStatus;

describe('本地语音合成模型包的登记', () => {
  it('十个 MLX 模型包与它们的 candle 变体，都在总登记里，都是 synthesize；不登记 AuK', () => {
    expect(SPEECH_BUNDLES.map((b) => b.bundleId)).toEqual(EXPECTED_IDS);
    for (const def of SPEECH_BUNDLES) {
      expect(BUNDLES).toContain(def);
      expect(def.capability).toBe('synthesize');
      expect(def.speech).toBeDefined();
      expect(def.license).toBeDefined();
      expect(def.label).toBeTruthy();
      expect(def.components.tts).toBeDefined();
      for (const [name] of componentsOf(def)) expect(SPEECH_COMPONENTS).toContain(name);
    }
    expect(JSON.stringify(BUNDLES).toLowerCase()).not.toMatch(/\bauk\b/);
    expect(new Set(BUNDLES.map((b) => b.bundleId)).size).toBe(BUNDLES.length);
  });

  it('每个组件都有内置清单：每个文件都有 64 位十六进制 sha256 与正的大小，估计字节等于大小之和', () => {
    for (const def of SPEECH_BUNDLES) {
      for (const [name, source] of componentsOf(def)) {
        const manifest = repoManifestFor(source!.repo, source!.revision);
        expect(manifest, `${def.bundleId} 的 ${name}（${source!.repo}@${source!.revision}）`).not.toBeNull();
        expect(manifest!.files.length).toBeGreaterThan(0);
        let total = 0;
        for (const file of manifest!.files) {
          expect(file.sha256, `${source!.repo}/${file.path}`).toMatch(/^[0-9a-f]{64}$/);
          expect(file.size, `${source!.repo}/${file.path}`).toBeGreaterThan(0);
          total += file.size!;
        }
        expect(manifest!.estimatedBytes).toBe(total);
      }
    }
    // 同一仓库版本只登记一次。
    const keys = REPO_MANIFESTS.map((m) => `${m.repo}@${m.revision}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('candle 变体与 MLX 模型包同一仓库、同一特性，只换后端与设备；组件都带参数个数', () => {
    for (const [i, id] of CANDLE_IDS.entries()) {
      const candle = SPEECH_BUNDLES.find((b) => b.bundleId === id)!;
      const mlx = SPEECH_BUNDLES.find((b) => b.bundleId === MLX_IDS[i])!;
      expect(candle).toEqual({ ...mlx, bundleId: id, backend: 'candle', device: 'cpu' });
      for (const [name, source] of componentsOf(candle)) {
        expect(source!.parameters, `${id} 的 ${name}`).toBeGreaterThan(0);
        expect(source!.weightBits, `${id} 的 ${name}`).toBeDefined();
      }
    }
  });

  it('Qwen3-TTS 共用一份编解码器；IndexTTS 2.5 的辅助权重就是 IndexTTS2 的仓库', () => {
    const qwen = SPEECH_BUNDLES.filter((b) => b.bundleId.startsWith('qwen3-tts-'));
    expect(qwen).toHaveLength(10);
    const codecs = new Set(qwen.map((b) => `${b.components.codec!.repo}@${b.components.codec!.revision}`));
    expect(codecs.size).toBe(1);
    const index2 = SPEECH_BUNDLES.find((b) => b.bundleId === 'indextts2@mlx-fp16')!;
    const index25 = SPEECH_BUNDLES.find((b) => b.bundleId === 'index-tts2.5@mlx-fp16')!;
    expect(index25.components.aux).toMatchObject({ repo: index2.components.tts!.repo, revision: index2.components.tts!.revision });
  });

  describe('目录里的状态', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-speech-bundles-'));
    });
    afterEach(async () => {
      await fs.rm(dir, { recursive: true, force: true });
    });

    it('Apple Silicon：没装是 not-installed，共用的编解码器列出其余四个 Qwen3-TTS 模型包，许可与名字随状态给出', async () => {
      const catalog = new ModelCatalog({ root: dir, platform: 'darwin', arch: 'arm64', workerAvailable: () => true });
      const base = (await catalog.status('qwen3-tts-0.6b-base@mlx-8bit'))!;
      expect(base).toMatchObject({ capability: 'synthesize', state: 'not-installed', label: 'Qwen3-TTS 0.6B Base' });
      expect(base.license).toMatchObject({ commercialUse: true });
      const codec = base.components!.find((c) => c.component === 'codec')!;
      expect(codec.sharedWith.sort()).toEqual(MLX_IDS.filter((id) => id.startsWith('qwen3-tts-') && id !== base.bundleId).sort());
      expect(base.components!.find((c) => c.component === 'tts')!.sharedWith).toEqual([]);
      const index2 = (await catalog.status('indextts2@mlx-fp16'))!;
      expect(index2.components!.find((c) => c.component === 'tts')!.sharedWith).toEqual(['index-tts2.5@mlx-fp16']);
    });

    it('别的平台：mlx 不可用，模型包不列出、硬登记进去的是 error / unsupported；列 candle 变体', async () => {
      expect(backendSupported('mlx', 'darwin', 'arm64')).toBe(true);
      expect(backendSupported('mlx', 'darwin', 'x64')).toBe(false);
      expect(backendSupported('mlx', 'win32', 'x64')).toBe(false);
      expect(backendSupported('candle', 'linux', 'x64')).toBe(true);
      const catalog = new ModelCatalog({ root: dir, platform: 'win32', arch: 'x64', workerAvailable: () => true });
      for (const id of MLX_IDS) expect(await catalog.status(id)).toBeNull();
      for (const id of CANDLE_IDS)
        expect(await catalog.status(id)).toMatchObject({ state: 'not-installed', backend: 'candle', device: 'cpu' });
      const forced = new ModelCatalog({ root: dir, platform: 'win32', arch: 'x64', workerAvailable: () => true, bundles: SPEECH_BUNDLES });
      for (const id of MLX_IDS) expect(await forced.status(id)).toMatchObject({ state: 'error', reason: 'unsupported' });
    });

    it('常驻量：candle 变体按参数个数 × 计算精度（CPU 计在内存，CUDA 计在 GPU 内存）；MLX 的合成按固定的需求（null）', async () => {
      const win = new ModelCatalog({ root: dir, platform: 'win32', arch: 'x64', workerAvailable: () => true });
      // 0.6B Base（8 位，914.6M 参数）加共用的编解码器（f32，170.6M 参数）：CPU 上 f32。
      expect(await win.workerFootprint('qwen3-tts-0.6b-base@candle')).toEqual({ bytes: (914_643_008 + 170_557_441) * 4, pool: 'memory' });
      // IndexTTS 2.5：主模型加 IndexTTS2 仓库 `aux/` 下的辅助权重。
      expect(await win.workerFootprint('index-tts2.5@candle')).toEqual({ bytes: (966_515_596 + 699_767_331) * 4, pool: 'memory' });
      win.setWorkerDevice('candle', 'cuda');
      expect(await win.workerFootprint('voxcpm2@candle')).toEqual({ bytes: 2_383_791_364 * 2, pool: 'gpuMemory' });
      const mac = new ModelCatalog({ root: dir, platform: 'darwin', arch: 'arm64', workerAvailable: () => true });
      expect(await mac.workerFootprint('qwen3-tts-0.6b-base@mlx-8bit')).toBeNull();
    });
  });

  describe('模型描述', () => {
    const info = (id: string) =>
      localSpeechModelInfo(
        SPEECH_BUNDLES.find((b) => b.bundleId === id)!,
        status,
        true,
      );

    it('OmniVoice 的许可不可商用，写在模型描述里；能克隆、能按词表描述', () => {
      const omni = info('omnivoice@mlx-int8');
      expect(omni.local!.license).toMatchObject({ name: 'CC-BY-NC-4.0', commercialUse: false });
      expect(omni.voiceModes).toEqual(['preset', 'clone', 'describe']);
      expect(omni.local!.voiceDescription).toMatchObject({ kind: 'vocabulary' });
      expect(omni.local!.maxDurationSec).toBe(60);
      expect(info('omnivoice@candle').local!.license.commercialUse).toBe(false);
      for (const id of EXPECTED_IDS.filter((x) => !x.startsWith('omnivoice@'))) expect(info(id).local!.license.commercialUse).toBe(true);
    });

    it('CustomVoice 列出模型自己的说话人；克隆模型列出内置音色；VoiceDesign 的内置音色是描述', () => {
      const custom = info('qwen3-tts-1.7b-customvoice@mlx-8bit');
      expect(custom.voices.every((v) => v.source === 'model')).toBe(true);
      expect(custom.defaultVoice).toBe('Vivian');
      expect(custom.local!.builtinVoices).toBeNull();
      expect(custom.acceptsInstructions).toBe(true);

      const base = info('qwen3-tts-0.6b-base@mlx-8bit');
      expect(base.voices.map((v) => v.voiceId)).toEqual(BUILTIN_VOICES.map((v) => v.id));
      expect(base.local!.builtinVoices).toBe('reference');
      expect(base.voiceModes).toEqual(['preset', 'clone']);

      const design = info('qwen3-tts-1.7b-voicedesign@mlx-8bit');
      expect(design.local!.builtinVoices).toBe('description');
      expect(design.voiceModes).toEqual(['preset', 'describe']);

      for (const id of EXPECTED_IDS) {
        const model = info(id);
        expect(model).toMatchObject({ formats: ['wav'], defaultFormat: 'wav', cost: 'free-local', maxInputChars: LOCAL_SPEECH_MAX_CHARS });
      }
    });

    it('candle 在 CPU 上照实提示比实时慢多少；Worker 报告了 CUDA 时与 MLX 一样不写', () => {
      const on = (device: string) => ({ device, detail: undefined }) as unknown as ModelBundleStatus;
      const of = (id: string, s: ModelBundleStatus) =>
        localSpeechModelInfo(
          SPEECH_BUNDLES.find((b) => b.bundleId === id)!,
          s,
          true,
        ).notes;
      for (const id of CANDLE_IDS) {
        const note = of(id, on('cpu'));
        expect(note).toMatch(/^在本机的 CPU 上合成，只用到一两个核，/);
        expect(note).toContain('CUDA');
        // 每只模型都有自己的一句，不落到兜底。
        expect(note).not.toContain('一句要等几分钟；');
        expect(of(id, on('cuda'))).toBeUndefined();
        // 状态没报设备时按登记的设备（cpu）算。
        expect(of(id, status)).toBe(note);
      }
      expect(of('qwen3-tts-0.6b-base@candle', on('cpu'))).toContain('约 55 倍');
      expect(of('index-tts2.5@candle', on('cpu'))).toContain('120–145 倍');
      expect(of('omnivoice@candle', on('cpu'))).toContain('约 30 倍');
      expect(of('gpt-sovits-v2@candle', on('cpu'))).toContain('约 6 倍');
      for (const id of ['qwen3-tts-1.7b-base@candle', 'indextts2@candle', 'voxcpm2@candle']) {
        expect(of(id, on('cpu'))).toContain('这只没有实测');
      }
      for (const id of MLX_IDS) expect(of(id, on('metal'))).toBeUndefined();
    });

    it('不可用时带上原因', () => {
      const def = SPEECH_BUNDLES[0]!;
      const model = localSpeechModelInfo(def, { detail: '没装' } as unknown as ModelBundleStatus, false);
      expect(model).toMatchObject({ available: false, detail: '没装' });
    });
  });
});

describe('引擎的语言表与旋钮区间', () => {
  // 与 model-runtime 的引擎常量对照的同一份夹具（crates/model-runtime/tests/synthesize_engine_limits.rs）。
  const LIMITS_FILE = new URL('../../../crates/model-runtime/tests/fixtures/speech-engine-limits.json', import.meta.url);
  // 按模型包 ID 的 `@` 前一段：MLX 与 candle 变体是同一只引擎。
  const ENGINE_OF: Record<string, string> = {
    voxcpm2: 'voxcpm2',
    omnivoice: 'omnivoice',
    'index-tts2.5': 'index-tts2.5',
    'gpt-sovits-v2': 'gpt-sovits',
  };

  it('与 Worker 一侧的引擎常量一致', async () => {
    const limits = JSON.parse(await fs.readFile(LIMITS_FILE, 'utf8')) as {
      languages: Record<string, string[]>;
      knobs: Record<string, Record<string, unknown>>;
    };
    for (const bundle of SPEECH_BUNDLES) {
      const speech = bundle.speech!;
      const engine = speech.family === 'qwen3-tts' ? 'qwen3-tts' : ENGINE_OF[bundle.bundleId.split('@')[0]!];
      expect(speech.knobs, bundle.bundleId).toEqual((engine && limits.knobs[engine]) ?? {});
      const languages = engine ? limits.languages[engine] : undefined;
      expect(speech.languages, bundle.bundleId).toEqual(languages ?? 'any');
    }
  });
});
