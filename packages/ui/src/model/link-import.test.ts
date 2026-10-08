import { describe, expect, it } from 'vitest';
import type { ExternalToolStatus, JobRecord, PipelineStepState } from '@baocut/protocol';
import {
  downloadDirLabel,
  downloadProgress,
  isLinkImport,
  linkFrozen,
  linkHeading,
  linkIssue,
  linkMeta,
  linkProvenance,
  linkStages,
  linkSummary,
  linkTitle,
  rejectionCode,
  toolCard,
  toolReady,
} from './link-import.ts';

const step = (name: string, status: PipelineStepState['status'], extra: Partial<PipelineStepState> = {}): PipelineStepState => ({
  name,
  label: name,
  status,
  jobId: null,
  attempts: status === 'pending' ? 0 : 1,
  output: null,
  ...extra,
});

function job(patch: Partial<JobRecord> & { steps?: PipelineStepState[]; summary?: Record<string, unknown> | null } = {}): JobRecord {
  const { steps, summary, ...rest } = patch;
  return {
    jobId: 'job_1',
    kind: 'pipeline',
    state: 'running',
    phase: 'downloading',
    progress: null,
    videoId: null,
    assetId: null,
    assetRevision: null,
    contentHash: '',
    providerId: 'yt-dlp',
    modelId: '2026.01.01',
    bundleId: null,
    inputHash: '',
    submitter: { kind: 'connection', id: 'app' },
    attempt: 1,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    startedAt: '2026-10-01T00:00:00Z',
    endedAt: null,
    error: null,
    result: null,
    warnings: [],
    pipeline: {
      name: 'link-import',
      params: { url: 'https://www.youtube.com/watch?v=abc', host: 'youtube.com', audioOnly: false, outDir: '/Users/me/p/downloads' },
      steps: steps ?? [step('resolve', 'completed'), step('download', 'running', { jobId: 'job_dl' }), step('verify', 'pending'), step('publish', 'pending')],
      current: 1,
      stoppedAt: null,
      summary: summary ?? null,
    },
    ...rest,
  };
}

const SUMMARY = {
  url: 'https://www.youtube.com/watch?v=abc',
  title: '访谈第一集',
  platform: 'youtube',
  uploader: 'me',
  durationSec: 300,
  files: { media: '/Users/me/p/downloads/访谈第一集.mp4', subtitles: [] },
  tool: { name: 'yt-dlp', version: '2026.01.01', source: 'managed' },
  downloadedAt: '2026-10-01T00:01:00Z',
  videoId: null,
  assetId: null,
  transcribeJobId: null,
};

describe('认出与读出', () => {
  it('只认 link-import 的父任务', () => {
    expect(isLinkImport(job())).toBe(true);
    expect(isLinkImport({ kind: 'pipeline', pipeline: { ...job().pipeline!, name: 'translate' } })).toBe(false);
    expect(isLinkImport({ kind: 'transcribe' })).toBe(false);
    expect(isLinkImport(null)).toBe(false);
  });

  it('冻结参数与摘要', () => {
    expect(linkFrozen(job())).toEqual({
      url: 'https://www.youtube.com/watch?v=abc',
      host: 'youtube.com',
      audioOnly: false,
      outDir: '/Users/me/p/downloads',
      videoId: null,
    });
    expect(linkSummary(job())).toBeNull();
    expect(linkSummary(job({ summary: SUMMARY }))?.files.media).toBe('/Users/me/p/downloads/访谈第一集.mp4');
    expect(linkSummary(job({ summary: { title: 'x' } }))).toBeNull();
    // 用上的浏览器：之前的版本没有这一项，不认得的取值当作匿名。
    expect(linkSummary(job({ summary: SUMMARY }))?.cookieBrowser).toBeNull();
    expect(linkSummary(job({ summary: { ...SUMMARY, cookieBrowser: 'edge' } }))?.cookieBrowser).toBe('edge');
    expect(linkSummary(job({ summary: { ...SUMMARY, cookieBrowser: 'netscape' } }))?.cookieBrowser).toBeNull();
  });

  it('标题：解析出来之前写主机名', () => {
    expect(linkTitle(job())).toBe('从链接导入 · youtube.com');
    const resolved = job({ steps: [step('resolve', 'completed', { output: { metadata: { title: '访谈', platform: 'youtube', durationSec: 12 } } })] });
    expect(linkMeta(resolved)).toEqual({ title: '访谈', platform: 'youtube', durationSec: 12 });
    expect(linkTitle(resolved)).toBe('从链接导入 · 访谈');
    expect(linkTitle(job({ summary: SUMMARY }))).toBe('从链接导入 · 访谈第一集');
  });
});

describe('来源', () => {
  it('首页建视频时素材记的来源与流程自己导入时同形，摘要没有的取解析步骤', () => {
    expect(linkProvenance(job())).toBeNull();
    const metadata = { title: '访谈', platform: 'youtube', webpageUrl: 'https://www.youtube.com/watch?v=abc', mediaId: 'abc', uploadDate: '20260930' };
    const done = job({ jobId: 'job_9', summary: SUMMARY, steps: [step('resolve', 'completed', { output: { metadata } })] });
    expect(linkProvenance(done)).toEqual({
      origin: 'link-import',
      source: {
        url: 'https://www.youtube.com/watch?v=abc',
        webpageUrl: 'https://www.youtube.com/watch?v=abc',
        platform: 'youtube',
        mediaId: 'abc',
        title: '访谈第一集',
        uploader: 'me',
        uploadDate: '20260930',
        durationSec: 300,
        tool: { name: 'yt-dlp', version: '2026.01.01', source: 'managed' },
        downloadedAt: '2026-10-01T00:01:00Z',
        jobId: 'job_9',
      },
    });
  });
});

describe('下载进度', () => {
  it('读下载那一步子任务的字节数', () => {
    const child = { ...job(), jobId: 'job_dl', kind: 'pipeline-step', progress: { done: 1024 * 1024, total: 4 * 1024 * 1024, unit: 'bytes' } } as JobRecord;
    expect(downloadProgress(job(), [child])).toEqual({ pct: 25, text: '1.0 MB / 4.0 MB' });
    expect(downloadProgress(job(), [{ ...child, progress: { done: 2048, total: null, unit: 'bytes' } }])).toEqual({ pct: null, text: '已下载 2.0 KB' });
    expect(downloadProgress(job(), [])).toBeNull();
  });
});

describe('三步', () => {
  const states = (j: JobRecord, follow: Parameters<typeof linkStages>[1]) => linkStages(j, follow).map((s) => s.state);

  it('下载中：第一步在做', () => {
    expect(states(job(), null)).toEqual(['current', 'pending', 'pending']);
  });

  it('下载失败：第一步失败，后面不动', () => {
    const failed = job({
      state: 'failed',
      steps: [step('resolve', 'completed'), step('download', 'failed'), step('verify', 'pending'), step('publish', 'pending')],
    });
    expect(states(failed, null)).toEqual(['failed', 'pending', 'pending']);
  });

  it('流程完成后，建视频与转录由首页执行器接着做', () => {
    const done = job({ state: 'completed', steps: ['resolve', 'download', 'verify', 'publish'].map((n) => step(n, 'completed')), summary: SUMMARY });
    expect(states(done, { video: 'running', subs: 'pending' })).toEqual(['done', 'current', 'pending']);
    expect(states(done, { video: 'done', subs: 'running' })).toEqual(['done', 'done', 'current']);
    expect(states(done, { video: 'done', subs: 'skipped' })).toEqual(['done', 'done', 'skipped']);
    expect(states(done, { video: 'failed', subs: 'pending' })).toEqual(['done', 'failed', 'pending']);
    // 没有跟进记录（应用重启过、或别处起的）：等用户自己建视频。
    expect(states(done, null)).toEqual(['done', 'current', 'pending']);
  });

  it('带 videoId 起的导入：导入与转写是流程自己的步骤', () => {
    const own = job({
      state: 'running',
      steps: [...['resolve', 'download', 'verify', 'publish', 'import'].map((n) => step(n, 'completed')), step('transcribe', 'running')],
    });
    expect(states(own, null)).toEqual(['done', 'done', 'current']);
  });

  it('大标题', () => {
    expect(linkHeading({ state: 'running' }, null)).toBe('把这条链接变成可编辑的视频');
    expect(linkHeading({ state: 'cancelled' }, null)).toBe('导入已停止');
    expect(linkHeading({ state: 'completed' }, { video: 'done', subs: 'running' })).toBe('视频已就绪，正在生成字幕');
    expect(linkHeading({ state: 'completed' }, { video: 'done', subs: 'done' })).toBe('字幕准备好了');
  });
});

describe('失败的说法', () => {
  it('认得的码给补救按钮，带上下载工具的原话', () => {
    const issue = linkIssue({ code: 'LINK_NETWORK_ERROR', message: 'x', details: { stderr: 'ERROR: timed out', remedy: 'r', step: 'download' } });
    expect(issue).toMatchObject({ title: '连接中断了', actions: ['retry', 'use-file'], diag: 'ERROR: timed out' });
    expect(linkIssue({ code: 'LINK_LOGIN_REQUIRED', message: 'x' })!.actions[0]).toBe('use-file');
    expect(linkIssue({ code: 'TOOL_CONSENT_REQUIRED', message: 'x' })!.actions).toEqual(['tools']);
    expect(linkIssue({ code: 'LINK_SOURCE_EXPIRED', message: 'x' })!.actions).toEqual(['restart']);
  });

  it('不认得的码照原话写；中断没有错误码也有说法；没出错时 null', () => {
    expect(linkIssue({ code: 'WHATEVER', message: '出错了', details: { remedy: '换个办法' } })).toMatchObject({
      title: '导入没有完成',
      body: '出错了。换个办法',
    });
    expect(linkIssue(null, 'interrupted')).toMatchObject({ code: 'INTERRUPTED', actions: ['retry'] });
    expect(linkIssue(null, 'completed')).toBeNull();
  });

  it('提交被拒时读出码', () => {
    expect(rejectionCode({ details: { code: 'TOOL_NOT_INSTALLED' } })).toBe('TOOL_NOT_INSTALLED');
    expect(rejectionCode(new Error('x'))).toBeNull();
  });
});

const tool = (patch: Partial<ExternalToolStatus> = {}): ExternalToolStatus => ({
  name: 'yt-dlp',
  label: 'yt-dlp',
  purpose: '从链接导入',
  state: 'missing',
  reason: '没有找到',
  path: null,
  version: null,
  source: null,
  minVersion: '2025.01.01',
  installable: true,
  offer: {
    version: '2026.01.01',
    fileName: 'yt-dlp_macos',
    url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.01.01/yt-dlp_macos',
    sizeBytes: 35 * 1024 * 1024,
    estimatedBytes: 35 * 1024 * 1024,
    sha256: 'abc',
    license: 'Unlicense',
    homepage: 'https://github.com/yt-dlp/yt-dlp',
    blockedReason: null,
  },
  consentRequired: true,
  consent: null,
  managed: null,
  userPath: null,
  installJobId: null,
  update: null,
  updateJobId: null,
  platform: 'darwin',
  remedy: null,
  ...patch,
});

describe('下载工具卡片', () => {
  const card = (status: ExternalToolStatus | null, o: Partial<{ checking: boolean; installing: boolean; updating: boolean }> = {}) =>
    toolCard(status, { checking: false, installing: false, ...o });

  it('检查中、没登记', () => {
    expect(card(null, { checking: true }).state).toBe('checking');
    expect(card(null).state).toBe('unknown');
  });

  it('没装：能下载时给「同意并安装」与来源、大小、许可', () => {
    const c = card(tool());
    expect(c).toMatchObject({ state: 'install', action: '同意并安装' });
    expect(c.facts[0]).toBe('版本 2026.01.01 · 约 35 MB');
    expect(c.facts[1]).toBe('从 github.com 下载 · Unlicense 许可');
  });

  it('清单不全或平台不支持：不能装，说原因', () => {
    const c = card(tool({ offer: { ...tool().offer!, blockedReason: '清单里没有这个平台的摘要。' } }));
    expect(c).toMatchObject({ state: 'blocked', action: null });
    expect(c.body).toContain('清单里没有这个平台的摘要');
  });

  it('正在安装', () => {
    expect(card(tool({ installJobId: 'job_i' })).state).toBe('installing');
    expect(card(tool(), { installing: true }).state).toBe('installing');
  });

  const brew = { method: 'homebrew' as const, argv: ['/opt/homebrew/bin/brew', 'upgrade', 'yt-dlp'], command: '/opt/homebrew/bin/brew upgrade yt-dlp', runnable: true, reason: null };

  it('版本旧：BaoCut 下载的能更新，系统里的按原安装方式更新（能代为执行时指向下面的命令）', () => {
    expect(card(tool({ state: 'outdated', source: 'managed', version: '2024.01.01' }))).toMatchObject({ state: 'update', action: '同意并更新' });
    const system = card(tool({ state: 'outdated', source: 'system', version: '2024.01.01' }));
    expect(system).toMatchObject({ state: 'blocked', action: null });
    expect(system.body).toContain('按下面的说明在终端里更新');
    expect(card(tool({ state: 'outdated', source: 'system', version: '2024.01.01', update: brew })).body).toContain('可以用下面这条命令按原安装方式更新');
  });

  it('正在更新：卡片说在更新，事实照旧', () => {
    const installed = tool({ state: 'installed', reason: null, path: '/opt/homebrew/bin/yt-dlp', version: '2026.01.01', source: 'system', update: brew });
    expect(card({ ...installed, updateJobId: 'job_u' })).toMatchObject({ state: 'updating', action: null });
    expect(card(installed, { updating: true }).facts).toEqual(['yt-dlp 2026.01.01 · 系统里装的 · Homebrew 安装', '/opt/homebrew/bin/yt-dlp']);
  });

  it('装好了：没同意时要同意，同意过就绪', () => {
    const installed = tool({ state: 'installed', reason: null, path: '/opt/homebrew/bin/yt-dlp', version: '2026.01.01', source: 'system' });
    expect(card(installed)).toMatchObject({ state: 'consent', action: '同意使用' });
    expect(card(installed).facts).toEqual(['yt-dlp 2026.01.01 · 系统里装的', '/opt/homebrew/bin/yt-dlp']);
    expect(card({ ...installed, consent: { state: 'revoked', at: '', via: 'app' } }).title).toContain('撤回');
    const granted = { ...installed, consent: { state: 'granted' as const, at: '', via: 'app' as const } };
    expect(card(granted).state).toBe('ready');
    expect(toolReady(granted)).toBe(true);
    expect(toolReady(installed)).toBe(false);
    expect(toolReady(null)).toBe(false);
  });

  it('下载位置', () => {
    expect(downloadDirLabel('/Users/me/Downloads', '/Users/me/p')).toBe('~/Downloads');
    expect(downloadDirLabel(null, '/Users/me/p/')).toBe('~/Downloads');
    expect(downloadDirLabel(null, null)).toBe('~/Downloads');
  });
});
