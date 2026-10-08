import { describe, expect, it } from 'vitest';
import type { ResourcesSnapshot } from '@baocut/protocol';
import { autoPlaceholder, capacityForm, capacityRows, capacitySetting, demandLine, sameCapacity } from './resource-capacity.ts';

const GiB = 1024 ** 3;
const zero = { memory: 0, gpuMemory: 0, cpuThreads: 0, scratchDisk: 0 };

const snapshot = (patch: Partial<ResourcesSnapshot> = {}): ResourcesSnapshot => ({
  capacity: {
    memory: 16 * GiB,
    gpuMemory: (16 * GiB * 2) / 3,
    cpuThreads: 10,
    scratchDisk: 200 * GiB,
    unifiedMemory: true,
    sources: { memory: 'system', gpuMemory: 'unified-estimate', cpuThreads: 'system', scratchDisk: 'statfs' },
  },
  reserves: { system: zero, interactive: zero },
  leased: { memory: 2 * GiB, gpuMemory: 0, cpuThreads: 4, scratchDisk: 0 },
  available: { interactive: zero, background: { memory: 9.6 * GiB, gpuMemory: 6 * GiB, cpuThreads: 4, scratchDisk: 180 * GiB } },
  leases: [],
  holders: [],
  waiting: [],
  ...patch,
});

describe('资源调度', () => {
  it('每个维度一行：容量、来源、正在用、后台还能用；统一内存说明 GPU 计入内存', () => {
    const rows = capacityRows(snapshot());
    expect(rows.map((r) => [r.label, r.total])).toEqual([
      ['内存', '16.0 GB'],
      ['GPU 内存', '10.7 GB'],
      ['CPU 线程', '10 线程'],
      ['临时磁盘空间', '200 GB'],
    ]);
    expect(rows[0]!.desc).toBe('系统探测 · 正在用 2.0 GB · 后台任务还能用 9.6 GB');
    expect(rows[1]!.desc).toBe('按统一内存估计 · 与内存共用，GPU 的用量同时计入内存 · 后台任务还能用 6.0 GB');
    expect(rows[2]!.desc).toBe('系统探测 · 正在用 4 线程 · 后台任务还能用 4 线程');
  });

  it('未知的维度不写用量；手动设定的标出来', () => {
    const s = snapshot();
    const rows = capacityRows({
      ...s,
      capacity: {
        ...s.capacity,
        gpuMemory: null,
        scratchDisk: null,
        unifiedMemory: false,
        sources: { ...s.capacity.sources, gpuMemory: 'unknown', scratchDisk: 'unknown', memory: 'setting' },
      },
    });
    expect(rows[1]).toMatchObject({ total: '未知', desc: '未知', overridden: false });
    expect(rows[3]).toMatchObject({ total: '未知', desc: '未知' });
    expect(rows[0]!.overridden).toBe(true);
    expect(rows[0]!.desc).toMatch(/^手动设定 · /);
  });

  it('一项工作的量', () => {
    expect(demandLine({ memory: 2 * GiB, cpuThreads: 4 })).toBe('内存 2.0 GB、CPU 线程 4 线程');
    expect(demandLine({})).toBe('不占本机资源');
  });

  it('表单按 GB 填、存成 MiB；三项都空时整个设置为 null', () => {
    expect(capacityForm(null)).toEqual({ memoryGB: null, gpuMemoryGB: null, cpuThreads: null });
    expect(capacityForm({ memoryMiB: 12288, gpuMemoryMiB: null, cpuThreads: 6 })).toEqual({ memoryGB: 12, gpuMemoryGB: null, cpuThreads: 6 });
    expect(capacitySetting({ memoryGB: 12.5, gpuMemoryGB: null, cpuThreads: 6 })).toEqual({ memoryMiB: 12800, gpuMemoryMiB: null, cpuThreads: 6 });
    expect(capacitySetting({ memoryGB: null, gpuMemoryGB: NaN, cpuThreads: null })).toBeNull();
    expect(sameCapacity(null, { memoryMiB: null, gpuMemoryMiB: null, cpuThreads: null })).toBe(true);
    expect(sameCapacity(null, { memoryMiB: 512, gpuMemoryMiB: null, cpuThreads: null })).toBe(false);
  });

  it('留空时的占位写自动探测到的值', () => {
    expect(autoPlaceholder(snapshot(), 'memoryGB')).toBe('自动（16.0）');
    expect(autoPlaceholder(snapshot(), 'gpuMemoryGB')).toBe('自动（10.7）');
    expect(autoPlaceholder(snapshot(), 'cpuThreads')).toBe('自动（10）');
    expect(autoPlaceholder(null, 'cpuThreads')).toBe('自动');
  });
});
