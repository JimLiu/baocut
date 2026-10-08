import type {
  AddProviderAccountRequest,
  ArrangeProviderAccountsRequest,
  ConfigureProviderRequest,
  ProviderKind,
  ProviderRefreshStatus,
  ProviderView,
  UpdateProviderAccountRequest,
} from '@baocut/protocol';
import type { GenerationCapability, GenerationProvider } from './generation-provider.ts';
import type { TextProvider } from './text-generation.ts';
import type { TranscribeProvider } from './transcribe-provider.ts';

/**
 * Provider 注册表的条目（架构设计 §6.1）：一个 Provider 来源负责一个 `providerId`（`local`、`openai`、`google`）
 * 或一族（`node:*`、`custom:*`）。来源给出描述（模型、限制、此刻是否可用），并交出执行各能力的实现。
 *
 * 能力按同样的方式加入：描述里声明能力与模型，来源再交出那种能力的执行者（`transcriber`、`generator`）；
 * 选择、默认值与视图不需要改动。
 */

/**
 * 描述的取法：
 * - `select`：提交时的选择用。不联网，只看本机知道的事实（配置、密钥、模型包、是否配对）；
 * - `view`：视图用。不联网，可以带上最近一次探测到的远端状态；
 * - `probe`：`models.capabilities` 用。可以联网探测（每个节点至多 2 秒，并行），并更新最近一次的状态。
 */
export type DescribeMode = 'select' | 'view' | 'probe';

export interface ProviderQueue {
  /** 同一个 key 的任务共用一个队列。 */
  key: string;
  /** 这个队列同时运行的任务数。 */
  concurrency: number;
}

export interface ProviderSource {
  readonly kind: ProviderKind;
  /** 这个来源负责的 `providerId`（含还不存在的，例如新的 `custom:<slug>`）。 */
  owns(providerId: string): boolean;
  /** 把调用方的写法规范化（节点别名 → `node:<nodeId>`）；属于这个来源但不存在时 null。 */
  resolve(providerId: string): string | null;
  list(mode: DescribeMode): Promise<ProviderView[]>;
  describe(providerId: string, mode: DescribeMode): Promise<ProviderView | null>;
  /** 执行 `transcribe` 的实现；这个 Provider 不提供时 null。 */
  transcriber(providerId: string): TranscribeProvider | null;
  /** 执行 `synthesizeSpeech` / `generateImage` 的实现；这个 Provider 不提供这种能力时 null。没有生成能力的来源可以不实现。 */
  generator?(providerId: string, capability: GenerationCapability): GenerationProvider | null;
  /** 执行 `generateText` 的实现（任务与进程内调用共用）；这个 Provider 不提供时 null。只有在线来源实现。 */
  textProvider?(providerId: string): TextProvider | null;
  queue(providerId: string, modelId: string): ProviderQueue;
  /** 所有转写执行者：停止时关闭，重新启用模型包时通知。 */
  executors(): TranscribeProvider[];
  /** 所有生成执行者：停止时关闭。 */
  generators?(): GenerationProvider[];
  /** 只有在线来源实现：修改配置（含校验与可选的验证）。 */
  configure?(request: ConfigureProviderRequest): Promise<void>;
  /** 只有在线来源实现：移除服务商（自定义端点删除配置；目录里的服务商删掉配置与全部账号的凭据）。不存在时返回 false。 */
  remove?(providerId: string): Promise<boolean>;
  /** 只有在线来源实现：账号（§6.8）。 */
  addAccount?(request: AddProviderAccountRequest): Promise<void>;
  updateAccount?(request: UpdateProviderAccountRequest): Promise<void>;
  removeAccount?(providerId: string, accountId: string): Promise<void>;
  arrangeAccounts?(request: ArrangeProviderAccountsRequest): Promise<void>;
  /** 只有在线来源实现：向供应商取模型（与音色）列表并缓存。取不到时照旧用内置列表并标明，不抛错。 */
  refresh?(providerId: string): Promise<ProviderRefreshStatus>;
}
