import { z } from 'zod';
import { defaultTranscribeBundle, type ModelCatalog } from '@baocut/models';
import { RpcError, type Localized, type ModelBundleStatus, type ModelInstallPlan } from '@baocut/protocol';
import { RcAgentTools } from '@baocut/protocol/messages/runtime-core';
import type { ModelInstallService } from '../models/model-install-service.ts';
import { ToolError, type ToolInfo, type ToolSet } from './tool-catalog.ts';
import { approvalField, confirmSummary, type ToolPrincipal, type ToolScope } from './tool-scope.ts';
import { commandIdArg } from './video-tools.ts';

/**
 * 下载本地模型（架构设计 §3.5、§6.3）：智能体在做需要本机模型的事之前，把「下载模型」作为一个前置步骤提交。
 *
 * 先做计划拿到大小，再按 `command` 风险确认（访问模式决定问不问用户；确认的说明里写明大小与来源），确认之后提交安装任务；
 * 结果带大小。`surfaces` 是工具桥与 CLI：MCP 对外服务不提供安装与删除（设计的对外清单里没有它，让外部客户端触发几 GB
 * 的下载是这台机器的管理，与 Web 服务不开放 `models.install` 同理）。删除与修复只在界面与 CLI 里做。
 *
 * 同组还有 `models_list`（本地模型包与状态，网关的 `models.list`，三个面都有）与 `models_test`（跑一遍固定样本检查一个模型包，
 * 网关的 `models.test`；占用本机算力，与 `models_install` 一样不开放给 MCP）。
 */

export interface ModelInstallToolsDeps {
  installs: ModelInstallService;
  /** 本地模型包的目录（`models_list`）。 */
  catalog: Pick<ModelCatalog, 'list'>;
  scope: ToolScope;
}

// i18n-ignore-start: 给模型的工具说明、错误与下一步
const schemas = {
  models_install: z.strictObject({
    bundleId: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        `可选。要下载的本地模型包；不给时是这台机器默认的转写模型包 ${defaultTranscribeBundle(process.platform, process.arch)}，本机语音合成与生图必须给出。models_capabilities 里本机 Provider 的模型就是模型包（转写在 transcribe 下，合成在 synthesizeSpeech 下，生图在 generateImage 下）`,
      ),
    commandId: commandIdArg.optional().describe('可选。重试同一次提交时带上同一个值，不会重复创建任务'),
  }),
  models_list: z.strictObject({}),
  models_test: z.strictObject({
    bundleId: z.string().min(1).max(200).describe('要检查的本地模型包：models_list 里的 bundleId（要已经装好）'),
    commandId: commandIdArg.optional().describe('可选。重试同一次提交时带上同一个值，不会重复创建任务'),
  }),
};

type ToolName = keyof typeof schemas;
type Args<N extends ToolName = 'models_install'> = z.infer<(typeof schemas)[N]>;

const DEFINITIONS: Record<ToolName, ToolInfo> = {
  models_install: {
    title: '下载本地模型',
    description: [
      '下载并安装一个本机模型包（几百 MB 到几 GB）。',
      '装好之后才能用本机转写、语音合成或生图。只在本机模型没有安装（CAPABILITY_NOT_CONFIGURED 的 remedy.action 为 install-model）时用。',
      '提交前会把大小告诉用户并按访问模式确认；已经装好时不下载（jobId 为 null）。只下载缺的部分，之前没下完的会续传。',
      '立即返回 jobId 与大小（downloadBytes；大小未知时为 null，estimatedBytes 是估计值）。用 jobs_wait 等它结束（要看进度用 jobs_inspect，progress.unit 为 bytes），state 为 completed 才算装好；之后再提交转写，或带上 provider: local 与这个模型包提交合成或生图（它们没有出厂默认）。不要重复提交同一件事。',
    ].join('\n'),
    annotations: { destructiveHint: false, idempotentHint: true },
    effect: 'job',
    examples: [
      { title: '下载默认的转写模型包', args: {} },
      { title: '下载指定的模型包', args: { bundleId: 'qwen3-asr-0.6b@mlx-4bit' } },
    ],
    surfaces: ['agent', 'cli'],
  },
  models_list: {
    title: '列出本地模型包',
    description: [
      '列出这台机器上的本地模型包与各自的状态。',
      '每个模型包：bundleId、名字、能力（transcribe、align、synthesize、separate、image、diarize）、后端、状态（not-installed、downloading、installed、ready 等）与原因、下载大小的估计、权重许可、安装进度与最近一次检查的结果。',
      '只读。要用本机模型时先看这里装没装；没装的用 models_install 下载（会话与终端里），能力与默认值看 models_capabilities。',
    ].join('\n'),
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [{ title: '列出本地模型包', args: {} }],
    surfaces: ['agent', 'mcp', 'cli'],
  },
  models_test: {
    title: '检查本地模型包',
    description: [
      '用固定样本把一个已装好的本地模型包完整跑一遍，检查它能不能用。',
      '识别的模型包识别一段固定录音，合成的合成一句固定短句，生图的出一张小图，分离的分一段录音；说话人区分模型包没有单独的检查。不含用户的内容。',
      '立即返回 jobId；用 jobs_wait 等它结束：completed 是通过，failed 时 error.details.check 是原因（MODEL_FILES_DAMAGED 可以请用户修复）。结果也记进 models_list 的 selfTest。',
    ].join('\n'),
    annotations: { destructiveHint: false },
    effect: 'job',
    examples: [{ title: '检查一个模型包', args: { bundleId: 'qwen3-asr-0.6b@mlx-4bit' } }],
    surfaces: ['agent', 'cli'],
    positional: 'bundleId',
  },
};
// i18n-ignore-end

export class ModelInstallTools implements ToolSet {
  readonly schemas = schemas;
  readonly definitions = DEFINITIONS;
  readonly #installs: ModelInstallService;
  readonly #catalog: Pick<ModelCatalog, 'list'>;
  readonly #scope: ToolScope;

  constructor(deps: ModelInstallToolsDeps) {
    this.#installs = deps.installs;
    this.#catalog = deps.catalog;
    this.#scope = deps.scope;
  }

  dispatch(name: string, args: unknown, principal: ToolPrincipal): Promise<unknown> {
    switch (name as ToolName) {
      case 'models_install':
        return this.#install(args as Args, principal);
      case 'models_list':
        return this.#list(principal);
      case 'models_test':
        return this.#test(args as Args<'models_test'>, principal);
      default:
        // i18n-ignore: 给模型的工具说明、错误与下一步
        return Promise.reject(new ToolError('UNKNOWN_TOOL', `没有这个工具：${name}`));
    }
  }

  async #list(principal: ToolPrincipal) {
    this.#scope.authorize(principal, false);
    const bundles = await this.#catalog.list();
    return {
      bundles: bundles.map(digestBundle),
      // i18n-ignore: 给模型的工具说明、错误与下一步
      next: '没装的模型包用 models_install 下载（state 为 not-installed；reason 为 unsupported 的这台机器用不了）；装好的可以用 models_test 检查。',
    };
  }

  async #test(args: Args<'models_test'>, principal: ToolPrincipal) {
    const access = this.#scope.authorize(principal, true);
    const approval = await this.#scope.confirm(access, {
      tool: 'models_test',
      ...confirmSummary(RcAgentTools.testModelSummary({ bundleId: args.bundleId })),
      risk: 'command',
    });
    const { jobId } = await this.#installs
      .test(
        { bundleId: args.bundleId, ...(args.commandId ? { commandId: this.#scope.commandId(access, args.commandId) } : {}) },
        access.submitter,
      )
      .catch((error: unknown) => {
        throw toolErrorOf(error);
      });
    return {
      jobId,
      bundleId: args.bundleId,
      ...approvalField(approval),
      // i18n-ignore: 给模型的工具说明、错误与下一步
      next: '检查已提交：用 jobs_wait 等它结束。completed 是通过；failed 时 error.details.check 是原因，告诉用户。不要重复提交。',
    };
  }

  async #install(args: Args, principal: ToolPrincipal) {
    const access = this.#scope.authorize(principal, true);
    const bundleId = args.bundleId ?? defaultTranscribeBundle(process.platform, process.arch);
    const first = await this.#installs.install({ bundleId }, access.submitter).catch((error: unknown) => {
      throw toolErrorOf(error);
    });
    // i18n-ignore-start: 给模型的工具说明、错误与下一步
    if (first.jobId) return { ...resultOf(first.plan, first.jobId), next: '这个模型包已经在下载：用 jobs_wait 等它结束，不要重复提交。' };
    if (first.plan.upToDate) return { ...resultOf(first.plan, null), next: '模型包已经装好，不用下载；可以直接提交转写。' };
    // i18n-ignore-end
    const approval = await this.#scope.confirm(access, { tool: 'models_install', ...confirmSummary(summaryOf(first.plan)), risk: 'command' });
    const submitted = await this.#installs
      .install(
        {
          bundleId,
          confirmBytes: first.plan.confirmBytes,
          ...(args.commandId ? { commandId: this.#scope.commandId(access, args.commandId) } : {}),
        },
        access.submitter,
      )
      .catch((error: unknown) => {
        throw toolErrorOf(error);
      });
    return {
      ...resultOf(submitted.plan, submitted.jobId),
      ...approvalField(approval),
      // i18n-ignore: 给模型的工具说明、错误与下一步
      next: '下载已提交。用 jobs_wait 等它结束（看进度用 jobs_inspect），state 为 completed 才算装好，之后再提交转写；失败时 error.details.remedy 说明怎么补救。',
    };
  }
}

/** 模型包的状态给模型看的版本：组件只留名字与装没装，没有本机路径。 */
function digestBundle(bundle: ModelBundleStatus) {
  return {
    bundleId: bundle.bundleId,
    label: bundle.label ?? bundle.bundleId,
    capability: bundle.capability,
    backend: bundle.backend,
    state: bundle.state,
    ...(bundle.reason ? { reason: bundle.reason } : {}),
    ...(bundle.detail ? { detail: bundle.detail } : {}),
    ...(bundle.estimatedBytes != null ? { estimatedBytes: bundle.estimatedBytes, size: formatBytes(bundle.estimatedBytes) } : {}),
    ...(bundle.license ? { license: { name: bundle.license.name, commercialUse: bundle.license.commercialUse } } : {}),
    ...(bundle.components?.length
      ? {
          components: bundle.components.map((c) => ({ component: c.component, state: c.state, ...(c.optional ? { optional: true } : {}) })),
        }
      : {}),
    ...(bundle.install
      ? {
          install: {
            jobId: bundle.install.jobId,
            state: bundle.install.state,
            receivedBytes: bundle.install.receivedBytes,
            totalBytes: bundle.install.totalBytes,
          },
        }
      : {}),
    ...(bundle.selfTest
      ? {
          selfTest: {
            state: bundle.selfTest.state,
            at: bundle.selfTest.at,
            ...(bundle.selfTest.code ? { code: bundle.selfTest.code } : {}),
            ...(bundle.selfTest.detail ? { detail: bundle.selfTest.detail } : {}),
          },
        }
      : {}),
  };
}

function resultOf(plan: ModelInstallPlan, jobId: string | null) {
  return {
    jobId,
    bundleId: plan.bundleId,
    downloadBytes: plan.downloadBytes,
    estimatedBytes: plan.estimatedBytes,
    resumedBytes: plan.resumedBytes,
    // i18n-ignore: 给模型的工具说明、错误与下一步
    size: formatBytes(plan.confirmBytes) + (plan.downloadBytes === null ? '（估计）' : ''),
    components: plan.components
      .filter((c) => c.action === 'download')
      .map((c) => ({ component: c.component, repo: c.repo, bytes: c.bytes })),
    source: plan.source,
  };
}

function summaryOf(plan: ModelInstallPlan): Localized {
  const parts = plan.components.filter((c) => c.action === 'download').map((c) => c.repo);
  return RcAgentTools.installModelSummary({
    bundleId: plan.bundleId,
    size: formatBytes(plan.downloadBytes ?? plan.estimatedBytes),
    estimated: plan.downloadBytes === null,
    resumed: plan.resumedBytes > 0 ? formatBytes(plan.resumedBytes) : null,
    source: plan.source,
    parts: parts.join(RcAgentTools.listSeparator().text),
  });
}

/** 字节数给人看：KB、MB、GB，保留一位小数。 */
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

/** 服务的拒绝换成工具的错误：`details.code`（`MODEL_INSTALL_SIZE_CHANGED`、`OFFLINE_STRICT`……）作为工具错误码。 */
function toolErrorOf(error: unknown): unknown {
  if (error instanceof RpcError && typeof error.details === 'object' && error.details !== null) {
    const { code, ...rest } = error.details as Record<string, unknown>;
    if (typeof code === 'string') return new ToolError(code, error.message, rest);
  }
  return error;
}
