import type {
  ExternalToolOffer,
  ExternalToolStatus,
  ExternalToolUpdateMethod,
  ExternalToolUpdatePlan,
  JobCommandRun,
} from '@baocut/protocol';
import { live, localizeText, localizeToolStatus } from '@baocut/protocol';
import { formatBytes } from './models-output.ts';
import { M } from './external-tools-copy.ts';

/**
 * `baocut external-tools …` 的参数与输出（架构设计 §12.9；管理桶，Agent 面设计 §7）。
 * 下载工具的同意只来自用户：`install` 先打印来源、版本、大小与许可，终端里问一次，只有 `--yes` 跳过；不在终端里又没给
 * `--yes` 时拒绝，不默认同意。`update` 同样先打印安装方式与要执行的完整命令，确认之后才执行，输出逐行打出来。
 */

export type ToolsCommand =
  | { kind: 'list' }
  | { kind: 'detect'; name?: string }
  | { kind: 'install'; name: string }
  | { kind: 'update'; name: string }
  | { kind: 'path'; name: string; file: string | null }
  | { kind: 'remove'; name: string }
  | { kind: 'consent'; name: string; grant: boolean };

/** `baocut external-tools <子命令> …`。`path` 的文件按当前目录解析成绝对路径。 */
export function parseToolsArgs(
  args: string[],
  flags: { revoke?: boolean | undefined; clear?: boolean | undefined },
  resolve: (file: string) => string,
): ToolsCommand {
  const [action, name, file, ...extra] = args;
  const need = (value: string | undefined): string => {
    if (!value) throw new Error(M.usage);
    return value;
  };
  if (extra.length > 0) throw new Error(M.usage);
  switch (action) {
    case undefined:
    case 'list':
      if (name !== undefined) throw new Error(M.usage);
      return { kind: 'list' };
    case 'detect':
      if (file !== undefined) throw new Error(M.usage);
      return name ? { kind: 'detect', name } : { kind: 'detect' };
    case 'install':
    case 'update':
    case 'remove':
      if (file !== undefined) throw new Error(M.usage);
      return { kind: action, name: need(name) };
    case 'path':
      if (flags.clear) {
        if (file !== undefined) throw new Error(M.clearOrFile);
        return { kind: 'path', name: need(name), file: null };
      }
      return { kind: 'path', name: need(name), file: resolve(need(file)) };
    case 'consent':
      if (file !== undefined) throw new Error(M.usage);
      return { kind: 'consent', name: need(name), grant: !flags.revoke };
    default:
      throw new Error(M.usage);
  }
}

const STATE_LABELS: Readonly<Record<ExternalToolStatus['state'], string>> = live(() => M.stateLabels);

const SOURCE_LABELS: Readonly<Record<NonNullable<ExternalToolStatus['source']>, string>> = live(() => M.sourceLabels);

/** 一个工具几行：状态、版本与来源、路径；同意的状态；不能用时的原因与补救。 */
export function formatToolStatus(probed: ExternalToolStatus): string[] {
  const tool = localizeToolStatus(probed);
  const source = tool.source ? SOURCE_LABELS[tool.source] : null;
  const lines = [M.statusHead(tool.name, STATE_LABELS[tool.state], tool.version ?? null, source, tool.purpose)];
  if (tool.path) lines.push(M.pathLine(tool.path));
  if (tool.userPath && tool.userPath !== tool.path) lines.push(M.userPathLine(tool.userPath));
  if (tool.managed && tool.managed.path !== tool.path) lines.push(M.managedLine(tool.managed.version, tool.managed.path));
  if (tool.consentRequired) lines.push(M.consentLine(consentLabel(tool)));
  if (tool.installJobId) lines.push(M.installingLine(tool.installJobId));
  if (tool.updateJobId) lines.push(M.updatingLine(tool.updateJobId));
  else if (tool.update) {
    lines.push(M.updateLine(tool.update.command, UPDATE_METHOD_LABELS[tool.update.method], tool.update.runnable));
  }
  if (tool.reason && tool.state !== 'installed') lines.push(M.reasonLine(tool.reason));
  if (tool.remedy) lines.push(M.remedyLine(tool.remedy));
  return lines;
}

function consentLabel(tool: ExternalToolStatus): string {
  if (!tool.consent) return M.consentMissing(tool.name);
  const via = tool.consent.via === 'agent-approval' ? M.consentVia.agent : tool.consent.via === 'cli' ? M.consentVia.cli : M.consentVia.app;
  return tool.consent.state === 'granted' ? M.consentGranted(tool.consent.at, via) : M.consentRevoked(tool.consent.at);
}

export function formatToolList(tools: ExternalToolStatus[]): string[] {
  if (tools.length === 0) return [M.noTools];
  return tools.flatMap(formatToolStatus);
}

const UPDATE_METHOD_LABELS: Readonly<Record<ExternalToolUpdateMethod, string>> = live(() => M.updateMethodLabels);

/** 更新之前给用户看的：安装方式与要执行的完整命令；不能代为执行时说明原因，交给用户在终端里执行。 */
export function formatToolUpdatePlan(tool: ExternalToolStatus, plan: ExternalToolUpdatePlan): string[] {
  if (!plan.runnable) {
    return [
      M.cannotUpdate(tool.label, localizeText(plan.reason, plan.reasonRef) ?? ''),
      M.runInTerminal,
      `  ${plan.command}`,
      M.redetect(tool.name),
    ];
  }
  return [
    M.updatePlanHead(UPDATE_METHOD_LABELS[plan.method], tool.label, tool.version ?? null),
    M.pathLine(tool.path ?? ''),
    M.runLine(plan.command),
  ];
}

export function updateToolPrompt(label: string): string {
  return M.updatePrompt(label);
}

/**
 * 逐行跟随命令的输出（任务记录的 `command`）：返回还没打印过的完整行，`final` 时连同最后没写完的那一行；前面截掉、
 * 没来得及打印的行用一行说明代替。`printed` 是已经打印过的行数。
 */
export function newCommandLines(run: JobCommandRun, printed: number, final: boolean): { lines: string[]; printed: number } {
  const complete = run.output.split('\n');
  const partial = complete.pop() ?? '';
  const first = run.lines - complete.length;
  const lines = complete.slice(Math.max(printed - first, 0));
  if (first > printed) lines.unshift(M.omittedLines(first - printed));
  if (final && partial) lines.push(partial);
  return { lines, printed: Math.max(printed, run.lines) + (final && partial ? 1 : 0) };
}

/** 更新结束后的一句：按前后版本说更新到了哪个版本，或已是最新。 */
export function updateOutcomeLine(label: string, before: string | null, after: string | null): string {
  if (after && after !== before) return M.updated(label, before, after);
  return M.upToDate(label, after);
}

/** 下载之前给用户看的：来源、版本、大小、许可；不能下载时说明原因。 */
export function formatToolOffer(label: string, offer: ExternalToolOffer): string[] {
  const size = offer.sizeBytes !== null ? formatBytes(offer.sizeBytes) : M.sizeEstimated(formatBytes(offer.estimatedBytes));
  const lines = [
    M.willDownload(label, offer.version),
    M.sourceLine(offer.url ?? null),
    M.sizeLine(size),
    M.licenseLine(offer.license),
    M.homepageLine(offer.homepage),
  ];
  if (offer.sha256) lines.push(M.sha256Line(offer.sha256));
  if (offer.blockedReason) lines.push(M.blockedLine(localizeText(offer.blockedReason, offer.blockedReasonRef)));
  return lines;
}

export function installToolPrompt(label: string, offer: ExternalToolOffer): string {
  const size = offer.sizeBytes !== null ? formatBytes(offer.sizeBytes) : M.sizeAbout(formatBytes(offer.estimatedBytes));
  return M.installPrompt(label, offer.version, size);
}
