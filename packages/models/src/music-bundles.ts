import type { ModelLicense } from '@baocut/protocol';
import { ModelsMusicBundles as M } from '@baocut/protocol/messages/models/music-bundles.ts';
import type { BundleDefinition } from './bundle-registry.ts';
import { AUDIO_CPP_COMMAND } from './audio-cpp-engine.ts';

/**
 * 本地音乐生成的模型包（架构设计 §6.3）。`bundleId` 是 `<模型>@<backend>-<量化>`。权重是 YuE2 的 GGUF 转换版，由 audio.cpp 引擎
 * （`audiocpp_cli`，随应用内置，见 `audio-cpp-engine.ts`）执行，不经 Model Worker：主模型、VAE 与分词表同在一个仓库里，整个仓库是
 * 一个 `music` 组件，只下载清单（`repo-manifests.ts`）里列出的 Q8 主模型、F16 VAE 与配置文件，仓库里别的量化（Q4、BF16、F32 VAE）
 * 不下载。
 *
 * 引擎按构建选设备（macOS 上 Metal，Windows 与 Linux 是 Vulkan 或 CPU），所以登记的 `device` 是 `auto`；全平台列出，主机没有内置
 * 引擎时模型包报告为 `unsupported`。
 */

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

/** 引擎可执行文件名（不带后缀）。 */
export const AUDIO_CPP_ENGINE = AUDIO_CPP_COMMAND;

const YUE2_LICENSE: ModelLicense = {
  name: 'CC-BY-NC-4.0',
  url: 'https://huggingface.co/audio-cpp/Yue2-3B-GGUF/blob/main/model_licenses.md',
  commercialUse: false,
  // 许可摘要给人看：用 getter，读的时候（列出状态、序列化过线）按当前语言生成。
  get summary() {
    return M.yue2License().text;
  },
};

/** 引擎的语义 token 帧率：YuE2 每秒 25 个语义 token（上游 `semantic_max_tokens` 的换算依据）。 */
export const YUE2_SEMANTIC_TOKENS_PER_SEC = 25;

export const YUE2_3B_Q8: BundleDefinition = {
  bundleId: 'yue2-3b@audio-cpp-q8',
  capability: 'music',
  backend: 'audio-cpp',
  device: 'auto',
  components: {
    music: { family: 'yue2', repo: 'audio-cpp/Yue2-3B-GGUF', revision: 'cca74d8980c00f30ab8d52248a367c01ad633ec2' },
  },
  label: 'YuE2 3B',
  license: YUE2_LICENSE,
  music: {
    family: 'yue2',
    engine: AUDIO_CPP_ENGINE,
    modes: ['song', 'instrumental'],
    maxStyleChars: 2000,
    maxLyricsChars: 4000,
    // 上游默认生成约两分钟；更长的段落按比例更慢，上限先定五分钟。
    maxDurationSec: 300,
    defaultDurationSec: 120,
    semanticTokensPerSec: YUE2_SEMANTIC_TOKENS_PER_SEC,
    sampleRate: 44100,
    planning: { options: ['off', 'melody', 'full'], default: 'melody' },
    // 上游 CLI 的 `num_inference_steps` 默认 8。
    steps: { min: 1, max: 50, step: 1, default: 8 },
    lyricLanguages: 'unverified',
    files: { model: 'yue2-3b-q8_0.gguf', vae: 'yue2-vae-f16.gguf' },
    // 上游在 RTX 5090 上实测 Q8 加 F16 VAE 的显存峰值约 8867 MiB；留到 10 GiB 容抖动。没有在这个仓库里重新测量。
    peakBytes: 10 * GiB,
    peakEstimated: true,
    slow: true,
  },
};

export const MUSIC_BUNDLES: readonly BundleDefinition[] = [YUE2_3B_Q8];
