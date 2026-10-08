import type { WorkerFootprint } from '@baocut/models';
import type { ResourceAmounts, ResourceCapacity, ResourceDemand } from '@baocut/protocol';

/**
 * 各种重任务的峰值需求与预留（架构设计 §7.7）：集中在这一处。都是保守的初始估计，没有经过基准测量，
 * 待按真实机器校准（架构设计 §14「租约的公平性与资源估计」）。字节数一律是 bytes。
 */

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

/**
 * 一个 Model Worker 进程（一个模型包，§6.5）：模型权重、推理的激活与解码缓冲。进程活着就一直计入，不论有没有任务在用。
 * 不知道权重多大时用这个固定值，也是按权重估计的下限。
 */
export const MODEL_WORKER_DEMAND: ResourceDemand = { memory: 1 * GiB, gpuMemory: 2 * GiB, cpuThreads: 2 };

/**
 * 按模型包加载后的常驻量（`ModelCatalog.workerFootprint`）估计 Model Worker 的需求，常驻量加 1 GiB（推理的激活与解码缓冲）：
 *
 * - 计在 GPU 内存（MLX、Core ML、candle 的 CUDA、GGML 的 CUDA 或 Vulkan）：GPU 内存是常驻量加 1 GiB，至少 `MODEL_WORKER_DEMAND`；
 *   进程自己的内存仍是 1 GiB（统一内存上 GPU 的量同时计入内存）。MLX 实测加载后常驻的量与权重相当
 *   （Qwen3-ASR 0.6B 约 0.71 GB、1.7B 约 2.46 GB）。
 * - 计在内存（candle 或 GGML 在 CPU 上）：内存是常驻量加 1 GiB，至少 1 GiB；不占 GPU 内存。
 * - 分离模型包的权重存成 16 位、加载时升成 32 位，常驻量按文件的两倍算（HTDemucs-FT 实测 673 MB 对 336 MB）。
 *
 * `footprint` 为 null（不知道多大）时用固定值。
 */
export function modelWorkerDemand(footprint: WorkerFootprint | null): ResourceDemand {
  if (footprint === null) return MODEL_WORKER_DEMAND;
  if (footprint.pool === 'memory') {
    return {
      ...MODEL_WORKER_DEMAND,
      memory: Math.max(MODEL_WORKER_DEMAND.memory ?? 0, Math.round(footprint.bytes + 1 * GiB)),
      gpuMemory: 0,
    };
  }
  const gpuMemory = Math.max(MODEL_WORKER_DEMAND.gpuMemory ?? 0, Math.round(footprint.bytes + 1 * GiB));
  return { ...MODEL_WORKER_DEMAND, gpuMemory };
}

/** 一次本地转写自己的 staging：解出的音频与分段结果（Worker 进程的量另计在 holder 上）。 */
export const LOCAL_TRANSCRIBE_DEMAND: ResourceDemand = { scratchDisk: 512 * MiB };

/**
 * 一次本地分离自己的量（Worker 进程的另计在 holder 上）：Worker 把整条音轨解成 44.1 kHz 立体声 32 位浮点、两路输出也在内存里，
 * staging 是两路 16 位 WAV 与补齐时长的副本。按半小时的素材估（解出的音频约 0.6 GB，三份约 1.9 GB），待按真实素材校准。
 */
export const LOCAL_SEPARATE_DEMAND: ResourceDemand = { memory: 2 * GiB, scratchDisk: 2 * GiB };

/**
 * 本地文生图（含模型包自检）：任务自己的 staging（一张 PNG），加上（还没有进程时）这个模型包的 Model Worker。生图的三段权重
 * 逐层流式读入、从不同时驻留，Worker 的需求按模型包登记的实测峰值（`peak` 见 `ModelCatalog.imagePeak`）计，不按权重总量，
 * 也不另加激活的余量（峰值已含）：
 *
 * - 计在 GPU 内存（MLX、candle 的 CUDA）：GPU 内存是峰值，至少 `MODEL_WORKER_DEMAND`；进程自己的内存仍是 1 GiB。
 * - 计在内存（candle 在 CPU 上）：内存是峰值，至少 1 GiB；不占 GPU 内存。
 *
 * `peak` 为 null（不是登记过的文生图模型包）时用固定值。
 */
export function localImageResources(
  bundleId: string,
  peak: WorkerFootprint | null,
): { demand: ResourceDemand; holder: { id: string; demand: ResourceDemand } } {
  let worker: ResourceDemand = MODEL_WORKER_DEMAND;
  if (peak?.pool === 'memory') {
    worker = { ...MODEL_WORKER_DEMAND, memory: Math.max(MODEL_WORKER_DEMAND.memory ?? 0, peak.bytes), gpuMemory: 0 };
  } else if (peak) {
    worker = { ...MODEL_WORKER_DEMAND, gpuMemory: Math.max(MODEL_WORKER_DEMAND.gpuMemory ?? 0, peak.bytes) };
  }
  return { demand: LOCAL_IMAGE_DEMAND, holder: { id: modelWorkerHolder(bundleId), demand: worker } };
}

/** 一次本地生图自己的 staging：一张 PNG（1536² RGBA 不压缩也不到 10 MiB）加余量。 */
export const LOCAL_IMAGE_DEMAND: ResourceDemand = { scratchDisk: 64 * MiB };

/** 成片导出同时活跃的帧数（Render Worker 的帧窗口与编码器的缓冲，§9.6）。 */
const VIDEO_FRAME_WINDOW = 48;
/** 成片导出的 staging 余量：每段的中间文件、日志与校验。 */
const STAGING_SLACK = 64 * MiB;

/** 一个模型包的 Model Worker 在调度里的 holder：同一个模型包的任务先后共用这个进程，量只计一次。 */
export function modelWorkerHolder(bundleId: string): string {
  return `model-worker:${bundleId}`;
}

/**
 * 本地转写与合成（含模型包自检）：任务自己的 staging，加上（还没有进程时）这个模型包的 Model Worker。识别与 candle 的合成
 * 按它加载后的常驻量估计（`footprint` 见 `ModelCatalog.workerFootprint`）；MLX 的合成不给 `footprint`，用固定值。
 */
export function localTranscribeResources(
  bundleId: string,
  footprint: WorkerFootprint | null = null,
): { demand: ResourceDemand; holder: { id: string; demand: ResourceDemand } } {
  return { demand: LOCAL_TRANSCRIBE_DEMAND, holder: { id: modelWorkerHolder(bundleId), demand: modelWorkerDemand(footprint) } };
}

/**
 * 本地分离（翻译配音的分离一步）：这一步自己的量，加上（还没有进程时）分离模型包的 Model Worker，按它加载后的常驻量
 * （`ModelCatalog.workerWeightBytes`，已按文件的两倍算）估计；分离只有 MLX 的模型包，常驻量计在 GPU 内存。不知道用哪个模型包时
 * （旧的冻结参数）只算这一步自己的。
 */
export function localSeparateResources(
  bundleId: string | null,
  weightBytes: number | null,
): { demand: ResourceDemand; holder?: { id: string; demand: ResourceDemand } } {
  if (bundleId === null) return { demand: LOCAL_SEPARATE_DEMAND };
  const footprint: WorkerFootprint | null = weightBytes === null ? null : { bytes: weightBytes, pool: 'gpuMemory' };
  return { demand: LOCAL_SEPARATE_DEMAND, holder: { id: modelWorkerHolder(bundleId), demand: modelWorkerDemand(footprint) } };
}

/**
 * 成片导出（Render Worker 加 ffmpeg 编码）：基础 1.5 GiB 加帧窗口的 RGBA 帧；4 个线程；staging 是编码输出（码率不知道时
 * 按每像素 0.1 bit 估）的 1.5 倍，加上混音的 wav；开了响度标准化时再加母带的三份 32 位中间文件。
 */
export function videoExportDemand(input: {
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  bitrateKbps: number | null;
  audioBitrateKbps: number;
  sampleRate: number;
  channels: number;
  loudness?: boolean;
}): ResourceDemand {
  const frameBytes = input.width * input.height * 4;
  const kbps = input.bitrateKbps ?? Math.max(2_000, (input.width * input.height * input.fps * 0.1) / 1_000);
  const encoded = (input.durationSec * (kbps + input.audioBitrateKbps) * 1_000) / 8;
  const wav = input.durationSec * input.sampleRate * input.channels * (input.loudness ? 2 + 4 * 3 : 2);
  return {
    memory: Math.round(1.5 * GiB + frameBytes * VIDEO_FRAME_WINDOW),
    cpuThreads: 4,
    scratchDisk: Math.round(encoded * 1.5 + wav + STAGING_SLACK),
  };
}

/**
 * 音频导出（ffmpeg 混音、响度母带与编码）：512 MiB、2 个线程；staging 是 32 位中间文件的两倍，开了响度标准化时再加母带的
 * 三份（两轮的中间结果与写出的 PCM），不知道时长时按 1 GiB。
 */
export function audioExportDemand(input: {
  durationSec: number | null;
  sampleRate: number;
  channels: number;
  loudness?: boolean;
}): ResourceDemand {
  const copies = input.loudness ? 2 + 3 : 2;
  const scratch = input.durationSec === null ? 1 * GiB : input.durationSec * input.sampleRate * input.channels * 4 * copies + STAGING_SLACK;
  return { memory: 512 * MiB, cpuThreads: 2, scratchDisk: Math.round(scratch) };
}

/** 文件转码（ffmpeg 重新编码或合并）：1 GiB、4 个线程；staging 按输入总大小的 1.2 倍。 */
export function transcodeDemand(inputBytes: number): ResourceDemand {
  return { memory: 1 * GiB, cpuThreads: 4, scratchDisk: Math.round(inputBytes * 1.2 + STAGING_SLACK) };
}

/** 模型下载与校验：256 MiB、1 个线程；staging 是还要下载的字节数（暂停过的部分已经在盘上）。 */
export function modelDownloadDemand(remainingBytes: number): ResourceDemand {
  return { memory: 256 * MiB, cpuThreads: 1, scratchDisk: Math.round(remainingBytes + STAGING_SLACK) };
}

/** 预留：`system` 留给系统与其他应用，谁都不用；`interactive` 留给交互操作，后台任务不用（§7.6「前台预览优先」）。 */
export interface ResourceReserves {
  system: ResourceAmounts;
  interactive: ResourceAmounts;
}

/**
 * 按容量算预留：系统留内存的 25%（至少 2 GiB）、4 个线程以上时留 1 个线程、磁盘留 1 GiB；交互留 1 GiB 内存、512 MiB GPU 内存、
 * 线程数的四分之一（至多 2 个）。
 */
export function defaultReserves(capacity: ResourceCapacity): ResourceReserves {
  return {
    system: {
      memory: Math.max(2 * GiB, Math.round(capacity.memory * 0.25)),
      gpuMemory: capacity.gpuMemory === null ? null : 0,
      cpuThreads: capacity.cpuThreads >= 4 ? 1 : 0,
      scratchDisk: capacity.scratchDisk === null ? null : 1 * GiB,
    },
    interactive: {
      memory: 1 * GiB,
      gpuMemory: capacity.gpuMemory === null ? null : 512 * MiB,
      cpuThreads: Math.min(2, Math.floor(capacity.cpuThreads / 4)),
      scratchDisk: capacity.scratchDisk === null ? null : 0,
    },
  };
}
