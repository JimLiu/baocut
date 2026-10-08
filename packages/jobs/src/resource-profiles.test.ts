import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ResourceCapacity, ResourcePriority } from '@baocut/protocol';
import { IMAGE_BUNDLES, ModelCatalog, requiredSources, weightBytes, type WorkerFootprint } from '@baocut/models';
import { unifiedGpuEstimate } from './machine-capacity.ts';
import {
  MODEL_WORKER_DEMAND,
  defaultReserves,
  localImageResources,
  localTranscribeResources,
  modelWorkerDemand,
  modelWorkerHolder,
} from './resource-profiles.ts';
import { ResourceScheduler } from './resource-scheduler.ts';

const GiB = 1024 * 1024 * 1024;

/** 按默认预留：这个模型包的 Model Worker 能不能被准入。统一内存的 Mac 有 GPU 的估计；别的机器不知道 GPU 有多少。 */
function admitted(
  bundleId: string,
  footprint: WorkerFootprint | null,
  totalMemory: number,
  priority: ResourcePriority,
  unified = true,
): boolean {
  const capacity: ResourceCapacity = {
    memory: totalMemory,
    gpuMemory: unified ? unifiedGpuEstimate(totalMemory) : null,
    cpuThreads: 8,
    scratchDisk: null,
    unifiedMemory: unified,
    sources: { memory: 'system', gpuMemory: unified ? 'unified-estimate' : 'unknown', cpuThreads: 'system', scratchDisk: 'unknown' },
  };
  const scheduler = new ResourceScheduler({ capacity: { current: () => capacity }, reserves: defaultReserves });
  return scheduler.check({ owner: 'job', label: 'model', priority, ...localTranscribeResources(bundleId, footprint) }) === null;
}

const noModels = path.join(os.tmpdir(), 'baocut-no-such-models-dir');

describe('Model Worker 的需求', () => {
  it('GPU 上的常驻量计 GPU 内存，CPU 上的计内存；都是加 1 GiB，至少固定值；不知道时用固定值', () => {
    expect(MODEL_WORKER_DEMAND).toEqual({ memory: 1 * GiB, gpuMemory: 2 * GiB, cpuThreads: 2 });
    expect(modelWorkerDemand(null)).toEqual(MODEL_WORKER_DEMAND);
    expect(modelWorkerDemand({ bytes: 0.5 * GiB, pool: 'gpuMemory' })).toEqual(MODEL_WORKER_DEMAND);
    expect(modelWorkerDemand({ bytes: 4 * GiB, pool: 'gpuMemory' })).toEqual({ ...MODEL_WORKER_DEMAND, gpuMemory: 5 * GiB });
    expect(modelWorkerDemand({ bytes: 4 * GiB, pool: 'memory' })).toEqual({ memory: 5 * GiB, gpuMemory: 0, cpuThreads: 2 });
    expect(modelWorkerDemand({ bytes: 0, pool: 'memory' })).toEqual({ memory: 1 * GiB, gpuMemory: 0, cpuThreads: 2 });
    expect(localTranscribeResources('a@mlx', { bytes: 4 * GiB, pool: 'gpuMemory' }).holder).toEqual({
      id: modelWorkerHolder('a@mlx'),
      demand: { ...MODEL_WORKER_DEMAND, gpuMemory: 5 * GiB },
    });
    expect(localTranscribeResources('a@mlx').holder.demand).toEqual(MODEL_WORKER_DEMAND);
  });

  it('Apple Silicon：识别与分离模型包按权重估计（分离按文件的两倍），8 GiB 的 Mac 也放得下；合成模型包仍是原来的固定需求', async () => {
    // 模型目录是空的：可选组件都没装。
    const catalog = new ModelCatalog({ root: noModels, platform: 'darwin', arch: 'arm64' });
    for (const def of catalog.definitions()) {
      const footprint = await catalog.workerFootprint(def.bundleId);
      const demand = localTranscribeResources(def.bundleId, footprint).holder.demand;
      // 识别与已有转写的说话人区分（单独加载「说话人区分」模型包）都按必需组件的权重估计。
      if (def.capability === 'transcribe' || def.capability === 'diarize') {
        expect(footprint, def.bundleId).toEqual({ bytes: weightBytes(requiredSources(def)), pool: 'gpuMemory' });
        expect(await catalog.workerWeightBytes(def.bundleId), def.bundleId).toBe(footprint!.bytes);
        expect(demand.gpuMemory, def.bundleId).toBeGreaterThanOrEqual(MODEL_WORKER_DEMAND.gpuMemory!);
      } else if (def.capability === 'separate') {
        expect(footprint, def.bundleId).toEqual({ bytes: 2 * weightBytes(requiredSources(def))!, pool: 'gpuMemory' });
        expect(await catalog.workerWeightBytes(def.bundleId), def.bundleId).toBe(footprint!.bytes);
      } else {
        expect(footprint, def.bundleId).toBeNull();
        expect(demand, def.bundleId).toEqual({ memory: 1 * GiB, gpuMemory: 2 * GiB, cpuThreads: 2 });
      }
      for (const total of [8 * GiB, 16 * GiB]) {
        for (const priority of ['background', 'interactive'] as const) {
          expect(admitted(def.bundleId, footprint, total, priority), `${def.bundleId} ${total / GiB} GiB ${priority}`).toBe(true);
        }
      }
    }
    const large = await catalog.workerFootprint('qwen3-asr-1.7b@mlx-8bit');
    expect(localTranscribeResources('qwen3-asr-1.7b@mlx-8bit', large).holder.demand.gpuMemory).toBeGreaterThan(3.2 * GiB);
  });

  it('candle：CPU 上按参数个数 × 4 计在内存，CUDA 上按 × 2 计在 GPU 内存；16 GiB 的机器放得下 0.6B 与 MOSS', async () => {
    const catalog = new ModelCatalog({ root: noModels, platform: 'linux', arch: 'x64' });
    const cpu = (await catalog.workerFootprint('qwen3-asr-0.6b@candle'))!;
    // Qwen3-ASR 0.6B 与 Silero：约 7.8 亿参数，f32 约 3.1 GB（实测加载后约 3.7 GiB，含解码缓冲）。
    expect(cpu).toEqual({ bytes: (782_426_112 + 309_121) * 4, pool: 'memory' });
    expect(localTranscribeResources('qwen3-asr-0.6b@candle', cpu).holder.demand).toEqual({
      memory: cpu.bytes + 1 * GiB,
      gpuMemory: 0,
      cpuThreads: 2,
    });
    for (const bundleId of ['qwen3-asr-0.6b@candle', 'moss-transcribe-diarize@candle']) {
      const footprint = await catalog.workerFootprint(bundleId);
      expect(admitted(bundleId, footprint, 16 * GiB, 'background', false), bundleId).toBe(true);
    }
    // 1.7B 在 CPU 上约 8 GB：8 GiB 的机器放不下。
    const large = await catalog.workerFootprint('qwen3-asr-1.7b@candle');
    expect(large!.bytes).toBeGreaterThan(8 * GiB * 0.9);
    expect(admitted('qwen3-asr-1.7b@candle', large, 8 * GiB, 'background', false)).toBe(false);

    catalog.setWorkerDevice('candle', 'cuda');
    expect(await catalog.workerFootprint('qwen3-asr-0.6b@candle')).toEqual({ bytes: (782_426_112 + 309_121) * 2, pool: 'gpuMemory' });
    expect((await catalog.status('qwen3-asr-0.6b@candle'))!.device).toBe('cuda');
  });

  it('GGML：Whisper 权重按存储字节、加 candle 上的 VAD；CPU 上计在内存，CUDA 或 Vulkan 上计在 GPU 内存；8 GiB 的机器放得下', async () => {
    const catalog = new ModelCatalog({ root: noModels, platform: 'win32', arch: 'x64' });
    for (const [bundleId, mib] of [
      ['whisper-large-v3@ggml', 1031],
      ['whisper-large-v3-turbo@ggml', 834],
    ] as const) {
      const footprint = (await catalog.workerFootprint(bundleId))!;
      expect(footprint, bundleId).toEqual({ bytes: mib * 1024 * 1024 + 309_121 * 4, pool: 'memory' });
      expect(admitted(bundleId, footprint, 8 * GiB, 'background', false), bundleId).toBe(true);
    }
    catalog.setWorkerDevice('ggml', 'vulkan');
    expect((await catalog.workerFootprint('whisper-large-v3-turbo@ggml'))!.pool).toBe('gpuMemory');
    expect((await catalog.status('whisper-large-v3-turbo@ggml'))!.device).toBe('vulkan');
    // CUDA 安装包的 Worker 报 `cuda`：同样计在 GPU 内存。
    catalog.setWorkerDevice('ggml', 'cuda');
    expect((await catalog.workerFootprint('whisper-large-v3-turbo@ggml'))!.pool).toBe('gpuMemory');
    expect((await catalog.status('whisper-large-v3-turbo@ggml'))!.device).toBe('cuda');
  });

  it('文生图按登记的峰值计 Model Worker（至少固定需求），不按约 10 GB 的权重；8 GiB 的 Mac 也放得下', () => {
    const def = IMAGE_BUNDLES[0]!;
    const catalog = new ModelCatalog({ root: noModels, platform: 'darwin', arch: 'arm64' });
    const resources = localImageResources(def.bundleId, catalog.imagePeak(def.bundleId));
    expect(resources.holder).toEqual({
      id: modelWorkerHolder(def.bundleId),
      demand: { ...MODEL_WORKER_DEMAND, gpuMemory: def.image!.peakBytes },
    });
    expect(resources.demand).toEqual({ scratchDisk: 64 * 1024 * 1024 });
    expect(localImageResources('x', null).holder.demand).toEqual(MODEL_WORKER_DEMAND);
    expect(localImageResources('x', { bytes: 6 * GiB, pool: 'gpuMemory' }).holder.demand.gpuMemory).toBe(6 * GiB);
    // 峰值已含激活：不像识别那样另加 1 GiB。
    expect(localImageResources('x', { bytes: 0.5 * GiB, pool: 'gpuMemory' }).holder.demand).toEqual(MODEL_WORKER_DEMAND);
    const capacity: ResourceCapacity = {
      memory: 8 * GiB,
      gpuMemory: unifiedGpuEstimate(8 * GiB),
      cpuThreads: 8,
      scratchDisk: null,
      unifiedMemory: true,
      sources: { memory: 'system', gpuMemory: 'unified-estimate', cpuThreads: 'system', scratchDisk: 'unknown' },
    };
    const scheduler = new ResourceScheduler({ capacity: { current: () => capacity }, reserves: defaultReserves });
    for (const priority of ['background', 'interactive'] as const) {
      expect(scheduler.check({ owner: 'job', label: 'image', priority, ...resources }), priority).toBeNull();
    }
  });

  it('candle 的文生图在 CPU 上按峰值计内存、不占 GPU 内存，在 CUDA 上计 GPU 内存；16 GiB 的机器放得下，8 GiB 的后台放不下', () => {
    const candle = IMAGE_BUNDLES.find((b) => b.backend === 'candle')!;
    const catalog = new ModelCatalog({ root: noModels, platform: 'win32', arch: 'x64' });
    const cpu = localImageResources(candle.bundleId, catalog.imagePeak(candle.bundleId));
    expect(cpu.holder.demand).toEqual({ memory: candle.image!.peakBytes, gpuMemory: 0, cpuThreads: 2 });
    catalog.setWorkerDevice('candle', 'cuda');
    expect(localImageResources(candle.bundleId, catalog.imagePeak(candle.bundleId)).holder.demand).toEqual({
      ...MODEL_WORKER_DEMAND,
      gpuMemory: candle.image!.devicePeakBytes!.cuda,
    });
    // 非统一内存、不知道 GPU 有多少：系统预留 25%（至少 2 GiB），交互预留 1 GiB。
    const check = (totalMemory: number, priority: ResourcePriority) => {
      const capacity: ResourceCapacity = {
        memory: totalMemory,
        gpuMemory: null,
        cpuThreads: 8,
        scratchDisk: null,
        unifiedMemory: false,
        sources: { memory: 'system', gpuMemory: 'unknown', cpuThreads: 'system', scratchDisk: 'unknown' },
      };
      const scheduler = new ResourceScheduler({ capacity: { current: () => capacity }, reserves: defaultReserves });
      return scheduler.check({ owner: 'job', label: 'image', priority, ...cpu }) === null;
    };
    for (const priority of ['background', 'interactive'] as const) expect(check(16 * GiB, priority), priority).toBe(true);
    // 8 GiB：后台只剩 5 GiB，放不下；交互不扣交互预留，剩 6 GiB，刚好放下。
    expect(check(8 * GiB, 'background')).toBe(false);
    expect(check(8 * GiB, 'interactive')).toBe(true);
  });
});
