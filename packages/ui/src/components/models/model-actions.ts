import type {
  DeclaredModel,
  GeneratedOutput,
  ModelBundleStatus,
  ModelCapabilitiesView,
  ModelInfoBase,
  ModelServiceCapability,
  SpeechModelInfo,
} from '@baocut/protocol';
import {
  addModelRequest,
  connectRequest,
  customProviderRequest,
  disconnectRequest,
  isCustomProvider,
  parseDefaultKey,
  type CustomProviderDraft,
} from '../../model/models-cloud.ts';
import { canReenable, localDefaultChoice, VIEW_CAPABILITY, type LocalDefaultCapability } from '../../model/models-local.ts';
import { imageProbeRequest, speechProbeRequest, textProbeRequest } from '../../model/models-probe.ts';
import { concurrencyRequest, effortRequest } from '../../model/models-text.ts';
import type { RuntimeSession } from '../../runtime/session.ts';
import { PROBE_COPY } from './models-copy.ts';

/**
 * 模型页的命令：把按钮的意思换成 `RuntimeSession` 上的一次调用。新的能力视图由 `models` 主题送回来，这里不改本地状态。
 * 失败原样抛给调用方（对话框留着、把原因写在里面）。
 */

type Session = Pick<
  RuntimeSession,
  | 'setModelDefault'
  | 'configureModelProvider'
  | 'removeModelProvider'
  | 'refreshModelProvider'
  | 'enableModelBundle'
  | 'synthesizeSpeech'
  | 'generateImage'
  | 'generateText'
  | 'setCapabilityParameters'
  | 'openArtifact'
>;

/** 云端页的默认模型菜单选了一项。 */
export async function chooseCloudDefault(session: Session, capability: ModelServiceCapability, key: string): Promise<void> {
  const ref = parseDefaultKey(key);
  await session.setModelDefault(capability, ref?.providerId ?? null, ref?.modelId);
}

/** 文本生成的「推理强度」分段选了一项（「自动」= 清掉，交给模型自己的默认）。新值经 `models` 主题送回。 */
export async function setTextEffort(session: Session, key: string): Promise<void> {
  await session.setCapabilityParameters(effortRequest(key));
}

/** 文本生成的「并发请求数」改了；不是数时不提交。 */
export async function setTextConcurrency(session: Session, value: number): Promise<boolean> {
  const request = concurrencyRequest(value);
  if (!request) return false;
  await session.setCapabilityParameters(request);
  return true;
}

/** 本地页的默认模型菜单选了一项。选中的模型包停用或加载失败过时先重新启用（`models.enable` 会让它重新校验，所以只在这时调）。 */
export async function chooseLocalDefault(
  session: Session,
  key: string,
  bundles: readonly ModelBundleStatus[],
  kind: LocalDefaultCapability = 'transcribe',
): Promise<void> {
  const choice = localDefaultChoice(key);
  const target = bundles.find((b) => b.bundleId === choice.modelId);
  if (target && canReenable(target)) await session.enableModelBundle(target.bundleId);
  await session.setModelDefault(VIEW_CAPABILITY[kind], choice.providerId, choice.modelId);
}

/** 密钥对话框的「保存」：启用并验证，不过时 Runtime 拒绝、不保存。 */
export async function saveProviderKey(session: Session, providerId: string, key: string): Promise<void> {
  await session.configureModelProvider(connectRequest(providerId, key));
}

/** 卡头的「刷新」：向服务商取模型与音色列表。取不到（`ok: false`）不算失败，原因记在它的配置里、由 `models` 主题送回。 */
export async function refreshProvider(session: Session, providerId: string): Promise<void> {
  await session.refreshModelProvider(providerId);
}

/** 内置的「移除密钥」= 清掉并停用；自建的「删除服务商」= 连同声明的模型一起删。 */
export async function disconnectProvider(session: Session, providerId: string): Promise<void> {
  if (isCustomProvider(providerId)) await session.removeModelProvider(providerId);
  else await session.configureModelProvider(disconnectRequest(providerId));
}

/** 添加自建服务商，返回它的 ID（随后打开它的密钥对话框）。 */
export async function addCustomProvider(session: Session, view: ModelCapabilitiesView, draft: CustomProviderDraft): Promise<string> {
  const request = customProviderRequest(view, draft);
  await session.configureModelProvider(request);
  return request.providerId;
}

/** 在一家自建服务商下添加一只模型。 */
export async function addProviderModel(
  session: Session,
  view: ModelCapabilitiesView,
  providerId: string,
  model: DeclaredModel,
): Promise<void> {
  await session.configureModelProvider(addModelRequest(view, providerId, model));
}

/** 开始一次测试（合成一句话、生成一张图，或让文本模型回一句），返回任务 ID。 */
export async function startProbe(
  session: Session,
  capability: ModelServiceCapability,
  providerId: string,
  model: ModelInfoBase,
  voice = '',
): Promise<string> {
  if (capability === 'synthesizeSpeech') return session.synthesizeSpeech(speechProbeRequest(providerId, model as SpeechModelInfo, voice));
  if (capability === 'generateImage') return session.generateImage(imageProbeRequest(providerId, model));
  if (capability === 'generateText') return session.generateText(textProbeRequest(providerId, model));
  throw new Error(PROBE_COPY.asrUnsupported);
}

/** 测试结果的受限地址（给 `<audio>` / `<img>`）。 */
export async function probeMediaUrl(session: Session, output: GeneratedOutput): Promise<string> {
  const handle = await session.openArtifact(output.artifactId);
  return handle.url;
}
