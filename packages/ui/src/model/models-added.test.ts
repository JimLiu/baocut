import { describe, expect, it } from 'vitest';
import type { AudioCppAddableFamily, ModelBundleStatus, ModelLicense } from '@baocut/protocol';
import {
  addedChips,
  addedSource,
  addressHint,
  customParams,
  familyState,
  firstPackage,
  idleText,
  inPlaceFile,
  languagesLine,
  licenseFlag,
  licenseLine,
  moreCount,
  packagesNamed,
  removeFlow,
  searchFamilies,
  traitsLine,
} from './models-added.ts';
import { licenseBrief, nonCommercial } from './models-tts-local.ts';

const LIC = (commercialUse: boolean | null): ModelLicense => ({ name: 'X', url: 'https://example.com', commercialUse, summary: '上游许可表标不明' });

function fam(over: Partial<AudioCppAddableFamily> & Pick<AudioCppAddableFamily, 'family'>): AudioCppAddableFamily {
  return {
    name: over.family,
    group: 'tts',
    tasks: ['tts'],
    status: 'supported',
    languages: ['en'],
    traits: {},
    license: LIC(true),
    packages: [{ id: `${over.family}_q8_0`, name: `${over.family} GGUF`, precision: 'q8_0', bytes: 1024, parts: [], bundleId: `${over.family}-q8-0@audio-cpp`, state: null }],
    ...over,
  };
}

const bundle = (over: Partial<ModelBundleStatus>): ModelBundleStatus =>
  ({ bundleId: 'b@audio-cpp', capability: 'synthesize', backend: 'audio-cpp', state: 'not-installed', ...over }) as ModelBundleStatus;

describe('添加模型对话框的列表', () => {
  it('语言一句：自动、个数、说法词与简称，多于五种写前四种和总数', () => {
    expect(languagesLine(['auto'])).toBe('自动认语言');
    expect(languagesLine(['80+ languages'])).toBe('80 种以上语言');
    expect(languagesLine(['51 languages'])).toBe('51 种语言');
    expect(languagesLine(['multilingual'])).toBe('多语言');
    expect(languagesLine(['language_agnostic'])).toBe('不限语言');
    expect(languagesLine(['auto', 'zh', 'en'])).toBe('中 / 英');
    expect(languagesLine(['zh', 'en', 'ja', 'ko', 'de', 'fr'])).toBe('中 / 英 / 日 / 韩 等 6 种语言');
    expect(languagesLine([])).toBe('');
    expect(languagesLine(['da'])).toBe('丹麦语');
  });

  it('特点一句：出声方式在前、语言在后', () => {
    expect(traitsLine(fam({ family: 'a', traits: { clone: true, voices: 3 }, languages: ['auto'] }))).toBe('克隆 · 3 个内置音色 · 自动认语言');
  });

  it('暂时用不上的写原因；别的任务列出任务名', () => {
    expect(idleText(fam({ family: 'w', group: 'idle', idle: 'recognize' }))).toMatch(/识别/);
    expect(idleText(fam({ family: 'v', group: 'idle', idle: 'other', tasks: ['vad', 'x_task'] }))).toBe('人声检测, x_task · BaoCut 还没有用到它的功能');
  });

  it('按组与搜索词筛：能加的在前，成熟度高的在前，同档按名字', () => {
    const done = fam({ family: 'done', packages: [{ ...fam({ family: 'done' }).packages[0]!, state: 'builtin' }] });
    const community = fam({ family: 'comm', status: 'community' });
    const beta = fam({ family: 'beta', name: 'Beta' });
    const alpha = fam({ family: 'alpha', name: 'Alpha', languages: ['zh'] });
    const music = fam({ family: 'yue2', group: 'music' });
    const all = [done, community, beta, alpha, music];
    expect(searchFamilies(all, '', 'tts').map((f) => f.family)).toEqual(['alpha', 'beta', 'comm', 'done']);
    expect(searchFamilies(all, '中', 'tts').map((f) => f.family)).toEqual(['alpha']);
    expect(searchFamilies(all, 'ALPHA q8', 'tts').map((f) => f.family)).toEqual(['alpha']);
    expect(familyState(done)).toBe('done');
    expect(familyState(fam({ family: 'n', packages: [] }))).toBe('nopkg');
    expect(moreCount(all, 'tts')).toBe(3);
  });

  it('先选第一个还能加的包；精度相同的选项写包名', () => {
    const base = fam({ family: 'q' }).packages[0]!;
    const f = fam({
      family: 'q',
      packages: [
        { ...base, id: 'q_small', name: 'Q 0.6B GGUF', state: 'builtin' },
        { ...base, id: 'q_big', name: 'Q 1.7B GGUF', default: true },
      ],
    });
    expect(firstPackage(f)?.id).toBe('q_big');
    expect(packagesNamed(f)).toBe(true);
    expect(packagesNamed(fam({ family: 'one' }))).toBe(false);
  });
});

describe('自己指定文件', () => {
  it('表单不完整时列出缺的；齐了给 models.add 的参数，名字去空格、空的不带', () => {
    expect(customParams({ source: 'repo-file', address: 'nope', path: '', family: null, label: '' })).toEqual({ ok: false, problems: ['address', 'family'] });
    expect(customParams({ source: 'local-file', address: '', path: '', family: 'qwen3_tts', label: '' })).toEqual({ ok: false, problems: ['file'] });
    expect(customParams({ source: 'repo-file', address: ' me/r/v.gguf ', path: '', family: 'qwen3_tts', label: '  ' })).toEqual({
      ok: true,
      params: { source: 'repo-file', family: 'qwen3_tts', address: 'me/r/v.gguf' },
    });
    expect(customParams({ source: 'local-file', address: '', path: '/a/v.gguf', family: 'qwen3_tts', label: ' Mine ' })).toEqual({
      ok: true,
      params: { source: 'local-file', family: 'qwen3_tts', path: '/a/v.gguf', label: 'Mine' },
    });
  });

  it('地址的说明：认出来写仓库与修订；试过提交后才写错误', () => {
    expect(addressHint('https://huggingface.co/me/r/blob/v1/a/b.gguf', false).help).toContain('me/r');
    expect(addressHint('me/r/model.bin', false).error).toBeNull();
    expect(addressHint('me/r/model.bin', true).error).toMatch(/\.gguf/);
  });
});

describe('添加进来的模型在行上', () => {
  const local = bundle({
    state: 'installed',
    added: { kind: 'local-file', family: 'qwen3_tts', familyName: 'Qwen3-TTS', source: '/v/my.gguf' },
    components: [{ component: 'tts', repo: 'audio-cpp-added/custom-1', revision: 'local', state: 'installed', bytes: 9, sharedWith: [], origin: 'local-file', file: '/v/my.gguf' } as never],
  });
  const catalog = bundle({ added: { kind: 'catalog', family: 'yue2', familyName: 'YuE2', source: 'yue2_main_bf16' }, license: LIC(null) });

  it('原地引用的文件、来源一句与标签', () => {
    expect(inPlaceFile(local)).toBe('/v/my.gguf');
    expect(inPlaceFile(catalog)).toBeNull();
    expect(addedSource(catalog)).toBe('audio.cpp 模型列表 · 按 YuE2 跑');
    expect(addedSource(bundle({}))).toBeNull();
    expect(addedChips(catalog).map((c) => c.label)).toEqual(['已添加', '商用待核实']);
    expect(addedChips(bundle({ license: LIC(false) }))).toEqual([]);
  });

  it('删除按钮：内置的删除；添加的删完移出列表；原地引用的只移出列表；没下载的直接移出；下载中不给', () => {
    expect(removeFlow(bundle({}), true)).toBe('remove');
    expect(removeFlow(bundle({}), false)).toBeNull();
    expect(removeFlow(catalog, true)).toBe('remove-unlist');
    expect(removeFlow(catalog, false)).toBe('unlist');
    expect(removeFlow(local, true)).toBe('unlist-in-place');
    expect(removeFlow({ ...catalog, install: { state: 'running' } as never }, false)).toBeNull();
    expect(removeFlow({ ...catalog, install: { state: 'paused' } as never }, false)).toBe('unlist');
  });

  it('许可：商用待核实不算「仅限非商用」，提要照 Runtime 写', () => {
    expect(licenseFlag(LIC(null))).toBe('check');
    expect(licenseFlag(LIC(false))).toBe('nc');
    expect(licenseFlag(LIC(true))).toBeNull();
    expect(nonCommercial(LIC(null))).toBeNull();
    expect(nonCommercial(LIC(false))).not.toBeNull();
    expect(licenseBrief(LIC(null))).toBe('X · 上游许可表标不明');
    expect(licenseLine(LIC(true))).toBe('X');
    expect(licenseLine(LIC(null))).toBe('X · 上游许可表标不明');
    expect(licenseLine({ name: 'X', summary: 'X：只许非商业用途', commercialUse: false })).toBe('X：只许非商业用途');
  });
});
