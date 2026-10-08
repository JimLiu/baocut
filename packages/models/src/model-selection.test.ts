import { describe, expect, it } from 'vitest';
import type { ProviderUnavailableReason, ProviderView, SeparateModelInfo, TranscribeModelInfo } from '@baocut/protocol';
import { checkTranscribeOptions, effectiveChoice, selectModel, type SelectionInput } from './model-selection.ts';

/** 选择的顺序（架构设计 §6.2）：显式 → 用户默认值 → 出厂默认 → `CAPABILITY_NOT_CONFIGURED`。 */

const model = (modelId: string, extra: Partial<TranscribeModelInfo> = {}): TranscribeModelInfo => ({
  modelId,
  label: modelId,
  maxInputBytes: null,
  maxDurationSec: null,
  wordTimestamps: 'native',
  languages: 'any',
  acceptsHint: true,
  cost: 'free-local',
  ...extra,
});

const provider = (
  providerId: string,
  kind: ProviderView['kind'],
  models: TranscribeModelInfo[],
  unavailable?: ProviderUnavailableReason,
  config: ProviderView['config'] = null,
): ProviderView => ({
  providerId,
  kind,
  label: providerId,
  config,
  capabilities: { transcribe: { models, available: !unavailable, ...(unavailable ? { unavailableReason: unavailable } : {}) } },
});

// 与 LocalProviderSource 一致：一个可用的模型包都没有时，能力本身也不可用（not-installed）。
const local = (installed = true) =>
  provider(
    'local',
    'local',
    [
      model('asr-small', { default: true, ...(installed ? {} : { available: false, unavailableReason: 'not-installed' as const }) }),
      model('asr-large', { available: false, unavailableReason: 'not-installed' }),
    ],
    installed ? undefined : 'not-installed',
  );
const openai = (unavailable?: ProviderUnavailableReason, credential: 'set' | 'missing' = 'set') =>
  provider(
    'openai',
    'online',
    [model('whisper-1', { default: true, cost: 'unknown' }), model('gpt-4o-transcribe', { wordTimestamps: 'none' })],
    unavailable,
    { enabled: unavailable !== 'not-configured', enabledAt: null, credential },
  );
const custom = () => provider('custom:box', 'online', [model('whisper-1', { declared: true, default: true })]);
const node = (unavailable?: ProviderUnavailableReason) =>
  provider('node:studio', 'node', [model('asr-small', { default: true })], unavailable);

const select = (input: Partial<SelectionInput<'transcribe'>>) =>
  selectModel({ capability: 'transcribe', userDefault: null, providers: [local(), openai()], ...input });
const cnc = (reason: string, action: string, providerId?: string) => ({
  code: 'conflict',
  details: expect.objectContaining({
    code: 'CAPABILITY_NOT_CONFIGURED',
    capability: 'transcribe',
    reason,
    ...(providerId ? { providerId } : {}),
    remedy: expect.objectContaining({ action }),
  }),
});

describe('selectModel', () => {
  it('显式的 provider：用它的默认模型；用户默认值指向它时用默认值的模型', () => {
    expect(select({ provider: 'openai' })).toMatchObject({
      providerId: 'openai',
      modelId: 'whisper-1',
      source: 'explicit',
      kind: 'online',
    });
    expect(select({ provider: 'openai', userDefault: { providerId: 'openai', modelId: 'gpt-4o-transcribe' } })).toMatchObject({
      modelId: 'gpt-4o-transcribe',
    });
    expect(select({ provider: 'openai', model: 'gpt-4o-transcribe' })).toMatchObject({ modelId: 'gpt-4o-transcribe' });
  });

  it('只给模型：先找默认的 Provider，再找 local，再找唯一列出它的；多个是 invalid-request，没有是 not-found', () => {
    const providers = [local(), openai(), custom()];
    expect(select({ providers, model: 'whisper-1', userDefault: { providerId: 'custom:box', modelId: 'whisper-1' } })).toMatchObject({
      providerId: 'custom:box',
    });
    expect(() => select({ providers, model: 'whisper-1' })).toThrow(
      expect.objectContaining({ code: 'invalid-request', details: { providers: ['openai', 'custom:box'] } }),
    );
    expect(select({ model: 'gpt-4o-transcribe' })).toMatchObject({ providerId: 'openai' });
    expect(() => select({ model: 'nope' })).toThrow(expect.objectContaining({ code: 'not-found' }));
    expect(() => select({ model: 'asr-large' })).toThrow(expect.objectContaining(cnc('not-installed', 'install-model', 'local')));
  });

  it('用户默认值优先于出厂默认；都没有时出厂默认是本机已安装的默认模型包', () => {
    expect(select({ userDefault: { providerId: 'openai', modelId: 'whisper-1' } })).toMatchObject({
      providerId: 'openai',
      source: 'user-default',
    });
    expect(select({})).toMatchObject({ providerId: 'local', modelId: 'asr-small', source: 'factory-default' });
  });

  it('选中的不可用时直接拒绝，不换 Provider：缺密钥、停用、未安装、节点连不上', () => {
    const missing = [local(), openai('missing-credential', 'missing')];
    expect(() => select({ providers: missing, userDefault: { providerId: 'openai', modelId: 'whisper-1' } })).toThrow(
      expect.objectContaining(cnc('missing-credential', 'configure-provider', 'openai')),
    );
    const disabled = [local(), openai('not-configured', 'set')];
    expect(() => select({ providers: disabled, provider: 'openai' })).toThrow(
      expect.objectContaining(cnc('disabled', 'enable-provider', 'openai')),
    );
    const neverConfigured = [local(), openai('not-configured', 'missing')];
    expect(() => select({ providers: neverConfigured, provider: 'openai' })).toThrow(
      expect.objectContaining(cnc('disabled', 'configure-provider', 'openai')),
    );
    expect(() => select({ provider: 'local', model: 'asr-large' })).toThrow(
      expect.objectContaining(cnc('not-installed', 'install-model', 'local')),
    );
    expect(() => select({ providers: [local(), node('not-connected')], provider: 'node:studio' })).toThrow(
      expect.objectContaining(cnc('not-connected', 'pair-node', 'node:studio')),
    );
  });

  it('默认值指向已删除的 Provider 或已不存在的模型：拒绝并说明', () => {
    expect(() => select({ userDefault: { providerId: 'custom:gone', modelId: 'm' } })).toThrow(
      expect.objectContaining(cnc('disabled', 'configure-provider', 'custom:gone')),
    );
    expect(() => select({ userDefault: { providerId: 'node:old', modelId: 'm' } })).toThrow(
      expect.objectContaining(cnc('not-paired', 'pair-node', 'node:old')),
    );
    expect(() => select({ userDefault: { providerId: 'openai', modelId: 'retired' } })).toThrow(
      expect.objectContaining(cnc('unsupported', 'set-default', 'openai')),
    );
    expect(() => select({ provider: 'openai', model: 'retired' })).toThrow(expect.objectContaining({ code: 'not-found' }));
    expect(() => select({ provider: 'nobody' })).toThrow(expect.objectContaining({ code: 'not-found' }));
  });

  it('什么都没有：no-default；提示指向已可用的 Provider，或安装模型包，或去配置', () => {
    const remedy = (action: string, providerId?: string) =>
      expect.objectContaining({
        details: expect.objectContaining({
          reason: 'no-default',
          remedy: expect.objectContaining({ action, ...(providerId ? { providerId } : {}) }),
        }),
      });
    expect(() => select({ providers: [local(false), openai()] })).toThrow(remedy('set-default', 'openai'));
    expect(() => select({ providers: [local(false), openai('missing-credential', 'missing')] })).toThrow(remedy('install-model', 'local'));
    expect(() => select({ providers: [openai('not-configured', 'missing')] })).toThrow(remedy('configure-provider'));
  });

  it('节点没列出的模型包照样放行，交给节点自己核对', () => {
    expect(select({ providers: [node()], provider: 'node:studio', model: 'asr-xl' })).toMatchObject({
      providerId: 'node:studio',
      modelId: 'asr-xl',
      kind: 'node',
    });
  });

  it('effectiveChoice：可用时报告来源，不可用时 null', () => {
    expect(effectiveChoice({ capability: 'transcribe', userDefault: null, providers: [local()] })).toEqual({
      providerId: 'local',
      modelId: 'asr-small',
      source: 'factory-default',
    });
    expect(
      effectiveChoice({ capability: 'transcribe', userDefault: { providerId: 'custom:gone', modelId: 'x' }, providers: [local()] }),
    ).toBeNull();
    expect(effectiveChoice({ capability: 'synthesizeSpeech', userDefault: null, providers: [local()] })).toBeNull();
  });

  it('人声分离有出厂默认：本机可用的分离模型包；用户默认值优先；没有可用的时补救是安装模型包', () => {
    const sepModel = (modelId: string, extra: Partial<SeparateModelInfo> = {}): SeparateModelInfo => ({
      modelId,
      label: modelId,
      cost: 'free-local',
      ...extra,
    });
    const sepLocal = (models: SeparateModelInfo[]): ProviderView => ({
      providerId: 'local',
      kind: 'local',
      label: '本机',
      config: null,
      capabilities: {
        transcribe: { models: [model('asr-small', { default: true })], available: true },
        separateAudio: {
          models,
          available: models.some((m) => m.available !== false),
          ...(models.some((m) => m.available !== false) ? {} : { unavailableReason: 'not-installed' as const }),
        },
      },
    });
    const two = sepLocal([sepModel('sep-a', { default: true }), sepModel('sep-b')]);
    expect(effectiveChoice({ capability: 'separateAudio', userDefault: null, providers: [two, openai()] })).toEqual({
      providerId: 'local',
      modelId: 'sep-a',
      source: 'factory-default',
    });
    expect(
      effectiveChoice({ capability: 'separateAudio', userDefault: { providerId: 'local', modelId: 'sep-b' }, providers: [two] }),
    ).toEqual({ providerId: 'local', modelId: 'sep-b', source: 'user-default' });
    const missing = sepLocal([sepModel('sep-a', { default: true, available: false, unavailableReason: 'not-installed' })]);
    expect(() => selectModel({ capability: 'separateAudio', userDefault: null, providers: [missing, openai()] })).toThrow(
      expect.objectContaining({
        details: expect.objectContaining({
          capability: 'separateAudio',
          reason: 'no-default',
          remedy: expect.objectContaining({ action: 'install-model', providerId: 'local' }),
        }),
      }),
    );
    // 没有一个分离模型包登记（其他平台）：同样指向安装，不指向配置在线服务。
    expect(() => selectModel({ capability: 'separateAudio', userDefault: null, providers: [local(), openai()] })).toThrow(
      expect.objectContaining({ details: expect.objectContaining({ remedy: expect.objectContaining({ action: 'install-model' }) }) }),
    );
  });

  it('checkTranscribeOptions：模型不接受 hint 或不支持断言的语言时 invalid-request', () => {
    const choice = select({ provider: 'openai' });
    const strict = { ...choice, model: model('m', { acceptsHint: false, languages: ['en', 'zh'] }) };
    expect(() => checkTranscribeOptions(strict, { hint: 'BaoCut', assertedLanguage: null })).toThrow(
      expect.objectContaining({ code: 'invalid-request' }),
    );
    expect(() => checkTranscribeOptions(strict, { hint: null, assertedLanguage: 'ja' })).toThrow(
      expect.objectContaining({ code: 'invalid-request' }),
    );
    expect(() => checkTranscribeOptions(strict, { hint: null, assertedLanguage: 'zh-Hans' })).not.toThrow();
    expect(() => checkTranscribeOptions(choice, { hint: 'BaoCut', assertedLanguage: 'ja' })).not.toThrow();
  });
});
