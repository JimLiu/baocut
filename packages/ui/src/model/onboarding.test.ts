import { describe, expect, it } from 'vitest';
import type { DriverInfo, JobRecord, ModelBundleStatus, ModelComponentStatus } from '@baocut/protocol';
import {
  agentJobStatus,
  agentLine,
  agentPrimary,
  agentRows,
  bgLine,
  bundleProgress,
  cardState,
  combineStatus,
  downloadPlan,
  initialPicks,
  isLastStep,
  modelPrimary,
  onboardingRecord,
  parseOnboardingRecord,
  planLine,
  setupProgress,
  shouldShowOnboarding,
  stepChoices,
} from './onboarding.ts';

const MB = 1024 * 1024;

const part = (component: string, state: ModelComponentStatus['state'], mb: number, repo = `o/${component}`): ModelComponentStatus => ({
  component,
  repo,
  revision: 'r1',
  state,
  bytes: state === 'installed' ? mb * MB : null,
  estimatedBytes: mb * MB,
  sharedWith: [],
});

function bundle(bundleId: string, capability: ModelBundleStatus['capability'], patch: Partial<ModelBundleStatus> = {}): ModelBundleStatus {
  return {
    bundleId,
    capability,
    label: bundleId.split('@')[0]!.toUpperCase(),
    backend: 'mlx',
    device: 'metal',
    state: 'not-installed',
    components: [part('asr', 'missing', 1000, `o/${bundleId}`)],
    ...patch,
  };
}

const ASR = [
  bundle('qwen3-asr-1.7b@mlx-8bit', 'transcribe'),
  bundle('moss-transcribe-diarize@mlx-8bit', 'transcribe', {
    components: [part('asr', 'missing', 1700, 'o/moss'), part('speaker', 'missing', 26, 'o/wespeaker'), part('aligner', 'missing', 600, 'o/aligner')],
  }),
  bundle('whisper-large-v3@coreml', 'transcribe', { reason: 'unsupported' }),
  bundle('speaker-diarization@mlx', 'diarize', { label: '说话人区分' }),
  bundle('qwen3-forced-aligner@mlx', 'align'),
];
const TTS = [
  bundle('indextts2@audio-cpp-q8', 'synthesize'),
  bundle('voxcpm2@audio-cpp-q8', 'synthesize'),
  bundle('qwen3-tts-0.6b-base@audio-cpp-q8', 'synthesize'),
  bundle('qwen3-tts-1.7b-customvoice@audio-cpp-q8', 'synthesize'),
];

describe('步骤与记录', () => {
  it('没有记录才弹；走完、退出都记下', () => {
    expect(shouldShowOnboarding(null)).toBe(true);
    const rec = onboardingRecord('skipped', 'tts', ['a', 'a', 'b']);
    expect(rec).toEqual({ state: 'skipped', step: 'tts', downloaded: ['a', 'b'] });
    expect(shouldShowOnboarding(rec)).toBe(false);
    expect(isLastStep('music')).toBe(true);
    expect(isLastStep('agent')).toBe(false);
  });

  it('本机存着的记录认不出时当作没有', () => {
    expect(parseOnboardingRecord(null)).toBeNull();
    expect(parseOnboardingRecord({ state: 'later' })).toBeNull();
    expect(parseOnboardingRecord({ state: 'done', step: 'nope', downloaded: ['x', 3] })).toEqual({ state: 'done', step: 'agent', downloaded: ['x'] });
  });
});

describe('每一步的候选', () => {
  it('转录：推荐的 MOSS 排第一，跑不了的与辅助包不列，写清怎么区分说话人', () => {
    const list = stepChoices('asr', ASR);
    expect(list.map((c) => c.bundle.bundleId)).toEqual(['moss-transcribe-diarize@mlx-8bit', 'qwen3-asr-1.7b@mlx-8bit']);
    expect(list[0]).toMatchObject({ recommended: true, note: '转录同时区分说话人' });
    expect(list[1]).toMatchObject({ recommended: false, note: '要区分说话人，另装「说话人区分」' });
  });

  it('语音合成只列三只，按预设音色、克隆、多语言的次序', () => {
    const list = stepChoices('tts', TTS);
    expect(list.map((c) => c.bundle.bundleId)).toEqual([
      'qwen3-tts-1.7b-customvoice@audio-cpp-q8',
      'qwen3-tts-0.6b-base@audio-cpp-q8',
      'voxcpm2@audio-cpp-q8',
    ]);
    expect(list[0]!.note).toBe('9 个预设音色 · 可用一句话指定风格');
  });

  it('默认至少勾一只：没有装好、也没在下的时勾推荐的；有了就不再替人勾', () => {
    expect(initialPicks(stepChoices('asr', ASR))).toEqual(['moss-transcribe-diarize@mlx-8bit']);
    const installed = ASR.map((b) => (b.bundleId.startsWith('qwen3-asr') ? { ...b, state: 'installed' as const, components: [part('asr', 'installed', 1000)] } : b));
    expect(initialPicks(stepChoices('asr', installed))).toEqual([]);
    const downloading = ASR.map((b) =>
      b.bundleId.startsWith('qwen3-asr') ? { ...b, install: { jobId: 'j', state: 'downloading' as const, receivedBytes: 1, totalBytes: 4 } } : b,
    );
    expect(cardState(downloading[0]!)).toBe('installing');
    expect(initialPicks(stepChoices('asr', downloading))).toEqual([]);
    // 没有推荐的那一类（音乐）勾第一只；这台电脑一只都跑不了时什么也不勾
    expect(initialPicks(stepChoices('music', [bundle('yue2-3b@audio-cpp-q8', 'music')]))).toEqual(['yue2-3b@audio-cpp-q8']);
    expect(initialPicks(stepChoices('image', [bundle('qwen-image-2.1@candle', 'image', { reason: 'unsupported' })]))).toEqual([]);
  });
});

describe('要下多少与主按钮', () => {
  it('共用的组件只算一份；装好的、正在下的不算', () => {
    const a = bundle('a@x', 'synthesize', { components: [part('tts', 'missing', 100, 'o/a'), part('codec', 'missing', 50, 'o/codec')] });
    const b = bundle('b@x', 'synthesize', { components: [part('tts', 'missing', 200, 'o/b'), part('codec', 'missing', 50, 'o/codec')] });
    const c = bundle('c@x', 'synthesize', { install: { jobId: 'j', state: 'queued', receivedBytes: 0, totalBytes: null } });
    const plan = downloadPlan([a, b, c]);
    expect(plan.bundles.map((x) => x.bundleId)).toEqual(['a@x', 'b@x']);
    expect(plan.bytes).toBe(350 * MB);
    expect(planLine(plan)).toBe('一起下载：A 100 MB · 语音编解码器 50 MB · B 200 MB');
    expect(modelPrimary('tts', plan)).toEqual({ kind: 'download', label: '后台下载 350 MB 并继续' });
    expect(modelPrimary('music', plan).label).toBe('后台下载 350 MB 并完成');
  });

  it('不知道大小时按钮不写大小；没有要下的就往下走，最后一步是完成', () => {
    const unknown = bundle('u@x', 'image', { components: [{ ...part('image', 'missing', 1), estimatedBytes: null }] });
    expect(modelPrimary('image', downloadPlan([unknown])).label).toBe('后台下载并继续');
    expect(modelPrimary('tts', downloadPlan([]))).toEqual({ kind: 'next', label: '下一步' });
    expect(modelPrimary('music', downloadPlan([]))).toEqual({ kind: 'next', label: '完成' });
  });

  it('Agent 一步：勾了要装的才是「后台安装」', () => {
    expect(agentPrimary(2)).toEqual({ kind: 'install', label: '后台安装 2 个并继续' });
    expect(agentPrimary(0)).toEqual({ kind: 'next', label: '下一步' });
  });
});

function driver(patch: Partial<DriverInfo>): DriverInfo {
  return {
    id: 'codex',
    name: 'Codex CLI',
    command: 'codex',
    state: 'ready',
    status: 'available',
    version: '0.130.0',
    minVersion: '0.120.0',
    latestVersion: null,
    unavailableReason: null,
    detail: null,
    executable: '/opt/homebrew/bin/codex',
    realExecutable: null,
    account: 'Logged in using ChatGPT · Plus',
    plan: 'ChatGPT Plus 或 Pro 订阅',
    loginCommand: 'codex login',
    install: [
      { kind: 'brew', label: 'Homebrew', needs: 'Homebrew', command: 'brew install codex', upgrade: 'brew upgrade codex' },
      { kind: 'npm', label: 'npm', needs: 'Node.js', command: 'npm install -g @openai/codex', upgrade: 'npm install -g @openai/codex@latest' },
    ],
    models: [],
    configModel: null,
    configModelKnown: null,
    checkedAt: '2026-10-03T00:00:00.000Z',
    verified: true,
    tested: true,
    capabilities: { steer: true, approvals: true, resume: true, images: true },
    enabled: true,
    source: 'builtin',
    custom: null,
    isDefault: false,
    defaultModel: null,
    defaultEffort: null,
    executableOverride: null,
    ...patch,
  };
}

describe('Agent 一步', () => {
  const drivers = [
    driver({ id: 'claude', name: 'Claude Code', command: 'claude', loginCommand: null, isDefault: true }),
    driver({ id: 'codex', state: 'not-installed', version: null, executable: null, account: null }),
    driver({
      id: 'antigravity',
      name: 'Antigravity CLI',
      state: 'not-installed',
      version: null,
      executable: null,
      install: [{ kind: 'script', label: '官方脚本', needs: null, command: 'curl -fsSL https://example.com/install.sh | bash', upgrade: 'agy update' }],
    }),
    driver({ id: 'opencode', name: 'OpenCode', state: 'outdated', version: '1.2.0', minVersion: '2.0.0' }),
    driver({ id: 'pi', name: 'Pi', state: 'disabled', enabled: false }),
    driver({ id: 'my-acp' as DriverInfo['id'], name: 'My ACP', state: 'not-installed', source: 'custom', install: [] }),
  ];

  it('装好的能启用，要处理的、只有官方脚本的不给勾，没装的用能在应用内运行的方式装；没检测到的自定义 Agent 不列', () => {
    const rows = agentRows(drivers);
    expect(rows.map((r) => [r.driver.id, r.kind, r.choice?.kind ?? null])).toEqual([
      ['claude', 'use', null],
      ['opencode', 'fix', null],
      ['pi', 'use', null],
      ['codex', 'install', 'brew'],
      ['antigravity', 'manual', null],
    ]);
  });

  it('每一行下面那一句', () => {
    const rows = agentRows(drivers);
    const at = (id: string) => rows.find((r) => r.driver.id === id)!;
    const idle = { picked: false, running: false, failed: false };
    expect(agentLine(at('claude'), idle)).toBe('本机已安装 · v0.130.0 · Logged in using ChatGPT');
    expect(agentLine(at('opencode'), idle)).toMatch(/ · 在 设置 › Agent 提供方 里处理$/);
    expect(agentLine(at('antigravity'), idle)).toBe('只能在终端里按官方说明安装 · 说明在 设置 › Agent 提供方');
    expect(agentLine(at('codex'), idle)).toBe('未安装 · 装好后用你已有的ChatGPT Plus 或 Pro 订阅登录');
    expect(agentLine(at('codex'), { ...idle, picked: true })).toBe('用 Homebrew 在后台安装（brew install codex）· 装好后在终端里运行 codex login 登录');
    expect(agentLine(at('codex'), { ...idle, running: true })).toBe('正在用 Homebrew 在后台安装 · 装好后在终端里运行 codex login 登录');
    expect(agentLine(at('codex'), { ...idle, failed: true })).toBe('没装成 · 详情在后台任务里');
  });
});

describe('后台在跑的那一行', () => {
  const since = '2026-10-16T10:00:00.000Z';
  const job = (state: JobRecord['state'], createdAt = '2026-10-16T10:00:05.000Z') => ({ kind: 'modelInstall', bundleId: 'a@x', state, createdAt }) as JobRecord;

  it('确认之后、进度还没来时算在跑；任务结束却没装好算没下成', () => {
    const a = bundle('a@x', 'synthesize');
    expect(bundleProgress(a, [], since)).toEqual({ status: 'running', pct: null });
    expect(bundleProgress(a, [job('failed', '2026-10-15T00:00:00.000Z')], since).status).toBe('running');
    expect(bundleProgress(a, [job('failed')], since).status).toBe('error');
    expect(bundleProgress({ ...a, install: { jobId: 'j', state: 'downloading', receivedBytes: 25, totalBytes: 100 } }, [], since)).toEqual({ status: 'running', pct: 25 });
    expect(bundleProgress({ ...a, state: 'installed', components: [part('tts', 'installed', 1)] }, [], since).status).toBe('done');
    expect(bundleProgress(undefined, [], since).status).toBe('error');
    expect(setupProgress(undefined)).toBe('running');
    expect(setupProgress({ state: 'failed' })).toBe('error');
    expect(combineStatus(['done', 'running'])).toBe('running');
    expect(combineStatus(['done', 'error'])).toBe('error');
  });

  it('排队装的 Agent：没轮到、刚开始还没收到运行都算在跑，请求被拒或运行失败算没装成', () => {
    const queued = { driverId: 'codex', name: 'Codex CLI', kind: 'npm', runId: null, failed: false } as const;
    expect(agentJobStatus(queued, [])).toBe('running');
    expect(agentJobStatus({ ...queued, failed: true }, [])).toBe('error');
    expect(agentJobStatus({ ...queued, runId: 'run_1' }, [])).toBe('running');
    expect(agentJobStatus({ ...queued, runId: 'run_1' }, [{ runId: 'run_1', state: 'completed' }])).toBe('done');
    expect(agentJobStatus({ ...queued, runId: 'run_1' }, [{ runId: 'run_1', state: 'cancelled' }])).toBe('error');
  });

  it('一件在跑写名字与百分比，几件只写个数；用词跟着那几件走', () => {
    expect(bgLine([])).toBeNull();
    expect(bgLine([{ name: 'MOSS', pct: 42.4, status: 'running', agent: false }])).toBe('后台在下载 MOSS 42%');
    expect(bgLine([{ name: 'Codex CLI', pct: null, status: 'running', agent: true }])).toBe('后台在安装 Codex CLI');
    expect(
      bgLine([
        { name: 'A', pct: 10, status: 'running', agent: false },
        { name: 'B', pct: 20, status: 'running', agent: false },
        { name: 'Codex CLI', pct: null, status: 'done', agent: true },
        { name: 'C', pct: null, status: 'error', agent: false },
      ]),
    ).toBe('后台在下载 2 个 · 1 个已装好 · 1 个没下成');
    expect(
      bgLine([
        { name: 'A', pct: 100, status: 'done', agent: false },
        { name: 'Codex CLI', pct: null, status: 'done', agent: true },
      ]),
    ).toBe('后台下载和安装 · 2 个已完成');
  });
});
