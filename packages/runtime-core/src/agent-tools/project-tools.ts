import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Harness } from '@baocut/harness';
import { RpcError, type RiskLevel } from '@baocut/protocol';
import { RcAgentTools, RcGit } from '@baocut/protocol/messages/runtime-core';
import type { VideoService } from '../videos/video-service.ts';
import type { ProjectGitService } from '../git/project-git-service.ts';
import { inside, nearestReal } from './artifact-save.ts';
import { ToolError, type ToolInfo, type ToolSet } from './tool-catalog.ts';
import type { AgentPrincipal } from './grants.ts';
import { approvalField, confirmSummary, scopedProject, type ToolPrincipal, type ToolScope } from './tool-scope.ts';

/**
 * 项目工具（Agent 面设计 §4.3）：列出范围之内的已登记项目（`projects_list`），在一个目录上新建并登记项目（`projects_create`）。
 *
 * - `projects_list` 三个面都有，范围由 `ToolScope.listProjects` 决定：会话只看得到所属的项目，对外服务只看得到范围之内的视频所属的项目
 *   （全部视频时是全部已登记项目，不给路径），终端是全部。
 * - `projects_create` 只在工具桥与 CLI（对外服务不新建项目）。`path` 相对会话的工作目录或终端的 cwd（`ToolScope.saveRoot`），绝对路径照收；
 *   目录不存在时建出来，已有的目录直接登记（与 `projects.open` 相同，写 `.bcut/project.json`）。会话里在工作目录之内是 `edit`，
 *   之外是写项目目录之外（`high`），按访问模式确认；终端不走审批。已经登记过的项目原样返回，不确认、不改名。
 * - `projects_adopt_session` 只在工具桥：用户明确要建项目时，把不属于项目的会话放进一个项目（`ToolScope.bindSession`，
 *   `Harness.ensureConversationProject`，架构设计 §3.10），会话的视频与文件搬过去，之后在项目里工作。不给 `project` 时在默认项目目录下
 *   新建（名字默认取会话里最早建的视频）：只写 BaoCut 的项目目录下一个新建的目录、搬的是会话自己的工作目录，不覆盖任何文件，按 `edit`
 *   确认。给了 `project`（已登记项目的 id，或用户指定的目录）时放进那里，写到工作目录之外，按 `high` 确认。已经属于项目的会话原样返回
 *   那个项目。工作目录里还有视频被界面、任务或别的连接开着时拒绝（`VIDEO_IN_USE`），什么都不动。
 * - `projects_git_commit` 在工具桥与 CLI（版本记录设计 §5.3）：把项目里 BaoCut 的文件提交到 git，与「提交到 git」同一个动作
 *   （`ProjectGitService.commit`）。只在用户要求时用；会话里按 `edit` 确认。暂停（本地过滤器、仓库的特殊状态、`index.lock`）时
 *   不报错，返回原因与下一步：本地过滤器要用户在 CLI 里允许（项目设置里的入口随界面再加），智能体不能替用户允许（§5.4）；
 *   找不到 git 或项目不在仓库里时同样返回原因，不替用户初始化。
 */

export interface ProjectToolsDeps {
  harness: Pick<Harness, 'listProjects' | 'openProject' | 'updateProject' | 'getConversation'>;
  videos: Pick<VideoService, 'claimProjectVideos'>;
  git: Pick<ProjectGitService, 'commit'>;
  scope: ToolScope;
}

// i18n-ignore-start: 给模型的工具说明、错误与下一步
const schemas = {
  projects_list: z.strictObject({}),
  projects_create: z.strictObject({
    path: z.string().min(1).max(1000).describe('项目目录：相对工作目录（终端里是当前目录），或绝对路径；不存在时新建，已有的目录直接登记'),
    name: z.string().trim().min(1).max(200).optional().describe('可选。项目的显示名；不给时用目录名'),
  }),
  projects_adopt_session: z.strictObject({
    project: z
      .string()
      .min(1)
      .max(1000)
      .optional()
      .describe(
        '可选。放进哪里：已登记项目的 projectId，或用户指定的文件夹（绝对路径或 ~/ 开头，例如外置盘上的 /Volumes/T7/访谈；不存在时新建并登记为项目）。不给时在 BaoCut 的项目目录下新建项目',
      ),
    name: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe(
        '可选。项目名；不给时取会话里最早建的视频的名字（还没有视频时取会话标题），给了 project 时取文件夹名。用户说了名字才给；已登记的项目不改名',
      ),
  }),
  projects_git_commit: z.strictObject({
    project: z
      .string()
      .min(1)
      .max(1000)
      .optional()
      .describe('可选。项目：projectId 或已登记项目的目录；会话里不给时是会话所属的项目，终端里不给时是当前目录所属的项目'),
    message: z
      .string()
      .trim()
      .min(1)
      .max(10_000)
      .optional()
      .describe('可选。提交说明的标题（可以带正文）；不给时按这段时间里各视频版本的摘要生成。用户给了说法才填'),
  }),
};

type ToolName = keyof typeof schemas;
type Args<N extends ToolName> = z.infer<(typeof schemas)[N]>;

const DEFINITIONS: Record<ToolName, ToolInfo> = {
  projects_list: {
    title: '列出项目',
    description: [
      '列出你能用的 BaoCut 项目。',
      '每个项目：projectId、名字、目录（对外服务不给）与其中的视频数（数得出来时）。videos_create 的 project 参数用这里的 projectId（终端里用目录）。',
      '会话里只有这个会话所属的项目（不属于项目的会话没有，它的视频在它自己的工作目录里）；对外服务只列访问范围之内的视频所属的项目。',
    ].join('\n'),
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [{ title: '列出项目', args: {} }],
    surfaces: ['agent', 'mcp', 'cli'],
  },
  projects_create: {
    title: '新建项目',
    description: [
      '在一个目录上新建并登记 BaoCut 项目。',
      'path 相对工作目录（终端里是当前目录），也可以是绝对路径；目录不存在时新建，已有的目录直接登记（写入 .bcut/project.json，不动别的文件）。已经是项目的原样返回。',
      '会话里：工作目录之内按普通修改确认，之外按高风险确认；新项目出现在用户的项目列表里，但这个会话仍在原来的工作目录里工作。用户只是说「建个项目」、没给目录时用 projects_adopt_session。',
    ].join('\n'),
    annotations: { destructiveHint: false, idempotentHint: true },
    effect: 'mutation',
    examples: [
      { title: '在当前目录下建项目', args: { path: 'my-show' } },
      { title: '指定名字', args: { path: '/Users/me/Videos/episode-12', name: '第 12 期' } },
    ],
    surfaces: ['agent', 'cli'],
    positional: 'path',
  },
  projects_adopt_session: {
    title: '把会话放进项目',
    description: [
      '用户明确要求建项目（「建个项目」「放进项目里」「把这个会话放到外置盘上」）时用：把这个会话的视频与文件搬进项目，会话从此属于它。',
      '不给 project 时在 BaoCut 的项目目录下新建项目，项目名不给时取会话里最早建的视频的名字（还没有视频时取会话标题）。用户指定了位置时给 project：已登记项目的 projectId，或一个文件夹的绝对路径（不存在时新建并登记），按高风险确认；只说了盘没说文件夹时，在盘上取一个文件夹（例如 /Volumes/T7/BaoCut），确认卡会写明。',
      '用户只是要把新视频建到别处时不必先调用它：videos_create、download / transcribe 的新视频直接给 project，同一张确认卡里会话一起放过去。用户没要求时不要调用：不属于项目的会话照样能新建、下载、编辑视频，视频就留在会话的工作目录里。',
      '会话已经属于项目时原样返回那个项目（会话只能放进项目一次，不能再换）。搬完之后会话的工作目录换成项目目录。工作目录里还有视频在编辑器、任务或别的连接里开着时拒绝（VIDEO_IN_USE），什么都不动：请用户关掉那几部视频后再试。',
    ].join('\n'),
    annotations: { destructiveHint: false, idempotentHint: true },
    effect: 'mutation',
    examples: [
      { title: '以视频命名', args: {} },
      { title: '用户给了名字', args: { name: '第 12 期' } },
      { title: '放到外置盘上的文件夹', args: { project: '/Volumes/T7/访谈' } },
    ],
    surfaces: ['agent'],
  },
  projects_git_commit: {
    title: '提交到 git',
    description: [
      '把项目里 BaoCut 的文件提交到 git（用户说「提交到 git」「commit 一下」时用；用户没要求时不要调用）。',
      '先把打开着的视频的快照写好，再只提交 BaoCut 的路径：各视频的 .bcut-snapshot/（不含版本文件）与 blobs/ 里不超过大小上限的素材。项目里别的文件（脚本、代码）与用户已经暂存的改动原样留着，由用户自己提交；不推送、不拉取、不改写历史。',
      '没有改动时 committed 为 false。项目不在 git 仓库里或这台电脑没有 git 时不提交，结果里 unavailable 说明原因；仓库暂停提交时（本地过滤器、合并或变基中、index.lock）结果里 paused 说明原因。两种情况都照 next 告诉用户，不要自己初始化仓库、改 git 配置或删锁文件。',
    ].join('\n'),
    annotations: { destructiveHint: false, idempotentHint: false },
    effect: 'mutation',
    examples: [
      { title: '提交当前项目', args: {} },
      { title: '用户给了说明', args: { message: '粗剪完成' } },
    ],
    surfaces: ['agent', 'cli'],
  },
};
// i18n-ignore-end

// i18n-ignore-start: 给模型的工具说明与下一步
/** 列出了项目时的下一步：用它新建视频。 */
const LIST_NEXT: Record<ToolPrincipal['kind'], string> = {
  agent: '新建视频时把 projectId 作为 videos_create 的 project；视频清单用 videos_list。',
  local: '新建视频时把项目目录（path）作为 videos_create 的 project；视频清单用 videos_list。',
  service: '新建视频时把 projectId 作为 videos_create（或 download、transcribe 的新视频）的 project；视频清单用 videos_list。',
};

/** 一个项目都没有时的出路：各个面能做的不一样（对外服务不能新建项目）。 */
const EMPTY_NEXT: Record<ToolPrincipal['kind'], string> = {
  agent:
    '这个会话不属于任何项目：videos_create、download 的新视频不给 project，建在会话的工作目录里，不必先建项目。用户要把新视频放到指定的文件夹（例如外置盘上）时，新建视频的工具直接给 project（文件夹的绝对路径），确认之后会话放进那里；用户明确要建项目时用 projects_adopt_session（默认以视频命名）。',
  local:
    '还没有登记的项目：videos_create 不给 project 时视频建在当前目录所属的项目里，没有时登记默认项目目录下的 CLI 项目；要放在指定的目录里，先用 projects_create 在那里新建并登记项目。',
  service:
    '访问范围之内没有项目，而对外服务不能新建项目，新视频只能建在已登记的项目里：请用户在 BaoCut 里登记一个项目（或在终端运行 baocut projects create <目录>；BaoCut 里一个项目都没有时，baocut mcp install 会登记默认的 CLI 项目）；访问范围是视频名单时，再请用户把项目里的视频加进范围。之后重新调用 projects_list。',
};

// i18n-ignore-end
export class ProjectTools implements ToolSet {
  readonly schemas = schemas;
  readonly definitions = DEFINITIONS;
  readonly #deps: ProjectToolsDeps;

  constructor(deps: ProjectToolsDeps) {
    this.#deps = deps;
  }

  dispatch(name: string, args: unknown, principal: ToolPrincipal): Promise<unknown> {
    switch (name as ToolName) {
      case 'projects_list':
        return this.#list(principal);
      case 'projects_create':
        return this.#create(args as Args<'projects_create'>, principal);
      case 'projects_adopt_session':
        return this.#adoptSession(args as Args<'projects_adopt_session'>, principal);
      case 'projects_git_commit':
        return this.#gitCommit(args as Args<'projects_git_commit'>, principal);
      default:
        // i18n-ignore: 给模型的工具说明、错误与下一步
        return Promise.reject(new ToolError('UNKNOWN_TOOL', `没有这个工具：${name}`));
    }
  }

  async #list(principal: ToolPrincipal) {
    const { scope } = this.#deps;
    const access = scope.authorize(principal, false);
    const projects = await scope.listProjects(access);
    return { projects, next: projects.length === 0 ? EMPTY_NEXT[principal.kind] : LIST_NEXT[principal.kind] };
  }

  async #create(args: Args<'projects_create'>, principal: ToolPrincipal) {
    const { scope, harness, videos } = this.#deps;
    const access = scope.authorize(principal, true);
    const base = scope.saveRoot(access);
    const target = path.resolve(base, args.path);
    const stat = await fs.stat(target).catch(() => null);
    if (stat && !stat.isDirectory()) {
      // i18n-ignore: 给模型的工具说明、错误与下一步
      throw new ToolError('INVALID_ARGUMENTS', `不是目录：${args.path}`, { issues: [{ path: 'path', message: '已经存在，但不是目录' }] });
    }
    const real = stat ? await fs.realpath(target) : null;
    const registered = real ? harness.listProjects().find((p) => p.path === real) : undefined;
    if (registered) {
      return { ...scopedProject(registered), created: false, existing: true, next: nextAfterCreate(principal) };
    }
    const baseReal = await fs.realpath(base).catch(() => path.resolve(base));
    const risk: RiskLevel = inside(real ?? (await nearestReal(target)), baseReal) ? 'edit' : 'high';
    const approval = await scope.confirm(access, {
      tool: 'projects_create',
      targets: [target],
      ...confirmSummary(
        (stat ? RcAgentTools.registerProjectSummary : RcAgentTools.createProjectSummary)({ path: target, name: args.name ?? null }),
      ),
      risk,
    });
    if (!stat) await fs.mkdir(target, { recursive: true });
    let project = await harness.openProject(target);
    // 副本里的视频在后台换标识（与 `projects.open` 相同）。
    void videos.claimProjectVideos(project).catch(() => {});
    if (args.name && args.name !== project.name) project = await harness.updateProject({ projectId: project.id, name: args.name });
    return { ...scopedProject(project), created: !stat, existing: false, ...approvalField(approval), next: nextAfterCreate(principal) };
  }

  async #adoptSession(args: Args<'projects_adopt_session'>, principal: ToolPrincipal) {
    const { scope, harness } = this.#deps;
    const access = scope.authorize(principal, true);
    if (principal.kind !== 'agent' || !scope.bindSession || !scope.locateBinding) {
      // i18n-ignore: 给模型的工具说明、错误与下一步
      throw new ToolError('UNKNOWN_TOOL', '没有这个工具：projects_adopt_session');
    }
    const conversationId = (principal as AgentPrincipal).conversationId;
    const { conversation } = harness.getConversation(conversationId);
    const owned = conversation.projectId ? harness.listProjects().find((p) => p.id === conversation.projectId) : undefined;
    if (owned) return { ...scopedProject(owned), created: false, existing: true, next: ADOPT_NEXT };
    const binding = args.project === undefined ? undefined : await scope.locateBinding(access, args.project);
    const approval = await scope.confirm(access, {
      tool: 'projects_adopt_session',
      targets: binding ? [conversation.cwd, binding.path] : [conversation.cwd],
      ...confirmSummary(
        binding
          ? RcAgentTools.adoptSessionIntoSummary({ path: binding.path, project: binding.project?.name ?? null })
          : RcAgentTools.adoptSessionSummary({ name: args.name ?? null }),
      ),
      risk: binding ? 'high' : 'edit',
    });
    const project = await scope.bindSession(access, { ...(binding ? { binding } : {}), ...(args.name ? { name: args.name } : {}) });
    return { ...scopedProject(project), created: !binding?.project, existing: false, ...approvalField(approval), next: ADOPT_NEXT };
  }

  async #gitCommit(args: Args<'projects_git_commit'>, principal: ToolPrincipal) {
    const { scope, harness, git } = this.#deps;
    const access = scope.authorize(principal, true);
    const root = await scope.createRoot(access, args.project, { locate: true });
    if (!('projectId' in root.scope)) {
      // i18n-ignore: 给模型的工具说明、错误与下一步
      throw new ToolError('NOT_IN_PROJECT', '这个会话不属于项目，没有可以提交的仓库', { next: GIT_NO_PROJECT_NEXT });
    }
    const projectId = root.scope.projectId;
    const project = harness.listProjects().find((item) => item.id === projectId);
    const approval = await scope.confirm(access, {
      tool: 'projects_git_commit',
      targets: [root.root],
      ...confirmSummary(RcGit.commitSummary({ name: project?.name ?? root.root })),
    });
    try {
      const result = await git.commit(projectId, { message: args.message });
      return {
        committed: result.committed,
        commit: result.commit,
        files: result.files,
        videos: result.videos,
        branch: result.status.branch,
        ...approvalField(approval),
        next: result.committed ? GIT_COMMITTED_NEXT : GIT_NOTHING_NEXT,
      };
    } catch (error) {
      const details = error instanceof RpcError ? (error.details as { code?: unknown; reason?: unknown; remedy?: unknown } | undefined) : undefined;
      if (details?.code !== 'GIT_PAUSED' && details?.code !== 'GIT_UNAVAILABLE') throw error;
      const paused = details.code === 'GIT_PAUSED';
      const reason = typeof details.reason === 'string' ? details.reason : paused ? 'locked' : 'missing';
      const why = { reason, message: (error as RpcError).message, ...(typeof details.remedy === 'string' ? { remedy: details.remedy } : {}) };
      return {
        committed: false,
        ...(paused ? { paused: why } : { unavailable: why }),
        ...approvalField(approval),
        next: paused ? (GIT_PAUSED_NEXT[reason] ?? GIT_PAUSED_NEXT.locked) : (GIT_UNAVAILABLE_NEXT[reason] ?? GIT_UNAVAILABLE_NEXT.missing),
      };
    }
  }
}

// i18n-ignore-start: 给模型的工具说明、错误与下一步
const GIT_COMMITTED_NEXT = '已提交到当前分支（没有推送）。告诉用户提交了哪几部视频；要推送由用户自己做。';
const GIT_NOTHING_NEXT = '上次提交之后 BaoCut 的文件没有改动，没有新提交。如实告诉用户即可。';
const GIT_NO_PROJECT_NEXT =
  '告诉用户：只有项目里的视频能提交到 git。用户要建项目时用 projects_adopt_session；仓库由用户自己准备（在 BaoCut 桌面应用的项目设置里初始化 git、在终端运行 baocut projects git-init，或把项目放进已有的仓库）。';
const GIT_PAUSED_NEXT: Record<string, string> = {
  'local-config':
    '仓库的本地配置里有会执行程序的过滤器或包含，BaoCut 在用户允许之前不提交。把 paused.message 告诉用户，请用户在 BaoCut 桌面应用的项目设置里（或在终端运行 baocut projects git-allow）查看这些条目并决定是否允许；你不能替用户允许，也不要自己去改仓库的配置。用户允许之后再调用一次。',
  'repo-state': '仓库正在合并、变基、拣选、还原、二分中，或 HEAD 没在分支上。把 paused.message 告诉用户，请用户在 git 里完成或放弃之后再提交；不要自己运行 git 去处理。',
  locked: '仓库正被别的 git 命令占用（index.lock）。稍后再调用一次；不要删除锁文件。',
};
const GIT_UNAVAILABLE_NEXT: Record<string, string> = {
  'not-repo': '项目不在 git 仓库里，没有提交。告诉用户；要不要建仓库由用户决定（在 BaoCut 桌面应用的项目设置里初始化 git、在终端运行 baocut projects git-init，或自己 git init），你不要替用户初始化。',
  missing: '这台电脑上没有能用的 git，没有提交。把 unavailable.message 与 unavailable.remedy 告诉用户，请用户装好 git 后再说。',
};
const ADOPT_NEXT =
  '会话已经属于这个项目：新视频不给 project 就建在项目里，视频与文件在项目目录里（相对路径不变）。告诉用户项目的名字与位置。';
// i18n-ignore-end

function nextAfterCreate(principal: ToolPrincipal): string {
  // i18n-ignore-start: 给模型的工具说明、错误与下一步
  return principal.kind === 'agent'
    ? '项目已登记，用户能在 BaoCut 的项目列表里看到；这个会话仍在原来的工作目录里工作。告诉用户项目的位置。不属于项目的会话要在这个项目里建视频时，videos_create（或 download、transcribe 的新视频）给 project: 这个 projectId，确认之后会话连同工作目录里的视频与文件一起放进项目；只是要会话进项目时用 projects_adopt_session { project }。属于别的项目的会话不能换项目：请用户在这个项目里新开会话。'
    : '项目已登记：videos_create 的 project 给这个项目目录（path）就建在这个项目里。';
  // i18n-ignore-end
}
