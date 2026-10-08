import { afterEach, describe, expect, it } from 'vitest';
import { MODEL_CHECK_CODES, RpcError, type JobRecord, type ModelBundleStatus } from '@baocut/protocol';
import {
  checkDetailLines,
  checkLineView,
  checkPhase,
  checkRoute,
  hasCheck,
  checkState,
  fileLabel,
  noticeAfterTry,
  rejectionOf,
  repairOutcome,
  tryFailureKind,
  tryFailureView,
  tryNotice,
  type CheckAbilities,
  type CheckState,
} from './model-check.ts';
import { checkCaption, CHECK_LABEL, TRY_SUBJECT_IMAGE, type CheckSubject } from './model-check-copy.ts';
import { bundle } from './models-test-fixtures.ts';
import { startCheck } from '../components/models/start-check.ts';
import { useModelCheck } from '../state/model-check-store.ts';
import { useModels } from '../state/models-store.ts';

/** 本地模型的「检查」：说法、状态行、试用面板的提醒与失败（设计稿 model-local-check.test.js 的各条，换成真实的代码与任务）。 */

const TTS = 'qwen3-tts-0.6b-base@mlx-8bit';
const ASR = 'qwen3-asr-0.6b@mlx-4bit';
const NOW = Date.parse('2026-10-05T10:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const ALL: CheckAbilities = { repair: true, recheck: true };

function tts(patch: Partial<ModelBundleStatus> = {}): ModelBundleStatus {
  return bundle(TTS, { capability: 'synthesize', ...patch });
}

function testJob(patch: Partial<JobRecord> = {}): JobRecord {
  return {
    jobId: 'job_test',
    kind: 'modelTest',
    state: 'running',
    phase: 'transcribing',
    progress: null,
    videoId: null,
    assetId: null,
    assetRevision: null,
    contentHash: 'sha256:0',
    providerId: 'local',
    modelId: TTS,
    bundleId: TTS,
    inputHash: 'sha256:0',
    submitter: { kind: 'app' },
    attempt: 1,
    createdAt: ago(2 * MIN),
    updatedAt: ago(2 * MIN),
    startedAt: null,
    endedAt: null,
    error: null,
    result: null,
    warnings: [],
    ...patch,
  } as JobRecord;
}

function failedSelfTest(code: string | undefined, at = ago(5 * MIN)): ModelBundleStatus['selfTest'] {
  return {
    state: 'failed',
    jobId: 'job_old',
    at,
    detail: 'Runtime 的原话',
    ...(code ? { code } : {}),
    facts: ['file: model.safetensors'],
  } as ModelBundleStatus['selfTest'];
}

function failedState(code: string | undefined, subject: CheckSubject = 'synthesize'): CheckState {
  return checkState({ bundle: tts({ selfTest: failedSelfTest(code) }), jobs: [], subject });
}

describe('放哪、叫什么', () => {
  it('叫「检查」，不再叫自测；说明一句讲清检查与修复', () => {
    expect(CHECK_LABEL.check).toBe('检查');
    expect(CHECK_LABEL.checkFull).toBe('检查模型');
    expect(CHECK_LABEL.details).not.toBe('详情');
    expect(checkCaption()).toMatch(/检查/);
    expect(checkCaption()).toMatch(/修复/);
    expect(checkCaption()).not.toMatch(/自测|走一遍|逐个文件|校验/);
  });
});

describe('状态行', () => {
  it('没检查过不写', () => {
    const state = checkState({ bundle: tts(), jobs: [], subject: 'synthesize' });
    expect(state).toEqual({ phase: 'idle' });
    expect(checkLineView(state, ALL, NOW)).toBeNull();
  });

  it('检查中：真实阶段、进度与取消', () => {
    const running = checkState({
      bundle: tts(),
      jobs: [testJob({ progress: { done: 1, total: 2, unit: 'items' } as never })],
      subject: 'synthesize',
    });
    expect(running).toMatchObject({ phase: 'checking', jobId: 'job_test', percent: 50 });
    const view = checkLineView(running, ALL, NOW)!;
    expect(view.tone).toBe('running');
    expect(view.head).toBe('检查中…');
    expect(view.text).toBe('试跑一小段样本');
    expect(view.actions.map((a) => a.k)).toEqual(['cancel']);
  });

  it('阶段：排队、加载、试跑、核对；总量未知不给百分比', () => {
    expect(checkPhase({ phase: 'queued', progress: null })).toEqual({ label: '排队中', percent: null });
    expect(checkPhase({ phase: 'loading', progress: null }).label).toBe('加载模型');
    expect(checkPhase({ phase: 'starting', progress: null }).label).toBe('加载模型');
    expect(checkPhase({ phase: 'generating', progress: { done: 3, total: null } as never })).toEqual({
      label: '试跑一小段样本',
      percent: null,
    });
    expect(checkPhase({ phase: 'validating', progress: null }).label).toBe('核对结果');
  });

  it('通过：一句安静的话', () => {
    const at = (ms: number) =>
      checkState({ bundle: tts({ selfTest: { state: 'passed', jobId: 'j', at: ago(ms) } }), jobs: [], subject: 'synthesize' });
    expect(checkLineView(at(3 * MIN), ALL, NOW)).toMatchObject({ tone: 'passed', text: '3 分钟前检查通过', actions: [] });
    expect(checkLineView(at(0), ALL, NOW)!.text).toBe('刚刚检查通过');
  });

  it('取消检查：回到之前那一条（取消与被打断的不留结论）', () => {
    const before = tts({ selfTest: { state: 'passed', jobId: 'job_old', at: ago(30 * MIN) } });
    expect(checkState({ bundle: before, jobs: [testJob()], subject: 'synthesize' }).phase).toBe('checking');
    for (const state of ['cancelled', 'interrupted'] as const) {
      const after = checkState({ bundle: before, jobs: [testJob({ state, updatedAt: ago(MIN) })], subject: 'synthesize' });
      expect(after).toEqual({ phase: 'passed', at: ago(30 * MIN) });
    }
    const failedBefore = tts({ selfTest: failedSelfTest('MODEL_FILES_DAMAGED') });
    expect(checkState({ bundle: failedBefore, jobs: [testJob({ state: 'cancelled' })], subject: 'synthesize' }).phase).toBe('failed');
    expect(checkState({ bundle: tts(), jobs: [testJob({ state: 'cancelled' })], subject: 'synthesize' }).phase).toBe('idle');
  });

  it('修复中：行上说修复，取消后回到修复前那一条；修完自动再检查', () => {
    const damaged = tts({
      selfTest: failedSelfTest('MODEL_FILES_DAMAGED'),
      install: { jobId: 'job_fix', state: 'downloading', receivedBytes: 25, totalBytes: 100 },
    });
    const repair = testJob({ jobId: 'job_fix', kind: 'modelInstall', phase: 'downloading' });
    const repairing = checkState({ bundle: damaged, jobs: [repair], subject: 'synthesize', repairJobId: 'job_fix' });
    expect(repairing).toEqual({ phase: 'repairing', jobId: 'job_fix', percent: 25 });
    const view = checkLineView(repairing, ALL, NOW)!;
    expect(view.head).toBe('修复中…');
    expect(view.actions.map((a) => a.k)).toEqual(['cancel']);

    // 取消（丢掉这次下载）后不再跟踪这次修复：回到修复前没通过的那一条。
    const { install: _, ...settled } = damaged;
    expect(checkState({ bundle: settled, jobs: [{ ...repair, state: 'cancelled' }], subject: 'synthesize' }).phase).toBe('failed');

    expect(repairOutcome([repair], 'job_fix')).toBeNull();
    expect(repairOutcome([], 'job_fix')).toBeNull();
    expect(repairOutcome([{ ...repair, state: 'completed' }], 'job_fix')).toBe('check');
    expect(repairOutcome([{ ...repair, state: 'failed' }], 'job_fix')).toBe('drop');
    expect(repairOutcome([{ ...repair, state: 'cancelled' }], 'job_fix')).toBe('drop');
    expect(repairOutcome([{ ...repair, state: 'completed' }], null)).toBeNull();
  });
});

describe('没通过', () => {
  it('每个代码：一句人话 + 怎么办；正文不放代码；修复帮得上才给「修复…」，总有重新检查与技术详情', () => {
    for (const code of MODEL_CHECK_CODES) {
      const view = checkLineView(failedState(code), ALL, NOW)!;
      expect(view.tone, code).toBe('failed');
      expect(view.head, code).toBe('检查没通过：');
      expect(view.text && view.todo, code).toBeTruthy();
      expect(view.text + view.todo, code).not.toMatch(/自测|任务执行出错|内部错误|[A-Z_]{6,}/);
      const keys = view.actions.map((a) => a.k);
      expect(keys.slice(-2), code).toEqual(['recheck', 'details']);
      expect(keys.includes('repair'), code).toBe(
        code !== 'APP_FILE_MISSING' && code !== 'MODEL_OUT_OF_MEMORY' && code !== 'MODEL_WORKER_FAILED',
      );
    }
    expect(checkLineView(failedState('APP_FILE_MISSING'), ALL, NOW)!.todo).toMatch(/重新安装 BaoCut/);
    expect(checkLineView(failedState('MODEL_FILES_DAMAGED'), ALL, NOW)!.actions[0]).toMatchObject({
      k: 'repair',
      label: '修复…',
      primary: true,
    });
    expect(checkLineView(failedState('MODEL_OUTPUT_WRONG', 'transcribe'), ALL, NOW)!.text).toMatch(/识别不出/);
    expect(checkLineView(failedState('MODEL_OUTPUT_WRONG', 'synthesize'), ALL, NOW)!.text).toMatch(/合成出来的声音不对/);
    expect(checkLineView(failedState('MODEL_OUTPUT_WRONG', 'separate'), ALL, NOW)!.text).toMatch(/人声和背景没分开/);
    expect(checkLineView(failedState('MODEL_OUT_OF_MEMORY'), ALL, NOW)!.text).toMatch(/内存不够/);
  });

  it('认不得的代码（旧记录、新版加的）：通用的一句，不给修复；Runtime 的原话只在技术详情', () => {
    for (const code of [undefined, 'SOMETHING_NEW']) {
      const state = failedState(code);
      const view = checkLineView(state, ALL, NOW)!;
      expect(view.text).toBe('模型没能正常工作。');
      expect(view.actions.map((a) => a.k)).toEqual(['recheck', 'details']);
      expect(view.text + view.todo).not.toMatch(/Runtime 的原话/);
      expect(checkDetailLines(state, TTS, NOW)).toContain('说明 Runtime 的原话');
    }
    expect(checkDetailLines(failedState(undefined), TTS, NOW)[0]).toBe('代码 MODEL_SELF_TEST_FAILED');
  });

  it('修复不了或不能检查时不给对应按钮', () => {
    expect(checkLineView(failedState('MODEL_FILES_DAMAGED'), { repair: false, recheck: false }, NOW)!.actions.map((a) => a.k)).toEqual([
      'details',
    ]);
  });

  it('没记进模型包的失败任务也算（应用自带的文件缺失）；结论取最新的那个', () => {
    const job = testJob({
      bundleId: ASR,
      modelId: ASR,
      state: 'failed',
      updatedAt: ago(MIN),
      error: {
        code: 'APP_FILE_MISSING',
        message: '找不到识别检查的样本',
        retryable: false,
        details: { check: 'APP_FILE_MISSING', facts: ['file: sample.wav'] },
      } as never,
    });
    const state = checkState({
      bundle: bundle(ASR, { selfTest: { state: 'passed', jobId: 'job_old', at: ago(10 * MIN) } }),
      jobs: [job],
      subject: 'transcribe',
    });
    expect(state).toMatchObject({ phase: 'failed', problem: { code: 'APP_FILE_MISSING', repair: 'no' } });
    expect(checkLineView(state, ALL, NOW)!.actions.map((a) => a.k)).toEqual(['recheck', 'details']);
    expect(checkDetailLines(state, ASR, NOW)).toEqual([
      '代码 APP_FILE_MISSING',
      `模型 ${ASR} · 1 分钟前`,
      '说明 找不到识别检查的样本',
      'file: sample.wav',
    ]);

    // 之后的一次通过盖过它。
    const later = bundle(ASR, { selfTest: { state: 'passed', jobId: 'job_new', at: ago(0) } });
    expect(checkState({ bundle: later, jobs: [job], subject: 'transcribe' }).phase).toBe('passed');
  });
});

describe('检查没能开始', () => {
  it('提交被拒：同一行说，不弹 toast；连不上后台说后台没响应', () => {
    const offline = rejectionOf(new RpcError('internal', 'Runtime 已断开'), ago(0));
    expect(offline.code).toBe('RUNTIME_UNREACHABLE');
    const state = checkState({ bundle: tts(), jobs: [], subject: 'synthesize', rejection: offline });
    const view = checkLineView(state, ALL, NOW)!;
    expect(view.head).toBe('检查没能开始：');
    expect(view.text).toBe('BaoCut 的后台服务没有响应。');
    expect(view.actions.map((a) => a.k)).toEqual(['recheck', 'details']);
    expect(tryNotice(state, ALL)).toBeNull();
  });

  it('代码在 details.code；认得的各一句，认不得的通用一句，原话进技术详情', () => {
    const inUse = rejectionOf(new RpcError('conflict', 'busy', { code: 'MODEL_IN_USE', jobId: 'job_x', path: '/Users/x/a' }), ago(0));
    const state = checkState({ bundle: tts(), jobs: [], subject: 'synthesize', rejection: inUse });
    expect(checkLineView(state, ALL, NOW)!.text).toMatch(/正在被别的任务使用/);
    expect(checkDetailLines(state, TTS, NOW)).toEqual(['代码 MODEL_IN_USE', `模型 ${TTS} · 刚刚`, '说明 busy', 'jobId: job_x']);

    const odd = rejectionOf(new RpcError('conflict', 'nope', { code: 'BRAND_NEW' }), ago(0));
    expect(checkLineView(checkState({ bundle: tts(), jobs: [], subject: 'synthesize', rejection: odd }), ALL, NOW)!.text).toBe(
      'BaoCut 没有接受这次检查。',
    );
    expect(rejectionOf(new RpcError('invalid-request', 'bad')).code).toBeNull();
  });

  it('提交时应用自带的文件缺失：是检查没通过（重新安装），不是没能开始', () => {
    const r = rejectionOf(
      new RpcError('conflict', '找不到识别检查的样本', { code: 'APP_FILE_MISSING', file: '/Applications/BaoCut.app/x.wav' }),
      ago(0),
    );
    const state = checkState({ bundle: bundle(ASR), jobs: [], subject: 'transcribe', rejection: r });
    const view = checkLineView(state, ALL, NOW)!;
    expect(view.head).toBe('检查没通过：');
    expect(view.todo).toMatch(/重新安装 BaoCut/);
    expect(checkDetailLines(state, ASR, NOW).join('\n')).not.toMatch(/Applications/);
  });

  it('被拒之后又跑过检查：取新的', () => {
    const r = rejectionOf(new RpcError('conflict', 'busy', { code: 'MODEL_IN_USE' }), ago(5 * MIN));
    const b = tts({ selfTest: { state: 'passed', jobId: 'j', at: ago(MIN) } });
    expect(checkState({ bundle: b, jobs: [], subject: 'synthesize', rejection: r }).phase).toBe('passed');
  });
});

describe('能不能检查', () => {
  it('装好能用的直接检查；加载失败被停用的先重新启用；没装好、在装、不支持的不能', () => {
    expect(checkRoute(bundle(ASR, { state: 'ready' }))).toBe('test');
    expect(
      checkRoute(
        bundle(ASR, {
          state: 'not-installed',
          reason: 'load-failed',
          components: [{ component: 'asr', repo: 'a/b', revision: 'r', state: 'installed', bytes: 1, sharedWith: [] }],
        }),
      ),
    ).toBe('enable-then-test');
    expect(checkRoute(bundle(ASR, { state: 'error', reason: 'resource' }))).toBe('enable-then-test');
    expect(checkRoute(bundle(ASR, { state: 'not-installed' }))).toBeNull();
    expect(checkRoute(bundle(ASR, { install: { jobId: 'j', state: 'downloading', receivedBytes: 0, totalBytes: null } }))).toBeNull();
    expect(checkRoute(bundle(ASR, { install: { jobId: null, state: 'paused', receivedBytes: 0, totalBytes: null } }))).toBe('test');
    expect(checkRoute(bundle(ASR, { state: 'not-installed', reason: 'unsupported' }))).toBeNull();
  });

  it('「说话人区分」模型包没有检查', () => {
    const pack = bundle('speaker-diarization@mlx', { capability: 'diarize', state: 'installed' });
    expect(hasCheck(pack)).toBe(false);
    expect(checkRoute(pack)).toBeNull();
    expect(hasCheck(bundle(ASR))).toBe(true);
  });
});

describe('提交一次检查', () => {
  afterEach(() => {
    useModelCheck.setState({ rejections: {}, repairs: {} });
    useModels.setState({ bundles: [] });
  });

  it('被停用的先重新启用再检查；被拒记下，下一次提交清掉', async () => {
    const calls: string[] = [];
    useModels.setState({ bundles: [bundle(ASR, { state: 'error', reason: 'resource' })] });
    const ok = { enableModelBundle: async () => void calls.push('enable'), testModelBundle: async () => (calls.push('test'), 'job_1') };
    await startCheck(ok as never, ASR);
    expect(calls).toEqual(['enable', 'test']);

    const refused = {
      enableModelBundle: async () => undefined,
      testModelBundle: async () => {
        throw new RpcError('conflict', 'busy', { code: 'MODEL_IN_USE' });
      },
    };
    useModels.setState({ bundles: [bundle(ASR, { state: 'ready' })] });
    await startCheck(refused as never, ASR);
    expect(useModelCheck.getState().rejections[ASR]).toMatchObject({ code: 'MODEL_IN_USE', message: 'busy' });
    await startCheck(ok as never, ASR);
    expect(useModelCheck.getState().rejections[ASR]).toBeUndefined();
  });
});

describe('试用面板', () => {
  it('上次检查没通过先说，并给修复 / 重新检查', () => {
    expect(tryNotice({ phase: 'passed', at: ago(0) }, ALL)).toBeNull();
    expect(tryNotice({ phase: 'idle' }, ALL)).toBeNull();
    const n = tryNotice(failedState('MODEL_FILES_DAMAGED'), ALL)!;
    expect(n.text).toBe('这只模型上次检查没通过：模型文件损坏了。');
    expect(n.todo).toMatch(/试听多半也会失败/);
    expect(n.actions.map((a) => a.k)).toEqual(['repair', 'recheck']);
    expect(tryNotice(failedState('APP_FILE_MISSING'), ALL)!.actions.map((a) => a.k)).toEqual(['recheck']);
  });

  it('那次检查之后试用做成了就撤掉提醒，之前做成的不算', () => {
    const state = failedState('MODEL_OUTPUT_INVALID');
    const n = tryNotice(state, ALL)!;
    const at = Date.parse(state.phase === 'failed' ? state.at : '');
    expect(noticeAfterTry(n, null)).toBe(n);
    expect(noticeAfterTry(n, new Date(at - 1000).toISOString())).toBe(n);
    expect(noticeAfterTry(n, new Date(at + 1000).toISOString())).toBeNull();
    expect(noticeAfterTry(null, new Date(at + 1000).toISOString())).toBeNull();
  });

  it('自己的失败：录音读不出时点名文件', () => {
    expect(tryFailureKind('INPUT_UNREADABLE', { file: '/Users/x/采访-张老师.m4a' })).toBe('refUnreadable');
    expect(tryFailureKind('ASSET_MISSING', null)).toBe('refUnreadable');
    expect(fileLabel('/Users/x/采访-张老师.m4a')).toBe('采访-张老师.m4a');
    expect(fileLabel('C:\\Users\\x\\a.wav')).toBe('a.wav');
    const ref = tryFailureView({ kind: 'refUnreadable', file: '/Users/x/采访-张老师.m4a', canCheck: true });
    expect(ref.text).toMatch(/「采访-张老师\.m4a」/);
    expect(ref.text).not.toMatch(/Users/);
    expect(ref.actions.map((a) => a.k)).toEqual(['pickRef', 'useSample']);
    expect(tryFailureView({ kind: 'refUnreadable', canCheck: true }).text).toMatch(/「录音」/);
  });

  it('自己的失败：内存不够、模型出错、应用文件缺失、其他、表单没填好', () => {
    expect(tryFailureKind('RESOURCE_ADMISSION_UNSATISFIABLE', null)).toBe('noMemory');
    expect(tryFailureKind('MODEL_LOAD_FAILED', { reason: 'resource' })).toBe('noMemory');
    expect(tryFailureKind('MODEL_LOAD_FAILED', {})).toBe('modelError');
    expect(tryFailureKind('MODEL_WORKER_CRASHED', null)).toBe('modelError');
    expect(tryFailureKind('APP_FILE_MISSING', null)).toBe('appFileMissing');
    expect(tryFailureKind('WHATEVER', null)).toBe('other');

    expect(tryFailureView({ kind: 'noMemory', canCheck: true }).text).toMatch(/没合成完/);
    const err = tryFailureView({ kind: 'modelError', canCheck: true });
    expect(err.text).toMatch(/没合成出来/);
    expect(err.actions[0]).toMatchObject({ k: 'check', label: '检查模型', primary: true });
    expect(tryFailureView({ kind: 'modelError', canCheck: false }).actions).toEqual([{ k: 'retry', label: '重试', primary: true }]);
    expect(tryFailureView({ kind: 'appFileMissing', canCheck: true }).todo).toMatch(/重新安装 BaoCut/);
    expect(tryFailureView({ kind: 'other', message: '超时', canCheck: true }).text).toBe('没合成出来：超时。');
    expect(tryFailureView({ kind: 'other', message: '超时', notStarted: true, canCheck: true })).toMatchObject({
      text: '没能开始合成：超时',
      todo: null,
    });
    expect(tryFailureView({ kind: 'invalid', message: '先写一句要念的话', canCheck: true })).toEqual({
      text: '先写一句要念的话',
      todo: null,
      actions: [],
    });
  });

  it('试画说「画」：提醒、内存不够、模型出错都换成图像的说法', () => {
    expect(tryNotice(failedState('MODEL_FILES_DAMAGED'), ALL, TRY_SUBJECT_IMAGE)!.todo).toMatch(/试画多半也会失败/);
    const oom = tryFailureView({ kind: 'noMemory', canCheck: true, subject: TRY_SUBJECT_IMAGE });
    expect([oom.text, oom.todo]).toEqual(['内存不够，没画完。', '关掉别的大模型后重试，或把步数调低。']);
    expect(tryFailureView({ kind: 'modelError', canCheck: true, subject: TRY_SUBJECT_IMAGE }).text).toMatch(/没画出来/);
    expect(tryFailureView({ kind: 'other', message: '超时', canCheck: true, subject: TRY_SUBJECT_IMAGE }).text).toBe('没画出来：超时。');
  });
});
