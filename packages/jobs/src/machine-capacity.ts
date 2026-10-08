import { promises as fs } from 'node:fs';
import os from 'node:os';
import type { ResourceCapacity, ResourceCapacitySetting } from '@baocut/protocol';

/**
 * 机器的容量（架构设计 §7.6、§7.7、§9.6）：只用 Node 标准库。
 *
 * - 内存：`os.totalmem()`；CPU 线程：`os.availableParallelism()`。
 * - GPU 内存：Apple 芯片是统一内存，GPU 能用的按内存的 2/3（32 GiB 以上按 3/4）估计，GPU 的需求同时计入内存；
 *   其余机器没有不加依赖的查法，报告未知、不按它准入（§9.6「未知时报告未知」）。
 * - 磁盘：staging 所在卷的可用空间（`fs.statfs`），后台刷新，准入只读缓存的值。
 * - 偏好设置 `resources.capacity` 可以覆盖内存、GPU 内存与线程数（某项为 null 时照旧自动）。
 */

/** 调度读容量的来源：`current()` 同步给出最近的值；`refresh()` 重新探测会变的部分（磁盘）。 */
export interface CapacitySource {
  current(): ResourceCapacity;
  refresh?(): Promise<void>;
}

export interface SystemFacts {
  platform: NodeJS.Platform;
  arch: string;
  totalMemory: number;
  cpuThreads: number;
}

export interface MachineCapacityOptions {
  /** staging 目录：按它所在的卷算磁盘。不给时磁盘未知。 */
  scratchDir?: string;
  /** 偏好设置的覆盖（每次读都重新取，改了设置立即生效）。 */
  override?: () => ResourceCapacitySetting | null;
  /** 测试注入：替换操作系统给出的事实。 */
  system?: Partial<SystemFacts>;
}

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

export function systemFacts(): SystemFacts {
  return { platform: process.platform, arch: process.arch, totalMemory: os.totalmem(), cpuThreads: os.availableParallelism() };
}

/** 统一内存的机器上 GPU 能用的量（估计）：32 GiB 及以下按 2/3，以上按 3/4。 */
export function unifiedGpuEstimate(totalMemory: number): number {
  return Math.floor(totalMemory <= 32 * GiB ? (totalMemory * 2) / 3 : (totalMemory * 3) / 4);
}

export class MachineCapacity implements CapacitySource {
  readonly #options: MachineCapacityOptions;
  readonly #system: SystemFacts;
  #scratchFree: number | null = null;

  constructor(options: MachineCapacityOptions = {}) {
    this.#options = options;
    this.#system = { ...systemFacts(), ...options.system };
  }

  current(): ResourceCapacity {
    const system = this.#system;
    const override = safeOverride(this.#options.override);
    const unified = system.platform === 'darwin' && system.arch === 'arm64';
    const memory = override?.memoryMiB != null ? override.memoryMiB * MiB : system.totalMemory;
    const gpuMemory = override?.gpuMemoryMiB != null ? override.gpuMemoryMiB * MiB : unified ? unifiedGpuEstimate(memory) : null;
    const cpuThreads = override?.cpuThreads != null ? override.cpuThreads : system.cpuThreads;
    return {
      memory,
      gpuMemory,
      cpuThreads,
      scratchDisk: this.#scratchFree,
      unifiedMemory: unified,
      sources: {
        memory: override?.memoryMiB != null ? 'setting' : 'system',
        gpuMemory: override?.gpuMemoryMiB != null ? 'setting' : unified ? 'unified-estimate' : 'unknown',
        cpuThreads: override?.cpuThreads != null ? 'setting' : 'system',
        scratchDisk: this.#scratchFree === null ? 'unknown' : 'statfs',
      },
    };
  }

  async refresh(): Promise<void> {
    const dir = this.#options.scratchDir;
    if (!dir) return;
    try {
      await fs.mkdir(dir, { recursive: true });
      const stats = await fs.statfs(dir);
      this.#scratchFree = stats.bavail * stats.bsize;
    } catch {
      this.#scratchFree = null;
    }
  }
}

/** 读设置出错（还没打开、文件坏了）时当作没有覆盖。 */
function safeOverride(read: (() => ResourceCapacitySetting | null) | undefined): ResourceCapacitySetting | null {
  try {
    return read?.() ?? null;
  } catch {
    return null;
  }
}
