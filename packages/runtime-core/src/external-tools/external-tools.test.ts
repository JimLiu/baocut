import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient } from '@baocut/client';
import { writeFakeYtDlp, type FakeYtDlp } from '@baocut/jobs';
import { LINK_COOKIE_BROWSERS, newId, type ExternalToolStatus, type JobRecord, type LinkImportSummary } from '@baocut/protocol';
import { resolveRuntimeHome, type RuntimeHome } from '@baocut/runtime-storage';
import { ToolDriver, mcp, tool, until } from '../agent-tools/testing/fake-agent.ts';
import { startRuntime, type RunningRuntime } from '../runtime.ts';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';
import { ExternalToolService } from './external-tool-service.ts';
import { TOOL_DOWNLOAD_REMEDIES } from './tool-download.ts';
import { BUILTIN_TOOL_MANIFESTS, YT_DLP, platformKey, type ToolManifest } from './tool-manifests.ts';

/**
 * 受管外部工具与从链接导入经网关端到端（架构设计 §12.9、§7.9）：
 *
 * - 「发布文件」是测试里生成的假 yt-dlp 包装，由本机回环地址上的假下载来源提供；清单里的 sha256 是现算的。
 *   搜索路径只有一个空目录，系统里真实的 yt-dlp 不会被用到；不访问真实网络，不下载真实的 yt-dlp。
 * - 同意的记录与撤回、未同意时拒绝安装、校验失败、安装成功、严格离线、指定路径与过旧的版本、ffmpeg 不由 BaoCut 下载。
 * - 下载之后导入真实引擎里的视频：来源里是脱敏的链接，视频目录与日志里没有原始链接（没有 engine-host 或 ffprobe 时跳过）。
 * - 智能体的 `download`：要安装时按 `external_tools_install`（high）确认，装好之后按 `download`（command），
 *   撤回同意之后按 `external_tools_consent`（high）。对外服务不代为安装或同意（services.test.ts）。
 */

const engine = resolveEngineHostCommand();
const hasFfprobe = (() => {
  try {
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
if (!engine || !hasFfprobe) console.warn('跳过导入视频的端到端测试：没有 engine-host 或 ffprobe');

const VERSION = '2026.07.04';
const SECRET = 'secret-token-e2e';

interface FakeSource {
  endpoint: string;
  requests: string[];
  corrupt: boolean;
  close(): Promise<void>;
}

async function startFakeSource(file: Buffer, fileName: string): Promise<FakeSource> {
  const state = { corrupt: false, requests: [] as string[] };
  const server = http.createServer((request, response) => {
    state.requests.push(request.url ?? '');
    if (request.method !== 'GET' || request.url !== `/mirror/yt-dlp/${VERSION}/${fileName}`) {
      response.writeHead(404).end();
      return;
    }
    const body = state.corrupt ? Buffer.alloc(file.length, 0x41) : file;
    response.writeHead(200, { 'Content-Length': String(body.length) }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${port}/mirror`,
    get requests() {
      return state.requests;
    },
    get corrupt() {
      return state.corrupt;
    },
    set corrupt(value: boolean) {
      state.corrupt = value;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

interface Side {
  dir: string;
  home: RuntimeHome;
  runtime: RunningRuntime;
  client: BaoCutClient;
  driver: ToolDriver;
  fake: FakeYtDlp;
  source: FakeSource;
  emptyPath: string;
}

async function startSide(): Promise<Side> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-external-tools-'));
  const home = resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home') });
  // 「发布文件」：假 yt-dlp 的包装（日志写在 dir/release 里）。
  const fake = await writeFakeYtDlp(path.join(dir, 'release'));
  const bytes = await fs.readFile(fake.command);
  const fileName = 'yt-dlp_test';
  const source = await startFakeSource(bytes, fileName);
  const builtin = BUILTIN_TOOL_MANIFESTS.find((m) => m.name === YT_DLP)!;
  const manifest: ToolManifest = {
    ...builtin,
    release: {
      ...builtin.release!,
      version: VERSION,
      assets: { [platformKey()]: { fileName, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } },
    },
  };
  const emptyPath = path.join(dir, 'empty-path');
  await fs.mkdir(emptyPath);
  const driver = new ToolDriver();
  const runtime = await startRuntime({
    home,
    drivers: () => [driver],
    watchSpace: false,
    engineHost: engine,
    videoGraceMs: 100,
    modelWorker: null,
    externalTools: {
      env: async () => ({ PATH: emptyPath }),
      // 不读真实环境里的覆盖：没有 BAOCUT_FFMPEG，下载来源指向假服务。
      overrides: { BAOCUT_TOOLS_ENDPOINT: source.endpoint },
      manifests: [manifest, BUILTIN_TOOL_MANIFESTS.find((m) => m.name !== YT_DLP)!],
      download: { backoffMs: () => 5, retries: 1 },
      lookup: async () => ['93.184.216.34'],
    },
  });
  const { endpoint, token } = runtime.discovery;
  const client = new BaoCutClient({
    resolve: async () => ({ endpoint, token }),
    client: { kind: 'desktop', name: 'test', version: '0' },
    reconnect: false,
  });
  await client.connect();
  await client.request('settings.set', { values: { 'downloads.directory': path.join(dir, 'Downloads') } });
  return { dir, home, runtime, client, driver, fake, source, emptyPath };
}

async function stopSide(side: Side | undefined): Promise<void> {
  if (!side) return;
  side.client.close();
  await side.runtime.close();
  await side.source.close();
  await fs.rm(side.dir, { recursive: true, force: true });
}

async function settledJob(side: Side, jobId: string): Promise<JobRecord> {
  await side.runtime.models.jobs.settled(jobId);
  await side.runtime.models.pipelines.idle();
  return side.runtime.models.jobs.inspect(jobId);
}

const ytDlp = (tools: ExternalToolStatus[]) => tools.find((t) => t.name === YT_DLP)!;

async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) out.push(path.join(entry.parentPath, entry.name));
  }
  return out;
}

describe('受管外部工具（假下载来源 + 假 yt-dlp）', () => {
  let side: Side | undefined;

  beforeEach(async () => {
    side = await startSide();
  });

  afterEach(async () => {
    await stopSide(side);
    side = undefined;
  });

  it('状态、同意、校验失败与安装成功、撤回之后流程拒绝、严格离线', async () => {
    const s = side!;
    const listed = await s.client.request('externalTools.list', {});
    expect(listed.tools.map((t) => [t.name, t.state])).toEqual([
      ['yt-dlp', 'missing'],
      ['ffmpeg', 'missing'],
    ]);
    const offer = ytDlp(listed.tools).offer!;
    expect(offer).toMatchObject({
      version: VERSION,
      url: `${s.source.endpoint}/yt-dlp/${VERSION}/yt-dlp_test`,
      sizeBytes: expect.any(Number),
      blockedReason: null,
    });
    expect(offer.license).toContain('GPLv3+');

    // 没有安装：流程以 TOOL_NOT_INSTALLED 拒绝，说明怎么补救。
    await expect(
      s.client.request('pipelines.start', { pipeline: 'link-import', params: { url: 'https://video.example.com/watch?v=a' } }),
    ).rejects.toMatchObject({ code: 'conflict', details: { code: 'TOOL_NOT_INSTALLED', remedy: expect.stringContaining('install') } });

    // 没有 consent：不下载，交出来源、版本、大小与许可。
    await expect(s.client.request('externalTools.install', { name: 'yt-dlp' })).rejects.toMatchObject({
      code: 'conflict',
      details: { code: 'TOOL_CONSENT_REQUIRED', offer: { version: VERSION, sizeBytes: offer.sizeBytes } },
    });
    expect(s.source.requests).toEqual([]);
    await expect(s.client.request('externalTools.install', { name: 'ffmpeg', consent: true })).rejects.toMatchObject({
      code: 'invalid-request',
      details: { code: 'TOOL_NOT_MANAGED' },
    });

    // 内容与清单不符：任务失败，不留下文件。
    s.source.corrupt = true;
    const bad = await s.client.request('externalTools.install', { name: 'yt-dlp', consent: true, via: 'cli' });
    const failed = await settledJob(s, bad.jobId);
    expect(failed).toMatchObject({ kind: 'toolInstall', state: 'failed', error: { code: 'TOOL_DOWNLOAD_INTEGRITY' } });
    await expect(fs.readdir(path.join(s.home.root, 'tools', 'yt-dlp'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readdir(path.join(s.home.root, 'tools', '.staging'))).toEqual([]);

    s.source.corrupt = false;
    const good = await s.client.request('externalTools.install', { name: 'yt-dlp', consent: true });
    expect(await settledJob(s, good.jobId)).toMatchObject({ state: 'completed', providerId: 'yt-dlp', modelId: VERSION });
    const installed = ytDlp((await s.client.request('externalTools.detect', { name: 'yt-dlp' })).tools);
    expect(installed).toMatchObject({
      state: 'installed',
      version: VERSION,
      source: 'managed',
      consent: { state: 'granted', via: 'app' },
      managed: { version: VERSION },
    });
    expect((await fs.stat(installed.path!)).mode & 0o111).not.toBe(0);
    expect(installed.path).toBe(path.join(s.home.root, 'tools', 'yt-dlp', VERSION, 'yt-dlp'));

    // 撤回同意：流程拒绝；再同意就能启动。
    const revoked = await s.client.request('externalTools.consent', { name: 'yt-dlp', grant: false, via: 'cli' });
    expect(revoked.tool.consent).toMatchObject({ state: 'revoked', via: 'cli' });
    await expect(
      s.client.request('pipelines.start', { pipeline: 'link-import', params: { url: 'https://video.example.com/watch?v=a' } }),
    ).rejects.toMatchObject({ details: { code: 'TOOL_CONSENT_REQUIRED' } });
    await s.client.request('externalTools.consent', { name: 'yt-dlp', grant: true });

    // 严格离线：不安装，流程也不启动。
    await s.client.request('settings.set', { values: { 'offline.strict': true } });
    await expect(s.client.request('externalTools.install', { name: 'yt-dlp', consent: true })).rejects.toMatchObject({
      details: { code: 'OFFLINE_STRICT' },
    });
    await expect(
      s.client.request('pipelines.start', { pipeline: 'link-import', params: { url: 'https://video.example.com/watch?v=a' } }),
    ).rejects.toMatchObject({ details: { code: 'OFFLINE_STRICT' } });
    await s.client.request('settings.set', { values: { 'offline.strict': false } });

    // 删除受管副本：回到未安装。
    const removed = await s.client.request('externalTools.remove', { name: 'yt-dlp' });
    expect(removed.tool.state).toBe('missing');
    await expect(fs.stat(installed.path!)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('本机浏览器的 Cookie 库：只给支持的浏览器、名字与时间，不给路径；带上主机的平台', async () => {
    const s = side!;
    // 看的是这台机器真实的主目录（只看文件在不在），有哪些浏览器因机器而异；具体的查找规则在 @baocut/jobs 里用临时目录测。
    const { platform, browsers } = await s.client.request('externalTools.cookieBrowsers', {});
    expect(platform).toBe(process.platform);
    for (const browser of browsers) {
      expect(LINK_COOKIE_BROWSERS).toContain(browser.id);
      expect(Object.keys(browser).sort()).toEqual(['id', 'label', 'lastUsedAt']);
    }
    await expect(s.client.request('externalTools.cookieBrowsers', { name: 'yt-dlp' } as never)).rejects.toMatchObject({ code: 'invalid-request' });
  });

  it('指定路径：不能运行的拒绝，过旧的报告需要更新、流程拒绝；清除后回到受管副本之外的来源', async () => {
    const s = side!;
    const notExe = path.join(s.dir, 'not-exe');
    await fs.writeFile(notExe, 'hello');
    await expect(s.client.request('externalTools.setPath', { name: 'yt-dlp', path: notExe })).rejects.toMatchObject({
      code: 'invalid-request',
      details: { code: 'TOOL_UNAVAILABLE' },
    });
    const old = await writeFakeYtDlp(path.join(s.dir, 'old'), { version: '2023.01.01' });
    const set = await s.client.request('externalTools.setPath', { name: 'yt-dlp', path: old.command });
    expect(set.tool).toMatchObject({ state: 'outdated', source: 'user', version: '2023.01.01', userPath: old.command });
    await s.client.request('externalTools.consent', { name: 'yt-dlp', grant: true });
    await expect(
      s.client.request('pipelines.start', { pipeline: 'link-import', params: { url: 'https://video.example.com/watch?v=a' } }),
    ).rejects.toMatchObject({ details: { code: 'TOOL_OUTDATED' } });
    const fresh = await writeFakeYtDlp(path.join(s.dir, 'fresh'));
    expect((await s.client.request('externalTools.setPath', { name: 'yt-dlp', path: fresh.command })).tool).toMatchObject({
      state: 'installed',
      source: 'user',
    });
    expect((await s.client.request('externalTools.setPath', { name: 'yt-dlp', path: null })).tool.state).toBe('missing');
  });

  it('内置清单没有可信的 sha256：同意了也不下载；PATH 只有空目录时找不到系统里的 yt-dlp', async () => {
    const s = side!;
    const service = new ExternalToolService({
      toolsDir: path.join(s.dir, 'builtin-tools'),
      storeFile: path.join(s.dir, 'builtin-store', 'external-tools.json'),
      jobs: s.runtime.models.jobs,
      log: s.runtime.log,
      env: async () => ({ PATH: s.emptyPath }),
      settings: () => ({ downloadEndpoint: null, offlineStrict: false }),
      overrides: {},
    });
    expect((await service.status(YT_DLP)).state).toBe('missing');
    const status = await service.status(YT_DLP);
    expect(status.offer).toMatchObject({ sha256: null, blockedReason: expect.stringContaining('sha256') });
    expect(status.offer!.url).toMatch(/^https:\/\/github\.com\/yt-dlp\/yt-dlp\/releases\/download\//);
    await expect(service.install({ name: YT_DLP, consent: true }, { kind: 'connection', id: 'conn_x' })).rejects.toMatchObject({
      details: { code: 'TOOL_MANIFEST_INCOMPLETE' },
    });
  });

  it('Windows：PATH 里先找到的是 .cmd 时报不可用（不经 cmd.exe 执行），指定路径也不收脚本', async () => {
    const s = side!;
    const bin = path.join(s.dir, 'win-bin');
    await fs.mkdir(bin, { recursive: true });
    const cmd = path.join(bin, 'yt-dlp.cmd');
    await fs.writeFile(cmd, '@echo off\r\n', { mode: 0o755 });
    const service = new ExternalToolService({
      toolsDir: path.join(s.dir, 'win-tools'),
      storeFile: path.join(s.dir, 'win-store', 'external-tools.json'),
      jobs: s.runtime.models.jobs,
      log: s.runtime.log,
      env: async () => ({ PATH: bin, PathExt: '.COM;.EXE;.BAT;.CMD' }),
      settings: () => ({ downloadEndpoint: null, offlineStrict: false }),
      overrides: {},
      platform: 'win32-x64',
    });
    const [status] = await service.detect(YT_DLP);
    // 状态带 Runtime 所在主机的平台：界面判断不了安装方式时按它列常用命令。
    expect(status).toMatchObject({ state: 'unavailable', path: cmd, source: 'system', reason: expect.stringContaining('批处理脚本'), platform: 'win32' });
    expect(status!.remedy).toContain('yt-dlp.exe');
    await expect(service.setPath({ name: YT_DLP, path: cmd })).rejects.toMatchObject({ details: { code: 'TOOL_UNAVAILABLE' } });
  });

  it.skipIf(!engine || !hasFfprobe)('下载之后导入视频：来源脱敏，视频目录、任务记录与 Runtime Home 里没有原始链接', async () => {
    const s = side!;
    const install = await s.client.request('externalTools.install', { name: 'yt-dlp', consent: true });
    expect((await settledJob(s, install.jobId)).state).toBe('completed');
    const { project } = await s.client.request('projects.create', { name: '链接导入' });
    const opened = await s.client.request('videos.create', { projectId: project.id });
    const videoId = opened.ref.videoId;
    const raw = `https://video.example.com/watch?v=abc&token=${SECRET}`;
    const { jobId } = await s.client.request('pipelines.start', {
      pipeline: 'link-import',
      params: { url: raw, videoId, subtitleLanguages: ['en'] },
    });
    const job = await settledJob(s, jobId);
    expect(job).toMatchObject({ kind: 'pipeline', state: 'completed', providerId: 'yt-dlp', modelId: VERSION });
    const summary = job.pipeline!.summary as unknown as LinkImportSummary;
    expect(summary.url).toBe('https://video.example.com/watch?v=abc');
    expect(path.dirname(summary.files.media)).toBe(path.join(await fs.realpath(s.dir), 'Downloads'));
    const asset = s.runtime.videos.mirror(videoId)!.video.assets[summary.assetId!]!;
    const revision = asset.revisions[asset.currentRevision]!;
    expect(revision.storage).toMatchObject({ mode: 'linked' });
    expect(revision.provenance).toMatchObject({
      origin: 'link-import',
      source: {
        url: 'https://video.example.com/watch?v=abc',
        tool: { name: 'yt-dlp', version: VERSION, source: 'managed' },
        downloadedAt: expect.any(String),
        jobId,
      },
    });
    // 原始链接不在任务记录、视频目录、日志与 Runtime Home 的任何文件里（暂存在完成时已删）。
    expect(JSON.stringify(await s.client.request('jobs.list', { children: true }))).not.toContain(SECRET);
    await s.runtime.videos.shutdown();
    for (const file of [...(await filesUnder(opened.ref.path)), ...(await filesUnder(s.home.root))]) {
      if (file.includes(`${path.sep}tools${path.sep}`)) continue;
      expect((await fs.readFile(file)).includes(SECRET), file).toBe(false);
    }
    // 下载工具拿到的是原始链接（在 -- 之后）。
    expect((await s.fake.calls()).some((c) => c.argv?.at(-1) === raw)).toBe(true);
  });

  it('智能体：需要安装时按 high 确认并提交安装；装好之后按 command 确认下载；撤回之后按 high 重新同意', async () => {
    const s = side!;
    const { project } = await s.client.request('projects.create', { name: '智能体导入' });
    const {
      conversation: { id: conversationId },
    } = await s.client.request('conversations.create', { projectId: project.id });
    await s.client.request('conversations.send', { conversationId, text: '下载', commandId: newId('cmd'), accessMode: 'auto' });
    const session = await until(() => s.driver.sessions[0]);
    await until(() => session.turnId);
    const listed = await mcp(session, 'tools/list');
    expect((listed.result!.tools as { name: string }[]).map((t) => t.name)).toContain('download');

    // 以 - 开头与本地地址：不弹确认，直接拒绝。
    const injected = await tool(session, 'download', { url: '--exec=id' });
    expect(injected).toMatchObject({ isError: true, body: { error: { code: 'LINK_UNSUPPORTED' } } });
    const local = await tool(session, 'download', { url: 'http://127.0.0.1:9/a' });
    expect(local.body.error.code).toBe('LINK_PRIVATE_ADDRESS');
    expect(s.runtime.harness.approvals.pending()).toEqual([]);

    // 没有安装：auto 模式下 high 也要问；说明里有来源、版本与大小。
    const first = tool(session, 'download', { url: `https://video.example.com/watch?v=abc&token=${SECRET}` });
    const installApproval = await until(() => s.runtime.harness.approvals.pending()[0]);
    expect(installApproval).toMatchObject({ action: { name: 'external_tools_install' }, risk: 'high' });
    const text = JSON.stringify(installApproval);
    expect(text).toContain(`${s.source.endpoint}/yt-dlp/${VERSION}/yt-dlp_test`);
    expect(text).toContain(VERSION);
    expect(text).not.toContain(SECRET);
    await s.client.request('approvals.respond', { approvalId: installApproval.approvalId, decision: 'allow' });
    const installing = await first;
    expect(installing).toMatchObject({ isError: false, body: { jobId: null, installJobId: expect.stringMatching(/^job_/) } });
    expect(await settledJob(s, installing.body.installJobId)).toMatchObject({ state: 'completed', submitter: { kind: 'agent' } });
    expect(ytDlp((await s.client.request('externalTools.list', {})).tools).consent).toMatchObject({ via: 'agent-approval' });

    // 装好、同意有效：auto 模式下 command 直接执行。
    const started = await tool(session, 'download', { url: 'https://video.example.com/watch?v=abc' });
    expect(started).toMatchObject({
      isError: false,
      body: { jobId: expect.stringMatching(/^job_/), approval: { risk: 'command', decidedBy: 'auto' } },
    });
    if (hasFfprobe) expect((await settledJob(s, started.body.jobId)).state).toBe('completed');
    else await settledJob(s, started.body.jobId);

    // 有落点（只下载到项目）：文件进项目的 downloads/，不进下载目录；不导入视频。
    const toProject = await tool(session, 'download', { url: 'https://video.example.com/watch?v=ghi', project: project.id });
    expect(toProject.isError).toBe(false);
    const projectJob = await settledJob(s, toProject.body.jobId);
    // 冻结的参数里 saveTo 已经解析成保存目录（outDir）。
    expect(projectJob).toMatchObject({ pipeline: { params: { projectId: project.id } } });
    expect((projectJob.pipeline!.params as { outDir: string }).outDir).toBe(path.join(project.path, 'downloads'));
    if (hasFfprobe) {
      expect(projectJob.state).toBe('completed');
      const summary = projectJob.pipeline!.summary as unknown as LinkImportSummary;
      expect(path.dirname(summary.files.media)).toBe(path.join(await fs.realpath(project.path), 'downloads'));
      expect(summary.videoId).toBeNull();
    }

    // 撤回之后：按 external_tools_consent（high）问；拒绝时不启动。
    await s.client.request('externalTools.consent', { name: 'yt-dlp', grant: false });
    const again = tool(session, 'download', { url: 'https://video.example.com/watch?v=def' });
    const consentApproval = await until(() => s.runtime.harness.approvals.pending()[0]);
    expect(consentApproval).toMatchObject({ action: { name: 'external_tools_consent' }, risk: 'high' });
    const before = s.runtime.models.jobs.list().length;
    await s.client.request('approvals.respond', { approvalId: consentApproval.approvalId, decision: 'deny' });
    expect((await again).body.error.code).toBe('APPROVAL_DENIED');
    expect(s.runtime.models.jobs.list().length).toBe(before);
    expect(ytDlp((await s.client.request('externalTools.list', {})).tools).consent).toMatchObject({ state: 'revoked' });
  });
});

const NEW_VERSION = '2026.09.01';

interface FakeBrew {
  /** `<前缀>/bin/yt-dlp`：指向 Cellar 里那一份的符号链接。 */
  link: string;
  /** 真实路径下的 `<前缀>/bin/brew`（计划里用的就是它）。 */
  brew: string;
  /** `ok` 打印输出并改版本、`fail` 以 1 退出、`slow` 记下自己与子进程的 pid 后一直等。 */
  mode(mode: 'ok' | 'fail' | 'slow'): Promise<void>;
  calls(): Promise<string>;
  pids(): Promise<number[]>;
}

/**
 * 假 Homebrew：`<dir>/brew/Cellar/yt-dlp/<版本>/bin/yt-dlp` 打印版本文件，`bin/yt-dlp` 是指向它的符号链接，`bin/brew`
 * 按模式文件行事。脚本里只用绝对路径的 `/bin/cat`、`/bin/sleep` 与 shell 内建命令（搜索路径只有一个空目录）。
 */
async function writeFakeBrew(dir: string): Promise<FakeBrew> {
  const prefix = path.join(dir, 'brew');
  const cellar = path.join(prefix, 'Cellar', 'yt-dlp', VERSION, 'bin');
  await fs.mkdir(cellar, { recursive: true });
  await fs.mkdir(path.join(prefix, 'bin'));
  const file = (name: string) => path.join(prefix, name);
  await fs.writeFile(file('version'), `${VERSION}\n`);
  await fs.writeFile(file('mode'), 'ok');
  await fs.writeFile(path.join(cellar, 'yt-dlp'), `#!/bin/sh\nexec /bin/cat '${file('version')}'\n`, { mode: 0o755 });
  await fs.symlink(`../Cellar/yt-dlp/${VERSION}/bin/yt-dlp`, path.join(prefix, 'bin', 'yt-dlp'));
  const script = [
    '#!/bin/sh',
    `echo "$@" >> '${file('calls')}'`,
    `mode=$(/bin/cat '${file('mode')}')`,
    'if [ "$mode" = slow ]; then',
    `  echo $$ > '${file('pids')}'`,
    '  /bin/sleep 30 &',
    `  echo $! >> '${file('pids')}'`,
    "  echo '==> Upgrading 1 outdated package'",
    '  wait',
    '  exit 0',
    'fi',
    'if [ "$mode" = fail ]; then',
    "  echo 'Error: yt-dlp: network unreachable' >&2",
    '  exit 1',
    'fi',
    "printf '\\033[1m==> Upgrading 1 outdated package:\\033[0m\\n'",
    "printf 'Downloading 10%%\\rDownloading 100%%\\n'",
    `echo '${NEW_VERSION}' > '${file('version')}'`,
    "echo '==> Summary'",
    '',
  ].join('\n');
  await fs.writeFile(file('bin/brew'), script, { mode: 0o755 });
  return {
    link: path.join(prefix, 'bin', 'yt-dlp'),
    brew: path.join(await fs.realpath(prefix), 'bin', 'brew'),
    mode: (mode) => fs.writeFile(file('mode'), mode),
    calls: () => fs.readFile(file('calls'), 'utf8').catch(() => ''),
    pids: async () =>
      (await fs.readFile(file('pids'), 'utf8').catch(() => ''))
        .split('\n')
        .filter(Boolean)
        .map(Number),
  };
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe.skipIf(process.platform === 'win32')('按原安装方式更新系统里的 yt-dlp（假 Homebrew）', () => {
  let side: Side | undefined;

  beforeEach(async () => {
    side = await startSide();
  });

  afterEach(async () => {
    await fs.chmod(path.join(side?.dir ?? '', 'locked'), 0o755).catch(() => {});
    await stopSide(side);
    side = undefined;
  });

  it('先交出完整命令要确认；确认后执行，输出进任务记录，结束后重新检测；失败时保留输出与退出码', async () => {
    const s = side!;
    const brew = await writeFakeBrew(s.dir);
    const set = await s.client.request('externalTools.setPath', { name: 'yt-dlp', path: brew.link });
    expect(set.tool).toMatchObject({
      state: 'installed',
      source: 'user',
      version: VERSION,
      update: { method: 'homebrew', argv: [brew.brew, 'upgrade', 'yt-dlp'], command: `${brew.brew} upgrade yt-dlp`, runnable: true, reason: null },
      updateJobId: null,
    });
    const plan = set.tool.update!;

    // 没交回命令、或交回的不是此刻的办法：不执行，交出办法。
    await expect(s.client.request('externalTools.update', { name: 'yt-dlp' })).rejects.toMatchObject({
      code: 'conflict',
      details: { code: 'TOOL_UPDATE_CONFIRM_REQUIRED', update: plan },
    });
    await expect(s.client.request('externalTools.update', { name: 'yt-dlp', command: 'brew upgrade yt-dlp' })).rejects.toMatchObject({
      details: { code: 'TOOL_UPDATE_CONFIRM_REQUIRED' },
    });
    expect(await brew.calls()).toBe('');

    const commandId = newId('cmd');
    const { jobId } = await s.client.request('externalTools.update', { name: 'yt-dlp', command: plan.command, commandId });
    // 同一个命令 ID 重发：交回同一个任务。
    expect((await s.client.request('externalTools.update', { name: 'yt-dlp', command: plan.command, commandId })).jobId).toBe(jobId);
    const done = await settledJob(s, jobId);
    expect(done).toMatchObject({
      kind: 'toolUpdate',
      state: 'completed',
      providerId: 'yt-dlp',
      modelId: VERSION,
      submitter: { kind: 'connection' },
      command: { line: plan.command, exitCode: 0, lines: 3, truncated: false },
      result: { artifactId: expect.any(String) },
    });
    // 去掉终端颜色，\r 改写的进度行只留最后一次。
    expect(done.command!.output).toBe('==> Upgrading 1 outdated package:\nDownloading 100%\n==> Summary\n');
    expect(await brew.calls()).toBe('upgrade yt-dlp\n');
    const record = JSON.parse((await s.runtime.models.jobs.artifacts.read(done.result!.artifactId!))!.toString('utf8'));
    expect(record).toMatchObject({
      schema: 'baocut.tool-update/1',
      tool: 'yt-dlp',
      method: 'homebrew',
      command: plan.command,
      outcome: 'exited',
      exitCode: 0,
      versionBefore: VERSION,
      versionAfter: NEW_VERSION,
      truncated: false,
    });
    expect(ytDlp((await s.client.request('externalTools.list', {})).tools)).toMatchObject({
      state: 'installed',
      version: NEW_VERSION,
      updateJobId: null,
    });

    await brew.mode('fail');
    const again = await s.client.request('externalTools.update', { name: 'yt-dlp', command: plan.command });
    expect(again.jobId).not.toBe(jobId);
    expect(await settledJob(s, again.jobId)).toMatchObject({
      state: 'failed',
      error: {
        code: 'TOOL_UPDATE_FAILED',
        message: '更新命令以 1 退出',
        details: { tool: 'yt-dlp', method: 'homebrew', exitCode: 1, remedy: expect.stringContaining(plan.command) },
      },
      command: { exitCode: 1, output: 'Error: yt-dlp: network unreachable\n' },
      result: { artifactId: expect.any(String) },
    });
  });

  it('更新期间流程拒绝、不能删除，重复请求交回同一个任务；停止时连同子进程一起结束', async () => {
    const s = side!;
    const brew = await writeFakeBrew(s.dir);
    const plan = (await s.client.request('externalTools.setPath', { name: 'yt-dlp', path: brew.link })).tool.update!;
    await s.client.request('externalTools.consent', { name: 'yt-dlp', grant: true });
    await brew.mode('slow');
    const { jobId } = await s.client.request('externalTools.update', { name: 'yt-dlp', command: plan.command });
    await until(async () => (await brew.pids()).length === 2);
    await until(() => s.runtime.models.jobs.inspect(jobId).command?.output.includes('Upgrading'));
    expect(s.runtime.models.jobs.inspect(jobId)).toMatchObject({ state: 'running', phase: 'downloading', command: { exitCode: null } });
    expect(ytDlp((await s.client.request('externalTools.list', {})).tools).updateJobId).toBe(jobId);
    expect((await s.client.request('externalTools.update', { name: 'yt-dlp', command: plan.command })).jobId).toBe(jobId);
    await expect(
      s.client.request('pipelines.start', { pipeline: 'link-import', params: { url: 'https://video.example.com/watch?v=a' } }),
    ).rejects.toMatchObject({ code: 'conflict', details: { code: 'TOOL_UPDATING', remedy: expect.stringContaining(jobId) } });
    await expect(s.client.request('externalTools.remove', { name: 'yt-dlp' })).rejects.toMatchObject({
      details: { code: 'TOOL_IN_USE', jobIds: [jobId] },
    });

    const [shell, sleep] = await brew.pids();
    await s.client.request('jobs.cancel', { jobId });
    expect((await settledJob(s, jobId)).state).toBe('cancelled');
    await until(() => !alive(shell!) && !alive(sleep!));
    expect(ytDlp((await s.client.request('externalTools.list', {})).tools).updateJobId).toBeNull();
  });

  it('不代为更新的情形：严格离线、判断不了安装方式、BaoCut 下载的副本、没有找到', async () => {
    const s = side!;
    await expect(s.client.request('externalTools.update', { name: 'yt-dlp' })).rejects.toMatchObject({
      details: { code: 'TOOL_UPDATE_UNSUPPORTED', remedy: expect.stringContaining('externalTools.detect') },
    });

    const brew = await writeFakeBrew(s.dir);
    const plan = (await s.client.request('externalTools.setPath', { name: 'yt-dlp', path: brew.link })).tool.update!;
    await s.client.request('settings.set', { values: { 'offline.strict': true } });
    await expect(s.client.request('externalTools.update', { name: 'yt-dlp', command: plan.command })).rejects.toMatchObject({
      details: { code: 'OFFLINE_STRICT' },
    });
    await s.client.request('settings.set', { values: { 'offline.strict': false } });
    expect(await brew.calls()).toBe('');

    // 自己写的包装脚本：认不出安装方式。
    const wrapper = await writeFakeYtDlp(path.join(s.dir, 'wrapper'));
    expect((await s.client.request('externalTools.setPath', { name: 'yt-dlp', path: wrapper.command })).tool.update).toBeNull();
    await expect(s.client.request('externalTools.update', { name: 'yt-dlp' })).rejects.toMatchObject({
      message: expect.stringContaining(wrapper.command),
      details: { code: 'TOOL_UPDATE_UNSUPPORTED' },
    });

    // BaoCut 下载的副本由清单决定版本，不按安装方式更新。
    await s.client.request('externalTools.setPath', { name: 'yt-dlp', path: null });
    const install = await s.client.request('externalTools.install', { name: 'yt-dlp', consent: true });
    expect((await settledJob(s, install.jobId)).state).toBe('completed');
    await expect(s.client.request('externalTools.update', { name: 'yt-dlp' })).rejects.toMatchObject({
      details: { code: 'TOOL_UPDATE_UNSUPPORTED', remedy: expect.stringContaining('externalTools.install') },
    });
  });

  it.skipIf(process.getuid?.() === 0)('要管理员权限才能改写时不代为执行：交出带 sudo 的命令', async () => {
    const s = side!;
    const locked = path.join(s.dir, 'locked');
    await fs.mkdir(locked);
    const versionFile = path.join(s.dir, 'zipapp-version');
    await fs.writeFile(versionFile, `${VERSION}\n`);
    // 像官方的 zipapp：shebang 之后是 zip 数据（这里在 exec 之后，shell 读不到）。
    const zipapp = path.join(locked, 'yt-dlp');
    await fs.writeFile(zipapp, Buffer.concat([Buffer.from(`#!/bin/sh\nexec /bin/cat '${versionFile}'\n`), Buffer.from('PK\x03\x04', 'latin1')]), {
      mode: 0o755,
    });
    await fs.chmod(locked, 0o555);
    const tool = (await s.client.request('externalTools.setPath', { name: 'yt-dlp', path: zipapp })).tool;
    expect(tool.update).toMatchObject({ method: 'standalone', argv: [zipapp, '-U'], command: `sudo ${zipapp} -U`, runnable: false });
    await expect(s.client.request('externalTools.update', { name: 'yt-dlp', command: tool.update!.command })).rejects.toMatchObject({
      details: { code: 'TOOL_UPDATE_MANUAL', update: tool.update, remedy: expect.stringContaining(`sudo ${zipapp} -U`) },
    });
  });
});

describe('下载失败的补救说明', () => {
  it('设置按设置页上的名字说，不写设置键', () => {
    for (const remedy of Object.values(TOOL_DOWNLOAD_REMEDIES)) expect(remedy).not.toMatch(/tools\.\w+/);
    expect(TOOL_DOWNLOAD_REMEDIES.TOOL_DOWNLOAD_NETWORK).toContain('「设置 › 通用」的「工具下载来源」');
    expect(TOOL_DOWNLOAD_REMEDIES.TOOL_DOWNLOAD_SOURCE).toContain('「设置 › 通用」的「工具下载来源」');
  });
});
