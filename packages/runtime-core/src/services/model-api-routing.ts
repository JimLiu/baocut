import {
  ONLINE_CAPABILITIES,
  type ModelApiAlias,
  type ModelApiRouting,
  type ModelCapabilitiesView,
  type ModelServiceCapability,
  type ProviderCapabilityView,
  type ProviderKind,
  type Localized,
} from '@baocut/protocol';
import { RcModelApi } from '@baocut/protocol/messages/runtime-core';
import { ApiError } from './model-api-errors.ts';

/**
 * 模型接口服务的路由（架构设计 §4.8）：OpenAI 形状的模型名 → 一种能力下的 Provider 与模型。
 *
 * - 名字的三种写法，按顺序：别名表里的别名；规范写法 `<providerId>/<modelId>`；能力视图里的模型名（多个 Provider 都有时
 *   按视图的顺序取第一个可用的，本机在前）。
 * - 只路由到允许的 Provider：`local` 总是允许；`online`、`node`、`agent` 各看服务配置里的开关。不允许的那一类
 *   对这个服务不存在：不在 `/v1/models` 里，按名访问是 404。
 * - 这种能力此刻没有任何可路由、可用的模型时回答 503（`CAPABILITY_NOT_CONFIGURED`），说明怎么开启；
 *   有，但名字不是其中之一时 404（`MODEL_NOT_FOUND`）。
 */

export interface ModelApiTarget {
  providerId: string;
  /** null：这个 Provider 的默认模型（选择规则见 §6.2）。 */
  modelId: string | null;
}

/** `/v1/models` 的一项。 */
export interface ListedModel {
  id: string;
  capability: ModelServiceCapability;
  providerId: string;
  modelId: string | null;
  alias: boolean;
}

/** 能力的叫法（嵌进错误说明里）。 */
function capabilityText(capability: ModelServiceCapability): Localized {
  switch (capability) {
    case 'transcribe':
      return RcModelApi.capabilityTranscribe();
    case 'synthesizeSpeech':
      return RcModelApi.capabilitySynthesizeSpeech();
    case 'generateImage':
      return RcModelApi.capabilityGenerateImage();
    case 'generateText':
      return RcModelApi.capabilityGenerateText();
    case 'separateAudio':
      return RcModelApi.capabilitySeparateAudio();
  }
}

export function routable(kind: ProviderKind, routing: ModelApiRouting): boolean {
  switch (kind) {
    case 'local':
      return true;
    case 'online':
      return routing.online;
    case 'node':
      return routing.nodes;
    case 'agent':
      return routing.agent;
  }
}

function usableProviders(
  view: ModelCapabilitiesView,
  capability: ModelServiceCapability,
  routing: ModelApiRouting,
): ProviderCapabilityView[] {
  return (view[capability].providers as ProviderCapabilityView[]).filter((p) => routable(p.kind, routing) && p.available);
}

function modelUsable(provider: ProviderCapabilityView, modelId: string | null): boolean {
  const models = provider.models;
  if (modelId === null) return models.some((m) => m.available !== false);
  return models.some((m) => m.modelId === modelId && m.available !== false);
}

/** 服务此刻能路由到的模型：别名在前，然后是 `<providerId>/<modelId>`。只列可用的。 */
export function listModels(view: ModelCapabilitiesView, routing: ModelApiRouting, aliases: ModelApiAlias[]): ListedModel[] {
  const listed: ListedModel[] = [];
  // 人声分离只在本机、没有对应的接口，不列。
  const capabilities = ONLINE_CAPABILITIES;
  for (const alias of aliases) {
    const provider = usableProviders(view, alias.capability, routing).find((p) => p.providerId === alias.providerId);
    if (!provider || !modelUsable(provider, alias.modelId)) continue;
    listed.push({ id: alias.alias, capability: alias.capability, providerId: alias.providerId, modelId: alias.modelId, alias: true });
  }
  for (const capability of capabilities) {
    for (const provider of usableProviders(view, capability, routing)) {
      for (const model of provider.models) {
        if (model.available === false) continue;
        listed.push({
          id: `${provider.providerId}/${model.modelId}`,
          capability,
          providerId: provider.providerId,
          modelId: model.modelId,
          alias: false,
        });
      }
    }
  }
  return listed;
}

/** 请求里的模型名 → Provider 与模型。找不到时 404，这种能力没有可路由的模型时 503。 */
export function resolveModel(
  name: string,
  capability: ModelServiceCapability,
  view: ModelCapabilitiesView,
  routing: ModelApiRouting,
  aliases: ModelApiAlias[],
): ModelApiTarget {
  const providers = usableProviders(view, capability, routing);
  if (!providers.some((p) => modelUsable(p, null))) throw notConfigured(capability, routing);

  const notFound = () =>
    new ApiError(404, 'MODEL_NOT_FOUND', RcModelApi.modelNotFoundFor({ capability: capabilityText(capability), model: name }));
  const check = (target: ModelApiTarget): ModelApiTarget => {
    const provider = providers.find((p) => p.providerId === target.providerId);
    if (!provider || !modelUsable(provider, target.modelId)) throw notFound();
    return target;
  };

  const alias = aliases.find((a) => a.alias === name);
  if (alias) {
    if (alias.capability !== capability) throw notFound();
    return check({ providerId: alias.providerId, modelId: alias.modelId });
  }
  const slash = name.indexOf('/');
  if (slash > 0) return check({ providerId: name.slice(0, slash), modelId: name.slice(slash + 1) });
  const provider = providers.find((p) => p.models.some((m) => m.modelId === name && m.available !== false));
  if (!provider) throw notFound();
  return { providerId: provider.providerId, modelId: name };
}

function notConfigured(capability: ModelServiceCapability, routing: ModelApiRouting): ApiError {
  const what = capabilityText(capability);
  const hint = routing.online ? RcModelApi.hintEnableOnline({ capability: what }) : RcModelApi.hintNoLocalModel({ capability: what });
  return new ApiError(503, 'CAPABILITY_NOT_CONFIGURED', RcModelApi.capabilityUnavailable({ capability: what, hint }));
}
