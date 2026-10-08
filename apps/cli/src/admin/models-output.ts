import {
  intlLocale,
  live,
  localizeText,
  modelCheckCode,
  modelCheckRepair,
  RpcError,
  type JobRecord,
  type ModelBundleStatus,
  type ModelInstallPlan,
  type ModelRemoveResult,
  type ModelsDirInfo,
  type ModelsDirInspection,
  type ModelsDirMode,
  type Money,
  type ProviderAccountStatus,
  type ProviderAccountView,
  type UsagePeriod,
  type UsageReport,
  type UsageRow,
  type UsageUnits,
} from '@baocut/protocol';
import { remedyText } from '../localized-text.ts';
import { M } from './models-copy.ts';

/**
 * `baocut models` 管理命令（repair / cancel / remove / dir / accounts / usage）的输出与参数（架构设计 §6.3）。列出、安装与
 * 检查是派生命令（`models list|install|test`）。大小未知时不显示百分比。
 */

/** 字节数给人看：B、KB、MB、GB，保留一位小数。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** 已收到 / 总量；总量未知时只给已收到的字节，不给百分比。 */
export function formatByteProgress(done: number, total: number | null): string {
  if (total === null || total <= 0) return M.byteProgressUnknown(formatBytes(done));
  const percent = Math.min(100, Math.floor((done / total) * 100));
  return M.byteProgress(formatBytes(done), formatBytes(total), percent);
}

/** 安装或修复（`models install` / `models repair`）。 */
export type InstallVerb = 'install' | 'repair';

/** 一个模型包的几行：状态、组件、安装进度与最近一次检查。 */
export function formatBundleLines(bundle: ModelBundleStatus): string[] {
  const state = M.bundleState(M.bundleStates[bundle.state], bundle.state, bundle.reason);
  const lines = [
    `${bundle.bundleId}  ${state}  ${bundle.capability} ${bundle.backend}/${bundle.device}${bundle.detail ? ` — ${localizeText(bundle.detail, bundle.detailRef)}` : ''}`,
  ];
  for (const c of bundle.components ?? []) {
    const size = c.bytes !== null ? `  ${formatBytes(c.bytes)}` : '';
    const shared = c.sharedWith.length > 0 ? M.sharedWith(c.sharedWith) : '';
    const installed = c.state === 'installed' ? M.componentInstalled : M.componentMissing;
    lines.push(`  ${c.component}  ${c.repo}@${c.revision.slice(0, 7)}  ${installed}${size}${shared}`);
  }
  if (bundle.install) {
    const job = bundle.install.jobId ? M.installTask(bundle.install.jobId) : '';
    const hint = bundle.install.state === 'paused' ? M.resumeHint(bundle.bundleId) : '';
    const progress = formatByteProgress(bundle.install.receivedBytes, bundle.install.totalBytes);
    lines.push(M.installLine(M.installStates[bundle.install.state], progress, job, hint));
  }
  if (bundle.selfTest) {
    const { state, at, detail, detailRef, code } = bundle.selfTest;
    const result = state === 'passed' ? M.checkPassed : M.checkFailed(code);
    lines.push(M.checkLine(result, at, localizeText(detail, detailRef)));
    if (state === 'failed') lines.push(...checkRemedyLines(bundle.bundleId, code));
  }
  return lines;
}

function checkRemedyLines(bundleId: string, code: string | undefined | null): string[] {
  if (code === 'APP_FILE_MISSING') return [M.remedyAppFileMissing];
  const repair = modelCheckRepair(code);
  if (repair === 'yes') return [M.remedyRepair(bundleId)];
  if (repair === 'maybe') return [M.remedyMaybeRepair(bundleId)];
  if (modelCheckCode(code) === 'MODEL_OUT_OF_MEMORY') return [M.remedyOutOfMemory];
  return [];
}

/** 安装或修复的计划：下载什么、多大、从哪里、磁盘够不够。 */
export function formatInstallPlan(plan: ModelInstallPlan, verb: InstallVerb): string[] {
  const repair = verb === 'repair';
  if (plan.upToDate) return [M.upToDate(repair, plan.bundleId)];
  const lines = [M.planHeader(repair, plan.bundleId, plan.source)];
  for (const c of plan.components) {
    if (c.action === 'keep') lines.push(M.planKeep(c.component, c.repo));
    else {
      const size = c.bytes === null ? M.sizeUnknown : formatBytes(c.bytes);
      lines.push(M.planDownload(c.component, c.repo, c.files.length, size));
    }
  }
  lines.push(
    plan.downloadBytes === null ? M.toDownloadEstimate(formatBytes(plan.estimatedBytes)) : M.toDownload(formatBytes(plan.downloadBytes)),
  );
  if (plan.resumedBytes > 0) lines.push(M.resumed(formatBytes(plan.resumedBytes)));
  if (plan.availableBytes !== null) lines.push(M.freeSpace(formatBytes(plan.availableBytes), plan.availableBytes < plan.confirmBytes));
  return lines;
}

/** 确认的提问。 */
export function installPrompt(plan: ModelInstallPlan, verb: InstallVerb): string {
  const size = plan.downloadBytes === null ? M.sizeAbout(formatBytes(plan.estimatedBytes)) : formatBytes(plan.downloadBytes);
  return M.installPrompt(verb === 'repair', size);
}

/** 安装或修复的任务没成：补救说明；磁盘空间不足、带着字节数时先说这次要多少、只剩多少。 */
export function installFailureLines(error: JobRecord['error']): string[] {
  const details = (error?.details ?? {}) as { remedy?: unknown; requiredBytes?: unknown; availableBytes?: unknown };
  const lines: string[] = [];
  const { requiredBytes: need, availableBytes: have } = details;
  if (error?.code === 'MODEL_DOWNLOAD_NO_SPACE' && typeof need === 'number' && typeof have === 'number') {
    lines.push(M.noSpace(formatBytes(need), formatBytes(have)));
  }
  const remedy = remedyText(details);
  if (remedy !== null) lines.push(M.remedy(remedy));
  return lines;
}

/**
 * `baocut models remove <id>`：`custom:` 开头的与目录里的在线服务商（`onlineProviders`，从能力视图取）是服务商
 * （§6.8：目录里的服务商移除即停用并删掉全部账号与凭据），其余是本地模型包。
 */
export function removeTarget(id: string, onlineProviders: readonly string[] = []): 'provider' | 'bundle' {
  return id.startsWith('custom:') || onlineProviders.includes(id) ? 'provider' : 'bundle';
}

export function formatRemoveResult(result: ModelRemoveResult): string[] {
  const lines = [result.removed.length > 0 ? M.removed(result.removed) : M.nothingRemoved];
  for (const kept of result.kept) {
    lines.push(kept.usedBy.length > 0 ? M.keptInUse(kept.repo, kept.usedBy) : M.keptOtherVersion(kept.repo));
  }
  lines.push(...formatBundleLines(result.bundle));
  return lines;
}

/** `baocut models dir`：当前的模型目录、来源与用量。 */
export function formatModelsDir(info: ModelsDirInfo): string[] {
  const lines = [info.path, M.dirSource(M.dirSources[info.source])];
  if (!info.exists) lines.push(M.dirMissing);
  else if (!info.writable) lines.push(M.dirNotWritable);
  const free = info.freeBytes === null ? null : formatBytes(info.freeBytes);
  lines.push(M.dirUsage(formatBytes(info.usedBytes), free, info.modelCount));
  if (info.source !== 'default') lines.push(M.dirDefault(info.defaultPath));
  if (info.moveJobId) lines.push(M.dirMoving(info.moveTo, info.moveJobId));
  return lines;
}

/**
 * 更改模型目录的第一步：先看当前目录的来源，环境变量指定时直接以 `MODELS_DIR_ENV_LOCKED` 失败（与 `models.setDir` 同样的
 * 拒绝），不去查看新位置、不打印说明；否则只读地查看新位置（`null` 是缺省目录）。
 */
export async function inspectDirChange(
  api: { getDir: () => Promise<ModelsDirInfo>; inspectDir: (path: string | null) => Promise<ModelsDirInspection> },
  target: string | null,
): Promise<ModelsDirInspection> {
  const current = await api.getDir();
  if (current.source === 'env') {
    throw new RpcError('conflict', M.dirEnvLocked, {
      code: 'MODELS_DIR_ENV_LOCKED',
      path: current.path,
    });
  }
  return api.inspectDir(target);
}

/** 选定文件夹的问题；没有问题时 null。 */
export function dirProblem(inspection: ModelsDirInspection): string | null {
  switch (inspection.problem) {
    case 'missing':
      return M.dirProblemMissing;
    case 'not-writable':
      return M.dirProblemNotWritable;
    case 'nested':
      return M.dirProblemNested;
    case 'same':
      return M.dirProblemSame;
    default:
      return null;
  }
}

/** 更改前的说明：新位置里已有的模型、可用空间，以及移动要写多少。 */
export function formatDirInspection(inspection: ModelsDirInspection): string[] {
  const found = inspection.found.bundleIds.length;
  const lines = [
    found > 0 ? M.dirFound(found, formatBytes(inspection.found.bytes)) : M.dirEmpty,
  ];
  if (inspection.freeBytes !== null) lines.push(M.dirFree(formatBytes(inspection.freeBytes)));
  if (inspection.current.bytes > 0) {
    const move = inspection.move.sameVolume
      ? M.moveSameVolume
      : M.moveSize(formatBytes(inspection.move.requiredBytes), inspection.move.fits);
    lines.push(M.dirCurrentHas(formatBytes(inspection.current.bytes), move));
  }
  return lines;
}

/**
 * 没给 `--move` / `--switch` 时用哪种：当前目录里没有模型时只切换；有时要用户选（返回 null）。两个都给时报错。
 */
export function dirMode(flags: { move?: boolean; switch?: boolean }, inspection: ModelsDirInspection): ModelsDirMode | null {
  if (flags.move && flags.switch) throw new Error(M.moveOrSwitch);
  if (flags.move) return 'move';
  if (flags.switch) return 'switch';
  return inspection.current.bytes > 0 ? null : 'switch';
}

// ---- 服务商的账号与用量（架构设计 §6.8、§6.10）：`models accounts`、`models usage` ----

/** 账号的状态给人看：限速时带上恢复时间（本机时间）。 */
export function accountStateLabel(status: ProviderAccountStatus): string {
  const label = (M.accountStates as Record<string, string>)[status.state] ?? status.state;
  if (status.state === 'rate-limited' && status.until) {
    return M.rateLimitedUntil(label, new Date(status.until).toLocaleString(intlLocale()));
  }
  return label;
}

/**
 * 一家服务商的账号，一个一行，按先后排（调用用第一个启用且有密钥的，出错不换下一个）。只有掩码，从不显示密钥。
 * `current` 标出此刻会用的那个。
 */
export function formatAccountLines(accounts: readonly ProviderAccountView[], indent = '    '): string[] {
  if (accounts.length === 0) return [`${indent}${M.noAccounts}`];
  const current = accounts.find((a) => a.enabled && a.credential === 'set')?.accountId;
  return accounts.map((account, index) => {
    const parts = [`${index + 1}. ${account.accountId}`, account.label ?? account.masked];
    if (account.label) parts.push(account.masked);
    parts.push(account.enabled ? M.accountEnabled : M.accountDisabled);
    if (account.credential === 'missing') parts.push(M.accountKeyUnreadable);
    parts.push(accountStateLabel(account.status));
    if (account.region) parts.push(M.accountRegion(account.region));
    if (account.endpoint) parts.push(M.accountEndpoint(account.endpoint));
    if (account.lastUsedAt) parts.push(M.accountLastUsed(account.lastUsedAt));
    if (account.accountId === current) parts.push(M.accountCurrent);
    return `${indent}${parts.join('  ')}`;
  });
}

/** `accounts use <账号>`：把这个账号排到最前，其余保持原来的先后。认 accountId，也认唯一的名字。 */
export function accountOrderWithFirst(accounts: readonly ProviderAccountView[], ref: string): string[] {
  const account = findAccount(accounts, ref);
  return [account.accountId, ...accounts.filter((a) => a.accountId !== account.accountId).map((a) => a.accountId)];
}

/** 按 accountId 或唯一的名字找账号；找不到或名字重复时报错（列出可选的）。 */
export function findAccount(accounts: readonly ProviderAccountView[], ref: string): ProviderAccountView {
  const byId = accounts.find((a) => a.accountId === ref);
  if (byId) return byId;
  const byLabel = accounts.filter((a) => a.label === ref);
  if (byLabel.length === 1) return byLabel[0]!;
  const choices = accounts.map((a) => (a.label ? M.accountChoice(a.accountId, a.label) : a.accountId)).join(M.listSep) || M.noAccountChoices;
  if (byLabel.length > 1) throw new Error(M.accountAmbiguous(byLabel.length, ref, choices));
  throw new Error(M.accountNotFound(ref, choices));
}

export const USAGE_PERIOD_LABELS: Record<UsagePeriod, string> = live(() => M.usagePeriods);

/** 金额：一种币种一项，不换算；空时 null。 */
export function formatMoney(list: readonly Money[]): string | null {
  if (list.length === 0) return null;
  return list.map((m) => (m.currency === 'USD' ? `$${m.amount}` : `${m.amount} ${m.currency}`)).join(' + ');
}

/** 用量给人看：只列有的项。 */
export function formatUnits(units: UsageUnits): string {
  const count = (n: number) => n.toLocaleString(intlLocale());
  const parts: string[] = [];
  if (units.inputTokens !== undefined || units.outputTokens !== undefined) {
    parts.push(M.unitTokens(count(units.inputTokens ?? 0), count(units.outputTokens ?? 0)));
    if (units.cachedTokens) parts.push(M.unitCached(count(units.cachedTokens)));
  }
  if (units.audioSeconds !== undefined) parts.push(M.unitAudio((units.audioSeconds / 60).toFixed(1)));
  if (units.chars !== undefined) parts.push(M.unitChars(count(units.chars)));
  if (units.images !== undefined) parts.push(M.unitImages(units.images));
  return parts.join(M.clauseSep);
}

function formatRow(row: UsageRow, total: number): string {
  const share = total > 0 ? `${Math.round((row.calls / total) * 100)}%` : '—';
  const money = formatMoney(row.cost);
  const cost = money ? M.costApprox(money, M.costKinds[row.costKind]) : M.costKinds[row.costKind];
  const units = formatUnits(row.units);
  return `  ${row.label}  ${M.rowCalls(row.calls, row.failed)}  ${share}${units ? `  ${units}` : ''}  ${cost}`;
}

/**
 * `baocut models usage` 的输出（§6.10）：三种金额分开写，不合成一个数——估算标「≈」，报告的照写，费用未知的只报次数；
 * 不同币种分开列。然后是按服务商、能力、模型、账号的拆分。没有调用时一句说明。
 */
export function formatUsageReport(report: UsageReport, period: UsagePeriod, providerId?: string): string[] {
  const lines = [M.usageHeader(providerId, M.usagePeriods[period], report.period.from, report.period.to)];
  const { totals } = report;
  if (totals.calls === 0) {
    lines.push(M.noCalls);
    return lines;
  }
  lines.push(M.totalCalls(totals.calls, totals.failed));
  const units = formatUnits(totals.units);
  if (units) lines.push(M.usageUnits(units));
  const estimated = formatMoney(totals.cost.estimated);
  const reported = formatMoney(totals.cost.reported);
  if (estimated) lines.push(M.spentEstimated(estimated));
  if (reported) lines.push(M.spentReported(reported));
  if (totals.cost.unknownCalls > 0) lines.push(M.unknownCostCalls(totals.cost.unknownCalls));
  if (!estimated && !reported && totals.cost.unknownCalls === 0) lines.push(M.noBilledCalls);
  const sections: Array<[string, UsageRow[]]> = [
    [M.byProvider, report.byProvider],
    [M.byCapability, report.byCapability],
    [M.byModel, report.byModel],
    [M.byAccount, report.byAccount],
  ];
  for (const [title, rows] of sections) {
    if (rows.length === 0) continue;
    lines.push(title);
    for (const row of rows) lines.push(formatRow(row, totals.calls));
  }
  return lines;
}
