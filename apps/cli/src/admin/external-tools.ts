import { localizeText, newId, type JobRecord } from '@baocut/protocol';
import type { ExitCode } from '../envelope.ts';
import { remedyText } from '../localized-text.ts';
import { defineNoun, type AdminRun } from './context.ts';
import { M } from './external-tools-copy.ts';
import {
  formatToolList,
  formatToolOffer,
  formatToolStatus,
  formatToolUpdatePlan,
  installToolPrompt,
  newCommandLines,
  parseToolsArgs,
  updateOutcomeLine,
  updateToolPrompt,
} from './external-tools-output.ts';

/**
 * `baocut external-tools …`：受管的外部工具（yt-dlp、ffmpeg；架构设计 §12.9），与协议的 `externalTools.*` 对应。
 * 安装先打印来源、版本、大小与许可，同意（终端里回答，或 `--yes`）之后才下载，并跟着任务的进度。
 */
export const externalTools = defineNoun({
  name: 'external-tools',
  verbs: ['list', 'detect', 'install', 'update', 'path', 'remove', 'consent'],
  get usage() {
    return M.help;
  },
  options: { yes: { type: 'boolean' }, revoke: { type: 'boolean' }, clear: { type: 'boolean' } },
  async run(ctx) {
    const { client, values } = ctx;
    const command = ctx.parse(() => parseToolsArgs(ctx.args, { revoke: values.revoke, clear: values.clear }, (file) => ctx.resolve(file)));
    switch (command.kind) {
      case 'list': {
        const result = await client.request('externalTools.list', {});
        return ctx.done(result, formatToolList(result.tools));
      }
      case 'detect': {
        const result = await client.request('externalTools.detect', command.name ? { name: command.name } : {});
        return ctx.done(result, formatToolList(result.tools));
      }
      case 'path': {
        const result = await client.request('externalTools.setPath', { name: command.name, path: command.file });
        return ctx.done(result, formatToolStatus(result.tool));
      }
      case 'remove': {
        const result = await client.request('externalTools.remove', { name: command.name });
        return ctx.done(result, formatToolStatus(result.tool));
      }
      case 'consent': {
        const result = await client.request('externalTools.consent', { name: command.name, grant: command.grant, via: 'cli' });
        return ctx.done(result, formatToolStatus(result.tool));
      }
      case 'update':
        return updateTool(ctx, command.name, values.yes === true);
      case 'install':
        return installTool(ctx, command.name, values.yes === true);
    }
  },
});

type Ctx = AdminRun<{ yes?: boolean | undefined }>;

async function installTool(ctx: Ctx, name: string, yes: boolean): Promise<ExitCode> {
  const { client } = ctx;
  const { tools: all } = await client.request('externalTools.detect', { name });
  const status = all.find((t) => t.name === name);
  if (!status) return ctx.fail({ code: 'TOOL_NOT_FOUND', message: M.noExternalTool(name) });
  let jobId = status.installJobId;
  if (jobId) ctx.log(M.alreadyInstalling(jobId));
  else {
    if (!status.offer) {
      return ctx.fail({ code: 'TOOL_NOT_DOWNLOADABLE', message: M.notDownloadedByBaoCut(status.label, localizeText(status.remedy, status.remedyRef)) });
    }
    for (const line of formatToolOffer(status.label, status.offer)) ctx.log(line);
    if (status.offer.blockedReason) {
      return ctx.fail({
        code: 'TOOL_DOWNLOAD_BLOCKED',
        message: M.cannotDownload(status.label, localizeText(status.offer.blockedReason, status.offer.blockedReasonRef)),
      });
    }
    const agreed = await ctx.confirm(installToolPrompt(status.label, status.offer), yes, M.notTtyAgreeDownload);
    if (!agreed) return ctx.done({ installed: false, tool: status }, [M.notDownloaded]);
  }
  return ctx.follow(
    async () => {
      if (jobId) return { jobId };
      const submitted = await client.request('externalTools.install', { name, consent: true, via: 'cli' });
      jobId = submitted.jobId;
      return { jobId };
    },
    {
      complete: async (job) => {
        const { tools: after } = await client.request('externalTools.detect', { name });
        const tool = after.find((t) => t.name === name) ?? null;
        return ctx.done({ jobId: job.jobId, tool }, [M.installDone, ...(tool ? formatToolStatus(tool) : [])]);
      },
      stopped: (job) => {
        const remedy = remedyText(job.error?.details);
        if (remedy !== null) ctx.log(M.remedy(remedy));
        if (job.state === 'cancelled') ctx.log(M.partialDownloadKept(name));
      },
    },
  );
}

/** `update <名字>`：打印安装方式与完整命令，确认之后提交；命令的输出逐行打出（`--json` 时写 stderr），结果里带全部输出。 */
async function updateTool(ctx: Ctx, name: string, yes: boolean): Promise<ExitCode> {
  const { client } = ctx;
  const { tools: all } = await client.request('externalTools.detect', { name });
  const status = all.find((t) => t.name === name);
  if (!status) return ctx.fail({ code: 'TOOL_NOT_FOUND', message: M.noExternalTool(name) });
  const before = status.version;
  let jobId = status.updateJobId;
  let confirmedCommand: string | null = null;
  if (jobId) ctx.log(M.alreadyUpdating(jobId));
  else {
    const plan = status.update;
    if (!plan) {
      return ctx.fail({
        code: 'TOOL_UPDATE_UNAVAILABLE',
        message:
          status.source === 'managed'
            ? M.managedCopy(status.label, name)
            : status.path
              ? M.unknownInstall(status.path, name)
              : M.noRunnableTool(status.label, localizeText(status.remedy, status.remedyRef) ?? ''),
      });
    }
    for (const line of formatToolUpdatePlan(status, plan)) ctx.log(line);
    if (!plan.runnable) {
      // 要管理员权限等：只能由用户在终端里自己执行。
      return ctx.fail({
        code: 'TOOL_UPDATE_MANUAL',
        message: M.updateManual(status.label, plan.command),
        command: plan.command,
        next: `baocut external-tools detect ${name}`,
      });
    }
    const agreed = await ctx.confirm(updateToolPrompt(status.label), yes, M.notTtyConfirmRun);
    if (!agreed) return ctx.done({ updated: false, tool: status }, [M.notRun]);
    confirmedCommand = plan.command;
  }
  let printed = 0;
  const output: string[] = [];
  const follow = (job: JobRecord, final: boolean) => {
    if (!job.command) return;
    const next = newCommandLines(job.command, printed, final);
    printed = next.printed;
    for (const line of next.lines) {
      output.push(line);
      if (ctx.output.json) ctx.log(line);
      else ctx.output.stdout.write(`${line}\n`);
    }
  };
  return ctx.follow(
    async () => {
      if (jobId) return { jobId };
      const submitted = await client.request('externalTools.update', { name, command: confirmedCommand!, commandId: newId('cmd') });
      jobId = submitted.jobId;
      return { jobId };
    },
    {
      onUpdate: (job) => follow(job, false),
      complete: async (job) => {
        follow(job, true);
        const { tools: after } = await client.request('externalTools.detect', { name });
        const tool = after.find((t) => t.name === name) ?? null;
        ctx.log(updateOutcomeLine(status.label, before, tool?.version ?? null));
        return ctx.done({ jobId: job.jobId, before, after: tool?.version ?? null, tool, output }, []);
      },
      stopped: (job) => {
        follow(job, true);
        const remedy = remedyText(job.error?.details);
        if (remedy !== null) ctx.log(M.remedy(remedy));
        if (job.state === 'cancelled') ctx.log(M.partialCommand(name));
      },
    },
  );
}
