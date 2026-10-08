import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { BaoCutClient } from '@baocut/client';
import type { DownloadedFontFace, FontFamilyStatus, FontSampleResult, FontsUsageResult, Id, JobRecord } from '@baocut/protocol';
import { batchFamilies, canDownload, familyKey, liveFontJobs, pushRecent, type FontBatch } from '../model/font-library.ts';
import { jobLive } from '../model/task-list.ts';
import { useJobs } from './jobs-store.ts';
import { recentOf } from './home-templates-store.ts';

/**
 * 字体库的状态（产品设计 §5.9「字体」；架构设计 §9.1；原型 font-library-store.jsx）：选字框、字体条、导出面板与
 * 设置 › 字体共用。权威在 Runtime：族的状态来自 `fonts.catalogue`，视频用到的来自 `fonts.usage`，进度来自 `jobs`
 * 主题里的 `fontDownload` 任务；这里只缓存与推进请求，任务结束时按族重新取状态。算的东西在 model/font-library.ts。
 */

type Client = Pick<BaoCutClient, 'request'>;

/** 一页取多少（`fonts.catalogue` 的上限）。 */
const PAGE = 500;

export type SampleState = { state: 'loading' } | { state: 'ready'; css: string } | { state: 'none' };

interface FontLibraryState {
  /** 族的状态（按 `familyKey`）与 Runtime 给的次序（上次整表取的时候）。 */
  statuses: Record<string, FontFamilyStatus>;
  order: string[];
  loaded: boolean;
  /** 打开着的视频用到的字体（`fonts.usage`，整部视频：字幕算在内）。 */
  usage: Record<Id, FontsUsageResult>;
  /** 导出面板这一次导出用到的字体（`fonts.usage` 带上「烧录字幕」的选择），按 `exportUsageKey`。 */
  exportUsage: Record<string, FontsUsageResult>;
  /** 打开视频的那一批（字体条）。 */
  batch: FontBatch | null;
  samples: Record<string, SampleState>;
  downloaded: { faces: DownloadedFontFace[]; totalBytes: number; inUse: string[] } | null;
}

export const useFontLibrary = create<FontLibraryState>()(() => ({
  statuses: {},
  order: [],
  loaded: false,
  usage: {},
  exportUsage: {},
  batch: null,
  samples: {},
  downloaded: null,
}));

/** 最近用过的族（这台电脑上记着，原型的 recent）。 */
export const useFontRecent = create<{ recent: string[]; use(family: string): void }>()(
  persist(
    (set) => ({
      recent: [],
      use: (family) => set((s) => ({ recent: pushRecent(s.recent, family) })),
    }),
    {
      name: 'baocut.fontRecent',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ recent: s.recent }),
      merge: (persisted, current) => ({ ...current, recent: recentOf(persisted) }),
    },
  ),
);

function putStatuses(list: readonly FontFamilyStatus[], appendOrder = false): void {
  useFontLibrary.setState((s) => {
    const statuses = { ...s.statuses };
    const order = appendOrder ? [...s.order] : s.order;
    for (const status of list) {
      const key = familyKey(status.family);
      if (appendOrder && !(key in statuses)) order.push(key);
      statuses[key] = status;
    }
    return { statuses, order };
  });
}

let loading: Promise<void> | null = null;

/** 整表（约两千个族，按页取）。取过之后只按族刷新；`force` 时重取（次序按 Runtime 的新次序）。 */
export function loadCatalogue(client: Client, force = false): Promise<void> {
  if (useFontLibrary.getState().loaded && !force) return Promise.resolve();
  loading ??= (async () => {
    try {
      const all: FontFamilyStatus[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const page = await client.request('fonts.catalogue', { offset, limit: PAGE });
        all.push(...page.families);
        if (page.families.length < PAGE || all.length >= page.total) break;
      }
      useFontLibrary.setState((s) => ({
        statuses: { ...s.statuses, ...Object.fromEntries(all.map((f) => [familyKey(f.family), f])) },
        order: all.map((f) => familyKey(f.family)),
        loaded: true,
      }));
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** 按族重新取状态（任务结束、下载开始、导出在下载时）。 */
export async function refreshFamilies(client: Client, families: readonly string[]): Promise<void> {
  const unique = [...new Set(families.map((f) => f.trim()).filter(Boolean))];
  for (let i = 0; i < unique.length; i += 200) {
    const { families: list } = await client.request('fonts.catalogue', { families: unique.slice(i, i + 200) });
    putStatuses(
      list.filter((f) => f.state !== 'unavailable' || familyKey(f.family) in useFontLibrary.getState().statuses),
      true,
    );
  }
}

/** 手动下载（点下载、重试、选中一个还没下载的族）：不看自动下载的开关。返回这次有没有开始下载。 */
export async function downloadFamily(client: Client, family: string): Promise<boolean> {
  const result = await client.request('fonts.download', { family });
  putStatuses([result.status], true);
  return result.jobId !== null;
}

/** 在下载这个族的任务（`fontDownload`）。 */
function liveJobOf(family: string): JobRecord | undefined {
  return liveFontJobs(useJobs.getState().jobs).get(familyKey(family));
}

/** 取消一个族的下载：Runtime 记为 `CANCELLED`（列表上是「已取消」）。导出任务里的下载随导出取消，这里不管。 */
export async function cancelFamily(client: Client, family: string): Promise<void> {
  const job = liveJobOf(family) ?? null;
  const jobId = job?.jobId ?? useFontLibrary.getState().statuses[familyKey(family)]?.job?.jobId ?? null;
  if (!jobId) return;
  try {
    await client.request('jobs.cancel', { jobId });
  } finally {
    await refreshFamilies(client, [family]).catch(() => {});
  }
}

/** 选中一个族：记进最近用过；还没下载（或上次失败、取消）的开始下载。返回开始下载的族的状态，没开始时 null。 */
export async function chooseFamily(client: Client, family: string): Promise<FontFamilyStatus | null> {
  useFontRecent.getState().use(family);
  const status = useFontLibrary.getState().statuses[familyKey(family)];
  if (!status || !canDownload(status) || liveJobOf(family)) return null;
  const started = await downloadFamily(client, family);
  return started ? (useFontLibrary.getState().statuses[familyKey(family)] ?? status) : null;
}

// ---- 视频 ----

/**
 * 打开视频：Runtime 清点用到的字体（`fonts.usage`，`download: true`：还没下载的按自动下载的规则开始下载，十分钟内失败过
 * 的不自动重试），字体条记下这一批。自动下载关着时这一批等用户点「下载」。
 */
export async function openVideoFonts(client: Client, videoId: Id, autoDownload: boolean): Promise<void> {
  const usage = await client.request('fonts.usage', { videoId, download: true });
  putStatuses(
    usage.families.map((f) => f.status),
    true,
  );
  const families = batchFamilies(usage.families);
  useFontLibrary.setState((s) => ({
    usage: { ...s.usage, [videoId]: usage },
    batch: families.length
      ? { videoId, families, mode: autoDownload || usage.started.length > 0 ? 'auto' : 'off', skipped: [], dismissed: false }
      : s.batch?.videoId === videoId
        ? null
        : s.batch,
  }));
}

/** 再清点一次（导出面板打开时；不下载）。 */
export async function refreshUsage(client: Client, videoId: Id): Promise<void> {
  const usage = await client.request('fonts.usage', { videoId });
  putStatuses(
    usage.families.map((f) => f.status),
    true,
  );
  useFontLibrary.setState((s) => ({ usage: { ...s.usage, [videoId]: usage } }));
}

/** 导出面板的清点按（视频，烧不烧字幕）各记一份：来回切换时晚到的回应不会盖掉当前选择的那一份。 */
export const exportUsageKey = (videoId: Id, burnCaptions: boolean) => `${videoId}\u0000${burnCaptions ? 'burn' : 'plain'}`;

/**
 * 导出面板（视频页）的清点：与这次导出同一套参数（`burnCaptions`；序列与导出一样用根序列），不下载。字幕不烧进画面时
 * 只给字幕用的族不在清单里。记在 `exportUsage`，不动整部视频的 `usage`（选字框的「这个视频里用到」与字体条读它）。
 */
export async function refreshExportUsage(client: Client, videoId: Id, burnCaptions: boolean): Promise<void> {
  const usage = await client.request('fonts.usage', { videoId, burnCaptions });
  putStatuses(
    usage.families.map((f) => f.status),
    true,
  );
  useFontLibrary.setState((s) => ({ exportUsage: { ...s.exportUsage, [exportUsageKey(videoId, burnCaptions)]: usage } }));
}

export function leaveVideoFonts(videoId: Id): void {
  useFontLibrary.setState((s) => (s.batch?.videoId === videoId ? { batch: null } : s));
}

export function dismissBatch(): void {
  useFontLibrary.setState((s) => (s.batch ? { batch: { ...s.batch, dismissed: true } } : s));
}

const pendingOf = (batch: FontBatch) =>
  batch.families.filter((n) => {
    const status = useFontLibrary.getState().statuses[familyKey(n)];
    return !!liveJobOf(n) || status?.state === 'downloading';
  });

/** 字体条的「跳过这个」：取消当前在下的那一个，这个族先用回退字体，条上接着念下一个。 */
export async function skipCurrent(client: Client): Promise<void> {
  const batch = useFontLibrary.getState().batch;
  const current = batch ? pendingOf(batch)[0] : undefined;
  if (!batch || !current) return;
  useFontLibrary.setState({ batch: { ...batch, skipped: [...batch.skipped, current] } });
  await cancelFamily(client, current);
}

/** 字体条的 ✕：取消这一批还在下载的。 */
export async function cancelBatch(client: Client): Promise<void> {
  const batch = useFontLibrary.getState().batch;
  if (!batch) return;
  await Promise.all(pendingOf(batch).map((n) => cancelFamily(client, n).catch(() => {})));
}

/** 自动下载关着时字体条上的「下载」：这一批改成下载，逐个提交（Runtime 同时下两个）。 */
export async function downloadBatch(client: Client): Promise<void> {
  const batch = useFontLibrary.getState().batch;
  if (!batch) return;
  useFontLibrary.setState({ batch: { ...batch, mode: 'auto', skipped: [] } });
  for (const family of batch.families) await downloadFamily(client, family).catch(() => {});
}

// ---- 设置 › 字体 ----

export async function loadDownloaded(client: Client): Promise<void> {
  useFontLibrary.setState({ downloaded: await client.request('fonts.downloaded', {}) });
}

export async function removeFamily(client: Client, family: string): Promise<{ freedBytes: number }> {
  try {
    const result = await client.request('fonts.remove', { family });
    return { freedBytes: result.freedBytes };
  } finally {
    await Promise.all([loadDownloaded(client), refreshFamilies(client, [family])]).catch(() => {});
  }
}

export async function clearDownloaded(client: Client) {
  try {
    return await client.request('fonts.clear', {});
  } finally {
    await loadDownloaded(client).catch(() => {});
    await loadCatalogue(client, true).catch(() => {});
  }
}

// ---- 样张 ----

/** 把样张装进界面的字体表：返回 CSS 里的族名。测试替换。 */
export type FaceRegistrar = (name: string, bytes: ArrayBuffer) => Promise<void>;

const registerInDocument: FaceRegistrar = async (name, bytes) => {
  const face = new FontFace(name, bytes);
  await face.load();
  document.fonts.add(face);
};

function decodeBase64(data: string): ArrayBuffer {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * 一行滚进视野时取它的样张（`fonts.sample`：只含族名那几个字的子集），装进界面的字体表，之后这一行按它画。
 * 本机已装的族用系统字体本身；随内核、字体目录里的族要样张；取不到（离线、严格离线、不在目录里）就是界面字体的纯文字。
 */
export async function requestSample(client: Client, family: string, register: FaceRegistrar = registerInDocument): Promise<void> {
  const key = familyKey(family);
  if (useFontLibrary.getState().samples[key]) return;
  const set = (state: SampleState) => useFontLibrary.setState((s) => ({ samples: { ...s.samples, [key]: state } }));
  const status = useFontLibrary.getState().statuses[key];
  if (status?.state === 'installed') return set({ state: 'ready', css: `"${status.family.replace(/"/g, '')}"` });
  if (status && status.category === null) return set({ state: 'none' });
  set({ state: 'loading' });
  let sample: FontSampleResult;
  try {
    sample = await client.request('fonts.sample', { family });
  } catch {
    return set({ state: 'none' });
  }
  if (!sample.data) return set({ state: 'none' });
  const name = `bc-sample-${key.replace(/[^a-z0-9]+/g, '-')}`;
  try {
    await register(name, decodeBase64(sample.data));
    set({ state: 'ready', css: `"${name}"` });
  } catch {
    set({ state: 'none' });
  }
}

// ---- 跟着任务走 ----

let syncUsers = 0;
let stopSync: (() => void) | null = null;

/**
 * 跟着 `jobs` 主题：`fontDownload` 任务结束（完成、失败、取消）时按族重新取状态，设置页的已下载列表也刷新。导出开始与结束时
 * 也刷新已下载列表：还没结束的导出钉住它用的字体（「导出在用」、删除钮不可点），钉住与解除都在这两个时候。
 * 引用计数：选字框、字体条、导出面板与设置页都会挂；最后一个离开时退订。
 */
export function startFontLibrarySync(client: Client): () => void {
  syncUsers++;
  if (!stopSync) {
    const live = new Set<Id>();
    const exporting = new Set<Id>();
    let exports: Set<Id> | null = null;
    const settle = (jobs: readonly JobRecord[]) => {
      const ended: string[] = [];
      const nowExporting = new Set(jobs.filter((j) => j.kind === 'export' && jobLive(j)).map((j) => j.jobId));
      // 第一次只记下（挂上时设置页自己取过一次）；之后有导出开始或结束就重取已下载列表。
      const pinsChanged = exports !== null && (nowExporting.size !== exports.size || [...nowExporting].some((id) => !exports!.has(id)));
      exports = nowExporting;
      for (const job of jobs) {
        if (job.kind === 'export') {
          // 导出自己下载的 face 不是 `fontDownload` 任务：导出离开下载阶段（或结束）时，状态里记着这个导出在下的族再取一次。
          if (jobLive(job) && job.phase === 'downloading') exporting.add(job.jobId);
          else if (exporting.delete(job.jobId)) {
            const { statuses } = useFontLibrary.getState();
            for (const s of Object.values(statuses)) if (s.state === 'downloading' && s.job?.jobId === job.jobId) ended.push(s.family);
          }
          continue;
        }
        if (job.kind !== 'fontDownload') continue;
        if (jobLive(job)) live.add(job.jobId);
        else if (live.delete(job.jobId)) ended.push(job.modelId);
      }
      if (ended.length) void refreshFamilies(client, ended).catch(() => {});
      if ((ended.length || pinsChanged) && useFontLibrary.getState().downloaded) void loadDownloaded(client).catch(() => {});
    };
    settle(useJobs.getState().jobs);
    stopSync = useJobs.subscribe((s) => settle(s.jobs));
  }
  return () => {
    if (--syncUsers > 0 || !stopSync) return;
    stopSync();
    stopSync = null;
  };
}
