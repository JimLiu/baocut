import type { Id } from './domain.ts';
import type { ModelCost, ModelPrice, ModelServiceCapability } from './models.ts';
import { live } from './i18n.ts';
import type { Localized, MessageRef } from './message-ref.ts';
import { ProtocolLabels } from './messages/protocol/protocol-labels.ts';
import { ProtocolValidation } from './messages/protocol/protocol-validation.ts';

/**
 * 数据外发的授权（Grant）与预算账本（架构设计 §12.5、§7.8）。
 *
 * - 一条授权绑定数据种类、接收方（Provider）、范围（全部视频或一个视频）、目的、预算方式与上限、到期时间，可以只属于一个任务。
 *   批准缩略图不等于批准原视频：调用要外发的每一种数据都要在授权的 `dataKinds` 里。
 * - 撤销或收紧（缩小数据种类、范围、上限，提前到期）使 `generation` 加一：之前按旧代接纳、还在排队的调用在开始执行时被拒绝
 *   （`GRANT_REVOKED`）。已经外发或已经计费的部分无法靠本地撤销抹除，`usage` 如实保留。
 * - 预算按调用次数（`maxCalls`）与金额（`budgetCap`，只在模型描述带价格时能估算）两种度量；每次调用在提交时原子地预留，
 *   结束时结算（§7.8）。
 * - 本机模型（`local`）与已配对的局域网节点（`node:*`）不需要授权：前者不外发，后者是用户自己的设备，配对即授权。
 */

/** 外发的数据种类。`context` 是智能体对话的上下文（发给智能体运行时的模型服务），本版只在模型上保留，不接入 Driver。 */
export const GRANT_DATA_KINDS = ['transcript', 'frames', 'audio', 'video', 'document', 'context'] as const;
export type GrantDataKind = (typeof GRANT_DATA_KINDS)[number];

/** 数据种类给人看的名字，带消息引用（嵌进 Runtime 的句子时作为参数传）。 */
export function grantDataKindLabel(kind: GrantDataKind): Localized {
  switch (kind) {
    case 'transcript':
      return ProtocolLabels.dataTranscript();
    case 'frames':
      return ProtocolLabels.dataFrames();
    case 'audio':
      return ProtocolLabels.dataAudio();
    case 'video':
      return ProtocolLabels.dataVideo();
    case 'document':
      return ProtocolLabels.dataDocument();
    case 'context':
      return ProtocolLabels.dataContext();
  }
}

/** 数据种类给人看的名字的当前语言文字（读的时候取当前语言）。 */
export const GRANT_DATA_KIND_LABELS: Readonly<Record<GrantDataKind, string>> = live(
  () => Object.fromEntries(GRANT_DATA_KINDS.map((kind) => [kind, grantDataKindLabel(kind).text])) as Record<GrantDataKind, string>,
);

/**
 * 一种能力的调用默认外发哪些数据：转写把素材的音频交给 Provider；合成语音、生成图片与文本生成交出的是文本（要合成的文字、
 * 提示词、消息）。调用方知道得更具体时可以另给（例如流程把文稿交去翻译时是 `transcript`）。
 */
export const CAPABILITY_DATA_KINDS: Readonly<Record<ModelServiceCapability, readonly GrantDataKind[]>> = {
  transcribe: ['audio'],
  synthesizeSpeech: ['document'],
  generateImage: ['document'],
  generateText: ['document'],
  // 只在本机分离，不外发；列出音频只为类型完整。
  separateAudio: ['audio'],
};

/**
 * 启用 Provider 时默认授权（§6.8 的迁移规则）覆盖的数据种类：这种能力的调用默认外发的，加上 BaoCut 自己的流程经它外发的
 * （文本生成还用于翻译文稿，§7.9）。启用之前就是这样外发的，迁移不收紧也不放宽。
 */
export const PROVIDER_ENABLE_DATA_KINDS: Readonly<Record<ModelServiceCapability, readonly GrantDataKind[]>> = {
  transcribe: ['audio'],
  synthesizeSpeech: ['document'],
  generateImage: ['document'],
  generateText: ['document', 'transcript'],
  separateAudio: ['audio'],
};

/**
 * 预算方式：
 * - `estimate-cap`：有金额上限，每次调用按模型描述的价格估算上界并预留；模型没有价格（或币种不同、计价单位在提交时
 *   估不出上界）时不能保证上限，调用以 `BUDGET_UNVERIFIABLE` 拒绝；
 * - `per-call-unknown-cost`：金额未知，只按次数（`maxCalls`，可以不限）计；不设金额上限；
 * - `free-local`：本机计算，不需要授权（保留给描述，`grants.create` 不接受）。
 */
export const GRANT_BUDGET_MODES = ['estimate-cap', 'per-call-unknown-cost', 'free-local'] as const;
export type GrantBudgetMode = (typeof GRANT_BUDGET_MODES)[number];

/** 金额：十进制字符串（最多 6 位小数）与 ISO 4217 币种。不用浮点数。 */
export interface Money {
  amount: string;
  currency: string;
}

/** 范围：`videoId` 为 null 时是全部视频（以及不属于任何视频的调用）；给了视频时只覆盖以这个视频为输入或目标的调用。 */
export interface GrantScope {
  videoId: Id | null;
}

/** 授权从哪里来：用户在设置或 CLI 里发放、审批时一并发放、启用 Provider 时默认发放（迁移规则，§6.8）。 */
export type GrantOrigin = 'user' | 'approval' | 'provider-enable';

/** 授权此刻的状态（读取时算出）：有效、已到期、已撤销、额度用完（只有 `once` 与有 `maxCalls` 的会用完）。 */
export type GrantState = 'active' | 'expired' | 'revoked' | 'exhausted';

/**
 * 用量。`calls` 是已经结算计入的调用次数（含保守扣除的），`reservedCalls` 是预留中的；金额按授权的币种：
 * `amount` 是已经计入的（服务报告的，或报告缺失时按估算），`reservedAmount` 是预留中的；没有金额上限时两者为 null。
 * `unknownCostCalls` 是计入了次数、金额未知的调用。
 */
export interface GrantUsage {
  calls: number;
  reservedCalls: number;
  amount: string | null;
  reservedAmount: string | null;
  unknownCostCalls: number;
}

export interface Grant {
  grantId: Id;
  dataKinds: GrantDataKind[];
  /** 接收方：Provider（`openai`、`google`、`elevenlabs`、`custom:<名字>`、`agent:codex`）。 */
  recipient: string;
  scope: GrantScope;
  /** 目的：给人看的一句话（任务、用途）。 */
  purpose: string;
  /** `purpose` 由 Runtime 写成时（例如启用 Provider 时的默认授权）的文字引用：界面按当前语言重新生成；用户给的目的没有。 */
  purposeRef?: MessageRef;
  budgetMode: GrantBudgetMode;
  /** 金额上限（`estimate-cap` 才有）。 */
  budgetCap: Money | null;
  /** 调用次数上限；null 为不限。`once` 的授权是 1。 */
  maxCalls: number | null;
  expiresAt: string | null;
  /** 授权的代：撤销或收紧时加一，按旧代接纳、还没开始执行的调用被拒绝。 */
  generation: number;
  /** 只属于这个任务（会话的一次执行）的授权；null 为不限任务。 */
  taskId: Id | null;
  /** 「只这一次」：只覆盖审批时绑定的那一次调用，不被别的调用匹配。 */
  once: boolean;
  origin: GrantOrigin;
  /** 审批时发放的：那条审批。 */
  approvalId: Id | null;
  state: GrantState;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  usage: GrantUsage;
}

/** 任务记录里的授权与预算：用了哪条授权（哪一代）、预留了什么、结算成什么。 */
export interface JobGrantUse {
  grantId: Id;
  generation: number;
  /** 账本里的这笔预留。 */
  reservationId: Id;
  budgetMode: GrantBudgetMode;
  /** 这次调用外发的数据种类。 */
  dataKinds: GrantDataKind[];
  /** 提交时预留的：一次调用，以及估算的金额上界（有金额上限时）。 */
  reserved: { calls: number; amount: Money | null };
  /** 结算（任务结束时）；还在进行时为 null。 */
  settled: JobGrantSettlement | null;
  /** 自动重试之前那几次尝试的结算：重试也消耗预算（§7.8）。 */
  retries?: JobGrantSettlement[];
}

/**
 * 结算的依据（§7.8）：
 * - `reported`：服务报告了费用，按报告计；
 * - `estimate`：完成了、服务没有报告费用，按预留的估算计（有金额上限时）；
 * - `unknown`：完成了，金额未知（`per-call-unknown-cost`），只计次数；
 * - `conservative`：已经开始执行（数据可能已经交出、可能已经计费）却失败、取消或中断，服务没有报告：计一次调用并扣下预留的估算；
 * - `released`：还没开始执行就结束了（排队时取消、开始前被撤销、停止），预留全部释放，什么都不计。
 */
export type JobGrantSettlementBasis = 'reported' | 'estimate' | 'unknown' | 'conservative' | 'released';

export interface JobGrantSettlement {
  calls: number;
  amount: Money | null;
  basis: JobGrantSettlementBasis;
  at: string;
}

/** 一项要用户授权的数据外发（审批里列出，`PendingApproval.grants`）。 */
export interface GrantRequestItem {
  capability: ModelServiceCapability;
  dataKinds: GrantDataKind[];
  recipient: string;
  /** 外发的数据来自（或结果要放进）哪个视频；没有时 null。 */
  videoId: Id | null;
  purpose: string;
  /** `purpose` 由 Runtime 写成时（工具页、流程、模型工具的用途）的文字引用：界面按当前语言重新生成；智能体给的用途没有。 */
  purposeRef?: MessageRef;
  /**
   * 为什么要授权：`none` 没有覆盖它的授权；`revoked` 覆盖它的授权已被撤销或到期；`unverifiable` 有金额上限的授权覆盖它，
   * 但模型没有价格，无法保证上限（只能批准这一次、金额未知）；`exhausted` 覆盖它的授权额度用完了（只出现在工具页的
   * 待批准项里，见 `PendingGrantsDetails`）。
   */
  reason: 'none' | 'revoked' | 'unverifiable' | 'exhausted';
  /** 模型的费用状态与这次调用的估算（有价格时）。 */
  cost: ModelCost;
  estimate: Money | null;
  /** 合并的审批（`grants_request`）里请求的调用次数上限；null 为不限。 */
  maxCalls: number | null;
}

/**
 * 允许一条带外发授权的审批时的选择（`approvals.respond` 的 `grant`）：
 * - `{ persist: false }`（默认）：只这一次，金额未知；
 * - `{ persist: true, … }`：同时发放一条持续授权，范围默认是这次调用的视频（`scope: 'all'` 为全部视频），给了 `budgetCap`
 *   时是 `estimate-cap`，否则 `per-call-unknown-cost`。
 */
export type ApprovalGrantChoice =
  | { persist: false }
  | { persist: true; scope?: 'video' | 'all'; maxCalls?: number | null; budgetCap?: Money | null; expiresAt?: string | null };

export interface GrantCreateParams {
  dataKinds: GrantDataKind[];
  recipient: string;
  /** 不给时是全部视频。 */
  scope?: GrantScope;
  purpose: string;
  budgetMode: Exclude<GrantBudgetMode, 'free-local'>;
  budgetCap?: Money | null;
  maxCalls?: number | null;
  expiresAt?: string | null;
  taskId?: Id | null;
}

/**
 * 工具页的当场授权（架构设计 §7.9、§12.5）：在场的用户（桌面界面的连接）启动固定流程或直接提交任务，缺授权或额度不够时，
 * 拒绝的 `details`（`GRANT_REQUIRED`、`GRANT_REVOKED`、`BUDGET_EXCEEDED`、`BUDGET_UNVERIFIABLE`）多带 `pendingGrants`：
 * 这次启动要用户批准的全部外发（一个流程的几种外发在同一次拒绝里）。客户端请用户确认之后逐项 `grants.create`
 * （`grantCreateParamsFor`），再用同一个 `commandId` 重新提交。Runtime 不自动发放、不放宽任何授权；CLI、智能体与对外服务
 * 的拒绝不带它（`remedy.commands` 照旧给出要执行的命令）。任务预算（`TASK_BUDGET_*`）不进待批准项。
 */
export interface PendingGrantsDetails {
  pendingGrants: GrantRequestItem[];
}

/**
 * 一项待批准的外发对应的 `grants.create` 参数：范围是这一项的视频（没有视频时是全部视频）、按次计金额未知、次数上限照项里的。
 * 用户可以在发放前改（例如设金额上限）。
 */
export function grantCreateParamsFor(item: GrantRequestItem): GrantCreateParams {
  return {
    dataKinds: [...item.dataKinds],
    recipient: item.recipient,
    scope: { videoId: item.videoId },
    purpose: item.purpose,
    budgetMode: 'per-call-unknown-cost',
    maxCalls: item.maxCalls,
  };
}

/** `grants.update`：给出的字段替换，不给的不变。收紧（缩小、降低、提前）时 `generation` 加一。 */
export interface GrantUpdateParams {
  grantId: Id;
  dataKinds?: GrantDataKind[];
  scope?: GrantScope;
  purpose?: string;
  budgetCap?: Money | null;
  maxCalls?: number | null;
  expiresAt?: string | null;
}

/** 一条授权的用量与用过它的任务（还保留在任务记录里的）。 */
export interface GrantUsageReport {
  grant: Grant;
  jobs: Array<{ jobId: Id; state: string; reserved: JobGrantUse['reserved']; settled: JobGrantSettlement | null }>;
}

/** 撤销的结果：撤销之后禁止新的调用；已经外发或计费的部分如实列出，无法抹除。 */
export interface GrantRevokeResult {
  grant: Grant;
  /** 已经计入的调用与金额（已经交出的数据与可能产生的费用）。 */
  alreadySent: { calls: number; amount: Money | null; unknownCostCalls: number };
  /** 撤销时正在执行的任务：数据已经交出，照常结束并结算；排队中的在开始时被拒绝。 */
  runningJobs: Id[];
  note: string;
  /** `note` 的消息引用（message-ref.ts）。 */
  noteRef?: MessageRef;
}

export interface GrantsSnapshot {
  grants: Grant[];
}

export type GrantsEvent = { type: 'grant.upsert'; grant: Grant } | { type: 'grant.removed'; grantId: Id };

/** 授权与预算的错误码（放在 `RpcError.details.code`）。 */
/** 授权与预算的错误码；`TASK_BUDGET_*` 是任务预算（§7.8）的，与授权的预算并列检查。 */
export const GRANT_ERROR_CODES = [
  'GRANT_REQUIRED',
  'GRANT_REVOKED',
  'BUDGET_EXCEEDED',
  'BUDGET_UNVERIFIABLE',
  'TASK_BUDGET_EXCEEDED',
  'TASK_BUDGET_UNVERIFIABLE',
] as const;
export type GrantErrorCode = (typeof GRANT_ERROR_CODES)[number];

export function isGrantErrorCode(value: unknown): value is GrantErrorCode {
  return typeof value === 'string' && (GRANT_ERROR_CODES as readonly string[]).includes(value);
}

// ---- 金额 ----

/** 金额的最小单位：百万分之一。 */
export const MONEY_SCALE = 1_000_000n;
const AMOUNT_PATTERN = /^\d{1,12}(\.\d{1,6})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function isMoneyAmount(value: string): boolean {
  return AMOUNT_PATTERN.test(value);
}

export function isCurrency(value: string): boolean {
  return CURRENCY_PATTERN.test(value);
}

/** 十进制字符串 → 百万分之一的整数。不合法时抛出。 */
export function moneyToMicros(amount: string): bigint {
  if (!AMOUNT_PATTERN.test(amount)) throw new Error(String(ProtocolValidation.amountInvalidValue({ amount })));
  const [whole, fraction = ''] = amount.split('.');
  return BigInt(whole!) * MONEY_SCALE + BigInt(fraction.padEnd(6, '0'));
}

/** 百万分之一的整数 → 十进制字符串（去掉多余的 0，至少两位小数）。 */
export function microsToMoney(micros: bigint): string {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const whole = abs / MONEY_SCALE;
  let fraction = (abs % MONEY_SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  if (fraction.length < 2) fraction = fraction.padEnd(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * 按模型描述的价格估算一次调用的金额上界。只在提交时能确定上界的计价单位上估算：按次（`request`）、按张（`image`，
 * 乘张数）、按千字符（`1k-chars`，按合成文本的码点数向上取整）。没有价格、单位用不上（例如转写按分钟、文本按 token）时 null。
 */
export function estimateCallCost(price: ModelPrice | undefined, input: { count?: number; chars?: number }): Money | null {
  if (!price || !isMoneyAmount(price.amount) || !isCurrency(price.currency)) return null;
  const unit = moneyToMicros(price.amount);
  switch (price.unit) {
    case 'request':
      return { amount: microsToMoney(unit), currency: price.currency };
    case 'image':
      return input.count === undefined ? null : { amount: microsToMoney(unit * BigInt(input.count)), currency: price.currency };
    case '1k-chars':
      return input.chars === undefined
        ? null
        : { amount: microsToMoney(unit * BigInt(Math.ceil(input.chars / 1000))), currency: price.currency };
  }
}
