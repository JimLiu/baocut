import { describe, expect, it } from 'vitest';
import {
  AUTO_DEFAULT,
  bundleCategory,
  bundleChips,
  bundleFacts,
  canReenable,
  isBundleInstalled,
  licenseLines,
  licenseLineText,
  localDefaultChoice,
  localDefaultPicker,
  localGroups,
} from './models-local.ts';
import type { ModelComponentStatus, ModelLicense } from '@baocut/protocol';
import { bundle, fixtureView } from './models-test-fixtures.ts';

const QWEN = 'qwen3-asr-0.6b@mlx-4bit';

describe('localGroups', () => {
  it('转写与对齐都算语音识别；文件齐全的算已安装，not-installed 的在可下载里', () => {
    const bundles = [
      bundle(QWEN, { state: 'ready' }),
      bundle('aligner@mlx', { capability: 'align', state: 'not-installed', reason: 'missing-manifest' }),
      bundle('broken@mlx', { state: 'error', reason: 'resource' }),
    ];
    expect(bundleCategory(bundles[1]!)).toBe('asr');
    const groups = localGroups(bundles, 'asr');
    expect(groups.installed.map((b) => b.bundleId)).toEqual(['broken@mlx', QWEN]);
    expect(groups.available.map((b) => b.bundleId)).toEqual(['aligner@mlx']);
  });

  it('分离的模型包归音源分离，不进语音识别', () => {
    const bundles = [bundle(QWEN, { state: 'ready' }), bundle('htdemucs-ft@mlx', { capability: 'separate', state: 'installed' })];
    expect(bundleCategory(bundles[1]!)).toBe('sep');
    expect(localGroups(bundles, 'sep').installed.map((b) => b.bundleId)).toEqual(['htdemucs-ft@mlx']);
    expect(localGroups(bundles, 'asr').installed.map((b) => b.bundleId)).toEqual([QWEN]);
    expect(bundleFacts(bundles[1]!)).toMatch(/^分离 · MLX/);
  });

  it('可选组件缺了不影响已安装；必需组件缺了仍在可下载里', () => {
    const component = (name: string, state: 'installed' | 'missing', optional = false) => ({
      component: name,
      repo: `test/${name}`,
      revision: 'r1',
      state,
      bytes: state === 'installed' ? 1 : null,
      sharedWith: [],
      ...(optional ? { optional } : {}),
    });
    const withOptional = bundle('moss@mlx', { components: [component('asr', 'installed'), component('aligner', 'missing', true)] });
    const missingRequired = bundle('whisper@coreml', {
      backend: 'coreml',
      state: 'not-installed',
      components: [component('asr', 'missing'), component('aligner', 'installed', true)],
    });
    expect(isBundleInstalled(withOptional)).toBe(true);
    expect(isBundleInstalled(missingRequired)).toBe(false);
    expect(bundleFacts(missingRequired)).toBe('转写 · Core ML · metal');
  });

  it('其它类还没有本地模型包', () => {
    expect(localGroups([bundle(QWEN)], 'tts')).toEqual({ installed: [], available: [] });
  });
});

describe('bundleChips', () => {
  it('默认在前，再写 Worker 状态', () => {
    expect(bundleChips(bundle(QWEN, { state: 'ready' }), true)).toEqual([
      { label: '默认', tone: 'accent' },
      { label: '已加载', tone: 'positive' },
    ]);
    expect(bundleChips(bundle(QWEN), false)).toEqual([]);
  });

  it('不可用写原因；从没装过的不加标签，装过但文件不对的提示一下', () => {
    expect(bundleChips(bundle(QWEN, { state: 'error', reason: 'resource' }), false)).toEqual([{ label: '已停用', tone: 'negative' }]);
    expect(bundleChips(bundle(QWEN, { state: 'not-installed', reason: 'missing-manifest' }), false)).toEqual([]);
    expect(bundleChips(bundle(QWEN, { state: 'not-installed', reason: 'size-mismatch' }), false)).toEqual([
      { label: '文件大小不符', tone: 'notice' },
    ]);
  });
});

describe('bundleFacts / canReenable', () => {
  it('事实：用途 · 后端 · 设备 · 说明', () => {
    expect(bundleFacts(bundle(QWEN))).toBe('转写 · MLX · metal');
    expect(bundleFacts(bundle(QWEN, { capability: 'align', backend: 'candle', device: 'cpu', detail: '缺少 model.safetensors' }))).toBe(
      '对齐 · Candle · cpu · 缺少 model.safetensors',
    );
  });

  it('只有停用与加载失败的能重新启用', () => {
    expect(canReenable({ state: 'error', reason: 'resource' })).toBe(true);
    expect(canReenable({ state: 'error', reason: 'load-failed' })).toBe(true);
    expect(canReenable({ state: 'error', reason: 'unsupported' })).toBe(false);
    expect(canReenable({ state: 'installed' })).toBe(false);
  });
});

describe('localDefaultPicker', () => {
  const bundles = [bundle(QWEN), bundle('other@mlx', { state: 'not-installed' }), bundle('aligner@mlx', { capability: 'align' })];

  it('没设默认：勾「自动选择」，并说出它此刻落到哪只；菜单里只有装好的转写模型包', () => {
    const picker = localDefaultPicker(fixtureView(), bundles);
    expect(picker).toMatchObject({ selectedKey: AUTO_DEFAULT, other: null, autoUses: QWEN });
    expect(picker.items.map((i) => i.key)).toEqual([AUTO_DEFAULT, QWEN]);
  });

  it('默认是本机模型包：勾它；没装的照样列出来', () => {
    const view = fixtureView();
    view.transcribe.default = { providerId: 'local', modelId: QWEN };
    expect(localDefaultPicker(view, bundles).selectedKey).toBe(QWEN);
    view.transcribe.default = { providerId: 'local', modelId: 'other@mlx' };
    const picker = localDefaultPicker(view, bundles);
    expect(picker.selectedKey).toBe('other@mlx');
    expect(picker.items.at(-1)).toEqual({ key: 'other@mlx', label: 'other@mlx（未安装）' });
  });

  it('默认是云端模型：这里不勾任何一项，如实写出是哪只', () => {
    const view = fixtureView();
    view.transcribe.default = { providerId: 'openai', modelId: 'whisper-1' };
    view.transcribe.effective = { providerId: 'openai', modelId: 'whisper-1', source: 'user-default' };
    expect(localDefaultPicker(view, bundles)).toMatchObject({ selectedKey: null, other: 'OpenAI · whisper-1', autoUses: null });
  });

  it('选项 → setDefault 参数', () => {
    expect(localDefaultChoice(AUTO_DEFAULT)).toEqual({ providerId: null });
    expect(localDefaultChoice(QWEN)).toEqual({ providerId: 'local', modelId: QWEN });
  });

  it('视图还没到时也能画', () => {
    expect(localDefaultPicker(null, []).selectedKey).toBe(AUTO_DEFAULT);
  });

  it('音源分离也有「自动选择」：出厂默认落到装好的分离模型包；菜单只列分离的模型包，设了默认就勾它', () => {
    const SEP = 'htdemucs-ft@mlx';
    const all = [...bundles, bundle(SEP, { capability: 'separate', label: 'HTDemucs-FT' })];
    const view = fixtureView();
    view.separateAudio.effective = { providerId: 'local', modelId: SEP, source: 'factory-default' };
    const picker = localDefaultPicker(view, all, 'separate');
    expect(picker).toMatchObject({ selectedKey: AUTO_DEFAULT, hasAuto: true, autoUses: SEP, other: null });
    expect(picker.items).toEqual([
      { key: AUTO_DEFAULT, label: '自动选择' },
      { key: SEP, label: 'HTDemucs-FT' },
    ]);
    view.separateAudio.default = { providerId: 'local', modelId: SEP };
    expect(localDefaultPicker(view, all, 'separate').selectedKey).toBe(SEP);
    // 语音识别的菜单不受影响。
    expect(localDefaultPicker(view, all).items.map((i) => i.key)).toEqual([AUTO_DEFAULT, QWEN]);
  });
});

describe('图像生成的本地模型', () => {
  const IMAGE = 'qwen-image-2.1@mlx-4bit';
  const image = (patch: Parameters<typeof bundle>[1] = {}) => bundle(IMAGE, { capability: 'image', label: 'Qwen-Image-2.1', ...patch });

  it('文生图的模型包在图像生成一类；事实写「生图」', () => {
    expect(bundleCategory(image())).toBe('image');
    expect(localGroups([bundle(QWEN), image()], 'image').installed.map((b) => b.bundleId)).toEqual([IMAGE]);
    expect(bundleFacts(image())).toBe('生图 · MLX · metal');
  });

  it('默认菜单没有「自动选择」：没设时什么都不勾，只列装好的；设了本地的就勾它；设的那只不可选时按未设置算', () => {
    const bundles = [image(), bundle('half@mlx', { capability: 'image', state: 'not-installed' }), bundle(QWEN)];
    const view = fixtureView();
    const unset = localDefaultPicker(view, bundles, 'image');
    expect(unset).toMatchObject({ selectedKey: null, hasAuto: false, other: null });
    expect(unset.items).toEqual([{ key: IMAGE, label: 'Qwen-Image-2.1' }]);
    view.generateImage.default = { providerId: 'local', modelId: IMAGE };
    expect(localDefaultPicker(view, bundles, 'image').selectedKey).toBe(IMAGE);
    view.generateImage.default = { providerId: 'local', modelId: 'half@mlx' };
    expect(localDefaultPicker(view, bundles, 'image').selectedKey).toBeNull();
  });
});

describe('许可行', () => {
  const lic = (name: string, summary = name): ModelLicense => ({ name, url: `https://x.test/${name}`, commercialUse: true, summary });
  const comp = (component: string, license?: ModelLicense): ModelComponentStatus => ({
    component,
    repo: `o/${component}`,
    revision: 'r',
    state: 'installed',
    bytes: 1,
    sharedWith: [],
    ...(license ? { license } : {}),
  });
  const parts = (lines: ReturnType<typeof licenseLines>) => lines.map((l) => `${l.part}:${l.license.name}`);

  it('权重的许可，再加上与它不同或要署名的组件', () => {
    const apache = lic('Apache-2.0');
    const moss = bundle('moss', { components: [comp('asr'), comp('aligner', lic('Apache-2.0')), comp('speaker', lic('CC-BY-4.0'))] });
    expect(parts(licenseLines(moss, apache))).toEqual(['模型权重:Apache-2.0', '声纹嵌入:CC-BY-4.0']);
    const whisper = bundle('whisper', { components: [comp('asr'), comp('aligner', lic('Apache-2.0'))] });
    expect(parts(licenseLines(whisper, lic('MIT')))).toEqual(['模型权重:MIT', 'Forced aligner:Apache-2.0']);
    const pack = bundle('speaker-diarization@mlx', {
      capability: 'diarize',
      components: [comp('segmentation'), comp('speaker', lic('CC-BY-4.0'))],
    });
    expect(parts(licenseLines(pack, lic('MIT')))).toEqual(['模型权重:MIT', '声纹嵌入:CC-BY-4.0']);
    // 没有权重许可时组件的都列；都没有时空表。
    expect(parts(licenseLines(pack, null))).toEqual(['声纹嵌入:CC-BY-4.0']);
    expect(licenseLines(bundle('x', { components: [comp('asr')] }), null)).toEqual([]);
    expect(parts(licenseLines(bundle('y', { components: [comp('other', lic('BSD'))] }), null))).toEqual(['other:BSD']);
  });

  it('只有一条权重许可时不写「模型权重 · 」，多条或组件的写名字', () => {
    const one = licenseLines(bundle('a'), lic('MIT', '可商用'));
    expect(one.map((l) => licenseLineText(l, one.length))).toEqual(['MIT · 可商用']);
    const two = licenseLines(bundle('b', { components: [comp('speaker', lic('CC-BY-4.0', '须署名'))] }), lic('MIT', '可商用'));
    expect(two.map((l) => licenseLineText(l, two.length))).toEqual(['模型权重 · MIT · 可商用', '声纹嵌入 · CC-BY-4.0 · 须署名']);
    const onlyComp = licenseLines(bundle('c', { components: [comp('speaker', lic('CC-BY-4.0', '须署名'))] }), null);
    expect(onlyComp.map((l) => licenseLineText(l, onlyComp.length))).toEqual(['声纹嵌入 · CC-BY-4.0 · 须署名']);
  });
});
