import { describe, expect, it } from 'vitest';
import type { JobRecord, ModelBundleStatus, ModelsDirInfo, ModelsDirInspection } from '@baocut/protocol';
import { appliedText, changePlan, dirBlocker, dirHealth, dirStats, moveProgressView, pickedMode, shortenDir } from './models-dir.ts';

const GB = 1024 ** 3;
const MB = 1024 ** 2;

function job(patch: Partial<JobRecord>): JobRecord {
  return {
    jobId: 'job_1',
    kind: 'transcribe',
    state: 'running',
    phase: 'transcribing',
    progress: null,
    videoId: null,
    assetId: null,
    assetRevision: null,
    contentHash: 'sha256:0',
    providerId: 'local',
    modelId: 'asr',
    bundleId: 'asr',
    inputHash: 'sha256:0',
    submitter: { kind: 'app' },
    attempt: 1,
    createdAt: '2026-10-03T10:00:00.000Z',
    updatedAt: '2026-10-03T10:00:00.000Z',
    startedAt: null,
    endedAt: null,
    error: null,
    result: null,
    warnings: [],
    ...patch,
  } as JobRecord;
}

const info: ModelsDirInfo = {
  path: '/Volumes/ExtremeSSD/BaoCut/models',
  source: 'setting',
  defaultPath: '/Users/me/Library/Application Support/BaoCut/models',
  exists: true,
  writable: true,
  usedBytes: 3 * GB,
  freeBytes: 812 * GB,
  modelCount: 3,
  moveJobId: null,
  moveTo: null,
};

const inspection: ModelsDirInspection = {
  path: '/Volumes/Backup/models',
  exists: true,
  writable: true,
  freeBytes: 100 * GB,
  problem: null,
  found: { repos: [], bundleIds: ['a', 'b'], bytes: 2 * GB },
  current: { repos: [], bundleIds: ['c'], bytes: 4 * GB },
  move: { requiredBytes: 4 * GB, sameVolume: false, fits: true },
};

describe('模型目录', () => {
  it('长路径中间省略：主目录缩成 ~，保留开头与结尾，最后一段不省', () => {
    expect(shortenDir('/Volumes/ExtremeSSD/BaoCut/models')).toBe('/Volumes/ExtremeSSD/BaoCut/models');
    expect(shortenDir('/Users/me/Library/Application Support/BaoCut/models')).toBe('~/Library/Application Support/BaoCut/models');
    expect(shortenDir('/Users/me/Library/Application Support/BaoCut/models', 30)).toBe('~/Library/…/BaoCut/models');
    expect(shortenDir('/a/very/long/path/with/many/segments/and-a-really-long-final-folder-name', 20)).toBe('…/and-a-really-long…');
  });

  it('Windows 路径：用 \\ 拼回去，盘符算开头的一段，最后一段不省', () => {
    expect(shortenDir('C:\\Users\\me\\AppData\\Roaming\\BaoCut\\models')).toBe('~\\AppData\\Roaming\\BaoCut\\models');
    expect(shortenDir('C:\\Users\\me\\AppData\\Roaming\\BaoCut\\models', 20)).toBe('~\\AppData\\…\\models');
    expect(shortenDir('D:\\Models\\baocut')).toBe('D:\\Models\\baocut');
    expect(shortenDir('D:\\Media Library\\Projects\\2026\\Client Work\\BaoCut\\models')).toBe('D:\\Media Library\\…\\BaoCut\\models');
    expect(shortenDir('D:\\Media Library\\Projects\\2026\\Client Work\\BaoCut\\models', 30)).toBe('D:\\Media Library\\…\\models');
    expect(shortenDir('\\\\nas\\share\\Video Archive\\2026\\BaoCut\\models', 30)).toBe('\\\\nas\\share\\…\\BaoCut\\models');
    expect(shortenDir('D:\\a\\very\\long\\path\\with\\many\\segments\\and-a-really-long-final-folder-name', 20)).toBe(
      '…\\and-a-really-long…',
    );
  });

  it('卡片副题与目录本身的问题', () => {
    expect(dirStats(info)).toBe('已用 3.0 GB · 所在磁盘可用 812.0 GB · 已识别 3 个模型');
    expect(dirStats({ ...info, freeBytes: null, modelCount: 0, usedBytes: 0 })).toBe('已用 1 KB · 已识别 0 个模型');
    expect(dirHealth(info)).toBeNull();
    expect(dirHealth({ ...info, exists: false })).toContain('外置盘');
    expect(dirHealth({ ...info, writable: false })).toContain('写入权限');
  });

  it('在用本地模型的任务让更改暂时不可用：下载、检查、带模型包的任务；在线任务与结束的不算', () => {
    const bundles = [{ bundleId: 'asr', label: 'Qwen3-ASR 0.6B' } as ModelBundleStatus];
    expect(dirBlocker([], bundles)).toBeNull();
    expect(dirBlocker([job({ state: 'completed' }), job({ bundleId: null, providerId: 'openai' })], bundles)).toBeNull();
    const block = dirBlocker(
      [
        job({ jobId: 'i', kind: 'modelInstall', state: 'queued' }),
        job({ jobId: 't', kind: 'modelTest', bundleId: 'tts' }),
        job({ jobId: 'x' }),
        job({ jobId: 'm', kind: 'modelsMove', bundleId: null }),
      ],
      bundles,
    );
    expect(block).toEqual({
      text: '正在下载 Qwen3-ASR 0.6B，正在检查 tts，1 个任务在用本地模型。等它们结束后再更改，否则文件会在使用中被搬走。',
      jobIds: ['x'],
      hasTasks: true,
    });
    expect(dirBlocker([job({ kind: 'modelInstall' })], bundles)?.hasTasks).toBe(false);
  });

  it('确认框：选的文件夹不能用时说明原因', () => {
    expect(changePlan({ ...inspection, problem: 'missing' })).toMatchObject({ kind: 'error', title: '找不到这个文件夹' });
    expect(changePlan({ ...inspection, problem: 'not-writable' })).toMatchObject({ kind: 'error', title: '这个文件夹不可写' });
    expect(changePlan({ ...inspection, problem: 'nested' })).toMatchObject({ kind: 'error' });
    expect(changePlan({ ...inspection, problem: 'same' })).toEqual({ kind: 'same' });
  });

  it('确认框：当前目录里没有模型时直接切换，只说新位置里有什么', () => {
    const plan = changePlan({ ...inspection, current: { repos: [], bundleIds: [], bytes: 0 } });
    expect(plan).toEqual({ kind: 'direct', found: '发现 2 个已下载的模型（2.0 GB），可以直接使用。 所在磁盘可用 100.0 GB。' });
    expect(pickedMode(plan, 'move')).toBe('switch');
    const empty = changePlan({
      ...inspection,
      found: { repos: [], bundleIds: [], bytes: 0 },
      current: { repos: [], bundleIds: [], bytes: 0 },
    });
    expect(empty).toMatchObject({ kind: 'direct', found: expect.stringContaining('还没有模型') });
  });

  it('确认框：当前目录里有模型时在移过去与只切换之间选；放不下时移过去不可选', () => {
    const plan = changePlan(inspection);
    expect(plan).toMatchObject({
      kind: 'choose',
      move: { disabled: false, description: '要移动 4.0 GB，移完后原位置不再保留这些文件。' },
      switchDescription: '原位置的文件保留，不删除。只有新位置里已有的 2 个模型可用，其余显示为未安装。',
    });
    expect(pickedMode(plan, 'move')).toBe('move');
    expect(pickedMode(plan, 'switch')).toBe('switch');
    const same = changePlan({ ...inspection, move: { requiredBytes: 4 * GB, sameVolume: true, fits: true } });
    expect(same).toMatchObject({ move: { description: expect.stringContaining('同一块盘') } });
    const tight = changePlan({ ...inspection, freeBytes: 3 * GB, move: { requiredBytes: 4 * GB, sameVolume: false, fits: false } });
    expect(tight).toMatchObject({ move: { disabled: true, description: '要移动 4.0 GB，目标盘只有 3.0 GB 可用，还差 1.0 GB，放不下。' } });
    expect(pickedMode(tight, 'move')).toBe('switch');
  });

  it('更改之后的提示', () => {
    expect(appliedText('switch', '/x/models', true, false)).toBe('模型目录已改为 /x/models · 原位置的文件保留');
    expect(appliedText('switch', '/x/models', false, false)).toBe('模型目录已改为 /x/models');
    expect(appliedText('move', '/x/models', true, true)).toBe('开始把模型移到 /x/models');
  });

  it('移动进度：按字节；排队、完成阶段不伪造百分比', () => {
    expect(moveProgressView(undefined, '/x')).toEqual({ percent: null, label: '等待开始移动到 /x…' });
    const moving = job({ kind: 'modelsMove', phase: 'moving', progress: { done: 256 * MB, total: GB, unit: 'bytes' } });
    expect(moveProgressView(moving, '/x')).toEqual({ percent: 25, label: '正在移动 256 MB / 1.0 GB 到 /x…' });
    expect(moveProgressView({ ...moving, phase: 'validating' }, null).label).toBe('正在校验复制过去的文件（256 MB / 1.0 GB）…');
    expect(moveProgressView({ ...moving, phase: 'publishing' }, '/x')).toEqual({ percent: null, label: '正在完成移动…' });
  });
});
