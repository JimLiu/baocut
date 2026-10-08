import type { ModelLicense } from '@baocut/protocol';
import { ModelsImageBundles as M } from '@baocut/protocol/messages/models/image-bundles.ts';
import type { BundleDefinition } from './bundle-registry.ts';

/**
 * 本地文生图的模型包（架构设计 §6.3）。`bundleId` 是 `<模型>@<backend>-<量化>`。仓库、版本与文件清单（`repo-manifests.ts`）
 * 与旧版 BaoCut 为同一版本固定的一致。
 *
 * Qwen-Image-2.1 的文本编码器、DiT 与 VAE 在一个仓库里，整个仓库是一个 `image` 组件；三段顺序运行、逐层流式读入、从不同时
 * 驻留，所以 Model Worker 的峰值远小于权重总量（约 10 GB），资源调度按 `image.peakBytes`（实测）计，不按权重估计。MLX 的
 * 只在 Apple Silicon 上列出，别的平台列 candle 的变体（`platformBundles`）。
 */

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

const QWEN_IMAGE_LICENSE: ModelLicense = {
  name: 'Qwen RESEARCH LICENSE AGREEMENT',
  url: 'https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/LICENSE',
  commercialUse: false,
  // 许可摘要给人看：用 getter，读的时候（列出状态、序列化过线）按当前语言生成。
  get summary() {
    return M.qwenImageLicense().text;
  },
};

/**
 * 宽高比与默认像素尺寸：长边 1024，短边按比例取 32 的倍数（与旧版的尺寸规则相同）。第一个是默认尺寸。
 * Worker 认的是更宽的规则（32 的倍数、长边 ≤ 1536、长短边之比 ≤ 3），这里只列界面与请求能选的几档。
 */
export const QWEN_IMAGE_ASPECTS: ReadonlyArray<{ ratio: string; size: string }> = [
  { ratio: '1:1', size: '1024x1024' },
  { ratio: '16:9', size: '1024x576' },
  { ratio: '9:16', size: '576x1024' },
  { ratio: '4:3', size: '1024x768' },
  { ratio: '3:4', size: '768x1024' },
  { ratio: '2.35:1', size: '1024x448' },
];

const QWEN_IMAGE_MLX: BundleDefinition = {
  bundleId: 'qwen-image-2.1@mlx-4bit',
  capability: 'image',
  backend: 'mlx',
  device: 'metal',
  components: {
    image: { family: 'qwen-image', repo: 'mlx-community/Qwen-Image-2.1-MLX-4bit', revision: '4db4e8c0c0e7a1debf0320415bec8388e888494c' },
  },
  label: 'Qwen-Image-2.1',
  license: QWEN_IMAGE_LICENSE,
  image: {
    family: 'qwen-image',
    aspects: QWEN_IMAGE_ASPECTS,
    extraSizes: ['512x512'],
    maxPromptChars: 1024,
    // 设计稿 image-gen.jsx 的「步数」：8–40，一次加减 4，默认 20。
    steps: { min: 8, max: 40, step: 4, default: 20 },
    // 实测 Model Worker 的进程峰值（phys_footprint）：256² 约 0.7 GB、1024² 约 1.0 GB（MLX 峰值 0.94 GB）；旧版同一管线
    // 512² 约 0.8 GB。留到 2 GiB 容更大的尺寸（长边至多 1536）与抖动。
    peakBytes: 2 * GiB,
    slow: true,
  },
};

/**
 * candle 后端的同一个模型包（架构设计 §6.5）：同一个 MLX 4-bit 仓库，用到时逐个矩阵反量化（与旧版相同），只在 Apple Silicon
 * 以外的平台列出。CPU 上以 f32 计算，CUDA 上以 bf16。CPU 上很慢：1024² 二十步约三小时（实测见 §6.5）。
 */
const QWEN_IMAGE_CANDLE: BundleDefinition = {
  ...QWEN_IMAGE_MLX,
  bundleId: 'qwen-image-2.1@candle',
  backend: 'candle',
  device: 'cpu',
  image: {
    ...QWEN_IMAGE_MLX.image!,
    // CPU 上算 f32，计在进程内存。本机实测进程峰值（phys_footprint）：256² 2.4 GB、1024² 4.7 GB（出在 VAE 解码；DiT 那段
    // 3.3 GB，逐层反量化的矩阵约 0.9 GB 加注意力的分块）。常驻集还算上映射的权重页（1024² 4.9 GB），那部分是文件缓存、可回收，
    // 不计。留到 6 GiB 容长边 1536 的尺寸与抖动。
    peakBytes: 6 * GiB,
    // CUDA 上算 bf16，计在显存：本机没有 CUDA；旧版同一管线实测 1024×576 整卡峰值 3.57 GiB（含桌面约 1.2 GB），1024² 未测。
    devicePeakBytes: { cuda: 4 * GiB },
  },
};

export const IMAGE_BUNDLES: readonly BundleDefinition[] = [QWEN_IMAGE_MLX, QWEN_IMAGE_CANDLE];
