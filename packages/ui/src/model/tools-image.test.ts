import { describe, expect, it } from 'vitest';
import type { ImageModelInfo, ModelCapabilitiesView, SpaceEntry } from '@baocut/protocol';
import { fixtureView, imageModel } from './models-test-fixtures.ts';
import { cloudModelOptions, initialModelKey } from './tools-models.ts';
import { imageJob, imageOut } from './tools-test-fixtures.ts';
import {
  BLANK_IMAGE,
  addRefs,
  editsByPrompt,
  emptyPrompt,
  imageRefMode,
  imageRefModes,
  outputCount,
  refsNote,
  refsCount,
  strengthFor,
  usedRefs,
  againDraft,
  aspectOptions,
  countFor,
  imageBatchMeta,
  imageFileName,
  imageFallback,
  imageHeaderChip,
  imageModelLine,
  imageModelOptions,
  imageProblems,
  imageRequest,
  imageResults,
  imageStatus,
  imageDecoding,
  imageGallery,
  imageStepPhase,
  imageTimeLeft,
  imageTimeLeftText,
  imageTimeLine,
  localImageOptions,
  ratioOfSize,
  retryRequest,
  requestSize,
  sizeKeyFor,
  sizeTierOptions,
  tierFor,
  fixedSteps,
  stepsFor,
  switchImageModel,
  type ImageDraft,
  type ImageOption,
} from './tools-image.ts';

function option(info: ImageModelInfo, patch: Partial<ImageOption> = {}): ImageOption {
  return { key: `openai/${info.modelId}`, providerId: 'openai', provider: 'OpenAI', modelId: info.modelId, label: info.label, connected: true, usable: true, why: null, info, ...patch };
}

const ratios = imageModel('gpt-image-1', {
  aspectRatios: [
    { ratio: '1:1', size: '1024x1024' },
    { ratio: '3:2', size: '1536x1024' },
    { ratio: '2:3', size: '1024x1536' },
  ],
  sizes: ['1024x1024', '1536x1024', '1024x1536'],
  defaultSize: '1536x1024',
  maxCount: 4,
  maxPromptChars: 10,
  acceptsSeed: true,
});
const qwen = imageModel('qwen-image-2.1@mlx-4bit', {
  label: 'Qwen-Image-2.1',
  aspectRatios: [{ ratio: '1:1', size: '1024x1024' }],
  sizes: ['1024x1024', '512x512'],
  defaultSize: '1024x1024',
  maxCount: 1,
  acceptsSeed: true,
  cost: 'free-local',
  local: { steps: { min: 8, max: 40, step: 4, default: 20 } },
});

/** 在 `fixtureView()` 上补一个本机 Provider：Qwen-Image 的状态由 `patch` 给。 */
function withLocal(patch: Partial<ImageModelInfo> = {}, available = true): ModelCapabilitiesView {
  const view = fixtureView();
  const model = { ...qwen, ...patch };
  return {
    ...view,
    generateImage: {
      ...view.generateImage,
      providers: [
        ...view.generateImage.providers,
        {
          providerId: 'local',
          kind: 'local',
          label: '本机',
          config: null,
          models: [model],
          available,
          ...(available ? {} : { unavailableReason: 'not-installed' as const }),
        },
      ],
    },
  };
}

const codexModel = imageModel('image-gen', {
  label: 'Codex 画图',
  sizes: [],
  aspectRatios: [],
  defaultSize: null,
  maxCount: 1,
  cost: 'subscription',
  notes: '用你的 Codex 订阅',
});

/** 换掉夹具里没启用的 Codex（`agent:codex`）：能不能画、是不是订阅登录由参数给。 */
function withCodex(view: ModelCapabilitiesView, available = true, cost: ImageModelInfo['cost'] = 'subscription'): ModelCapabilitiesView {
  const notes = cost === 'subscription' ? '用你的 Codex 订阅' : '用 API key 登录 · 可能画不了';
  return {
    ...view,
    generateImage: {
      ...view.generateImage,
      providers: [
        ...view.generateImage.providers.filter((p) => p.providerId !== 'agent:codex'),
        {
          providerId: 'agent:codex',
          kind: 'agent',
          label: 'Codex',
          config: { enabled: available } as never,
          models: [{ ...codexModel, cost, notes }],
          available,
          ...(available ? {} : { unavailableReason: 'disabled' as never, detail: '没有打开「用 Codex 画图」' }),
        },
      ],
    },
  };
}

const draft = (patch: Partial<ImageDraft> = {}): ImageDraft => ({ ...BLANK_IMAGE, model: 'openai/gpt-image-1', ...patch });

describe('画幅', () => {
  it('有宽高比时列宽高比（带默认尺寸），否则列尺寸', () => {
    expect(aspectOptions(ratios).map((o) => [o.key, o.label, o.sub])).toEqual([
      ['1:1', '1:1', '1024×1024'],
      ['3:2', '3:2', '1536×1024'],
      ['2:3', '2:3', '1024×1536'],
    ]);
    const sizesOnly = imageModel('dall-e', { sizes: ['1024x1024', '1792x1024'] });
    expect(aspectOptions(sizesOnly).map((o) => [o.key, o.label])).toEqual([
      ['1024x1024', '1:1'],
      ['1792x1024', '7:4'],
    ]);
    expect(ratioOfSize('1536x1024')).toBe('3:2');
  });

  it('草稿的画幅不成立时用模型的默认（默认尺寸对应的宽高比）', () => {
    expect(sizeKeyFor({ size: null }, ratios)).toBe('3:2');
    expect(sizeKeyFor({ size: '2:3' }, ratios)).toBe('2:3');
    expect(sizeKeyFor({ size: '16:9' }, ratios)).toBe('3:2');
    expect(sizeKeyFor({ size: null }, imageModel('auto', { sizes: [], defaultSize: null }))).toBeNull();
  });

  it('模型一行：画幅几种、一次几张、收不收种子', () => {
    expect(imageModelLine(ratios)).toBe('3 种画幅 · 一次最多 4 张 · 收种子');
    expect(imageModelLine(imageModel('auto', { sizes: [], aspectRatios: [], maxCount: 1, acceptsSeed: false }))).toBe('尺寸由服务商定 · 一次最多 1 张');
  });

  it('张数夹在 1 到 maxCount 之间；换模型时画幅与张数跟着收', () => {
    expect(countFor({ count: 9 }, ratios)).toBe(4);
    expect(countFor({ count: 0 }, ratios)).toBe(1);
    const one = option(imageModel('imagen', { sizes: ['1024x1024'], maxCount: 1 }), { key: 'google/imagen' });
    expect(switchImageModel(draft({ size: '3:2', count: 3 }), one)).toEqual({ model: 'google/imagen', size: '1024x1024', count: 1 });
  });
});

/** 分档的模型：1:1 有 1K、2K 两档，16:9 只有一档且没声明档名（像 gpt-image-2 的 1:1）。 */
const tiered = imageModel('qwen-image-2.1-turbo@mlx-8bit', {
  aspectRatios: [
    {
      ratio: '1:1',
      size: '1024x1024',
      tiers: [
        { tier: '1K', size: '1024x1024' },
        { tier: '2K', size: '2048x2048' },
      ],
    },
    {
      ratio: '16:9',
      size: '1024x576',
      tiers: [
        { tier: '1K', size: '1024x576' },
        { tier: '2K', size: '2752x1536' },
      ],
    },
    { ratio: '3:2', size: '1536x1024' },
  ],
  sizes: ['1024x1024', '1024x576', '1536x1024', '2048x2048', '2752x1536', '512x512'],
  defaultSize: '1024x1024',
  maxCount: 1,
  acceptsSeed: true,
  cost: 'free-local',
});

describe('尺寸档', () => {
  it('每个画幅列模型声明的几档（带像素尺寸）；没声明时只有画幅的默认尺寸一档；没有画幅时为空', () => {
    expect(sizeTierOptions(tiered, '16:9')).toEqual([
      { key: '1K', label: '1K', size: '1024x576', sub: '1024×576' },
      { key: '2K', label: '2K', size: '2752x1536', sub: '2752×1536' },
    ]);
    expect(sizeTierOptions(tiered, '3:2')).toEqual([{ key: '1536x1024', label: null, size: '1536x1024', sub: '1536×1024' }]);
    expect(sizeTierOptions(tiered, null)).toEqual([]);
    // 只列尺寸的模型（OpenAI 兼容端点）：画幅的键就是尺寸，一档。
    const plain = imageModel('sdxl', { sizes: ['512x512', '768x768'] });
    expect(sizeTierOptions(plain, '768x768').map((t) => t.size)).toEqual(['768x768']);
    expect(sizeTierOptions(codexModel, sizeKeyFor(draft(), codexModel))).toEqual([]);
  });

  it('默认是画幅默认尺寸那一档；选了 2K 换画幅时跟着走，换到没有 2K 的画幅回到它唯一那一档，换回来仍是 2K', () => {
    expect(tierFor(draft({ size: '16:9' }), tiered, '16:9')!.key).toBe('1K');
    const two = draft({ size: '16:9', tier: '2K' });
    expect(tierFor(two, tiered, '16:9')!.size).toBe('2752x1536');
    expect(tierFor({ ...two, size: '1:1' }, tiered, '1:1')!.size).toBe('2048x2048');
    expect(tierFor({ ...two, size: '3:2' }, tiered, '3:2')!.size).toBe('1536x1024');
    // 存下来的旧草稿没有 tier 字段
    expect(tierFor({ size: '16:9' } as ImageDraft, tiered, '16:9')!.key).toBe('1K');
  });

  it('请求：默认那一档照旧交宽高比，别的档交像素尺寸（在模型的 sizes 里）', () => {
    const local = option(tiered, { providerId: 'local', key: `local/${tiered.modelId}`, local: true });
    expect(imageRequest(draft({ prompt: '纸鹤', size: '16:9' }), local).size).toBe('16:9');
    expect(imageRequest(draft({ prompt: '纸鹤', size: '16:9', tier: '2K' }), local).size).toBe('2752x1536');
    expect(requestSize(draft({ size: '3:2', tier: '2K' }), tiered)).toBe('3:2');
    expect(tiered.sizes).toContain(requestSize(draft({ size: '1:1', tier: '2K' }), tiered));
    // 状态行写实际会出的像素尺寸
    expect(imageStatus(draft({ prompt: '纸鹤', size: '16:9', tier: '2K' }), local, false).text).toContain('2752×1536');
  });

  it('「再来一版」带回的像素尺寸落回它的画幅与档', () => {
    const back = draft({ size: '2752x1536', tier: null });
    expect(sizeKeyFor(back, tiered)).toBe('16:9');
    expect(tierFor(back, tiered, '16:9')!.key).toBe('2K');
    expect(requestSize(back, tiered)).toBe('2752x1536');
  });
});

describe('校验与请求', () => {
  it('没写提示词、超长、张数超出、种子不是整数', () => {
    expect(imageProblems(draft(), option(ratios))).toEqual([emptyPrompt()]);
    expect(imageProblems(draft({ prompt: '一'.repeat(11) }), option(ratios))).toEqual(['提示词 11 字 · 这只模型最多 10 字']);
    expect(imageProblems(draft({ prompt: 'cat', count: 5 }), option(ratios))).toEqual(['一次最多 4 张']);
    expect(imageProblems(draft({ prompt: 'cat', seed: '1.5' }), option(ratios))).toEqual(['种子要是整数']);
  });

  it('请求带画幅、张数，收种子的模型才带种子', () => {
    expect(imageRequest(draft({ prompt: ' cat ', size: '2:3', count: 2, seed: '42' }), option(ratios))).toEqual({
      prompt: 'cat',
      provider: 'openai',
      model: 'gpt-image-1',
      size: '2:3',
      count: 2,
      seed: 42,
    });
    const auto = imageModel('auto', { sizes: [], defaultSize: null });
    expect(imageRequest(draft({ prompt: 'cat', seed: '42' }), option(auto))).toEqual({ prompt: 'cat', provider: 'openai', model: 'auto', count: 1 });
  });

  it('主按钮旁的现状：门、问题、摘要', () => {
    const options = cloudModelOptions(fixtureView(), 'generateImage');
    expect(imageStatus(draft(), null, false)).toEqual({ text: '先选一只模型', bad: true });
    expect(imageStatus(draft(), options[1]!, false)).toEqual({ text: '先连接 Google Gemini', bad: true });
    expect(imageStatus(draft(), options[0]!, false)).toEqual({ text: 'gpt-image-1 · 1024×1024 · 1 张', bad: false });
    expect(imageStatus(draft(), options[0]!, true)).toEqual({ text: emptyPrompt(), bad: true });
    expect(imageHeaderChip(options[0]!)).toBe('联网 · OpenAI · 按用量计费');
  });
});

describe('本机模型', () => {
  it('出厂顺序：能画的 Codex › 本机 › 云端；本机名字用模型名，没下载的也列出；Codex 画不了时排最后', () => {
    const view = withLocal({ available: false, unavailableReason: 'not-installed' }, false);
    // 夹具里的 Codex 没启用：照样列出，排在最后。
    expect(imageModelOptions(view).map((o) => [o.key, o.local ?? false])).toEqual([
      ['local/qwen-image-2.1@mlx-4bit', true],
      ['openai/gpt-image-1', false],
      ['google/imagen-4', false],
      ['agent:codex/image-gen', false],
    ]);
    expect(imageModelOptions(withCodex(view)).map((o) => o.key)).toEqual([
      'agent:codex/image-gen',
      'local/qwen-image-2.1@mlx-4bit',
      'openai/gpt-image-1',
      'google/imagen-4',
    ]);
    const off = imageModelOptions(withCodex(view, false));
    expect(off.map((o) => o.key).at(-1)).toBe('agent:codex/image-gen');
    expect(off.at(-1)).toMatchObject({ agent: true, usable: false, why: '没有打开「用 Codex 画图」' });
    const [local] = localImageOptions(view);
    expect([local!.label, local!.usable, local!.why]).toEqual(['Qwen-Image-2.1', false, '未下载']);
    expect(localImageOptions(withLocal({ available: false, unavailableReason: 'unsupported' }, false))[0]!.why).toBe(
      '此平台或构建暂不可用',
    );
    expect(localImageOptions(withLocal())[0]!.usable).toBe(true);
  });

  it('开页：保存的 › 生效默认值（含 Runtime 的出厂顺序）› 第一只能用的，跳过不是订阅登录的 Codex', () => {
    const options = imageModelOptions(withLocal());
    expect(initialModelKey(options, null, null, imageFallback)).toBe('local/qwen-image-2.1@mlx-4bit');
    const codex = imageModelOptions(withCodex(withLocal()));
    expect(initialModelKey(codex, null, null, imageFallback)).toBe('agent:codex/image-gen');
    expect(initialModelKey(codex, null, { providerId: 'openai', modelId: 'gpt-image-1' }, imageFallback)).toBe('openai/gpt-image-1');
    const paid = imageModelOptions(withCodex(withLocal(), true, 'unknown'));
    expect(paid[0]).toMatchObject({ key: 'agent:codex/image-gen', usable: true, caution: '用 API key 登录 · 可能画不了' });
    expect(initialModelKey(paid, null, null, imageFallback)).toBe('local/qwen-image-2.1@mlx-4bit');
    expect(initialModelKey(paid, 'agent:codex/image-gen', null, imageFallback)).toBe('agent:codex/image-gen');
  });

  it('页头标签：Codex 用订阅；不是订阅登录时如实说可能画不了', () => {
    const [sub] = imageModelOptions(withCodex(fixtureView()));
    expect(imageHeaderChip(sub!)).toBe('联网 · Codex · 用你的订阅');
    const [paid] = imageModelOptions(withCodex(fixtureView(), true, 'unknown'));
    expect(imageHeaderChip(paid!)).toBe('联网 · Codex · 不是订阅登录 · 可能画不了');
  });

  it('步数：没给用默认，夹进范围；请求只给本机模型带步数', () => {
    expect(stepsFor({ steps: null }, qwen)).toBe(20);
    expect(stepsFor({ steps: 100 }, qwen)).toBe(40);
    expect(stepsFor({ steps: 3 }, qwen)).toBe(8);
    expect(stepsFor({ steps: 12 }, ratios)).toBeNull();
    const local = localImageOptions(withLocal())[0]!;
    expect(imageRequest(draft({ prompt: 'cat', seed: '5', steps: 12 }), local)).toEqual({
      prompt: 'cat',
      provider: 'local',
      model: 'qwen-image-2.1@mlx-4bit',
      size: '1:1',
      count: 1,
      seed: 5,
      steps: 12,
    });
    expect(imageRequest(draft({ prompt: 'cat', steps: 12 }), option(ratios))).not.toHaveProperty('steps');
  });

  it('步数固定的蒸馏模型（Turbo）：界面写固定步数，请求总带它，草稿里调过的步数留给别的模型', () => {
    const turbo = { ...qwen, modelId: 'qwen-image-2.1-turbo@mlx-8bit', label: 'Qwen-Image-2.1 Turbo', local: { steps: { min: 8, max: 8, step: 8, default: 8 } } };
    expect(fixedSteps(turbo)).toBe(8);
    expect(fixedSteps(qwen)).toBeNull();
    expect(fixedSteps(ratios)).toBeNull();
    expect(stepsFor({ steps: null }, turbo)).toBe(8);
    expect(stepsFor({ steps: 32 }, turbo)).toBe(8);
    expect(stepsFor({ steps: 32 }, qwen)).toBe(32);
    const local = localImageOptions(withLocal(turbo))[0]!;
    expect(imageRequest(draft({ prompt: 'cat', steps: 32 }), local)).toMatchObject({ provider: 'local', model: 'qwen-image-2.1-turbo@mlx-8bit', steps: 8 });
  });

  it('现状一句与页头标签', () => {
    const missing = localImageOptions(withLocal({ available: false, unavailableReason: 'not-installed' }, false))[0]!;
    expect(imageStatus(draft(), missing, false)).toEqual({ text: '先下载 Qwen-Image-2.1', bad: true });
    const ready = localImageOptions(withLocal())[0]!;
    expect(imageStatus(draft({ prompt: 'cat' }), ready, false)).toEqual({
      text: '本机 · 1024×1024 · 20 步 · 耗时取决于设备 · 不联网',
      bad: false,
    });
    expect(imageHeaderChip(ready)).toBe('在这台电脑上出图 · 不联网');
  });

  it('跑起来按步报：写正在画的第 done+1/N 步，走完是解码；本机还没按步时是加载模型，云端 null', () => {
    expect(imageStepPhase({ progress: { unit: 'steps', done: 0, total: 20 } })).toBe('第 1/20 步');
    expect(imageStepPhase({ progress: { unit: 'steps', done: 3, total: 20 } })).toBe('第 4/20 步');
    expect(imageStepPhase({ progress: { unit: 'steps', done: 19, total: 20 } })).toBe('第 20/20 步');
    expect(imageStepPhase({ progress: { unit: 'steps', done: 20, total: 20 } })).toBe('解码');
    expect(imageStepPhase({ progress: null, providerId: 'local', phase: 'generating' })).toBe('加载模型');
    expect(imageStepPhase({ progress: null, providerId: 'local', phase: 'starting' })).toBeNull();
    expect(imageStepPhase({ progress: null, providerId: 'openai', phase: 'generating' })).toBeNull();
    expect(imageStepPhase({ progress: { unit: 'outputs', done: 0, total: 1 }, providerId: 'openai', phase: 'generating' })).toBeNull();
    expect(imageDecoding({ progress: { unit: 'steps', done: 20, total: 20 } })).toBe(true);
    expect(imageDecoding({ progress: { unit: 'steps', done: 4, total: 20 } })).toBe(false);
  });

  it('剩余时间从 updatedAt 起往下数；开头、解码与云端没有剩余，只写已用', () => {
    const at = Date.parse('2026-10-03T00:00:02.000Z');
    const local = (done: number, remainingSec: number | null) =>
      imageJob({ providerId: 'local', progress: { unit: 'steps', done, total: 8, remainingSec } });
    expect(imageTimeLeft(local(3, 20), at + 4_500)).toBe(15.5);
    expect(imageTimeLeft(local(3, 2), at + 9_000)).toBe(0);
    expect(imageTimeLeftText(local(3, 20), at + 4_500)).toBe('剩余 0:16');
    expect(imageTimeLeft(local(0, null), at)).toBeNull();
    expect(imageTimeLeft(local(8, null), at)).toBeNull();
    expect(imageTimeLeft({ ...local(3, 20), state: 'completed' }, at)).toBeNull();
    // 已用从 startedAt（00:00:00.5）算，向下取整秒。
    expect(imageTimeLine(local(3, 20), at + 6_400)).toBe('已用 0:07 · 剩余 0:14');
    expect(imageTimeLine(imageJob({ progress: { unit: 'outputs', done: 0, total: 1 } }), at + 6_400)).toBe('已用 0:07');
    expect(imageTimeLine({ ...local(3, 20), state: 'queued', startedAt: null }, at)).toBeNull();
  });
});

describe('记录', () => {
  const done = imageJob({
    state: 'completed',
    generation: { capability: 'generateImage', prompt: '山间小路', size: null, aspectRatio: '3:2', count: 2, format: 'png', seed: 7 },
    result: { documentId: null, artifactId: 'sha256:1', outputs: [imageOut('sha256:1', 1536, 1024), imageOut('sha256:2', 1536, 1024)] },
  });

  it('每张图的名字与尺寸、种子', () => {
    expect(imageResults(done).map((r) => [r.name, r.meta])).toEqual([
      ['图片 1', '1536×1024 · 种子 7'],
      ['图片 2', '1536×1024 · 种子 7'],
    ]);
    expect(imageBatchMeta(done, 'OpenAI')).toBe('OpenAI · gpt-image-1 · 3:2 · 2 张');
    expect(imageFileName('图片 1', 'image/jpeg')).toBe('图片 1.jpg');
  });

  it('再来一版：带回提示词与设置，种子留空', () => {
    expect(againDraft(done)).toEqual({
      prompt: '山间小路',
      model: 'openai/gpt-image-1',
      size: '3:2',
      tier: null,
      count: 2,
      seed: '',
      steps: null,
      refs: [],
      refMode: 'ref',
      strength: null,
      dropped: 0,
    });
  });

  it('再试一次：照冻结的参数原样再提交', () => {
    expect(retryRequest(done)).toEqual({ prompt: '山间小路', provider: 'openai', model: 'gpt-image-1', size: '3:2', count: 2, format: 'png', seed: 7 });
    expect(retryRequest(imageJob({ generation: undefined }))).toBeNull();
  });
});

describe('放大查看', () => {
  const entry = (id: string, artifactId: string, trashedAt: string | null = null): SpaceEntry => ({
    id,
    kind: 'image',
    name: `${id}.png`,
    fileName: `${id}.png`,
    source: { projectId: null, conversationId: null },
    relPath: `${id}.png`,
    size: 1024,
    lastActivityAt: '2026-10-01T00:00:00.000Z',
    status: null,
    ref: { artifactId },
    user: { favorite: false, displayName: null, trashedAt },
  });

  it('做完的各批里收进 Space 的图，按页上的先后；没收进或进了废纸篓的不在里面', () => {
    const jobs = [
      imageJob({ jobId: 'b', state: 'completed', result: { documentId: null, artifactId: 'sha256:3', outputs: [imageOut('sha256:3')] } }),
      imageJob({ jobId: 'r', state: 'running' }),
      imageJob({
        jobId: 'a',
        state: 'completed',
        result: { documentId: null, artifactId: 'sha256:1', outputs: [imageOut('sha256:1'), imageOut('sha256:2'), imageOut('sha256:4')] },
      }),
    ];
    const entries = [entry('e1', 'sha256:1'), entry('e2', 'sha256:2', '2026-10-02T00:00:00.000Z'), entry('e3', 'sha256:3')];
    expect(imageGallery(jobs, entries)).toEqual([
      { target: { entryId: 'e3' }, name: 'e3.png' },
      { target: { entryId: 'e1' }, name: 'e1.png' },
    ]);
  });
});

describe('参考图（§6.1 生图的输入图）', () => {
  const refs = { max: 3, edit: true, maxBytesEach: null, maxBytesTotal: null };
  const editing = imageModel('gpt-image-1', { maxCount: 4, referenceImages: refs, img2img: null });
  const plain = imageModel('gemini-image', { maxCount: 1, referenceImages: { ...refs, edit: false }, img2img: null });
  const none = imageModel('dall-e', { maxCount: 4, referenceImages: null, img2img: null });
  const redraw = imageModel('qwen-image-2.1@mlx-4bit', {
    label: 'Qwen-Image-2.1',
    maxCount: 1,
    referenceImages: { ...refs, max: 10 },
    img2img: { max: 1, strength: { min: 0.1, max: 1, step: 0.05, default: 0.6 } },
  });
  const a = { entryId: 'e1', name: 'a.png' };
  const b = { assetId: 'as1', name: 'b.png' };
  const c = { path: '/tmp/c.png', name: 'c.png' };
  const d = { entryId: 'e2', name: 'd.png' };
  const draft = (patch: Partial<ImageDraft> = {}): ImageDraft => ({ ...BLANK_IMAGE, prompt: '雪景', ...patch });

  it('加图：不重复、按剩下的名额截，报没加进去的张数', () => {
    expect(addRefs([a], [a, b, c], 1)).toEqual({ refs: [a, b], dropped: 1 });
    expect(addRefs([], [c, c], 5)).toEqual({ refs: [c], dropped: 0 });
  });

  it('是不是按提示词改图（这时提示词框提醒写清怎么改）：模型认编辑、有参考图、不是以图为底重画', () => {
    expect(editsByPrompt(draft({ refs: [a] }), editing)).toBe(true);
    expect(editsByPrompt(draft({ refs: [a] }), redraw)).toBe(true);
    expect(editsByPrompt(draft(), editing)).toBe(false);
    expect(editsByPrompt(draft({ refs: [a] }), plain)).toBe(false);
    expect(editsByPrompt(draft({ refs: [a] }), none)).toBe(false);
    expect(editsByPrompt(draft({ refs: [a], refMode: 'img2img' }), redraw)).toBe(false);
  });

  it('按提示词改图：几张一起送，张数照表单；不认参考图的模型一张不送也不算错', () => {
    const f = draft({ refs: [a, b, c], count: 2 });
    expect(imageRequest(f, option(editing))).toMatchObject({ count: 2, images: [{ entryId: 'e1' }, { assetId: 'as1' }, '/tmp/c.png'], imageMode: 'ref' });
    expect(imageRequest(f, option(editing))).not.toHaveProperty('strength');
    expect(imageRequest(f, option(none))).not.toHaveProperty('images');
    expect(imageProblems(f, option(none))).toEqual([]);
    expect(refsNote(f, option(none))).toBe('dall-e 不认参考图，已选的 3 张这次不会用');
    expect(imageRefModes(editing.referenceImages ? editing : none).map((m) => m.label)).toEqual(['按提示词改图']);
    expect(imageRefModes(plain).map((m) => m.label)).toEqual(['作为参考']);
    expect(imageRefModes(none)).toEqual([]);
  });

  it('超过上限：报一条，计数标红，说明写超出几张不送；真送出去的按上限截', () => {
    const f = draft({ refs: [a, b, c, d] });
    expect(imageProblems(f, option(editing))).toEqual(['参考图最多 3 张']);
    expect(refsCount(f, editing)).toEqual({ text: '4 / 3', over: true });
    expect(usedRefs(f, editing)).toEqual([a, b, c]);
    expect(refsNote(f, option(editing))).toBe('最多 3 张 · 会按参考图编辑 · 参考图会上传给服务商 · 超出的 1 张不送');
    expect(imageStatus(draft({ refs: [a] }), option(editing), false).text).toBe('gpt-image-1 · 1024×1024 · 1 张 · 参考图 1 张');
  });

  it('以图为底重画：张数是底图的组数、带改动幅度（没给用默认）；没有底图、幅度越界都报', () => {
    const f = draft({ refs: [a, c], refMode: 'img2img', count: 4 });
    expect(imageRefMode(f, redraw)).toBe('img2img');
    expect(outputCount(f, redraw)).toBe(2);
    expect(strengthFor(f, redraw)).toBe(0.6);
    const local = option(redraw, { providerId: 'local', key: 'local/qwen-image-2.1@mlx-4bit', local: true });
    expect(imageRequest(f, local)).toMatchObject({ count: 2, images: [{ entryId: 'e1' }, '/tmp/c.png'], imageMode: 'img2img', strength: 0.6 });
    expect(imageRequest({ ...f, strength: 0.3 }, local)).toMatchObject({ strength: 0.3 });
    expect(refsNote(f, local)).toBe('最多 10 张 · 2 张底图各重画一张 · 只在这台电脑上读，不上传');
    expect(imageProblems(draft({ refMode: 'img2img' }), local)).toEqual(['以图为底重画要先选一张底图']);
    expect(imageProblems({ ...f, strength: 0 }, local)).toEqual(['改动幅度要在 0.1–1 之间']);
    // 换到不能以图为底重画的模型：回到 ref，参考图留着。
    expect(switchImageModel(f, option(editing))).toMatchObject({ refMode: 'ref' });
    expect(switchImageModel(f, option(editing))).not.toHaveProperty('refs');
    expect(imageRefMode(f, editing)).toBe('ref');
    expect(imageRequest(f, option(editing))).toMatchObject({ count: 4, imageMode: 'ref' });
  });

  it('再来一版与再试一次：冻结的输入图按来源回到草稿或原样再交；工具页带不回素材', () => {
    const job = imageJob({
      state: 'completed',
      generation: {
        capability: 'generateImage',
        prompt: '雪景',
        size: null,
        aspectRatio: '1:1',
        count: 2,
        format: 'png',
        seed: null,
        imageMode: 'img2img',
        strength: 0.4,
        images: [
          { source: 'space', entryId: 'e1', path: '/s/a.png', sha256: 'sha256:a', byteLength: 1, mediaType: 'image/png', name: 'a.png' },
          { source: 'asset', assetId: 'as1', revision: 'r1', path: '/v/b.png', sha256: 'sha256:b', byteLength: 1, mediaType: 'image/png', name: 'b.png' },
          { source: 'file', path: '/tmp/c.png', sha256: 'sha256:c', byteLength: 1, mediaType: 'image/jpeg', name: 'c.png' },
        ],
      },
    });
    expect(againDraft(job)).toMatchObject({ refs: [a, c], refMode: 'img2img', strength: 0.4, dropped: 1 });
    expect(againDraft(job)).not.toHaveProperty('count');
    expect(againDraft(job, true)).toMatchObject({ refs: [a, b, c], dropped: 0 });
    expect(retryRequest(job)).toMatchObject({
      count: 2,
      images: [{ entryId: 'e1' }, { assetId: 'as1' }, '/tmp/c.png'],
      imageMode: 'img2img',
      strength: 0.4,
    });
    expect(imageBatchMeta(job, 'OpenAI')).toBe('OpenAI · gpt-image-1 · 1:1 · 2 张 · 以图为底 · 幅度 0.4');
  });

  it('模型那一行写参考图上限', () => {
    expect(imageModelLine(editing)).toContain('参考图最多 3 张');
    expect(imageModelLine(none)).not.toContain('参考图');
  });
});
