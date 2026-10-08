import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient } from '@baocut/client';
import { JobLedger } from '@baocut/jobs';
import { fakeGoogleHandler, fakeOpenAiHandler, startFakeProviderServer, type FakeProviderServer } from '@baocut/providers/testing';
import { newId, type AgentMode, type Autonomy, type Id, type Project } from '@baocut/protocol';
import { resolveRuntimeHome, type RuntimeHome } from '@baocut/runtime-storage';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';
import { startRuntime, type RunningRuntime } from '../runtime.ts';
import { ToolDriver, mcp, tool, until, type Loose, type ToolSession } from './testing/fake-agent.ts';

/**
 * 模型工具端到端（架构设计 §3.5、§6.2）：假智能体拿着会话令牌经真实的 MCP 端点调用 `models_*` 与 `jobs_*`（任务工具在 `job-tools.ts`，
 * 这里借真实的模型任务端到端覆盖 `jobs_inspect` / `jobs_cancel`），
 * 任务走与网关相同的 JobManager → 本机回环地址上的假供应商 → ffprobe 校验 → 产物；给了视频时经真实引擎导入为素材。
 * 密钥是测试里编的字符串，从不连真实的服务。需要 ffprobe / engine-host / ffmpeg 的部分缺了就跳过。
 */

const engine = resolveEngineHostCommand();
const hasTool = (command: string) => {
  try {
    execFileSync(command, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const ffprobe = hasTool(process.env.BAOCUT_FFPROBE || 'ffprobe');
const ffmpeg = hasTool(process.env.BAOCUT_FFMPEG || 'ffmpeg');
if (!ffprobe) console.warn('跳过模型工具的生成任务测试：没有 ffprobe');
if (!engine || !ffmpeg) console.warn('跳过模型工具带视频的测试：没有 engine-host 或 ffmpeg');

const OPENAI_KEY = 'sk-test-ONLY-FOR-TESTS-agent-tools-0123456789';
const GOOGLE_KEY = 'AIzaTESTONLY-agent-tools-0123456789abcdefgh';

interface Side {
  dir: string;
  home: RuntimeHome;
  runtime: RunningRuntime;
  driver: ToolDriver;
  client: BaoCutClient;
  project: Project;
  conversationId: Id;
  /** 智能体收到的每一个工具结果（检查里面没有密钥）。 */
  results: unknown[];
}

async function startSide(servers: { openai?: FakeProviderServer; google?: FakeProviderServer }, withEngine = false): Promise<Side> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-model-tools-'));
  const home = resolveRuntimeHome({ BAOCUT_HOME: dir });
  const driver = new ToolDriver();
  const runtime = await startRuntime({
    home,
    drivers: () => [driver],
    watchSpace: false,
    engineHost: withEngine ? engine : null,
    videoGraceMs: 100,
    modelWorker: null,
    jobIdleMs: 60_000,
    online: {
      baseUrls: {
        ...(servers.openai ? { openai: `${servers.openai.origin}/v1` } : {}),
        ...(servers.google ? { google: `${servers.google.origin}/v1beta` } : {}),
      },
      http: { backoffMs: () => 10 },
    },
  });
  const { endpoint, token } = runtime.discovery;
  const client = new BaoCutClient({
    resolve: async () => ({ endpoint, token }),
    client: { kind: 'desktop', name: 'test', version: '0' },
    reconnect: false,
  });
  await client.connect();
  const { project } = await client.request('projects.create', { name: '模型工具' });
  const {
    conversation: { id: conversationId },
  } = await client.request('conversations.create', { projectId: project.id });
  return { dir, home, runtime, driver, client, project, conversationId, results: [] };
}

async function stopSide(side: Side | undefined): Promise<void> {
  if (!side) return;
  side.client.close();
  await side.runtime.close();
  await fs.rm(side.dir, { recursive: true, force: true });
}

/** 发一条消息，等假智能体的回合开始。 */
async function send(
  side: Side,
  options: { autonomy?: Autonomy; accessMode?: AgentMode; conversationId?: Id } = {},
): Promise<{ taskId: Id; session: ToolSession }> {
  const conversationId = options.conversationId ?? side.conversationId;
  const before = side.driver.sessions.length;
  const { taskId } = await side.client.request('conversations.send', {
    conversationId,
    text: '做点事',
    commandId: newId('cmd'),
    ...(options.autonomy ? { autonomy: options.autonomy } : {}),
    ...(options.accessMode ? { accessMode: options.accessMode } : {}),
  });
  const session = await until(() => side.driver.sessions[conversationId === side.conversationId ? 0 : before]);
  await until(() => session.turnId);
  return { taskId, session };
}

/** 以智能体的身份调用工具，并记下结果。 */
async function call(side: Side, session: ToolSession, name: string, args: Record<string, unknown>) {
  const result = await tool(session, name, args);
  side.results.push(result);
  return result;
}

/** 轮询 `jobs_inspect` 直到任务终结（不另外读 Runtime 的内部状态）。 */
async function settle(side: Side, session: ToolSession, jobId: string): Promise<Loose> {
  return until(async () => {
    const { isError, body } = await call(side, session, 'jobs_inspect', { jobId });
    expect(isError).toBe(false);
    return ['completed', 'failed', 'cancelled', 'interrupted'].includes(body.state) ? body : null;
  }, 15_000);
}

/** 智能体看到的工具结果、日志、账本与配置文件里都不能出现密钥。 */
async function expectNoSecret(side: Side, secret: string) {
  expect(JSON.stringify(side.results)).not.toContain(secret);
  const files = [path.join(side.home.logsDir, 'runtime.log'), side.home.jobsFile, side.home.modelServicesFile];
  for (const file of files) expect(await fs.readFile(file, 'utf8').catch(() => ''), file).not.toContain(secret);
}

describe('模型工具：能力视图与提交时的拒绝（不需要 ffprobe）', () => {
  let side: Side | undefined;
  let openai: FakeProviderServer | undefined;

  afterEach(async () => {
    await stopSide(side);
    await openai?.close();
    side = openai = undefined;
  });

  it('translate：文本模型没有配置时以 CAPABILITY_NOT_CONFIGURED 拒绝，next 指向自己翻译，不请用户去配置', async () => {
    side = await startSide({});
    const srt = path.join(side.dir, 'talk.srt');
    await fs.writeFile(srt, '1\n00:00:00,000 --> 00:00:01,000\nhello\n');
    const { session } = await send(side);
    const refused = await call(side, session, 'translate', { file: srt, to: 'zh-CN' });
    expect(refused.body.error).toMatchObject({ code: 'CAPABILITY_NOT_CONFIGURED', capability: 'generateText' });
    expect(refused.body.error.next).toContain('自己翻译');
    expect(refused.body.error.next).not.toContain('设置里');
    expect((await call(side, session, 'translate', { file: srt, video: 'x', to: 'zh-CN' })).body.error.code).toBe('INVALID_ARGUMENTS');
    expect(side.runtime.models.jobs.list()).toEqual([]);
  });

  it('能力视图：三种能力、可用性与默认值；没有端点与密钥，也没有配置类的工具', async () => {
    openai = await startFakeProviderServer(fakeOpenAiHandler());
    side = await startSide({ openai });
    const { session } = await send(side);

    const listed = await mcp(session, 'tools/list');
    const names = (listed.result!.tools as { name: string }[]).map((t) => t.name);
    expect(names.filter((n) => /configure|default|credential|key|enable/i.test(n))).toEqual([]);

    const before = await call(side, session, 'models_capabilities', {});
    expect(before.isError).toBe(false);
    expect(before.body.capabilities.map((c: Loose) => c.capability)).toEqual([
      'transcribe',
      'synthesizeSpeech',
      'generateImage',
      'generateText',
      'separateAudio',
    ]);
    // 文本生成也列出（带能力参数），但没有提交它的工具。
    expect(before.body.capabilities[3]).toMatchObject({ parameters: { effort: null, concurrency: 4 } });
    // 目录里所有提供文本生成的服务商（§6.4），都没有配置。
    const textProviders = before.body.capabilities[3].providers.map((p: Loose) => p.providerId);
    expect(textProviders.slice(0, 3)).toEqual(['openai', 'google', 'anthropic']);
    expect(textProviders).toEqual(expect.arrayContaining(['deepseek', 'qwen', 'openrouter']));
    expect(before.body.capabilities[3].usableProviders).toEqual([]);
    expect(names.filter((n) => /text/i.test(n))).toEqual([]);
    const speech = before.body.capabilities[1];
    expect(speech).toMatchObject({ default: null, effective: null, usableProviders: [] });
    // 本机列出没装的合成模型包；在线的没有配置。
    expect(speech.providers.map((p: Loose) => p.providerId)).toEqual(['local', 'openai', 'elevenlabs']);
    expect(speech.providers[0]).toMatchObject({ kind: 'local', available: false, unavailableReason: 'not-installed' });
    expect(speech.providers[1]).toMatchObject({ kind: 'online', available: false, unavailableReason: 'not-configured', enabled: false });
    expect(speech.next).toContain('设置');

    // 用户在设置里启用 OpenAI（这是用户的操作，工具做不到）。
    await side.client.request('models.configure', { providerId: 'openai', enabled: true, credential: OPENAI_KEY });
    await side.client.request('models.setDefault', { capability: 'generateImage', providerId: 'openai' });
    const after = await call(side, session, 'models_capabilities', { capability: 'generateImage' });
    expect(after.body.capabilities).toHaveLength(1);
    const image = after.body.capabilities[0];
    expect(image).toMatchObject({
      capability: 'generateImage',
      default: { providerId: 'openai', modelId: 'gpt-image-2' },
      effective: { providerId: 'openai', modelId: 'gpt-image-2', source: 'user-default' },
      usableProviders: ['openai'],
    });
    const model = image.providers.find((p: Loose) => p.providerId === 'openai').models.find((m: Loose) => m.modelId === 'gpt-image-2');
    expect(model).toMatchObject({ maxCount: expect.any(Number), maxPromptChars: expect.any(Number), sizes: expect.any(Array) });
    // 智能体 Provider 也列出，带着如实的限制（这里的假 Driver 版本是 0，所以版本太旧）。
    const agent = image.providers.find((p: Loose) => p.providerId === 'agent:codex');
    expect(agent).toMatchObject({ kind: 'agent', available: false, unavailableReason: 'outdated', enabled: false });
    expect(agent.models[0]).toMatchObject({ maxCount: 1, sizes: [], acceptsSeed: false, cost: 'subscription', notes: expect.any(String) });
    expect(JSON.stringify(after.body)).not.toMatch(/endpoint|credential|http:\/\//);
    expect(openai.requests).toHaveLength(0);
    await expectNoSecret(side, OPENAI_KEY);
  });

  it('没有配置：CAPABILITY_NOT_CONFIGURED 带补救与 next；停用的服务同样；超长文本 INPUT_TOO_LONG；都不创建任务', async () => {
    openai = await startFakeProviderServer(fakeOpenAiHandler());
    side = await startSide({ openai });
    const { session } = await send(side);

    // 图片生成的本机模型包不作补救（界面只回落到云端）：补救是配置在线服务。
    const image = await call(side, session, 'image', { prompt: 'a cat' });
    expect(image.isError).toBe(true);
    expect(image.body.error).toMatchObject({
      code: 'CAPABILITY_NOT_CONFIGURED',
      capability: 'generateImage',
      reason: 'no-default',
      remedy: { action: 'configure-provider', hint: expect.stringContaining('设置') },
    });
    expect(image.body.error.remedy.commands).toEqual([expect.stringMatching(/^baocut models configure </)]);
    expect(image.body.error.next).toContain('别的服务商');
    // 点名还没配置的在线服务：补救是去设置里配置它。
    const online = await call(side, session, 'image', { prompt: 'a cat', provider: 'openai' });
    expect(online.isError).toBe(true);
    expect(online.body.error).toMatchObject({
      code: 'CAPABILITY_NOT_CONFIGURED',
      capability: 'generateImage',
      remedy: { action: 'configure-provider', hint: expect.stringContaining('设置') },
    });
    expect(online.body.error.remedy.commands).toEqual([expect.stringMatching(/^baocut models configure openai /)]);
    expect(online.body.error.next).toContain('不要用 shell 命令、脚本');
    expect(online.body.error.next).toContain('别的服务商');

    // 语音合成有本机模型包可装：补救是安装模型包（或配置在线服务）。
    const speech = await call(side, session, 'speak', { text: '你好' });
    expect(speech.isError).toBe(true);
    expect(speech.body.error).toMatchObject({
      code: 'CAPABILITY_NOT_CONFIGURED',
      capability: 'synthesizeSpeech',
      reason: 'no-default',
      remedy: { action: 'install-model', hint: expect.stringContaining('本机模型包') },
    });
    expect(speech.body.error.remedy.commands).toEqual([
      expect.stringMatching(/^baocut models list/),
      'baocut models install <bundleId>',
      expect.stringMatching(/^baocut models configure </),
    ]);
    expect(speech.body.error.next).toContain('不要用 shell 命令、脚本');

    // 启用了但没有默认值：提示设默认值。
    await side.client.request('models.configure', { providerId: 'openai', enabled: true, credential: OPENAI_KEY });
    const noDefault = await call(side, session, 'speak', { text: '你好' });
    expect(noDefault.body.error).toMatchObject({
      code: 'CAPABILITY_NOT_CONFIGURED',
      reason: 'no-default',
      remedy: { action: 'set-default' },
    });
    expect(noDefault.body.error.remedy.commands).toEqual(['baocut models default synthesizeSpeech openai']);

    // 超过模型上限：在提交时拒绝，说明上限，由智能体自己分段。
    const tooLong = await call(side, session, 'speak', { text: 'a'.repeat(4097), provider: 'openai' });
    expect(tooLong.body.error).toMatchObject({
      code: 'INPUT_TOO_LONG',
      details: { providerId: 'openai', modelId: 'gpt-4o-mini-tts', length: 4097, limit: 4096 },
    });
    expect(tooLong.body.error.message).toContain('4096');
    expect(tooLong.body.error.next).toContain('不超过 4096 个字符，逐段提交');

    // 模型没有的音色：invalid-request，带模型的音色清单。
    const badVoice = await call(side, session, 'speak', {
      text: 'hi',
      provider: 'openai',
      model: 'tts-1',
      voice: 'marin',
    });
    expect(badVoice.body.error).toMatchObject({ code: 'INVALID_REQUEST', details: { voices: expect.any(Array) } });
    expect(badVoice.body.error.next).toContain('details.voices');
    // 用户库的音色与网关同一条路解析（JobManager）：库里没有这个音色时 not-found，不创建任务。
    const noLibraryVoice = await call(side, session, 'speak', {
      text: 'hi',
      provider: 'openai',
      voice: 'library:voc_none',
    });
    expect(noLibraryVoice.isError).toBe(true);
    expect(noLibraryVoice.body.error.code).toBe('NOT_FOUND');
    // 参数形状不对：工具层拒绝。
    const badShape = await call(side, session, 'image', { prompt: 'x', size: 'huge', apiKey: 'x' });
    expect(badShape.body.error.code).toBe('INVALID_ARGUMENTS');

    // 用户停用了：remedy 是重新启用。
    await side.client.request('models.configure', { providerId: 'openai', enabled: false });
    const disabled = await call(side, session, 'image', { prompt: 'a cat', provider: 'openai' });
    expect(disabled.body.error).toMatchObject({
      code: 'CAPABILITY_NOT_CONFIGURED',
      reason: 'disabled',
      providerId: 'openai',
      remedy: { action: 'enable-provider', commands: ['baocut models configure openai --enable'] },
    });

    expect(await side.client.request('jobs.list', {})).toEqual({ jobs: [] });
    expect(openai.requests).toHaveLength(0);
    await expectNoSecret(side, OPENAI_KEY);
  });

  it('规划模式：可以看能力，不能提交；没有任务时工具不可用', async () => {
    openai = await startFakeProviderServer(fakeOpenAiHandler());
    side = await startSide({ openai });
    await side.client.request('models.configure', { providerId: 'openai', enabled: true, credential: OPENAI_KEY });
    const { session } = await send(side, { autonomy: 'plan' });
    expect((await call(side, session, 'models_capabilities', {})).isError).toBe(false);
    const refused = await call(side, session, 'speak', { text: 'hi', provider: 'openai' });
    expect(refused.body.error.code).toBe('PLAN_ONLY');
    expect((await call(side, session, 'jobs_cancel', { jobId: 'job_x' })).body.error.code).toBe('PLAN_ONLY');
    session.finish();
    await until(() => side!.runtime.harness.agentRun(side!.conversationId).taskId === null);
    expect((await call(side, session, 'models_capabilities', {})).body.error.code).toBe('NO_ACTIVE_TASK');
    expect(await side.client.request('jobs.list', {})).toEqual({ jobs: [] });
  });
});

describe('模型工具的访问模式（不需要 ffprobe）', () => {
  let side: Side | undefined;
  let openai: FakeProviderServer | undefined;

  afterEach(async () => {
    await stopSide(side);
    await openai?.close();
    side = openai = undefined;
  });

  it('交给已启用的在线 Provider 是 command：自动接受修改下要问（允许后才提交），切到 auto 后不问', async () => {
    openai = await startFakeProviderServer(fakeOpenAiHandler());
    side = await startSide({ openai });
    await side.client.request('models.configure', { providerId: 'openai', enabled: true, credential: OPENAI_KEY });
    const { session } = await send(side, { accessMode: 'autoAcceptEdits' });

    const submitting = call(side, session, 'speak', { text: 'hi', provider: 'openai' });
    const pending = await until(() => side!.runtime.harness.approvals.pending()[0]);
    expect(pending).toMatchObject({ action: { name: 'speak' }, risk: 'command', basis: { mode: 'autoAcceptEdits' } });
    expect((await side.client.request('jobs.list', {})).jobs).toEqual([]);
    await side.client.request('approvals.respond', { approvalId: pending.approvalId, decision: 'allow' });
    const submitted = await submitting;
    expect(submitted.body).toMatchObject({
      jobId: expect.stringMatching(/^job_/),
      approval: { mode: 'autoAcceptEdits', risk: 'command', decidedBy: 'user' },
    });

    await side.client.request('conversations.update', { conversationId: side.conversationId, accessMode: 'auto' });
    const auto = await call(side, session, 'speak', { text: 'hi again', provider: 'openai' });
    expect(auto.body).toMatchObject({ approval: { mode: 'auto', risk: 'command', decidedBy: 'auto' } });
    expect(side.runtime.harness.approvals.pending()).toEqual([]);
    await expectNoSecret(side, OPENAI_KEY);
  });
});

describe.skipIf(!ffprobe)('模型工具：生成任务（假供应商，不带视频）', () => {
  let side: Side;
  let openai: FakeProviderServer;
  let google: FakeProviderServer;

  beforeEach(async () => {
    openai = await startFakeProviderServer(fakeOpenAiHandler());
    google = await startFakeProviderServer(fakeGoogleHandler());
    side = await startSide({ openai, google });
    await side.client.request('models.configure', { providerId: 'openai', enabled: true, credential: OPENAI_KEY });
  });

  afterEach(async () => {
    await stopSide(side);
    await openai.close();
    await google.close();
  });

  it('语音（默认值）：立即返回 jobId，jobs_inspect 等到完成；提交者是这个会话与任务；结果是产物', async () => {
    await side.client.request('models.setDefault', { capability: 'synthesizeSpeech', providerId: 'openai' });
    const { taskId, session } = await send(side);
    const submitted = await call(side, session, 'speak', { text: '欢迎来到 BaoCut', speed: 1.25 });
    expect(submitted.isError).toBe(false);
    expect(submitted.body).toMatchObject({
      jobId: expect.stringMatching(/^job_/),
      kind: 'synthesizeSpeech',
      providerId: 'openai',
      modelId: 'gpt-4o-mini-tts',
      videoId: null,
      next: expect.stringContaining('jobs_wait'),
    });
    const { jobId } = submitted.body;
    expect(side.runtime.models.jobs.inspect(jobId).submitter).toEqual({ kind: 'agent', id: side.conversationId, taskId });

    const job = await settle(side, session, jobId);
    expect(job).toMatchObject({
      state: 'completed',
      phase: 'done',
      providerId: 'openai',
      modelId: 'gpt-4o-mini-tts',
      submittedBy: 'agent',
      parameters: { capability: 'synthesizeSpeech', voice: 'marin', format: 'mp3', speed: 1.25, language: null, textChars: 11 },
      outputs: [{ artifactId: expect.stringMatching(/^sha256:[0-9a-f]{64}$/), mediaType: 'audio/mpeg', assetId: null }],
    });
    expect(job.parameters.text).toBeUndefined();
    expect(job.outputs[0].media).toMatchObject({ kind: 'audio', sampleRate: 44100, channels: 1 });
    expect(job.next).toContain('产物');
    // 账本里留下同样的提交者（重启之后仍可归属）。
    const ledger = { jobs: await new JobLedger(side.home.jobsFile).load() };
    expect(ledger.jobs[0]!.record.submitter).toEqual({ kind: 'agent', id: side.conversationId, taskId });
    await expectNoSecret(side, OPENAI_KEY);
  });

  it('图片（显式 Provider）：两张，按宽高比；jobs_inspect 报告每个输出的尺寸', async () => {
    await side.client.request('models.configure', { providerId: 'google', enabled: true, credential: GOOGLE_KEY });
    const { session } = await send(side);
    const submitted = await call(side, session, 'image', {
      prompt: 'a red fox',
      provider: 'google',
      size: '16:9',
      count: 2,
    });
    expect(submitted.body).toMatchObject({ kind: 'generateImage', providerId: 'google', modelId: 'gemini-3.1-flash-image' });
    const job = await settle(side, session, submitted.body.jobId);
    expect(job).toMatchObject({
      state: 'completed',
      parameters: { capability: 'generateImage', prompt: 'a red fox', size: '1376x768', aspectRatio: '16:9', count: 2, format: 'png' },
    });
    expect(job.outputs).toHaveLength(2);
    for (const output of job.outputs) expect(output).toMatchObject({ mediaType: 'image/png', assetId: null, media: { kind: 'image' } });
    expect(google.requests[0]!.headers['x-goog-api-key']).toBe(GOOGLE_KEY);
    await expectNoSecret(side, GOOGLE_KEY);
    await expectNoSecret(side, OPENAI_KEY);
  });

  it('jobs_cancel 取消自己的任务；用户与别的会话的任务看不到、取消不了', async () => {
    openai.handler = () => 'hang';
    const { session } = await send(side);
    const { body } = await call(side, session, 'speak', { text: 'hi', provider: 'openai' });
    await openai.waitForRequests(1);
    await until(async () => (await call(side, session, 'jobs_inspect', { jobId: body.jobId })).body.phase === 'generating');
    // 取消是 command：默认的 auto 模式下自动放行，结果里记下依据。
    expect((await call(side, session, 'jobs_cancel', { jobId: body.jobId })).body).toEqual({
      jobId: body.jobId,
      state: 'cancelled',
      approval: { mode: 'auto', risk: 'command', decidedBy: 'auto' },
    });
    expect((await call(side, session, 'jobs_inspect', { jobId: body.jobId })).body).toMatchObject({ state: 'cancelled' });

    // 用户在工具页提交的、不属于任何视频的任务：智能体看不到。
    openai.handler = fakeOpenAiHandler();
    const user = await side.client.request('models.synthesizeSpeech', { text: 'user text', provider: 'openai' });
    expect((await call(side, session, 'jobs_inspect', { jobId: user.jobId })).body.error.code).toBe('JOB_NOT_FOUND');
    expect((await call(side, session, 'jobs_cancel', { jobId: user.jobId })).body.error.code).toBe('JOB_NOT_FOUND');
    expect((await call(side, session, 'jobs_inspect', { jobId: 'job_missing' })).body.error.code).toBe('JOB_NOT_FOUND');

    // 另一个会话的智能体也看不到这个会话的任务。
    const other = await side.client.request('conversations.create', { projectId: side.project.id });
    const { session: otherSession } = await send(side, { conversationId: other.conversation.id });
    expect(otherSession).not.toBe(session);
    expect((await call(side, otherSession, 'jobs_inspect', { jobId: body.jobId })).body.error.code).toBe('JOB_NOT_FOUND');
    expect(JSON.stringify(side.results)).not.toContain('user text');
  });

  it('artifacts_save：产物复制到工作目录；已有文件只有 overwrite 才替换；写不到外面、符号链接与视频目录；别人的产物用不了', async () => {
    const { session } = await send(side);
    const submitted = await call(side, session, 'speak', { text: '保存我', provider: 'openai' });
    const job = await settle(side, session, submitted.body.jobId);
    const artifactId: string = job.outputs[0].artifactId;
    const bytes = (await side.runtime.models.jobs.artifacts.read(artifactId))!;
    const root = await fs.realpath(side.project.path);

    // 省略扩展名时补上产物的；中间的目录新建。
    const saved = await call(side, session, 'artifacts_save', { artifactId, path: 'out/voice' });
    expect(saved.isError).toBe(false);
    expect(saved.body).toMatchObject({
      artifactId,
      jobId: job.jobId,
      path: path.join('out', 'voice.mp3'),
      mediaType: 'audio/mpeg',
      byteLength: bytes.length,
      overwritten: false,
      approval: { mode: 'auto', risk: 'edit', decidedBy: 'auto' },
    });
    expect(await fs.readFile(path.join(root, 'out', 'voice.mp3'))).toEqual(bytes);

    // 已经存在：不带 overwrite 拒绝（不生成审批），带了是 high：auto 模式下也要问用户，拒绝时不写，允许后才替换。
    await fs.writeFile(path.join(root, 'out', 'voice.mp3'), 'mine');
    const exists = await call(side, session, 'artifacts_save', { artifactId, path: 'out/voice.mp3' });
    expect(exists.body.error.code).toBe('PATH_EXISTS');
    expect(side.runtime.harness.approvals.pending()).toEqual([]);
    expect(await fs.readFile(path.join(root, 'out', 'voice.mp3'), 'utf8')).toBe('mine');
    const answer = async (decision: 'allow' | 'deny') => {
      const pending = await until(() => side.runtime.harness.approvals.pending()[0]);
      expect(pending).toMatchObject({
        subject: { kind: 'conversation', conversationId: side.conversationId },
        action: { kind: 'tool', name: 'artifacts_save', targets: [path.join('out', 'voice.mp3')] },
        risk: 'high',
        basis: { kind: 'mode', mode: 'auto' },
        expiresAt: null,
      });
      expect(await side.client.request('approvals.respond', { approvalId: pending.approvalId, decision })).toEqual({
        status: decision === 'allow' ? 'allowed' : 'denied',
      });
    };
    const declined = call(side, session, 'artifacts_save', { artifactId, path: 'out/voice.mp3', overwrite: true });
    await answer('deny');
    expect((await declined).body.error).toMatchObject({ code: 'APPROVAL_DENIED', mode: 'auto', risk: 'high' });
    expect(await fs.readFile(path.join(root, 'out', 'voice.mp3'), 'utf8')).toBe('mine');
    const replacing = call(side, session, 'artifacts_save', { artifactId, path: 'out/voice.mp3', overwrite: true });
    await answer('allow');
    const replaced = await replacing;
    expect(replaced.body).toMatchObject({ overwritten: true, approval: { mode: 'auto', risk: 'high', decidedBy: 'user' } });
    expect(await fs.readFile(path.join(root, 'out', 'voice.mp3'))).toEqual(bytes);
    const card = side.runtime.harness.getConversation(side.conversationId).items.filter((i) => i.kind === 'approval');
    expect(card.map((i) => i.kind === 'approval' && [i.status, i.risk, i.mode, i.decidedBy])).toEqual([
      ['declined', 'high', 'auto', 'user'],
      ['accepted', 'high', 'auto', 'user'],
    ]);

    // 写到外面：..、绝对路径、经过指向别处的符号链接目录、目标本身是符号链接。
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-outside-'));
    try {
      await fs.writeFile(path.join(outside, 'victim.mp3'), 'keep');
      await fs.symlink(outside, path.join(root, 'link'));
      await fs.symlink(path.join(outside, 'victim.mp3'), path.join(root, 'victim.mp3'));
      for (const target of ['../escape.mp3', path.join(outside, 'abs.mp3'), 'link/escape.mp3', 'link/sub/escape.mp3']) {
        const refused = await call(side, session, 'artifacts_save', { artifactId, path: target });
        expect(refused.body.error?.code, target).toBe('PATH_OUTSIDE_WORKSPACE');
      }
      const linked = await call(side, session, 'artifacts_save', { artifactId, path: 'victim.mp3', overwrite: true });
      expect(linked.body.error.code).toBe('PATH_IS_SYMLINK');
      expect((await fs.readdir(outside)).sort()).toEqual(['victim.mp3']);
      expect(await fs.readFile(path.join(outside, 'victim.mp3'), 'utf8')).toBe('keep');
      expect(await fs.stat(path.join(root, '..', 'escape.mp3')).catch(() => null)).toBeNull();
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }

    // 视频目录与 .bcut 不写；扩展名要与产物一致。
    await fs.mkdir(path.join(root, 'clip-video'));
    await fs.writeFile(path.join(root, 'clip-video', 'video.db'), '');
    expect((await call(side, session, 'artifacts_save', { artifactId, path: 'clip-video/a.mp3' })).body.error.code).toBe(
      'PATH_INSIDE_VIDEO',
    );
    expect((await call(side, session, 'artifacts_save', { artifactId, path: '.bcut/a.mp3' })).body.error.code).toBe('PATH_INSIDE_VIDEO');
    expect((await call(side, session, 'artifacts_save', { artifactId, path: 'a.wav' })).body.error.code).toBe('EXTENSION_MISMATCH');

    // 用户在工具页生成的（不属于任何视频）与不存在的产物：一样回答找不到。
    const user = await side.client.request('models.synthesizeSpeech', { text: 'user text', provider: 'openai', format: 'wav' });
    expect(await side.runtime.models.jobs.settled(user.jobId)).toBe('completed');
    const userArtifact = side.runtime.models.jobs.inspect(user.jobId).result!.outputs![0]!.artifactId;
    expect(userArtifact).not.toBe(artifactId);
    expect((await call(side, session, 'artifacts_save', { artifactId: userArtifact, path: 'user.wav' })).body.error.code).toBe(
      'ARTIFACT_NOT_FOUND',
    );
    const missing = `sha256:${'0'.repeat(64)}`;
    expect((await call(side, session, 'artifacts_save', { artifactId: missing, path: 'x.mp3' })).body.error.code).toBe(
      'ARTIFACT_NOT_FOUND',
    );
    // 另一个会话的智能体用不了这个会话的产物。
    const other = await side.client.request('conversations.create', { projectId: side.project.id });
    const { session: otherSession } = await send(side, { conversationId: other.conversation.id });
    expect((await call(side, otherSession, 'artifacts_save', { artifactId, path: 'other.mp3' })).body.error.code).toBe(
      'ARTIFACT_NOT_FOUND',
    );
    expect(await fs.stat(path.join(root, 'user.wav')).catch(() => null)).toBeNull();
    expect(await fs.stat(path.join(root, 'other.mp3')).catch(() => null)).toBeNull();
    await expectNoSecret(side, OPENAI_KEY);
  });

  it('主停止取消这个会话还没结束的任务；完成的结果保留；停止回复不取消；别的会话与用户的任务不受影响', async () => {
    const { taskId, session } = await send(side);
    const done = await call(side, session, 'speak', { text: '已经完成', provider: 'openai' });
    const completed = await settle(side, session, done.body.jobId);
    expect(completed.state).toBe('completed');

    openai.handler = () => 'hang';
    const running = await call(side, session, 'speak', { text: '一直在跑', provider: 'openai' });
    const second = await call(side, session, 'image', { prompt: 'still going', provider: 'openai' });
    await openai.waitForRequests(3);
    // 另一个会话的智能体与用户自己的任务（排在后面，可能还在排队）。
    const other = await side.client.request('conversations.create', { projectId: side.project.id });
    const { session: otherSession } = await send(side, { conversationId: other.conversation.id });
    const foreign = await call(side, otherSession, 'speak', { text: '别的会话', provider: 'openai' });
    const user = await side.client.request('models.synthesizeSpeech', { text: '用户的', provider: 'openai' });
    const jobs = side.runtime.models.jobs;
    expect(jobs.inspect(running.body.jobId).state).toBe('running');

    // 次级操作「停止回复」：只停回合，不取消任务。
    expect(await side.client.request('agents.interrupt', { conversationId: side.conversationId })).toEqual({ status: 'requested' });
    expect(jobs.inspect(running.body.jobId).state).toBe('running');

    await side.client.request('tasks.stop', { taskId });
    expect(await jobs.settled(running.body.jobId)).toBe('cancelled');
    expect(await jobs.settled(second.body.jobId)).toBe('cancelled');
    session.finish('interrupted');
    await until(() => side.runtime.harness.agentRun(side.conversationId).taskId === null);

    // 完成的保留结果；别的会话与用户的任务没有被取消。
    expect(jobs.inspect(done.body.jobId)).toMatchObject({
      state: 'completed',
      result: { outputs: [{ artifactId: completed.outputs[0].artifactId }] },
    });
    for (const jobId of [foreign.body.jobId, user.jobId]) expect(['queued', 'running']).toContain(jobs.inspect(jobId).state);
    const notices = side.runtime.harness
      .getConversation(side.conversationId)
      .items.filter((item) => item.kind === 'notice' && item.taskId === taskId)
      .map((item) => (item as { text: string }).text);
    expect(notices).toEqual([expect.stringContaining('2 个后台任务')]);
    expect(side.runtime.harness.getConversation(other.conversation.id).items.some((item) => item.kind === 'notice')).toBe(false);
  });
});

describe.skipIf(!ffprobe || !ffmpeg || !engine)('模型工具：带视频（真实引擎 + 假供应商）', () => {
  let fixtures: string;
  let audio: string;
  let side: Side;
  let openai: FakeProviderServer;
  let videoId: Id;
  let videoPath: string;

  beforeAll(async () => {
    fixtures = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-fixtures-'));
    audio = path.join(fixtures, 'voice.wav');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-ar', '16000', '-ac', '1', audio]);
  });

  afterAll(async () => {
    await fs.rm(fixtures, { recursive: true, force: true });
  });

  beforeEach(async () => {
    openai = await startFakeProviderServer(fakeOpenAiHandler());
    side = await startSide({ openai }, true);
    await side.client.request('models.configure', { providerId: 'openai', enabled: true, credential: OPENAI_KEY });
    const opened = await side.client.request('videos.create', { projectId: side.project.id, name: '样片' });
    videoId = opened.ref.videoId;
    videoPath = opened.ref.relPath;
  });

  afterEach(async () => {
    await stopSide(side);
    await openai.close();
  });

  it('语音与图片带视频：导入为候选素材（不上时间线），assetId 由 jobs_inspect 给出，之后 edits_apply 才放上去', async () => {
    const { session } = await send(side);
    const before = side.runtime.videos.mirror(videoId)!.video;
    const speech = await call(side, session, 'speak', {
      text: '第一句旁白',
      provider: 'openai',
      video: videoPath,
      name: '旁白 1',
    });
    const image = await call(side, session, 'image', { prompt: 'a lighthouse', provider: 'openai', video: videoId });
    expect(speech.body.videoId).toBe(videoId);
    expect(image.body.videoId).toBe(videoId);
    const speechJob = await settle(side, session, speech.body.jobId);
    const imageJob = await settle(side, session, image.body.jobId);
    expect(speechJob).toMatchObject({ state: 'completed', videoId, outputs: [{ mediaType: 'audio/mpeg', assetId: expect.any(String) }] });
    expect(imageJob).toMatchObject({ state: 'completed', videoId, outputs: [{ mediaType: 'image/png', assetId: expect.any(String) }] });
    expect(speechJob.next).toContain('addItem');
    // 应用记录智能体看得到（只有状态与原因）；没有对账的工具（工具列表见 agent-tools.test.ts）。
    expect(speechJob.applications).toEqual([{ state: 'committed', videoId }]);

    const video = side.runtime.videos.mirror(videoId)!.video;
    const voiceId = speechJob.outputs[0].assetId;
    expect(video.assets[voiceId]!.name).toBe('旁白 1');
    expect(JSON.stringify(video.sequences)).toBe(JSON.stringify(before.sequences));

    const inspected = await call(side, session, 'videos_inspect', { video: videoId });
    const placed = await call(side, session, 'edits_apply', {
      video: videoId,
      expectedRevision: inspected.body.revision,
      label: '放入旁白',
      operations: [{ type: 'addItem', asset: voiceId, at: 0 }],
    });
    expect(placed.isError).toBe(false);
    expect(placed.body.status).toBe('committed');
    await expectNoSecret(side, OPENAI_KEY);
  });

  it('没带视频的产物：edits_apply 的 importAsset + artifactId 导入为 managed 素材，来源与带视频的生成相同，不再调用供应商', async () => {
    const { session } = await send(side);
    // 同样的文本，一次带视频、一次不带：两条路导入的素材来源要一样。带视频的那次用 wav：bytes 不同，引擎才不会复用同一个素材。
    const submit = async (name: string, args: Record<string, unknown>) =>
      settle(side, session, (await call(side, session, name, args)).body.jobId);
    const withVideo = await submit('speak', {
      text: '后来才放进视频',
      provider: 'openai',
      format: 'wav',
      video: videoId,
    });
    const loose = await submit('speak', { text: '后来才放进视频', provider: 'openai' });
    const images = await submit('image', { prompt: 'two frames', provider: 'openai', count: 2 });
    expect(loose.outputs[0].assetId).toBeNull();
    const requests = openai.requests.length;

    const inspected = await call(side, session, 'videos_inspect', { video: videoId });
    const applied = await call(side, session, 'edits_apply', {
      video: videoPath,
      expectedRevision: inspected.body.revision,
      label: '放入生成的旁白与图片',
      operations: [
        { type: 'importAsset', artifactId: loose.outputs[0].artifactId, ref: 'voice' },
        { type: 'addItem', asset: { ref: 'voice' }, at: 0 },
        { type: 'importAsset', artifactId: images.outputs[1].artifactId, name: '第二张' },
        { type: 'importAsset', artifactId: images.outputs[0].artifactId },
      ],
    });
    expect(applied.isError).toBe(false);
    expect(applied.body.status).toBe('committed');
    expect(openai.requests.length).toBe(requests);

    const video = side.runtime.videos.mirror(videoId)!.video;
    const find = (jobId: string, artifactId: string) => {
      const asset = Object.values(video.assets).find((a) => {
        const source = a.revisions[a.currentRevision]!.provenance.source as Loose;
        return source?.jobId === jobId && source?.artifactId === artifactId;
      })!;
      return { asset, revision: asset.revisions[asset.currentRevision]! };
    };
    const reference = find(withVideo.jobId, withVideo.outputs[0].artifactId).revision;
    const { asset: voice, revision } = find(loose.jobId, loose.outputs[0].artifactId);
    expect(voice.name).toBe('配音：后来才放进视频');
    expect(revision.storage).toEqual({ mode: 'managed' });
    expect(reference.storage).toEqual({ mode: 'managed' });
    const record = side.runtime.models.jobs.inspect(loose.jobId);
    expect(revision.provenance).toMatchObject({
      origin: 'generated',
      source: {
        jobId: loose.jobId,
        capability: 'synthesizeSpeech',
        providerId: 'openai',
        modelId: 'gpt-4o-mini-tts',
        inputHash: record.inputHash,
        contentHash: record.contentHash,
        artifactId: loose.outputs[0].artifactId,
        parameters: { capability: 'synthesizeSpeech', voice: 'marin', format: 'mp3', language: null },
      },
    });
    // 与带视频的那次同一个形状：除了任务号、输入 hash（含视频与格式）、产物与格式，来源完全相同；原文不进来源。
    const comparable = (r: typeof revision) => {
      const { jobId: _j, inputHash: _i, artifactId: _a, parameters, ...rest } = r.provenance.source as Record<string, Loose>;
      const { format: _f, ...others } = parameters;
      return { origin: r.provenance.origin, ...rest, parameters: others };
    };
    expect(comparable(revision)).toEqual(comparable(reference));
    expect(JSON.stringify(revision.provenance)).not.toContain('后来才放进视频');
    // 放上了时间线；多张图的默认名带序号，给了 name 时用它。
    expect(JSON.stringify(video.sequences)).toContain(voice.id);
    expect(find(images.jobId, images.outputs[1].artifactId).asset.name).toBe('第二张');
    expect(find(images.jobId, images.outputs[0].artifactId).asset.name).toBe('图片：two frames 1');

    // 拒绝：path 与 artifactId 同时给、要链接、自带来源、不存在的产物、用户在工具页生成的；视频不变。
    // 用户的任务要有智能体没生成过的 bytes（假供应商的第 i 张图各不相同）：第三张。
    const user = await side.client.request('models.generateImage', { prompt: 'user only', provider: 'openai', count: 3 });
    expect(await side.runtime.models.jobs.settled(user.jobId)).toBe('completed');
    const userArtifact = side.runtime.models.jobs.inspect(user.jobId).result!.outputs![2]!.artifactId;
    const revisionNow = side.runtime.videos.mirror(videoId)!.video.revision;
    const artifactId = loose.outputs[0].artifactId;
    for (const [operation, code] of [
      [{ type: 'importAsset', artifactId, path: 'x.mp3' }, 'INVALID_OPERATION'],
      [{ type: 'importAsset', artifactId, storage: 'linked' }, 'INVALID_OPERATION'],
      [{ type: 'importAsset', artifactId, provenance: { origin: 'user' } }, 'INVALID_OPERATION'],
      [{ type: 'importAsset', artifactId: `sha256:${'1'.repeat(64)}` }, 'ARTIFACT_NOT_FOUND'],
      [{ type: 'importAsset', artifactId: userArtifact }, 'ARTIFACT_NOT_FOUND'],
    ] as const) {
      const refused = await call(side, session, 'edits_apply', {
        video: videoId,
        expectedRevision: revisionNow,
        label: '不该成功',
        operations: [operation],
      });
      expect(refused.body.error?.code, JSON.stringify(operation)).toBe(code);
    }
    expect(side.runtime.videos.mirror(videoId)!.video.revision).toBe(revisionNow);
    expect(openai.requests.length).toBe(requests + 1);
    await expectNoSecret(side, OPENAI_KEY);
  });

  it('转写：transcribe 给 video 与 asset，转录流程经在线 Provider 写成 speech 文档', async () => {
    await side.client.request('models.setDefault', { capability: 'transcribe', providerId: 'openai' });
    const imported = await side.client.request('edits.apply', {
      videoId,
      commandId: newId('cmd'),
      expectedRevision: side.runtime.videos.mirror(videoId)!.video.revision,
      operations: [{ type: 'importAsset', path: audio, ref: 'voice' }],
    });
    const assetId = imported.receipt.refs!.voice!;
    const { session } = await send(side);
    const submitted = await call(side, session, 'transcribe', { video: videoPath, asset: assetId, hint: 'BaoCut', noCaptions: true });
    expect(submitted.body).toMatchObject({ jobId: expect.any(String) });
    const job = await settle(side, session, submitted.body.jobId);
    expect(job).toMatchObject({
      state: 'completed',
      kind: 'pipeline',
      submittedBy: 'agent',
      pipeline: { name: 'transcribe', summary: { videoId, assetId, documentId: expect.any(String), providerId: 'openai' } },
    });
    expect(job.next).toContain('documentId');
    const document = await side.client.request('documents.read', { videoId, documentId: job.pipeline.summary.documentId });
    expect((document.body as { words: { text: string }[] }).words.map((w) => w.text)).toEqual(['hello', 'world']);
    await expectNoSecret(side, OPENAI_KEY);
  });

  it('转写：transcribe 给 file 时新建视频、导入并转写；加 noVideo 时只写 TXT 与 SRT 文稿', async () => {
    await side.client.request('models.setDefault', { capability: 'transcribe', providerId: 'openai' });
    const { session } = await send(side);
    const created = await call(side, session, 'transcribe', { file: audio, name: '口播', noCaptions: true });
    expect(created.body).toMatchObject({ jobId: expect.any(String) });
    const job = await settle(side, session, created.body.jobId);
    expect(job).toMatchObject({
      state: 'completed',
      pipeline: { name: 'transcribe', summary: { createdVideo: true, documentId: expect.any(String) } },
    });
    const newVideoId = job.pipeline.summary.videoId as Id;
    expect(newVideoId).not.toBe(videoId);
    // 新视频与 videos_create 建在同一处（会话所属的项目），智能体看得到。
    expect(side.runtime.videos.ref(newVideoId)?.source.projectId).toBe(side.project.id);
    const listed = await call(side, session, 'videos_list', {});
    expect(JSON.stringify(listed.body)).toContain(newVideoId);
    const document = await side.client.request('documents.read', { videoId: newVideoId, documentId: job.pipeline.summary.documentId });
    expect((document.body as { words: { text: string }[] }).words.map((w) => w.text)).toEqual(['hello', 'world']);

    // 只要文稿：不建视频，写到 outDir。
    const outDir = path.join(fixtures, 'transcripts');
    const only = await call(side, session, 'transcribe', { file: audio, noVideo: true, outDir });
    const fileJob = await settle(side, session, only.body.jobId);
    expect(fileJob).toMatchObject({ state: 'completed', pipeline: { name: 'transcribe' } });
    expect(fileJob.pipeline.summary.files.map((f: string) => path.basename(f)).sort()).toEqual(['voice.srt', 'voice.txt']);
    expect(await fs.readFile(path.join(outDir, 'voice.txt'), 'utf8')).toContain('hello');
    expect(fileJob.next).toContain('TXT');

    // 参数组合不对：不提交。
    for (const args of [{}, { file: audio, video: videoPath }, { file: audio, asset: 'ast_x' }, { video: videoPath, noVideo: true }]) {
      expect((await call(side, session, 'transcribe', args)).body.error.code, JSON.stringify(args)).toBe('INVALID_ARGUMENTS');
    }
    await expectNoSecret(side, OPENAI_KEY);
  });

  it('工作目录以外的视频：提交被拒绝；那个视频上的任务看不到，本目录视频上用户的任务看得到', async () => {
    const { project: elsewhere } = await side.client.request('projects.create', { name: '别的项目' });
    const outside = await side.client.request('videos.create', { projectId: elsewhere.id, name: '别处' });
    const outsideId = outside.ref.videoId;
    const { session } = await send(side);

    const speech = await call(side, session, 'speak', { text: 'hi', provider: 'openai', video: outsideId });
    expect(speech.body.error.code).toBe('VIDEO_OUTSIDE_WORKSPACE');
    const transcribe = await call(side, session, 'transcribe', { video: outsideId, asset: 'ast_x', provider: 'openai' });
    expect(transcribe.body.error.code).toBe('VIDEO_OUTSIDE_WORKSPACE');
    const missing = await call(side, session, 'image', { prompt: 'x', provider: 'openai', video: '../别处' });
    expect(missing.body.error.code).toMatch(/VIDEO_NOT_FOUND|VIDEO_OUTSIDE_WORKSPACE/);
    expect(side.runtime.models.jobs.list()).toEqual([]);

    // 用户直接提交的任务：别处视频上的看不到，本目录视频上的看得到（只读）。
    const hidden = await side.client.request('models.generateImage', { prompt: 'secret plan', provider: 'openai', videoId: outsideId });
    const visible = await side.client.request('models.generateImage', { prompt: 'shared', provider: 'openai', videoId });
    expect((await call(side, session, 'jobs_inspect', { jobId: hidden.jobId })).body.error.code).toBe('JOB_NOT_FOUND');
    const seen = await settle(side, session, visible.jobId);
    expect(seen).toMatchObject({ state: 'completed', submittedBy: 'user', videoId });
    expect((await call(side, session, 'jobs_cancel', { jobId: visible.jobId })).body.error.code).toBe('JOB_NOT_OWNED');
    expect(JSON.stringify(side.results)).not.toContain('secret plan');
  });
});
