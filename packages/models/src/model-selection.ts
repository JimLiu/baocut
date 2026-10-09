import {
  live,
  localizeText,
  refOf,
  RpcError,
  type CapabilityNotConfiguredDetails,
  type Localized,
  type CapabilityNotConfiguredReason,
  type ModelInfoBase,
  type ModelInfoByCapability,
  type ModelRef,
  type ModelServiceCapability,
  type ProviderCapability,
  type ProviderKind,
  type ProviderUnavailableReason,
  type ProviderView,
  type TranscribeModelInfo,
} from '@baocut/protocol';
import { ModelsModelSelection as M } from '@baocut/protocol/messages/models/model-selection.ts';
import type { ModelText } from './model-text.ts';

/**
 * Provider 与模型的选择（架构设计 §6.2），纯函数：输入是各 Provider 的描述（`select` 取法）与用户默认值。
 *
 * 顺序，取第一个给出的：
 * 1. 显式的 `provider` / `model`。只给 Provider 时：用户默认值指向它就用默认值的模型，否则用它的默认模型。
 *    只给模型时：用户默认值（或出厂默认）的 Provider 有这个模型就用它，否则 `local` 有就用 `local`，
 *    否则唯一列出它的 Provider；没有 Provider 列出它是 `not-found`，多个是 `invalid-request`。
 * 2. 用户为这种能力设的默认值；
 * 3. 出厂默认：只有 `transcribe` 有——本机有可用的模型包时用 `local` 的默认模型包。`synthesizeSpeech`、
 *    `generateImage` 与 `generateText` 没有出厂默认（即使将来 `local` 提供这些能力），要用户显式指定或设默认值；
 * 4. 都没有：`CAPABILITY_NOT_CONFIGURED`，`reason: 'no-default'`。
 *
 * 选中的 Provider 或模型不可用时直接以 `CAPABILITY_NOT_CONFIGURED` 拒绝，不往下一条落，也不换 Provider。
 * 不认识的 Provider 或模型（显式给出的）是 `not-found`：那是标识错了，不是没有配置。
 *
 * 节点的模型包由节点自己核对（节点协议规范 §9）：显式给出的模型不在节点的描述里时照样放行，交给尝试前的预检。
 */

export type SelectionSource = 'explicit' | 'user-default' | 'factory-default';

export interface ModelChoice<C extends ModelServiceCapability = ModelServiceCapability> {
  capability: C;
  providerId: string;
  modelId: string;
  kind: ProviderKind;
  label: string;
  source: SelectionSource;
  model: ModelInfoByCapability[C];
}

export interface SelectionInput<C extends ModelServiceCapability> {
  capability: C;
  /** 已经规范化的 `providerId`（节点别名已换成 `node:<nodeId>`）。 */
  provider?: string;
  model?: string;
  userDefault: ModelRef | null;
  providers: ProviderView[];
}

const CAPABILITY_LABEL_BUILDERS: Record<ModelServiceCapability, () => Localized> = {
  transcribe: M.capTranscribe,
  synthesizeSpeech: M.capSynthesizeSpeech,
  generateImage: M.capGenerateImage,
  generateText: M.capGenerateText,
  separateAudio: M.capSeparateAudio,
};

/** 能力的名字（给人看）：嵌进句子时用它，带着引用。 */
export function capabilityLabel(capability: ModelServiceCapability): Localized {
  return CAPABILITY_LABEL_BUILDERS[capability]();
}

/** 能力的名字（当前语言的文本）：每次读都按当前语言生成。 */
export const CAPABILITY_LABELS: Record<ModelServiceCapability, string> = live(() => ({
  transcribe: M.capTranscribe().text,
  synthesizeSpeech: M.capSynthesizeSpeech().text,
  generateImage: M.capGenerateImage().text,
  generateText: M.capGenerateText().text,
  separateAudio: M.capSeparateAudio().text,
}));

const FACTORY_PROVIDER = 'local';
/** 有出厂默认的能力：都是本机的模型包。 */
const FACTORY_CAPABILITIES: ReadonlySet<ModelServiceCapability> = new Set(['transcribe', 'separateAudio']);

/** 这种能力有没有出厂默认（§6.2 的第 3 条）：`transcribe` 与 `separateAudio` 有。 */
export function hasFactoryDefault(capability: ModelServiceCapability): boolean {
  return FACTORY_CAPABILITIES.has(capability);
}

export function selectModel<C extends ModelServiceCapability>(input: SelectionInput<C>): ModelChoice<C> {
  const { capability } = input;
  const byId = new Map(input.providers.map((p) => [p.providerId, p]));

  if (input.provider !== undefined) {
    const view = byId.get(input.provider);
    if (!view) throw new RpcError('not-found', M.noSuchProvider({ provider: input.provider }));
    const modelId =
      input.model ??
      (input.userDefault?.providerId === input.provider
        ? input.userDefault.modelId
        : defaultModelOf(capabilityOf(view, capability))?.modelId);
    return check(input, view, modelId, 'explicit');
  }

  if (input.model !== undefined) {
    const model = input.model;
    const lists = (view: ProviderView | undefined) => !!view && !!capabilityOf(view, capability)?.models.some((m) => m.modelId === model);
    const preferred = effectiveProviderId(input);
    if (preferred && lists(byId.get(preferred))) return check(input, byId.get(preferred)!, model, 'explicit');
    if (lists(byId.get(FACTORY_PROVIDER))) return check(input, byId.get(FACTORY_PROVIDER)!, model, 'explicit');
    const candidates = input.providers.filter((view) => lists(view));
    if (candidates.length === 0) throw new RpcError('not-found', M.noProviderForModel({ model }));
    if (candidates.length > 1) {
      throw new RpcError('invalid-request', M.ambiguousModel({ model }), {
        providers: candidates.map((c) => c.providerId),
      });
    }
    return check(input, candidates[0]!, model, 'explicit');
  }

  if (input.userDefault) {
    const view = byId.get(input.userDefault.providerId);
    if (!view) throw missingDefaultProvider(capability, input.userDefault.providerId);
    return check(input, view, input.userDefault.modelId, 'user-default');
  }

  const local = FACTORY_CAPABILITIES.has(capability) ? byId.get(FACTORY_PROVIDER) : undefined;
  const localCapability = local ? capabilityOf(local, capability) : undefined;
  const localModel = localCapability?.available ? defaultModelOf(localCapability) : undefined;
  if (local && localModel && localModel.available !== false) return check(input, local, localModel.modelId, 'factory-default');
  throw noDefault(input);
}

/** 不显式指定时会用哪个（视图的 `effective`）：用户默认值或出厂默认；不可用或没有时 null。 */
export function effectiveChoice<C extends ModelServiceCapability>(
  input: Omit<SelectionInput<C>, 'provider' | 'model'>,
): (ModelRef & { source: 'user-default' | 'factory-default' }) | null {
  try {
    const choice = selectModel(input);
    return { providerId: choice.providerId, modelId: choice.modelId, source: choice.source as 'user-default' | 'factory-default' };
  } catch {
    return null;
  }
}

/**
 * 转写请求与模型的特性是否相容（提交时检查，不在执行到一半时失败）。识别提示不在这里把关：模型不收提示时提示被忽略，
 * 任务记 `hint-ignored` 提醒（JobManager 提交时处理），不拒绝。
 */
export function checkTranscribeOptions(choice: ModelChoice<'transcribe'>, options: { assertedLanguage: string | null }): void {
  const model: TranscribeModelInfo = choice.model;
  if (options.assertedLanguage && model.languages !== 'any') {
    const primary = options.assertedLanguage.toLowerCase().split('-')[0]!;
    if (!model.languages.some((tag) => tag.toLowerCase() === primary || tag.toLowerCase() === options.assertedLanguage!.toLowerCase())) {
      throw new RpcError('invalid-request', M.languageUnsupported({ modelId: choice.modelId, language: options.assertedLanguage }), {
        providerId: choice.providerId,
        languages: model.languages,
      });
    }
  }
}

// ---- 内部 ----

function capabilityOf<C extends ModelServiceCapability>(
  view: ProviderView,
  capability: C,
): ProviderCapability<ModelInfoByCapability[C]> | undefined {
  return view.capabilities[capability] as ProviderCapability<ModelInfoByCapability[C]> | undefined;
}

function defaultModelOf<M extends ModelInfoBase>(capability: ProviderCapability<M> | undefined): M | undefined {
  if (!capability) return undefined;
  return capability.models.find((m) => m.default) ?? capability.models[0];
}

/** 不显式指定时的 Provider：用户默认值的，或出厂默认（`local` 可用时）。 */
function effectiveProviderId(input: SelectionInput<ModelServiceCapability>): string | null {
  if (input.userDefault) return input.userDefault.providerId;
  if (!FACTORY_CAPABILITIES.has(input.capability)) return null;
  const local = input.providers.find((p) => p.providerId === FACTORY_PROVIDER);
  return local && capabilityOf(local, input.capability)?.available ? FACTORY_PROVIDER : null;
}

function check<C extends ModelServiceCapability>(
  input: SelectionInput<C>,
  view: ProviderView,
  modelId: string | undefined,
  source: SelectionSource,
): ModelChoice<C> {
  const { capability } = input;
  const cap = capabilityOf(view, capability);
  if (!cap) throw capabilityNotConfigured(capability, 'unsupported', view, 'set-default');
  if (!cap.available) throw fromUnavailable(capability, view, cap.unavailableReason, modelId, localizeText(cap.detail, cap.detailRef));
  if (modelId === undefined) throw capabilityNotConfigured(capability, 'unsupported', view, 'set-default');
  let model = cap.models.find((m) => m.modelId === modelId);
  if (!model) {
    if (view.kind === 'node') model = nodeModel(modelId) as ModelInfoByCapability[C];
    else if (source === 'explicit') throw new RpcError('not-found', M.providerNoModel({ provider: view.label, modelId }));
    else
      throw capabilityNotConfigured(capability, 'unsupported', view, 'set-default', M.defaultModelGone({ modelId, provider: view.label }));
  }
  if (model.available === false) {
    throw fromUnavailable(capability, view, model.unavailableReason, modelId, localizeText(model.detail, model.detailRef));
  }
  return { capability, providerId: view.providerId, modelId, kind: view.kind, label: view.label, source, model };
}

/** 节点没有列出的模型包：由节点自己核对，这里给一个不加限制的描述。 */
function nodeModel(modelId: string): TranscribeModelInfo {
  return {
    modelId,
    label: modelId,
    maxInputBytes: null,
    maxDurationSec: null,
    wordTimestamps: 'native',
    languages: 'any',
    acceptsHint: true,
    cost: 'free-local',
  };
}

function fromUnavailable(
  capability: ModelServiceCapability,
  view: ProviderView,
  reason: ProviderUnavailableReason | undefined,
  modelId: string | undefined,
  detail: string | null | undefined,
): RpcError {
  const name = view.label;
  const model = modelId ?? '';
  if (view.kind === 'agent') return fromAgentUnavailable(capability, view, reason, detail);
  switch (reason) {
    case 'missing-credential':
      return capabilityNotConfigured(
        capability,
        'missing-credential',
        view,
        'configure-provider',
        M.missingCredential({ name }),
      );
    case 'not-installed':
      return capabilityNotConfigured(
        capability,
        'not-installed',
        view,
        'install-model',
        M.localNotInstalled({ model }),
      );
    case 'not-paired':
      return capabilityNotConfigured(capability, 'not-paired', view, 'pair-node', M.nodeNotPaired({ name }));
    case 'not-connected':
      return capabilityNotConfigured(
        capability,
        'not-connected',
        view,
        'pair-node',
        M.nodeNotConnected({ name }),
      );
    case 'resource':
      return capabilityNotConfigured(
        capability,
        'disabled',
        view,
        'enable-provider',
        M.localDisabled({ model }),
      );
    case 'not-configured': {
      // 配置过（有密钥）只是停用了：重新启用；从没配置过：去配置。
      const configured = view.config?.credential === 'set';
      return configured
        ? capabilityNotConfigured(capability, 'disabled', view, 'enable-provider', M.providerDisabled({ name }))
        : capabilityNotConfigured(capability, 'disabled', view, 'configure-provider', M.providerNotConfigured({ name }));
    }
    case 'signed-out':
    case 'outdated':
    case 'unsupported':
    case undefined:
      return capabilityNotConfigured(capability, 'unsupported', view, 'set-default');
  }
}

/**
 * 智能体 Provider（§6.9）：安装、登录与升级在智能体运行时自己的界面里完成（`setup-agent`，`detail` 说明怎么做）；
 * 没有启用时启用它——启用即同意把提示词发给这个智能体的账号。
 */
function fromAgentUnavailable(
  capability: ModelServiceCapability,
  view: ProviderView,
  reason: ProviderUnavailableReason | undefined,
  detail: string | null | undefined,
): RpcError {
  const name = view.label;
  switch (reason) {
    case 'not-installed':
      return capabilityNotConfigured(
        capability,
        'not-installed',
        view,
        'setup-agent',
        detail ? M.agentNotInstalledWith({ name, detail }) : M.agentNotInstalled({ name }),
      );
    case 'signed-out':
      return capabilityNotConfigured(
        capability,
        'signed-out',
        view,
        'setup-agent',
        detail ? M.agentSignedOutWith({ name, detail }) : M.agentSignedOut({ name }),
      );
    case 'outdated':
      return capabilityNotConfigured(
        capability,
        'outdated',
        view,
        'setup-agent',
        detail ? M.agentOutdatedWith({ name, detail }) : M.agentOutdated({ name }),
      );
    case 'not-configured':
      return capabilityNotConfigured(
        capability,
        'disabled',
        view,
        'enable-provider',
        M.agentNotEnabled({ name }),
      );
    default:
      return capabilityNotConfigured(
        capability,
        'unsupported',
        view,
        'setup-agent',
        detail ? M.agentUnavailableWith({ name, detail }) : M.agentUnavailable({ name }),
      );
  }
}

function missingDefaultProvider(capability: ModelServiceCapability, providerId: string): RpcError {
  const isNode = providerId.startsWith('node:');
  return capabilityNotConfiguredError(
    capability,
    isNode ? 'not-paired' : 'disabled',
    providerId,
    isNode ? 'pair-node' : 'configure-provider',
    isNode
      ? M.defaultNodeUnpaired({ node: providerId.slice(5), capability: capabilityLabel(capability) })
      : M.defaultProviderRemoved({ provider: providerId, capability: capabilityLabel(capability) }),
  );
}

function noDefault(input: SelectionInput<ModelServiceCapability>): RpcError {
  const { capability } = input;
  const label = capabilityLabel(capability);
  const usable = input.providers.find((p) => capabilityOf(p, capability)?.available);
  if (usable) {
    return capabilityNotConfiguredError(
      capability,
      'no-default',
      undefined,
      'set-default',
      M.setUsableAsDefault({ provider: usable.label, capability: label }),
      usable.providerId,
    );
  }
  // 生图的本地模型包不作为没有默认值时的补救：界面开页只回落到已连接的云端模型（设计稿 model-cloud-image.js `preferred`），
  // 本机生图要用户自己选或设为默认。
  const local = capability === 'generateImage' ? undefined : input.providers.find((p) => p.providerId === FACTORY_PROVIDER);
  const localNotInstalled = local && capabilityOf(local, capability)?.models.some((m) => m.unavailableReason === 'not-installed');
  if (localNotInstalled) {
    return capabilityNotConfiguredError(
      capability,
      'no-default',
      undefined,
      'install-model',
      capability === 'separateAudio'
        ? M.noModelInstallSeparator({ capability: label })
        : M.noModelInstallLocal({ capability: label }),
      FACTORY_PROVIDER,
    );
  }
  return capabilityNotConfiguredError(
    capability,
    'no-default',
    undefined,
    capability === 'separateAudio' ? 'install-model' : 'configure-provider',
    capability === 'separateAudio'
      ? M.noModelInstallSeparator({ capability: label })
      : M.noModelConfigure({ capability: label }),
  );
}

function capabilityNotConfigured(
  capability: ModelServiceCapability,
  reason: CapabilityNotConfiguredReason,
  view: ProviderView,
  action: CapabilityNotConfiguredDetails['remedy']['action'],
  hint?: ModelText,
): RpcError {
  return capabilityNotConfiguredError(
    capability,
    reason,
    view.providerId,
    action,
    hint ?? M.cannotUseFor({ provider: view.label, capability: capabilityLabel(capability) }),
    view.providerId,
  );
}

/**
 * 构造 `CAPABILITY_NOT_CONFIGURED`（`RpcError` 的 `code` 为 `conflict`）。`hint` 可以是目录文字：`details.remedy.hint` 存文本、
 * `hintRef` 存引用，错误的 `messageRef` 也带着引用过线。
 */
export function capabilityNotConfiguredError(
  capability: ModelServiceCapability,
  reason: CapabilityNotConfiguredReason,
  providerId: string | undefined,
  action: CapabilityNotConfiguredDetails['remedy']['action'],
  hint: ModelText,
  remedyProvider: string | undefined = providerId,
): RpcError {
  const details: CapabilityNotConfiguredDetails = {
    code: 'CAPABILITY_NOT_CONFIGURED',
    capability,
    reason,
    ...(providerId ? { providerId } : {}),
    remedy: {
      action,
      ...(remedyProvider ? { providerId: remedyProvider } : {}),
      capability,
      hint: String(hint),
      ...(typeof hint === 'string' ? {} : { hintRef: refOf(hint) }),
    },
  };
  return new RpcError('conflict', hint, details);
}
