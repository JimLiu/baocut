import { describe, expect, it } from 'vitest';
import type { ModelApiAlias, ModelApiRouting, ModelCapabilitiesView, ProviderKind } from '@baocut/protocol';
import { ApiError } from './model-api-errors.ts';
import { chatRequest } from './model-api-openai.ts';
import { listModels, resolveModel } from './model-api-routing.ts';

/** 模型接口服务的路由与参数映射（不需要 Runtime）：节点与智能体的开关、名字的三种写法、聊天参数。 */

function provider(providerId: string, kind: ProviderKind, models: string[], available = true) {
  return { providerId, kind, label: providerId, config: null, available, models: models.map((modelId) => ({ modelId, available: true })) };
}

const VIEW = {
  transcribe: {
    default: null,
    effective: null,
    providers: [provider('local', 'local', ['qwen3-asr']), provider('node:studio', 'node', ['qwen3-asr'])],
  },
  synthesizeSpeech: { default: null, effective: null, providers: [provider('openai', 'online', ['tts-1'])] },
  generateImage: { default: null, effective: null, providers: [provider('openai', 'online', ['gpt-image-1'], false)] },
  generateText: {
    default: null,
    effective: null,
    providers: [provider('codex', 'agent', ['gpt-6']), provider('openai', 'online', ['gpt-6'])],
  },
} as unknown as ModelCapabilitiesView;

const ALIASES: ModelApiAlias[] = [{ alias: 'whisper-1', capability: 'transcribe', providerId: 'local', modelId: null }];
const OFF: ModelApiRouting = { online: false, nodes: false, agent: false };

function failure(run: () => unknown): ApiError {
  try {
    run();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('应当失败');
}

describe('模型接口服务的路由', () => {
  it('每个开关只放开自己那一类；不可用的 Provider 不列出', () => {
    expect(listModels(VIEW, OFF, ALIASES).map((m) => m.id)).toEqual(['whisper-1', 'local/qwen3-asr']);
    expect(listModels(VIEW, { ...OFF, nodes: true }, ALIASES).map((m) => m.id)).toEqual([
      'whisper-1',
      'local/qwen3-asr',
      'node:studio/qwen3-asr',
    ]);
    expect(listModels(VIEW, { ...OFF, agent: true }, ALIASES).map((m) => m.id)).toEqual(['whisper-1', 'local/qwen3-asr', 'codex/gpt-6']);
    expect(listModels(VIEW, { ...OFF, online: true }, ALIASES).map((m) => m.id)).toEqual([
      'whisper-1',
      'local/qwen3-asr',
      'openai/tts-1',
      'openai/gpt-6',
    ]);
  });

  it('名字：别名、`<providerId>/<modelId>`、裸模型名（按视图顺序取第一个可路由的）', () => {
    const all = { online: true, nodes: true, agent: true };
    expect(resolveModel('whisper-1', 'transcribe', VIEW, OFF, ALIASES)).toEqual({ providerId: 'local', modelId: null });
    expect(resolveModel('node:studio/qwen3-asr', 'transcribe', VIEW, all, ALIASES)).toEqual({
      providerId: 'node:studio',
      modelId: 'qwen3-asr',
    });
    expect(resolveModel('gpt-6', 'generateText', VIEW, all, ALIASES)).toEqual({ providerId: 'codex', modelId: 'gpt-6' });
    expect(resolveModel('gpt-6', 'generateText', VIEW, { ...OFF, online: true }, ALIASES)).toEqual({
      providerId: 'openai',
      modelId: 'gpt-6',
    });

    // 开关关着：那一类的模型按名请求是 404；这种能力一个可路由的都没有时 503。
    expect(failure(() => resolveModel('node:studio/qwen3-asr', 'transcribe', VIEW, OFF, ALIASES))).toMatchObject({
      status: 404,
      code: 'MODEL_NOT_FOUND',
    });
    expect(failure(() => resolveModel('codex/gpt-6', 'generateText', VIEW, OFF, ALIASES))).toMatchObject({
      status: 503,
      code: 'CAPABILITY_NOT_CONFIGURED',
    });
    // 别名的能力不对、Provider 不可用：404 / 503。
    expect(failure(() => resolveModel('whisper-1', 'generateText', VIEW, all, ALIASES))).toMatchObject({ status: 404 });
    expect(failure(() => resolveModel('openai/gpt-image-1', 'generateImage', VIEW, all, ALIASES))).toMatchObject({ status: 503 });
  });
});

describe('聊天参数的映射', () => {
  it('developer → system、文本片段拼起来；max_completion_tokens 优先；temperature、seed、reasoning_effort 与 json_object', () => {
    const { request, stream, includeUsage } = chatRequest({
      model: 'x',
      messages: [
        { role: 'developer', content: '简短' },
        {
          role: 'user',
          content: [
            { type: 'text', text: '你' },
            { type: 'text', text: '好' },
          ],
        },
      ],
      temperature: 0.3,
      max_tokens: 10,
      max_completion_tokens: 20,
      seed: 7,
      reasoning_effort: 'low',
      response_format: { type: 'json_object' },
      user: 'ignored',
    });
    expect(request).toEqual({
      messages: [
        { role: 'system', content: '简短' },
        { role: 'user', content: '你好' },
      ],
      responseFormat: { type: 'json', schema: { type: 'object' } },
      maxOutputTokens: 20,
      temperature: 0.3,
      effort: 'low',
      seed: 7,
    });
    expect({ stream, includeUsage }).toEqual({ stream: false, includeUsage: false });
    expect(chatRequest({ messages: [{ role: 'user', content: 'a' }], max_tokens: 5 }).request.maxOutputTokens).toBe(5);
    expect(failure(() => chatRequest({ messages: [{ role: 'tool', content: 'a' }] }))).toMatchObject({ code: 'UNSUPPORTED_PARAMETER' });
    expect(failure(() => chatRequest({ messages: [{ role: 'user', content: [{ type: 'image_url' }] }] }))).toMatchObject({
      code: 'UNSUPPORTED_PARAMETER',
    });
  });
});
