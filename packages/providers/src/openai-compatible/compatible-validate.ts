// OpenAI 兼容端点的连通性测试（架构设计 §6.8）。先列模型；有的端点没有这个接口：火山方舟 Agent Plan 的 `/api/plan/v3`
// 据 OpenMAIC、OmniRoute 两个开源项目的记录是 404（2026-11-03 查的，官方文档没有写明，也没有用真实密钥确认）。
// 不能凭这个 404 放行，写错的基址也是 404。于是向文本接口发一个不带模型与消息的空请求：端点的校验拒绝它，不生成内容，
// 又能分出三种情况：校验错误说明接口在、密钥被接受；401、403 是密钥不对；同样没有这个接口是基址不对。
import { ProviderFailure } from '@baocut/models';
import type { AdapterConfig, AdapterHttp } from '../adapter.ts';
import { providerFetch } from '../http/provider-fetch.ts';
import { authOf, httpOptions } from '../openai/openai-transcription.ts';

const EMPTY_REQUEST = JSON.stringify({ messages: [] });

/** `listModels` 是这个适配器列模型的只读请求。不通过时抛 `ProviderFailure`（文本不含密钥）。 */
export async function validateCompatibleEndpoint(
  listModels: () => Promise<unknown>,
  config: AdapterConfig,
  signal: AbortSignal,
  http: AdapterHttp,
  label: string,
): Promise<void> {
  try {
    await listModels();
  } catch (error) {
    if (!isMissingRoute(error)) throw error;
    await probeTextRoute(config, signal, http, label, error);
  }
}

function isMissingRoute(error: unknown): error is ProviderFailure {
  return error instanceof ProviderFailure && (error.details.status === 404 || error.details.status === 405);
}

async function probeTextRoute(
  config: AdapterConfig,
  signal: AbortSignal,
  http: AdapterHttp,
  label: string,
  listFailure: ProviderFailure,
): Promise<void> {
  try {
    await providerFetch(httpOptions(label, config, { ...http, attempts: 1 }), {
      method: 'POST',
      url: `${config.baseUrl}/chat/completions`,
      headers: { 'content-type': 'application/json' },
      auth: authOf(config),
      body: () => EMPTY_REQUEST,
      timeoutMs: http.timeoutMs ?? 15_000,
      signal,
      classify: (status, body) => (status === 404 && errorCodeNamesModel(body) ? { code: 'PROVIDER_REJECTED', reason: 'model-not-found' } : null),
    });
  } catch (error) {
    if (!(error instanceof ProviderFailure)) throw error;
    const { status, reason } = error.details;
    if (status === 400 || status === 422 || reason === 'model-not-found') return;
    throw isMissingRoute(error) ? listFailure : error;
  }
}

/**
 * 接口在，只是不认模型（方舟的 `InvalidEndpointOrModel.NotFound`，OpenAI 的 `model_not_found`）。只看错误码：404 的正文常把
 * 请求路径原样带回来，基址里有 "model" 时不能当成模型不存在。
 */
function errorCodeNamesModel(body: string): boolean {
  try {
    const code = (JSON.parse(body) as { error?: { code?: unknown } } | null)?.error?.code;
    return typeof code === 'string' && /model/i.test(code);
  } catch {
    return false;
  }
}
