import { describe, expect, it } from 'vitest';
import { RpcError, type GrantCreateParams, type GrantRequestItem, type JobRecord, type PipelineStepState, type ToolStatus } from '@baocut/protocol';
import {
  ambiguousAssets,
  dubEngineKey,
  dubParams,
  fallbackTitle,
  grantLoopText,
  grantAndRestart,
  grantKey,
  grantLines,
  isRunOf,
  linkParams,
  opensMovie,
  pct,
  pendingGrantsOf,
  phase,
  resultLines,
  runInput,
  runOpts,
  runsOf,
  runView,
  startTool,
  stepNote,
  toolOfJob,
  toolRequest,
  toolRunOf,
  transcribeFileParams,
  transcribeParams,
  transcriptEditedOf,
  transcriptSwitchOf,
  translateModelOptions,
  translateVideoParams,
  withAsset,
  type ToolStartSession,
} from './tool-runs.ts';
import { textView } from './models-test-fixtures.ts';

const step = (name: string, status: PipelineStepState['status'], extra: Partial<PipelineStepState> = {}): PipelineStepState => ({
  name,
  label: { target: '解析目标', create: '新建视频', transcribe: '转写', captions: '建立字幕层' }[name] ?? name,
  status,
  jobId: null,
  attempts: status === 'pending' ? 0 : 1,
  output: null,
  ...extra,
});

function job(
  patch: Partial<JobRecord> & { name?: string; params?: Record<string, unknown>; steps?: PipelineStepState[]; summary?: Record<string, unknown> | null } = {},
): JobRecord {
  const { name, params, steps, summary, ...rest } = patch;
  return {
    jobId: 'job_1',
    kind: 'pipeline',
    state: 'running',
    phase: null,
    progress: null,
    videoId: null,
    assetId: null,
    assetRevision: null,
    contentHash: '',
    providerId: 'local',
    modelId: 'whisper',
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
      name: name ?? 'transcribe',
      params: params ?? { target: { create: { projectId: 'prj_1', media: '/Users/me/访谈.mp4' } } },
      steps: steps ?? [
        step('target', 'skipped'),
        step('create', 'completed'),
        step('transcribe', 'running', { jobId: 'job_asr' }),
        step('captions', 'pending'),
      ],
      current: 2,
      stoppedAt: null,
      summary: summary ?? null,
    },
    ...rest,
  } as JobRecord;
}

const ITEM: GrantRequestItem = {
  capability: 'transcribe',
  dataKinds: ['audio'],
  recipient: 'openai',
  videoId: null,
  purpose: '转录',
  reason: 'none',
  cost: 'unknown',
  estimate: null,
  maxCalls: null,
};

function status(patch: Partial<ToolStatus> = {}): ToolStatus {
  return {
    id: 'translate-subtitles',
    label: '翻译字幕',
    description: '',
    category: 'speech',
    inputs: ['video', 'document', 'file'],
    results: ['video', 'artifact'],
    execution: { kind: 'pipeline', method: 'pipelines.start', pipeline: 'translate', params: { captions: true } },
    executionByInput: { file: { kind: 'pipeline', method: 'pipelines.start', pipeline: 'translate-subtitles' } },
    capabilities: ['generateText'],
    optionalCapabilities: [],
    externalTools: [],
    optionalExternalTools: [],
    network: 'none',
    candidates: 'videos-with-transcript',
    available: true,
    problems: [],
    limitations: [],
    ...patch,
  };
}

describe('运行视图', () => {
  it('步骤照 Runtime 的流程，跳过的不列；当前步的子任务进度算进总进度', () => {
    const child = { ...job(), jobId: 'job_asr', kind: 'transcribe', progress: { done: 30, total: 60, unit: 'seconds' } } as JobRecord;
    const run = runView(job(), [child])!;
    expect(run.steps.map((s) => [s.name, s.status])).toEqual([
      ['create', 'done'],
      ['transcribe', 'running'],
      ['captions', 'pending'],
    ]);
    expect(run.cur).toBe(1);
    expect(run.steps[1]!.pct).toBe(50);
    expect(pct(run)).toBe(50);
    expect(phase(run)).toBe('正在转写 · 第 2 / 3 步');
    expect(run.steps.map(stepNote)).toEqual(['完成', '50%', '等待']);
  });

  it('失败停在哪一步；排队、完成、取消各有说法', () => {
    const failed = runView(
      job({
        state: 'failed',
        error: { code: 'APPLY_FAILED', message: '写不进视频' },
        steps: [step('target', 'skipped'), step('create', 'completed'), step('transcribe', 'failed'), step('captions', 'pending')],
      }),
    )!;
    expect(failed.status).toBe('failed');
    expect(phase(failed)).toBe('停在「转写」· 第 2 / 3 步');
    expect(failed.error).toBe('写不进视频');
    expect(failed.errorCode).toBe('APPLY_FAILED');
    expect(stepNote(failed.steps[1]!)).toBe('停在这一步');
    expect(phase(runView(job({ state: 'queued' }))!)).toBe('排队中');
    const done = runView(job({ state: 'completed', steps: [step('create', 'completed'), step('transcribe', 'completed'), step('captions', 'completed')] }))!;
    expect(pct(done)).toBe(100);
    expect(phase(done)).toBe('已完成');
    expect(runView({ ...job(), pipeline: undefined } as JobRecord)).toBeNull();
  });

  it('由「说话人区分」区分说话人时，「转写」拆成「转写」与「识别说话人」两步，按转写任务的阶段分开', () => {
    const asr = (phase: JobRecord['phase'], state: JobRecord['state'] = 'running') =>
      ({
        ...job(),
        jobId: 'job_t',
        kind: 'transcribe',
        state,
        phase,
        submitter: { kind: 'pipeline', id: 'job_1' },
        pipeline: undefined,
      }) as JobRecord;
    const names = (r: ReturnType<typeof runView>) => r!.steps.map((s) => [s.name, s.status]);
    expect(names(runView(job(), [asr('transcribing')], { diarizeStep: true }))).toEqual([
      ['create', 'done'],
      ['transcribe', 'running'],
      ['diarize', 'pending'],
      ['captions', 'pending'],
    ]);
    const diarizing = runView(job(), [asr('diarizing')], { diarizeStep: true })!;
    expect(names(diarizing)).toEqual([
      ['create', 'done'],
      ['transcribe', 'done'],
      ['diarize', 'running'],
      ['captions', 'pending'],
    ]);
    expect(phase(diarizing)).toBe('正在识别说话人 · 第 3 / 4 步');
    const stuck = job({ state: 'failed', steps: [step('create', 'completed'), step('transcribe', 'failed'), step('captions', 'pending')] });
    expect(phase(runView(stuck, [asr('diarizing', 'failed')], { diarizeStep: true })!)).toBe('停在「识别说话人」· 第 3 / 4 步');
    expect(phase(runView(stuck, [asr('transcribing', 'failed')], { diarizeStep: true })!)).toBe('停在「转写」· 第 2 / 4 步');
    const done = job({
      state: 'completed',
      steps: [step('create', 'completed'), step('transcribe', 'completed'), step('captions', 'completed')],
    });
    expect(names(runView(done, [], { diarizeStep: true }))).toEqual([
      ['create', 'done'],
      ['transcribe', 'done'],
      ['diarize', 'done'],
      ['captions', 'done'],
    ]);
    // 不单列时照旧。
    expect(runView(job(), [asr('diarizing')])!.steps.map((s) => s.name)).toEqual(['create', 'transcribe', 'captions']);
  });

  it('流程名落到工具页；转录页另收下载后转录的链接导入', () => {
    expect(toolOfJob(job({ name: 'translate' }))).toBe('translate-subtitles');
    expect(toolOfJob(job({ name: 'translate-subtitles' }))).toBe('translate-subtitles');
    expect(toolOfJob(job({ name: 'transcode', params: { action: 'merge' } }))).toBe('merge-video');
    expect(toolOfJob(job({ name: 'export' }))).toBeNull();
    const linked = job({ jobId: 'l', name: 'link-import', params: { url: 'https://x.test/v', transcribe: true }, createdAt: '2026-10-02T00:00:00Z' });
    expect(isRunOf(linked, 'transcribe')).toBe(true);
    expect(isRunOf(linked, 'link-import')).toBe(true);
    expect(isRunOf(job({ name: 'link-import', params: { url: 'https://x.test/v' } }), 'transcribe')).toBe(false);
    expect(runsOf([job(), linked], 'transcribe').map((j) => j.jobId)).toEqual(['l', 'job_1']);
  });

  it('后台任务详情按工具运行来画的：转录、翻译字幕、翻译配音；下载视频也使用工具运行视图，转码不算', () => {
    expect(toolRunOf(job({ name: 'translate' }))).toBe('translate-subtitles');
    expect(toolRunOf(job({ name: 'dub' }))).toBe('dub');
    expect(toolRunOf(job({ name: 'link-import', params: { url: 'https://x.test/v', transcribe: true } }))).toBe('link-import');
    expect(toolRunOf(job({ name: 'transcode' }))).toBeNull();
    expect(toolRunOf({ ...job(), kind: 'transcribe' })).toBeNull();
  });

  it('写进视频的结果才有「打开编辑」：翻译字幕文件与只下载不建视频的没有', () => {
    expect(opensMovie('translate-subtitles', 'file')).toBe(false);
    expect(opensMovie('link-import', 'link', { target: 'none' })).toBe(false);
    expect(opensMovie('transcribe', 'file')).toBe(true);
  });
});

describe('当场授权', () => {
  it('从拒绝的 details 里取待批准项；别的拒绝不算', () => {
    expect(pendingGrantsOf(new RpcError('forbidden', '缺授权', { code: 'GRANT_REQUIRED', pendingGrants: [ITEM, { bogus: true }] }))).toEqual([ITEM]);
    expect(pendingGrantsOf({ details: { pendingGrants: [ITEM] } })).toEqual([ITEM]);
    expect(pendingGrantsOf(new RpcError('forbidden', '缺授权', { code: 'GRANT_REQUIRED' }))).toBeNull();
    expect(pendingGrantsOf(new Error('x'))).toBeNull();
    expect(pendingGrantsOf(new RpcError('forbidden', 'x', { pendingGrants: [] }))).toBeNull();
  });

  it('授权卡每项：发给谁、内容、费用（估不出时照实说）', () => {
    const labels = new Map([['openai', 'OpenAI']]);
    const lines = grantLines(
      [ITEM, ITEM, { ...ITEM, recipient: 'deepseek', dataKinds: ['transcript'], purpose: '翻译', estimate: { amount: '0.12', currency: 'USD' } }],
      labels,
    );
    expect(lines).toEqual([
      { key: 'openai:audio', recipient: 'OpenAI', what: '音频（转录）', cost: '按 OpenAI 的价目计费，这里估不出金额' },
      { key: 'deepseek:transcript', recipient: 'deepseek', what: '文稿与译文（翻译）', cost: '约 0.12 USD' },
    ]);
    expect(grantKey({ recipient: 'a', dataKinds: ['transcript', 'audio'] })).toBe('a:audio,transcript');
  });

  /** 假会话：前几次按给的结果拒绝，记下每次提交的 commandId 与发放的授权。 */
  function fake(rejections: unknown[]): ToolStartSession & { starts: string[]; grants: GrantCreateParams[] } {
    const starts: string[] = [];
    const grants: GrantCreateParams[] = [];
    return {
      starts,
      grants,
      async startPipelineWithCommand(_pipeline, _params, commandId) {
        starts.push(commandId);
        const next = rejections.shift();
        if (next) throw next;
        return 'job_new';
      },
      async createGrant(params) {
        grants.push(params);
        return {};
      },
    };
  }
  const refusal = () => new RpcError('forbidden', '缺授权', { code: 'GRANT_REQUIRED', pendingGrants: [ITEM] });
  const request = { pipeline: 'transcribe', params: { target: { entryId: 'ent_1' } } };

  it('被拒时交回待批准项；同意后逐项发放、用同一个 commandId 重提', async () => {
    const session = fake([refusal()]);
    const first = await startTool(session, request, 'cmd_1');
    expect(first).toEqual({ kind: 'grants', items: [ITEM] });
    expect(session.grants).toEqual([]);
    const granted = new Set<string>();
    const second = await grantAndRestart(session, request, 'cmd_1', [ITEM], granted);
    expect(second).toEqual({ kind: 'started', jobId: 'job_new' });
    expect(session.starts).toEqual(['cmd_1', 'cmd_1']);
    expect(session.grants).toEqual([
      { dataKinds: ['audio'], recipient: 'openai', scope: { videoId: null }, purpose: '转录', budgetMode: 'per-call-unknown-cost', maxCalls: null },
    ]);
  });

  it('发放之后还被拒、要的还是同一项：停下来说明，不再循环', async () => {
    const session = fake([refusal(), refusal()]);
    await startTool(session, request, 'cmd_1');
    const granted = new Set<string>();
    const second = await grantAndRestart(session, request, 'cmd_1', [ITEM], granted);
    expect(second.kind).toBe('failed');
    expect(second.kind === 'failed' && second.error.message).toBe(grantLoopText());
    const third = await grantAndRestart(session, request, 'cmd_1', [ITEM], granted);
    expect(third.kind === 'failed' && third.error.message).toBe(grantLoopText());
    expect(session.grants).toHaveLength(1);
  });

  it('取代被改过的文稿被拒（TRANSCRIPT_EDITED）：交回 edited，等用户确认', async () => {
    const edited = new RpcError('conflict', '文稿改过', { code: 'TRANSCRIPT_EDITED', documentId: 'doc_1' });
    expect(transcriptEditedOf(edited)).toBe(true);
    expect(transcriptEditedOf(new RpcError('conflict', 'x', { code: 'JOB_NOT_RETRYABLE' }))).toBe(false);
    const out = await startTool(fake([edited]), request, 'cmd_1');
    expect(out.kind).toBe('edited');
  });

  it('别的失败照原样交回', async () => {
    const session = fake([new RpcError('not-found', '视频不在了')]);
    const out = await startTool(session, request, 'cmd_1');
    expect(out.kind === 'failed' && out.error.message).toBe('视频不在了');
  });
});

describe('提交参数', () => {
  it('流程名与目录固定参数来自 tools.list；界面的参数叠在上面；状态没到时不提交', () => {
    expect(toolRequest(status(), 'video', { target: { entryId: 'e' }, bilingual: true })).toEqual({
      pipeline: 'translate',
      params: { captions: true, target: { entryId: 'e' }, bilingual: true },
    });
    expect(toolRequest(status(), 'file', { input: '/a.srt' })).toEqual({ pipeline: 'translate-subtitles', params: { input: '/a.srt' } });
    expect(toolRequest(null, 'video', {})).toBeNull();
    expect(
      toolRequest(status({ execution: { kind: 'job', method: 'models.generateText', capability: 'generateText' }, executionByInput: {} }), 'video', {}),
    ).toBeNull();
  });

  it('各工具的参数', () => {
    expect(transcribeParams({ create: { projectId: 'p', media: '/m.mp4' } }, { provider: 'local', model: 'whisper', language: '' })).toEqual({
      target: { create: { projectId: 'p', media: '/m.mp4' } },
      provider: 'local',
      model: 'whisper',
    });
    expect(transcribeParams({ entryId: 'e' }, { language: 'zh' }, 'ast_2')).toEqual({ target: { entryId: 'e' }, assetId: 'ast_2', language: 'zh' });
    expect(transcribeParams({ entryId: 'e' }, { diarize: false })).toEqual({ target: { entryId: 'e' }, diarize: false });
    expect(transcribeParams({ entryId: 'e' }, { diarize: true })).toEqual({ target: { entryId: 'e' }, diarize: true });
    // 重新转录的落点（产品设计 §5.11）：新建视频带名字；取代带译文结转，确认过改过的文稿时带 acceptEdited。
    expect(transcribeParams({ entryId: 'e' }, {}, null, { destination: 'new-video', name: ' 片花 · 重新转录 ' })).toEqual({
      target: { entryId: 'e' },
      destination: 'new-video',
      name: '片花 · 重新转录',
    });
    expect(transcribeParams({ entryId: 'e' }, {}, null, { destination: 'replace', name: '不用' })).toEqual({
      target: { entryId: 'e' },
      destination: 'replace',
      translations: 'carry',
    });
    expect(transcribeParams({ entryId: 'e' }, {}, null, { destination: 'replace', acceptEdited: true })).toEqual({
      target: { entryId: 'e' },
      destination: 'replace',
      translations: 'carry',
      acceptEdited: true,
    });
    expect(transcribeParams({ create: { projectId: 'p', media: '/m.mp4' } }, {}, null, { destination: 'replace' })).toEqual({
      target: { create: { projectId: 'p', media: '/m.mp4' } },
    });
    expect(linkParams({ url: ' https://x.test/v ', target: 'create', projectId: 'p', transcribe: true })).toEqual({
      url: 'https://x.test/v',
      target: { create: { projectId: 'p' } },
      transcribe: true,
    });
    expect(linkParams({ url: 'https://x.test/v', target: 'video', entryId: 'e' })).toEqual({ url: 'https://x.test/v', target: { entryId: 'e' } });
    expect(linkParams({ url: 'https://x.test/v', target: 'none', projectId: 'p', transcribe: true })).toEqual({ url: 'https://x.test/v', projectId: 'p' });
    expect(translateVideoParams({ entryId: 'e', documentId: 'd', targetLanguage: 'en', bilingual: false })).toEqual({
      target: { entryId: 'e' },
      documentId: 'd',
      targetLanguage: 'en',
    });
    expect(dubParams({ entryId: 'e', translation: { id: 't', documentId: 'd' }, targetLanguage: 'en', originalAudio: 'duck' })).toEqual({
      target: { entryId: 'e' },
      translationId: 't',
      documentId: 'd',
      originalAudio: 'duck',
    });
    expect(dubParams({ entryId: 'e', translation: null, targetLanguage: 'ja', originalAudio: 'mute' })).toMatchObject({ targetLanguage: 'ja' });
    // 先翻译：带来源文稿与翻译用的文本模型；选了已有译文时不带。
    expect(
      dubParams({
        entryId: 'e',
        translation: null,
        targetLanguage: 'ja',
        documentId: 'd',
        originalAudio: 'keep',
        provider: 'elevenlabs',
        model: 'v3',
        textProvider: 'openai',
        textModel: 'gpt',
      }),
    ).toEqual({
      target: { entryId: 'e' },
      targetLanguage: 'ja',
      documentId: 'd',
      textProvider: 'openai',
      textModel: 'gpt',
      originalAudio: 'keep',
      provider: 'elevenlabs',
      model: 'v3',
    });
    expect(
      dubParams({
        entryId: 'e',
        translation: { id: 't', documentId: 'd' },
        targetLanguage: null,
        originalAudio: 'duck',
        textProvider: 'openai',
        textModel: 'gpt',
      }),
    ).not.toHaveProperty('textModel');
  });

  it('翻译用的文本模型：不支持结构化输出的列着但用不了', () => {
    const view = textView();
    const options = translateModelOptions(view);
    expect(options.length).toBeGreaterThan(0);
    const first = options[0]!;
    const off = translateModelOptions({
      ...view,
      generateText: {
        ...view.generateText,
        providers: view.generateText.providers.map((p) => ({ ...p, models: p.models.map((m) => ({ ...m, structuredOutput: false })) })),
      },
    }).find((o) => o.key === first.key)!;
    expect(first.usable).toBe(true);
    expect(off).toMatchObject({ usable: false, why: '这只模型不支持结构化输出，翻译用不了' });
  });

  it('主轨上有几个素材时读出要选的素材', () => {
    expect(ambiguousAssets(job({ error: { code: 'TRANSCRIBE_ASSET_AMBIGUOUS', message: 'x', details: { assetIds: ['a', 'b', 3] } } }))).toEqual(['a', 'b']);
    expect(ambiguousAssets(job({ error: { code: 'APPLY_FAILED', message: 'x' } }))).toBeNull();
    expect(ambiguousAssets(null)).toBeNull();
  });

  it('选好素材重新开始：照冻结参数加 assetId；已经写进了视频时目标换成那个视频', () => {
    const into = job({ name: 'transcribe', params: { target: { entryId: 'e1' }, language: 'zh' }, videoId: 'vid_1' });
    expect(withAsset(into, 'ast_2')).toEqual({ pipeline: 'transcribe', params: { target: { videoId: 'vid_1' }, language: 'zh', assetId: 'ast_2' } });
    const fresh = job({ name: 'transcribe', params: { target: { entryId: 'e1' } } });
    expect(withAsset(fresh, 'ast_2')?.params).toEqual({ target: { entryId: 'e1' }, assetId: 'ast_2' });
  });

  it('从冻结参数推输入种类与链接导入的落点', () => {
    expect(runInput(job())).toBe('file');
    expect(runInput(job({ params: { target: { entryId: 'e' } } }))).toBe('video');
    expect(runInput(job({ name: 'translate-subtitles', params: { input: '/a.srt' } }))).toBe('file');
    expect(runInput(job({ name: 'link-import', params: { url: 'https://x' } }))).toBe('link');
    expect(runOpts(job({ name: 'link-import', params: { url: 'u', projectId: 'p' } }))).toEqual({ target: 'none', transcribe: false });
    expect(runOpts(job({ name: 'link-import', params: { url: 'u', target: { create: { projectId: 'p' } }, transcribe: true } }))).toEqual({
      target: 'create',
      transcribe: true,
    });
    expect(runOpts(job({ name: 'link-import', params: { url: 'u', target: { entryId: 'e' } } }))).toEqual({ target: 'video', transcribe: false });
    expect(runOpts(job())).toEqual({ target: 'create' });
    expect(runOpts(job({ params: { file: '/a.mp4' } }))).toEqual({ target: 'none' });
    expect(runOpts(job({ params: { target: { entryId: 'e' } } }))).toEqual({});
    expect(runInput(job({ params: { file: { entryId: 'e' } } }))).toBe('file');
  });

  it('只出文稿的转录：参数没有说话人与视频；结果是保存位置里的两份文件，不打开视频、没有接着做', () => {
    const asr = { provider: 'local', model: 'whisper', language: 'zh', diarize: true };
    expect(transcribeFileParams('/v/访谈.mp4', asr)).toEqual({ file: '/v/访谈.mp4', provider: 'local', model: 'whisper', language: 'zh' });
    expect(transcribeFileParams({ entryId: 'e1' }, { ...asr, language: '' }, '/out')).toEqual({ file: { entryId: 'e1' }, outDir: '/out', provider: 'local', model: 'whisper' });
    expect(opensMovie('transcribe', 'file', { target: 'none' })).toBe(false);
    expect(opensMovie('transcribe', 'file', { target: 'create' })).toBe(true);
    const done = job({
      state: 'completed',
      params: { file: '/v/访谈.mp4' },
      summary: { file: '/v/访谈.mp4', files: ['/out/访谈.txt', '/out/访谈.srt'], transcribeJobId: 'j', language: 'zh', providerId: 'local', modelId: 'whisper' },
    });
    expect(resultLines(done, null, null)).toEqual(['文稿与字幕保存到保存位置：访谈.txt、访谈.srt', '文稿语言：中文（whisper）']);
  });
});

describe('结果页', () => {
  it('转录：新建视频与写进已有视频的说法；字幕层按状态说', () => {
    const created = job({
      state: 'completed',
      summary: {
        videoId: 'vid_9',
        createdVideo: true,
        language: 'zh',
        modelId: 'whisper',
        target: 'first',
        captions: { status: 'created', documentId: 'cap', cueCount: 12, enabled: true },
      },
    });
    expect(resultLines(created, { tool: 'transcribe', input: 'file', title: '转录 · 访谈.mp4', projectName: '访谈' }, '访谈')).toEqual([
      '新建视频「访谈」，放进「访谈」；素材留在原处，只做链接',
      '文稿语言：中文（whisper）',
      '建立了一条可编辑的字幕层',
    ]);
    const into = job({
      state: 'completed',
      summary: {
        videoId: 'vid_1',
        createdVideo: false,
        language: 'en',
        target: 'first',
        captions: { status: 'existing', documentId: 'c', cueCount: null, enabled: null },
      },
    });
    expect(resultLines(into, null, '片花')).toEqual(['写进「片花」：写入一份文稿', '文稿语言：英语', '这份文稿已经有字幕层，没有再建']);
    const speakers = (diarize: boolean, speakerCount: number | null) =>
      resultLines(
        job({ state: 'completed', params: { target: { entryId: 'e' }, diarize }, summary: { videoId: 'v', language: 'zh', speakerCount } }),
        null,
        '片花',
      );
    expect(speakers(true, 3)).toEqual(['写进「片花」：写入一份文稿', '文稿语言：中文', '区分出 3 位说话人，字幕与文稿都标上了名字']);
    expect(speakers(true, 0)).toHaveLength(2);
    expect(speakers(true, null)).toHaveLength(2);
    expect(speakers(false, 2)).toHaveLength(2);
  });

  it('重新转录：新建视频说原视频没动；取代说可以撤销、逐语言写结转，有过期的提示去刷新', () => {
    const fresh = job({
      state: 'completed',
      params: { target: { entryId: 'e' }, destination: 'new-video' },
      summary: {
        videoId: 'vid_new',
        createdVideo: false,
        language: 'zh',
        target: 'new-video',
        newVideo: { videoId: 'vid_new', name: '片花 · 重新转录' },
        replaced: null,
        translations: [],
        captionPins: null,
        dubs: [],
        captions: { status: 'created', documentId: 'cap', cueCount: 12, enabled: true },
      },
    });
    expect(resultLines(fresh, { tool: 'transcribe', input: 'video', title: 't', videoName: '片花', projectName: '访谈' }, null)).toEqual([
      '新建视频「片花 · 重新转录」，放进「访谈」，链接同一份素材；「片花」和它的译文没动',
      '文稿语言：中文',
      '建立了一条可编辑的字幕层',
    ]);
    expect(transcriptSwitchOf(fresh)).toBeNull();
    const summary = {
      videoId: 'vid_1',
      createdVideo: false,
      language: 'zh',
      target: 'replace',
      newVideo: null,
      replaced: { documentId: 'doc_1', previousVersion: 'v1', transactionId: 'tx_9' },
      translations: [{ language: 'en', documentId: 'tr_en', kept: 54, keptReviewed: 40, stale: 8, unmatched: 2 }],
      captionPins: { reanchored: 11, orphaned: 1 },
      dubs: [{ language: 'en', documentId: 'dub_en', kept: 50, stale: 4 }],
      captions: { status: 'existing', documentId: 'c', cueCount: null, enabled: null },
    };
    const replaced = job({ state: 'completed', params: { target: { entryId: 'e' }, destination: 'replace' }, summary });
    expect(resultLines(replaced, null, '片花')).toEqual([
      '取代「片花」的文稿：一笔事务，可以撤销',
      '文稿语言：中文',
      '这份文稿已经有字幕层，没有再建',
      '英语译文：保留 54 句（已审 40）· 过期 8 句',
      '字幕 pin：重锚 11 处 · orphaned 1 处',
      '英语配音：保留 50 句 · 过期 4 句',
      '过期的译文用「刷新过期译文」重译',
    ]);
    expect(transcriptSwitchOf(replaced)).toEqual({ videoId: 'vid_1', transactionId: 'tx_9', stale: true });
    const bare = job({
      state: 'completed',
      summary: {
        ...summary,
        translations: [],
        captionPins: { reanchored: 0, orphaned: 0 },
        dubs: [],
        replaced: { ...summary.replaced, transactionId: null },
      },
    });
    expect(resultLines(bare, null, '片花').slice(-1)).toEqual(['这部视频没有译文、字幕 pin 与配音，没有要结转的']);
    expect(transcriptSwitchOf(bare)).toEqual({ videoId: 'vid_1', transactionId: null, stale: false });
    expect(transcriptSwitchOf(job({ state: 'running', summary }))).toBeNull();
  });

  it('翻译、链接导入的说法；没有摘要时没有', () => {
    const tr = job({
      name: 'translate',
      state: 'completed',
      summary: {
        videoId: 'v',
        targetLanguage: 'en',
        unitCount: 40,
        captions: { status: 'created', documentId: 'c', cueCount: 40, enabled: true, bilingual: true },
      },
    });
    expect(resultLines(tr, { tool: 'translate-subtitles', input: 'video', title: 't', sourceLanguage: 'zh' }, '访谈')).toEqual([
      '写进「访谈」：新增一份英语译文（译自中文文稿），原文没动',
      '共 40 句',
      '建立了英语字幕层，双语显示',
    ]);
    const link = job({
      name: 'link-import',
      state: 'completed',
      summary: { videoId: null, title: '发布会', files: { media: '/dl/发布会.mp4', subtitles: [] }, transcribeJobId: null },
    });
    expect(resultLines(link, null, null)).toEqual(['发布会.mp4 已下载，在 /dl']);
    const withCookies = job({
      name: 'link-import',
      state: 'completed',
      summary: { videoId: null, title: '会员', files: { media: '/dl/会员.mp4', subtitles: [] }, cookieBrowser: 'firefox', transcribeJobId: null },
    });
    expect(resultLines(withCookies, null, null)).toEqual(['会员.mp4 已下载，在 /dl', '用了 Firefox 的 Cookie']);
    expect(resultLines(job(), null, null)).toEqual([]);
    expect(fallbackTitle(job(), '转录', null)).toBe('转录 · 访谈.mp4');
    expect(fallbackTitle(job({ name: 'translate', params: { videoId: 'v', targetLanguage: 'en' } }), '翻译字幕', '片花')).toBe('翻译字幕 · 片花 → 英语');
  });
});

describe('配音引擎的缺省', () => {
  const engine = (key: string, usable: boolean, languages: 'any' | string[]) => {
    const [providerId = '', modelId = ''] = key.split('/');
    return { key, providerId, provider: providerId, modelId, label: modelId, connected: usable, usable, why: usable ? null : '未连接', info: { languages } };
  };
  const options = [engine('a/one', true, ['en']), engine('b/two', true, 'any'), engine('c/three', false, 'any')];

  it('选过的还在就用它，哪怕现在不能用', () => {
    expect(dubEngineKey(options, 'c/three', null, 'ja')).toBe('c/three');
  });

  it('生效的默认值会念这门语言时用它，否则换一只会念的', () => {
    expect(dubEngineKey(options, null, { providerId: 'a', modelId: 'one' }, 'en')).toBe('a/one');
    expect(dubEngineKey(options, null, { providerId: 'a', modelId: 'one' }, 'ja')).toBe('b/two');
    expect(dubEngineKey(options, 'gone/x', null, null)).toBe('a/one');
  });

  it('没有能用的时落到第一只；没有引擎时 null', () => {
    expect(dubEngineKey([engine('c/three', false, 'any')], null, null, 'en')).toBe('c/three');
    expect(dubEngineKey([], null, null, 'en')).toBeNull();
  });
});
