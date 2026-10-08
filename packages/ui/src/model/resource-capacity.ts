import { live, type ResourceCapacity, type ResourceCapacitySetting, type ResourceDemand, type ResourceDimension, type ResourcesSnapshot } from '@baocut/protocol';
import { M } from './resource-capacity-copy.ts';
import { formatBytes } from './space.ts';

/**
 * 设置 → 诊断里的「资源调度」（架构设计 §7.6、§7.7；设计稿没有这一块）：读 `jobs.resources` 说清机器的容量从哪来、
 * 后台任务此刻还能用多少、谁在用、谁在等；偏好设置 `resources.capacity` 可以覆盖内存、GPU 内存与 CPU 线程数，
 * 某一项留空就照旧自动探测。磁盘不能覆盖（按 staging 所在卷的可用空间）。
 */

const MiB = 1024 * 1024;

const SOURCE_LABEL: Record<ResourceCapacity['sources'][ResourceDimension], string> = live(() => M.sources);

const DIMENSION_LABEL: Record<ResourceDimension, string> = live(() => M.dimensions);

/** 内存与 GPU 内存一律按 GB 取一位小数，与覆盖框的单位和占位一致；临时磁盘照常换算单位。 */
function amount(dimension: ResourceDimension, value: number | null): string {
  if (value === null) return M.unknown;
  if (dimension === 'cpuThreads') return M.threads(value);
  if (dimension === 'scratchDisk') return formatBytes(value);
  return `${(value / 1024 / MiB).toFixed(1)} GB`;
}

export interface CapacityRow {
  dimension: ResourceDimension;
  label: string;
  /** 「16 GB」「10 线程」「未知」。 */
  total: string;
  /** 来源 · 已租出 · 后台还能用；统一内存时 GPU 那行说明同时计入内存。 */
  desc: string;
  /** 来源是手动设定。 */
  overridden: boolean;
}

/** 四个维度各一行：容量、来源、已经租出去的、后台任务此刻还能用的。 */
export function capacityRows(snapshot: ResourcesSnapshot): CapacityRow[] {
  const { capacity, leased, available } = snapshot;
  return (['memory', 'gpuMemory', 'cpuThreads', 'scratchDisk'] as const).map((dimension) => {
    const total = capacity[dimension];
    const facts = [SOURCE_LABEL[capacity.sources[dimension]]];
    if (dimension === 'gpuMemory' && capacity.unifiedMemory) facts.push(M.unifiedMemory);
    if (total !== null) {
      if (leased[dimension]) facts.push(M.inUse(amount(dimension, leased[dimension])));
      facts.push(M.backgroundAvailable(amount(dimension, available.background[dimension])));
    }
    return {
      dimension,
      label: DIMENSION_LABEL[dimension],
      total: amount(dimension, total),
      desc: facts.join(' · '),
      overridden: capacity.sources[dimension] === 'setting',
    };
  });
}

/** 一项工作占的量：「内存 2.0 GB、CPU 4 线程」；什么都不占时「不占本机资源」。 */
export function demandLine(demand: ResourceDemand): string {
  const parts = (['memory', 'gpuMemory', 'cpuThreads', 'scratchDisk'] as const)
    .filter((d) => demand[d])
    .map((d) => M.demandPart(DIMENSION_LABEL[d], amount(d, demand[d] ?? 0)));
  return parts.length ? M.joinDemand(parts) : M.noDemand;
}

/** 表单：内存与 GPU 内存按 GB 填（可带一位小数），线程数是整数；null 是「自动」。 */
export interface CapacityForm {
  memoryGB: number | null;
  gpuMemoryGB: number | null;
  cpuThreads: number | null;
}

export const CAPACITY_LIMITS = {
  /** 设置的下限是 512 MiB。 */
  memoryGB: { min: 0.5, max: 16 * 1024 },
  gpuMemoryGB: { min: 0, max: 16 * 1024 },
  cpuThreads: { min: 1, max: 4096 },
} as const;

const toGB = (mib: number | null) => (mib === null ? null : Math.round((mib / 1024) * 10) / 10);
const toMiB = (gb: number | null) => (gb === null || Number.isNaN(gb) ? null : Math.round(gb * 1024));

export function capacityForm(setting: ResourceCapacitySetting | null): CapacityForm {
  return { memoryGB: toGB(setting?.memoryMiB ?? null), gpuMemoryGB: toGB(setting?.gpuMemoryMiB ?? null), cpuThreads: setting?.cpuThreads ?? null };
}

/** 写回设置的值：三项都自动时整个设置为 null。 */
export function capacitySetting(form: CapacityForm): ResourceCapacitySetting | null {
  const threads = form.cpuThreads === null || Number.isNaN(form.cpuThreads) ? null : Math.round(form.cpuThreads);
  const setting = { memoryMiB: toMiB(form.memoryGB), gpuMemoryMiB: toMiB(form.gpuMemoryGB), cpuThreads: threads };
  return setting.memoryMiB === null && setting.gpuMemoryMiB === null && setting.cpuThreads === null ? null : setting;
}

/** 两份设置是不是同一个值（null 与三项全空视为相同）。 */
export function sameCapacity(a: ResourceCapacitySetting | null, b: ResourceCapacitySetting | null): boolean {
  const x = capacitySetting(capacityForm(a));
  const y = capacitySetting(capacityForm(b));
  return x?.memoryMiB === y?.memoryMiB && x?.gpuMemoryMiB === y?.gpuMemoryMiB && x?.cpuThreads === y?.cpuThreads;
}

/** 自动探测时这一项的值（覆盖框的占位）：手动设定过的项不知道系统值，写「自动」。 */
export function autoPlaceholder(snapshot: ResourcesSnapshot | null, key: keyof CapacityForm): string {
  if (!snapshot) return M.auto;
  const { capacity } = snapshot;
  if (key === 'memoryGB') return capacity.sources.memory === 'system' ? M.autoWith((capacity.memory / 1024 / MiB).toFixed(1)) : M.auto;
  if (key === 'gpuMemoryGB')
    return capacity.sources.gpuMemory === 'unified-estimate' && capacity.gpuMemory !== null
      ? M.autoWith((capacity.gpuMemory / 1024 / MiB).toFixed(1))
      : M.auto;
  return capacity.sources.cpuThreads === 'system' ? M.autoWith(String(capacity.cpuThreads)) : M.auto;
}
