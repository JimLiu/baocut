import { randomInt } from 'node:crypto';
import path from 'node:path';

import type { GenerationParameters, ModelBundleStatus, MusicModelInfo } from '@baocut/protocol';
import { ModelsLocalMusic as M } from '@baocut/protocol/messages/models/local-music.ts';
import type { BundleDefinition, MusicBundleProfile } from './bundle-registry.ts';
import { MUSIC_OUTPUT_FILE } from './worker-contract.ts';

/**
 * 本地音乐生成（架构设计 §6.1、§6.3）：模型包的描述、提交时冻结的 seed，与冻结参数到 audio.cpp 引擎命令行的换算。
 * 内置引擎（`audiocpp_cli`）每个任务起一个进程，读模型包目录里的 GGUF，把 WAV 写进 staging；没有 Model Worker 参与。
 */

export type MusicParameters = Extract<GenerationParameters, { capability: 'generateMusic' }>;

/** audio.cpp 0.9.3's default semantic EOS floor; shorter budgets must lower it too. */
const YUE2_SEMANTIC_MIN_TOKENS = 200;

/**
 * `generateMusic` 的模型描述：歌曲与纯音乐、只出 WAV、接受 seed 与步数；上限来自模型包登记的特性。`engine` 是内置引擎的可执行
 * 文件（找不到时 null，模型整体不可用；模型目录同样把模型包报告为 `unsupported`，说明在模型包状态的 `detail` 里）。
 */
export function localMusicModelInfo(def: BundleDefinition, status: ModelBundleStatus, usable: boolean, engine: string | null): MusicModelInfo {
  const profile = def.music!;
  return {
    modelId: def.bundleId,
    label: def.label,
    modes: [...profile.modes],
    maxStyleChars: profile.maxStyleChars,
    maxLyricsChars: profile.maxLyricsChars,
    maxDurationSec: profile.maxDurationSec,
    defaultDurationSec: profile.defaultDurationSec,
    formats: ['wav'],
    defaultFormat: 'wav',
    acceptsSeed: true,
    cost: 'free-local',
    available: usable && engine !== null,
    local: {
      family: profile.family,
      engine: { id: profile.engine, executable: engine },
      sampleRate: profile.sampleRate,
      lyricLanguages: profile.lyricLanguages === 'unverified' ? 'unverified' : [...profile.lyricLanguages],
      planning: { options: [...profile.planning.options], default: profile.planning.default },
      steps: { ...profile.steps },
      slow: profile.slow,
      license: def.license!,
    },
    ...(profile.slow ? { notes: M.slowLocal().text } : {}),
    ...((!usable || engine === null) && status.detail
      ? { detail: status.detail, ...(status.detailRef ? { detailRef: status.detailRef } : {}) }
      : {}),
  };
}

/**
 * 本地音乐的 seed 在提交时冻结：请求没给时在这里抽一个（`0..2^32-1`）。重试与重新执行用同一个，同一台机器上得到同一段。
 */
export function localMusicSeed(seed: number | undefined | null): number {
  return seed ?? randomInt(0, 2 ** 32);
}

/** `maxDurationSec` → 引擎的语义 token 上限（整数，至少 1）。 */
export function semanticMaxTokens(maxDurationSec: number, profile: Pick<MusicBundleProfile, 'semanticTokensPerSec'>): number {
  return Math.max(1, Math.round(maxDurationSec * profile.semanticTokensPerSec));
}

export interface MusicEngineRun {
  /** 引擎的命令行参数（不含可执行文件）。 */
  args: string[];
  /** 输出文件（绝对路径，在 staging 里）。 */
  output: string;
  /** 交给引擎的 token 上限（判断有没有撞上限）。 */
  semanticMaxTokens: number;
}

/**
 * 冻结的参数 → audio.cpp 引擎的命令行（上游 `audiocpp_cli --task gen --family yue2`）。纯音乐是空歌词；编排是 `cot`；时长没有直接的
 * 参数，按语义帧率换成 `semantic_max_tokens`；同时把引擎的 200 token 下限夹到这个上限内，避免短请求的采样上下限冲突。
 * 步数取冻结的 `steps`，没有时取调用方给的（模型包自检用少步数出一小段），都没有时不传（引擎用默认值）。
 * `backend` 不给时由引擎按构建自己选。
 */
export function musicEngineRunOf(
  parameters: MusicParameters,
  profile: MusicBundleProfile,
  options: { modelDir: string; staging: string; threads: number; backend?: string | null; steps?: number | null },
): MusicEngineRun {
  const tokens = semanticMaxTokens(parameters.maxDurationSec, profile);
  const steps = parameters.steps ?? options.steps ?? null;
  const args = [
    '--task',
    'gen',
    '--family',
    profile.family,
    '--model',
    options.modelDir,
    '--threads',
    String(options.threads),
    '--lyrics',
    parameters.mode === 'instrumental' ? '' : (parameters.lyrics ?? ''),
    '--request-option',
    `style=${parameters.style}`,
    '--request-option',
    `cot=${parameters.planning}`,
    '--request-option',
    `seed=${parameters.seed}`,
    '--request-option',
    `semantic_min_tokens=${Math.min(YUE2_SEMANTIC_MIN_TOKENS, tokens)}`,
    '--request-option',
    `semantic_max_tokens=${tokens}`,
    ...(steps !== null ? ['--request-option', `num_inference_steps=${steps}`] : []),
    // 引擎要求 GGUF 的路径相对于 `--model` 给的模型根（绝对路径被拒：`yue2.model_gguf must be relative to the Yue2 model root`）。
    '--session-option',
    `${profile.family}.model_gguf=${profile.files.model}`,
    '--session-option',
    `${profile.family}.vae_gguf=${profile.files.vae}`,
    '--out-dir',
    options.staging,
    '--out',
    MUSIC_OUTPUT_FILE,
    '--log',
  ];
  if (options.backend) args.push('--backend', options.backend);
  return { args, output: path.join(options.staging, MUSIC_OUTPUT_FILE), semanticMaxTokens: tokens };
}
