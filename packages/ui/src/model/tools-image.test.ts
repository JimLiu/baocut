import { describe, expect, it } from 'vitest';
import type { ImageModelInfo, ModelCapabilitiesView } from '@baocut/protocol';
import { fixtureView, imageModel } from './models-test-fixtures.ts';
import { cloudModelOptions, initialModelKey } from './tools-models.ts';
import { imageJob, imageOut } from './tools-test-fixtures.ts';
import {
  BLANK_IMAGE,
  emptyPrompt,
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
  imageStepPhase,
  localImageOptions,
  ratioOfSize,
  retryRequest,
  sizeKeyFor,
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
  it('云端在前、本机在后；本机名字用模型名，没下载的也列出', () => {
    const view = withLocal({ available: false, unavailableReason: 'not-installed' }, false);
    expect(imageModelOptions(view).map((o) => [o.key, o.local ?? false])).toEqual([
      ['openai/gpt-image-1', false],
      ['google/imagen-4', false],
      ['local/qwen-image-2.1@mlx-4bit', true],
    ]);
    const [local] = localImageOptions(view);
    expect([local!.label, local!.usable, local!.why]).toEqual(['Qwen-Image-2.1', false, '未下载']);
    expect(localImageOptions(withLocal({ available: false, unavailableReason: 'unsupported' }, false))[0]!.why).toBe(
      '此平台或构建暂不可用',
    );
    expect(localImageOptions(withLocal())[0]!.usable).toBe(true);
  });

  it('开页回落只落到云端：没默认、没保存时不选本机，哪怕本机能用', () => {
    const options = imageModelOptions(withLocal());
    expect(initialModelKey(options, null, null, imageFallback)).toBe('openai/gpt-image-1');
    const localOnly = options.filter((o) => o.local);
    expect(initialModelKey(localOnly, null, null, imageFallback)).toBe('local/qwen-image-2.1@mlx-4bit');
    expect(initialModelKey(options, null, { providerId: 'local', modelId: 'qwen-image-2.1@mlx-4bit' }, imageFallback)).toBe(
      'local/qwen-image-2.1@mlx-4bit',
    );
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

  it('现状一句与页头标签', () => {
    const missing = localImageOptions(withLocal({ available: false, unavailableReason: 'not-installed' }, false))[0]!;
    expect(imageStatus(draft(), missing, false)).toEqual({ text: '先下载 Qwen-Image-2.1', bad: true });
    const ready = localImageOptions(withLocal())[0]!;
    expect(imageStatus(draft({ prompt: 'cat' }), ready, false)).toEqual({
      text: '本机 · 1:1 · 20 步 · 耗时取决于设备 · 不联网',
      bad: false,
    });
    expect(imageHeaderChip(ready)).toBe('在这台电脑上出图 · 不联网');
  });

  it('跑起来按步报：第 x/N 步，走完是解码；没有按步的进度时 null', () => {
    expect(imageStepPhase({ progress: { unit: 'steps', done: 3, total: 20 } })).toBe('第 3/20 步');
    expect(imageStepPhase({ progress: { unit: 'steps', done: 0, total: 20 } })).toBe('第 1/20 步');
    expect(imageStepPhase({ progress: { unit: 'steps', done: 20, total: 20 } })).toBe('解码');
    expect(imageStepPhase({ progress: null })).toBeNull();
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
    expect(againDraft(done)).toEqual({ prompt: '山间小路', model: 'openai/gpt-image-1', size: '3:2', count: 2, seed: '', steps: null });
  });

  it('再试一次：照冻结的参数原样再提交', () => {
    expect(retryRequest(done)).toEqual({ prompt: '山间小路', provider: 'openai', model: 'gpt-image-1', size: '3:2', count: 2, format: 'png', seed: 7 });
    expect(retryRequest(imageJob({ generation: undefined }))).toBeNull();
  });
});
