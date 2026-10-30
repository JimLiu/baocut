import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  GenerateMusicRequest,
  ModelBundleStatus,
  MusicModelInfo,
} from '@baocut/protocol';
import { RpcError } from '@baocut/protocol';
import { BUNDLES } from './bundle-registry.ts';
import { musicParameters } from './generation-options.ts';
import { LocalProviderSource } from './local-source.ts';
import { AUDIO_CPP_CLI_ENV } from './audio-cpp-engine.ts';
import {
  localMusicModelInfo,
  localMusicSeed,
  musicEngineRunOf,
  semanticMaxTokens,
} from './local-music.ts';
import { MANIFEST_FILE, ModelCatalog } from './model-catalog.ts';
import type { ModelChoice } from './model-selection.ts';
import {
  AUDIO_CPP_ENGINE,
  MUSIC_BUNDLES,
  YUE2_SEMANTIC_TOKENS_PER_SEC,
} from './music-bundles.ts';
import {
  MUSIC_SELF_TEST,
  musicSelfTestParameters,
  musicSelfTestVerdict,
} from './music-self-test.ts';
import { repoManifestFor } from './repo-manifests.ts';
import { MUSIC_OUTPUT_FILE } from './worker-contract.ts';

/** 本地音乐生成的模型包登记、模型描述、冻结参数到引擎命令行的换算与自检判定（架构设计 §6.1、§6.3；Model Worker 协议规范 §4.4）。 */

const YUE = MUSIC_BUNDLES[0]!;
const GiB = 1024 * 1024 * 1024;
const status = { detail: undefined } as unknown as ModelBundleStatus;

describe('本地音乐模型包的登记', () => {
  it('YuE2 3B 的 q8 GGUF 在总登记里，是 music / audio-cpp；仓库整个是唯一的 music 组件（引擎随应用内置），有非商用许可与名字', () => {
    expect(MUSIC_BUNDLES.map((b) => b.bundleId)).toEqual([
      'yue2-3b@audio-cpp-q8',
    ]);
    expect(BUNDLES).toContain(YUE);
    expect(YUE).toMatchObject({
      capability: 'music',
      backend: 'audio-cpp',
      device: 'auto',
      label: 'YuE2 3B',
    });
    expect(Object.keys(YUE.components)).toEqual(['music']);
    expect(YUE.components.music!.family).toBe('yue2');
    expect(YUE.music).toMatchObject({
      family: 'yue2',
      engine: AUDIO_CPP_ENGINE,
      modes: ['song', 'instrumental'],
      slow: true,
      peakEstimated: true,
    });
    expect(YUE.music!.peakBytes).toBe(10 * GiB);
    expect(YUE.music!.planning).toEqual({
      options: ['off', 'melody', 'full'],
      default: 'melody',
    });
    expect(YUE.license).toMatchObject({ commercialUse: false });
  });

  it('内置清单：6 个文件都有 sha256 与大小，估计字节等于大小之和；登记的权重与 VAE 文件都在', () => {
    const source = YUE.components.music!;
    const manifest = repoManifestFor(source.repo, source.revision)!;
    expect(manifest).not.toBeNull();
    expect(manifest.files).toHaveLength(6);
    let total = 0;
    for (const file of manifest.files) {
      expect(file.sha256, file.path).toMatch(/^[0-9a-f]{64}$/);
      expect(file.size, file.path).toBeGreaterThan(0);
      total += file.size!;
    }
    expect(manifest.estimatedBytes).toBe(total);
    const paths = manifest.files.map((f) => f.path);
    expect(paths).toContain(YUE.music!.files.model);
    expect(paths).toContain(YUE.music!.files.vae);
  });

  describe('目录里的状态', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-music-bundles-'));
    });
    afterEach(async () => {
      await fs.rm(dir, { recursive: true, force: true });
    });

    it('哪个平台都列；没装时 not-installed；权重齐了就 installed（引擎随应用内置）；找不到内置引擎时 unsupported', async () => {
      for (const [platform, arch] of [
        ['darwin', 'arm64'],
        ['win32', 'x64'],
        ['linux', 'x64'],
      ] as const) {
        const catalog = new ModelCatalog({
          root: dir,
          platform,
          arch,
          workerAvailable: () => false,
        });
        expect(
          catalog
            .definitions()
            .filter((d) => d.capability === 'music')
            .map((d) => d.bundleId),
          `${platform}/${arch}`,
        ).toEqual([YUE.bundleId]);
        expect(
          await catalog.status(YUE.bundleId),
          `${platform}/${arch}`,
        ).toMatchObject({
          capability: 'music',
          state: 'not-installed',
          backend: 'audio-cpp',
        });
      }
      await writeRepo(
        dir,
        YUE.components.music!.repo,
        YUE.components.music!.revision,
        {
          [YUE.music!.files.model]: 'gguf',
          [YUE.music!.files.vae]: 'vae',
        },
      );
      // Model Worker 在不在与它无关。
      const catalog = new ModelCatalog({
        root: dir,
        platform: 'linux',
        arch: 'arm64',
        workerAvailable: () => false,
      });
      const installed = await catalog.status(YUE.bundleId);
      expect(installed).toMatchObject({ state: 'installed' });
      expect(installed!.components!.map((c) => c.component)).toEqual(['music']);
      expect(Object.keys((await catalog.bundleFor(YUE.bundleId)).components)).toEqual(['music']);
      const noEngine = new ModelCatalog({ root: dir, platform: 'darwin', arch: 'arm64', engineAvailable: () => false });
      const unsupported = await noEngine.status(YUE.bundleId);
      expect(unsupported).toMatchObject({ state: 'error', reason: 'unsupported' });
      expect(unsupported!.detail).toContain('audio.cpp');
    });

    it('峰值按登记的估计值取池：Apple Silicon 计 GPU 内存，别的平台计内存；不是音乐包时 null', () => {
      const mac = new ModelCatalog({
        root: dir,
        platform: 'darwin',
        arch: 'arm64',
      });
      expect(mac.musicPeak(YUE.bundleId)).toEqual({
        bytes: 10 * GiB,
        pool: 'gpuMemory',
      });
      expect(mac.musicPeak('qwen3-asr-0.6b@mlx-4bit')).toBeNull();
      const win = new ModelCatalog({
        root: dir,
        platform: 'win32',
        arch: 'x64',
      });
      expect(win.musicPeak(YUE.bundleId)).toEqual({
        bytes: 10 * GiB,
        pool: 'memory',
      });
    });

    it('本机 Provider：没装时 not-installed；装好且有内置引擎时可用；找不到内置引擎时 unsupported', async () => {
      let engine: string | null = '/opt/baocut/bin/audiocpp/audiocpp_cli';
      const catalog = () =>
        new ModelCatalog({ root: dir, platform: 'darwin', arch: 'arm64', workerAvailable: () => false, engineAvailable: () => engine !== null });
      const music = {} as never;
      const describe = (c: ModelCatalog) =>
        new LocalProviderSource({ catalog: c, transcriber: null, music, engine: () => engine }).describe('local', 'view');
      const neither = await describe(catalog());
      expect(neither!.capabilities.generateMusic).toMatchObject({
        available: false,
        unavailableReason: 'not-installed',
      });
      expect(neither!.capabilities.generateMusic!.models[0]).toMatchObject({
        modelId: YUE.bundleId,
        available: false,
        unavailableReason: 'not-installed',
      });

      await writeRepo(
        dir,
        YUE.components.music!.repo,
        YUE.components.music!.revision,
        {
          [YUE.music!.files.model]: 'gguf',
          [YUE.music!.files.vae]: 'vae',
        },
      );
      const present = await describe(catalog());
      expect(present!.capabilities.generateMusic).toMatchObject({ available: true });
      expect(present!.capabilities.generateMusic!.models[0]!.local!.engine).toEqual({ id: AUDIO_CPP_ENGINE, executable: engine });

      engine = null;
      const missing = await describe(catalog());
      expect(missing!.capabilities.generateMusic).toMatchObject({
        available: false,
        unavailableReason: 'unsupported',
      });
      expect(missing!.capabilities.generateMusic!.models[0]!.detail).toBeTruthy();
      expect(missing!.capabilities.generateMusic!.models[0]!.local!.engine.executable).toBeNull();
    });
  });
});

describe('模型描述与冻结参数', () => {
  it('歌曲与纯音乐、只出 WAV、接受 seed、免费；上限与编排选项来自模型包，提示耗时', () => {
    const info = localMusicModelInfo(YUE, status, true, '/opt/audiocpp_cli');
    expect(info).toMatchObject({
      modelId: YUE.bundleId,
      label: 'YuE2 3B',
      modes: ['song', 'instrumental'],
      maxStyleChars: 2000,
      maxLyricsChars: 4000,
      maxDurationSec: 300,
      defaultDurationSec: 120,
      formats: ['wav'],
      defaultFormat: 'wav',
      acceptsSeed: true,
      cost: 'free-local',
      available: true,
    });
    expect(info.notes).toBeTruthy();
    expect(info.local).toMatchObject({
      family: 'yue2',
      sampleRate: 44_100,
      lyricLanguages: 'unverified',
      slow: true,
    });
    expect(info.local!.steps).toEqual(YUE.music!.steps);
  });

  it('引擎找不到时不可用，说明取模型包状态的；模型包有问题时带目录给的说明', () => {
    const missing = localMusicModelInfo(YUE, { detail: 'audio.cpp engine 0.9.1 is not installed' } as unknown as ModelBundleStatus, true, null);
    expect(missing.available).toBe(false);
    expect(missing.detail).toContain('audio.cpp');
    expect(localMusicModelInfo(YUE, status, true, null).detail).toBeUndefined();
    const broken = {
      detail: 'checksum mismatch',
    } as unknown as ModelBundleStatus;
    expect(
      localMusicModelInfo(YUE, broken, false, '/opt/audiocpp_cli'),
    ).toMatchObject({ available: false, detail: 'checksum mismatch' });
  });

  it('seed：给了就用，没给时抽一个 0..2^32-1 的整数', () => {
    expect(localMusicSeed(0)).toBe(0);
    expect(localMusicSeed(4_294_967_295)).toBe(4_294_967_295);
    for (let i = 0; i < 20; i++) {
      const seed = localMusicSeed(null);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(2 ** 32);
    }
  });

  it('时长 → 语义 token 上限按模型族的帧率，至少 1', () => {
    expect(YUE2_SEMANTIC_TOKENS_PER_SEC).toBe(25);
    expect(semanticMaxTokens(120, YUE.music!)).toBe(3000);
    expect(semanticMaxTokens(0.01, YUE.music!)).toBe(1);
  });

  it('冻结的参数 → 引擎命令行：歌曲带歌词、纯音乐空歌词；风格、编排、seed、token 上限是 request-option；权重路径是 session-option；输出写进 staging', () => {
    const run = musicEngineRunOf(
      {
        capability: 'generateMusic',
        mode: 'song',
        style: 'upbeat pop',
        lyrics: 'la la',
        targetDurationSec: 60,
        maxDurationSec: 90,
        planning: 'full',
        format: 'wav',
        seed: 42,
      },
      YUE.music!,
      { modelDir: '/models/yue2', staging: '/staging', threads: 4 },
    );
    expect(run.output).toBe(path.join('/staging', MUSIC_OUTPUT_FILE));
    expect(run.semanticMaxTokens).toBe(2250);
    const args = run.args;
    const option = (flag: string, prefix: string) =>
      args
        .filter((_, i) => args[i - 1] === flag)
        .find((v) => v.startsWith(prefix));
    expect(args.slice(0, 4)).toEqual(['--task', 'gen', '--family', 'yue2']);
    expect(args[args.indexOf('--model') + 1]).toBe('/models/yue2');
    expect(args[args.indexOf('--threads') + 1]).toBe('4');
    expect(args[args.indexOf('--lyrics') + 1]).toBe('la la');
    expect(option('--request-option', 'style=')).toBe('style=upbeat pop');
    expect(option('--request-option', 'cot=')).toBe('cot=full');
    expect(option('--request-option', 'seed=')).toBe('seed=42');
    expect(option('--request-option', 'semantic_max_tokens=')).toBe(
      'semantic_max_tokens=2250',
    );
    expect(option('--request-option', 'num_inference_steps=')).toBeUndefined();
    // 相对于模型根，不是绝对路径：引擎拒绝绝对路径
    expect(option('--session-option', 'yue2.model_gguf=')).toBe(`yue2.model_gguf=${YUE.music!.files.model}`);
    expect(option('--session-option', 'yue2.vae_gguf=')).toBe(`yue2.vae_gguf=${YUE.music!.files.vae}`);
    expect(args[args.indexOf('--out-dir') + 1]).toBe('/staging');
    expect(args[args.indexOf('--out') + 1]).toBe(MUSIC_OUTPUT_FILE);
    expect(args).toContain('--log');
    expect(args).not.toContain('--backend');

    const instrumental = musicEngineRunOf(
      { ...musicSelfTestParameters(), lyrics: 'ignored' as never },
      YUE.music!,
      {
        modelDir: '/m',
        staging: '/s',
        threads: 1,
        backend: 'metal',
        steps: MUSIC_SELF_TEST.steps,
      },
    );
    expect(instrumental.args[instrumental.args.indexOf('--lyrics') + 1]).toBe(
      '',
    );
    expect(instrumental.args).toContain(
      `num_inference_steps=${MUSIC_SELF_TEST.steps}`,
    );
    expect(instrumental.args.slice(-2)).toEqual(['--backend', 'metal']);
    expect(instrumental.semanticMaxTokens).toBe(
      MUSIC_SELF_TEST.maxDurationSec * 25,
    );
  });

  it.each([0.01, 1, 4, 7.96, 8, 10, 120])('bounds the semantic minimum within a %s-second budget without increasing the maximum', (maxDurationSec) => {
    const run = musicEngineRunOf(
      { ...musicSelfTestParameters(), maxDurationSec },
      YUE.music!,
      { modelDir: '/models/yue2', staging: '/staging', threads: 1 },
    );
    const options = run.args.filter((_, i) => run.args[i - 1] === '--request-option');
    const maximum = Math.max(1, Math.round(maxDurationSec * 25));
    expect(options).toContain(`semantic_max_tokens=${maximum}`);
    expect(options).toContain(`semantic_min_tokens=${Math.min(200, maximum)}`);
    expect(run.semanticMaxTokens).toBe(maximum);
  });

  it('环境变量名固定', () => {
    expect(AUDIO_CPP_CLI_ENV).toBe('BAOCUT_AUDIOCPP_CLI');
  });
});

describe('提交时的检查', () => {
  const model = (extra: Partial<MusicModelInfo> = {}): MusicModelInfo => ({
    ...localMusicModelInfo(YUE, status, true, '/opt/audiocpp_cli'),
    ...extra,
  });
  const choice = (
    info: MusicModelInfo = model(),
  ): ModelChoice<'generateMusic'> => ({
    capability: 'generateMusic',
    providerId: 'local',
    modelId: info.modelId,
    kind: 'local',
    label: info.label,
    source: 'user-default',
    model: info,
  });
  const base: GenerateMusicRequest = {
    mode: 'instrumental',
    style: 'calm piano',
  };
  const reject = (request: GenerateMusicRequest, info?: MusicModelInfo) => {
    try {
      musicParameters(choice(info), request, 1);
    } catch (error) {
      expect(error).toBeInstanceOf(RpcError);
      return (error as RpcError).code;
    }
    throw new Error('expected a rejection');
  };

  it('纯音乐不带歌词：时长缺省取模型的默认值，编排取模型默认，格式 wav，seed 是调用方冻结的', () => {
    expect(musicParameters(choice(), base, 99)).toEqual({
      capability: 'generateMusic',
      mode: 'instrumental',
      style: 'calm piano',
      lyrics: null,
      targetDurationSec: null,
      maxDurationSec: 120,
      planning: 'melody',
      format: 'wav',
      seed: 99,
    });
  });

  it('歌曲要歌词；给了目标时长没给上限时上限等于目标；步数在范围内才进冻结参数', () => {
    const song = musicParameters(
      choice(),
      {
        mode: 'song',
        style: 's',
        lyrics: 'verse',
        targetDurationSec: 45,
        planning: 'off',
        steps: 8,
      },
      3,
    );
    expect(song).toMatchObject({
      mode: 'song',
      lyrics: 'verse',
      targetDurationSec: 45,
      maxDurationSec: 45,
      planning: 'off',
      steps: 8,
    });
    expect(reject({ mode: 'song', style: 's' })).toBe('invalid-request');
    expect(reject({ mode: 'song', style: 's', lyrics: '   ' })).toBe(
      'invalid-request',
    );
    expect(reject({ ...base, lyrics: 'x' })).toBe('invalid-request');
    expect(reject({ ...base, steps: 0 })).toBe('invalid-request');
    expect(reject({ ...base, steps: 7.5 })).toBe('invalid-request');
  });

  it('风格空或超长、歌词超长、时长出范围或目标超过上限、不支持的模式或编排、格式不对：拒绝', () => {
    expect(reject({ ...base, style: '  ' })).toBe('invalid-request');
    expect(reject({ ...base, style: 'x'.repeat(2001) })).toBe(
      'invalid-request',
    );
    expect(reject({ mode: 'song', style: 's', lyrics: 'x'.repeat(4001) })).toBe(
      'invalid-request',
    );
    expect(reject({ ...base, maxDurationSec: 301 })).toBe('invalid-request');
    expect(reject({ ...base, maxDurationSec: 0 })).toBe('invalid-request');
    expect(
      reject({ ...base, targetDurationSec: 100, maxDurationSec: 50 }),
    ).toBe('invalid-request');
    expect(
      reject(
        { ...base, planning: 'full' },
        model({
          local: {
            ...model().local!,
            planning: { options: ['off'], default: 'off' },
          },
        }),
      ),
    ).toBe('invalid-request');
    expect(
      reject(
        { mode: 'song', style: 's', lyrics: 'l' },
        model({ modes: ['instrumental'] }),
      ),
    ).toBe('invalid-request');
    expect(reject({ ...base, format: 'mp3' })).toBe('invalid-request');
  });
});

describe('自检', () => {
  it('固定输入：几秒纯音乐、不编排、少步数、固定 seed；冻结参数与正式提交同形', () => {
    expect(MUSIC_SELF_TEST).toMatchObject({
      mode: 'instrumental',
      maxDurationSec: 8,
      seed: 7,
      steps: 4,
    });
    expect(musicSelfTestParameters()).toEqual({
      capability: 'generateMusic',
      mode: 'instrumental',
      style: MUSIC_SELF_TEST.style,
      lyrics: null,
      targetDurationSec: null,
      maxDurationSec: 8,
      planning: 'off',
      format: 'wav',
      seed: 7,
    });
  });

  it('判定与语音合成同一套：有声的 WAV 通过并给出时长与采样率；不是 WAV、静音不通过', () => {
    const ok = musicSelfTestVerdict(wav({ seconds: 2, rate: 44_100 }));
    expect(ok).toMatchObject({ passed: true, wav: { sampleRate: 44_100 } });
    expect(
      (ok as { wav: { durationSec: number } }).wav.durationSec,
    ).toBeCloseTo(2, 2);
    expect(musicSelfTestVerdict(Buffer.from('not a wav'))).toMatchObject({
      passed: false,
    });
    expect(
      musicSelfTestVerdict(wav({ seconds: 2, sample: () => 0 })),
    ).toMatchObject({ passed: false });
  });
});

/** 在模型目录里写一个合成的仓库：几个小文件和与之相符的清单。 */
async function writeRepo(
  root: string,
  repo: string,
  revision: string,
  files: Record<string, string>,
): Promise<void> {
  const dir = path.join(root, ...repo.split('/'));
  await fs.mkdir(dir, { recursive: true });
  const entries = [];
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, name), content);
    entries.push({
      path: name,
      size: Buffer.byteLength(content),
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
      source_verified: true,
    });
  }
  await fs.writeFile(
    path.join(dir, MANIFEST_FILE),
    JSON.stringify({
      format_version: 1,
      repo,
      revision,
      source: 'https://huggingface.co',
      files: entries,
    }),
  );
}

/** 合成一段 16 位单声道 WAV：`sample(i)` 是 -1..1 的样本。 */
function wav(options: {
  seconds: number;
  rate?: number;
  sample?: (i: number) => number;
}): Buffer {
  const {
    seconds,
    rate = 24_000,
    sample = (i) => Math.sin(i / 10) * 0.25,
  } = options;
  const frames = Math.round(seconds * rate);
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++)
    data.writeInt16LE(Math.round(sample(i) * 32_767), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
