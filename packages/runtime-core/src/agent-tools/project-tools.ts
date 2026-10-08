import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Harness } from '@baocut/harness';
import type { RiskLevel } from '@baocut/protocol';
import { RcAgentTools } from '@baocut/protocol/messages/runtime-core';
import type { VideoService } from '../videos/video-service.ts';
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
 * - `projects_adopt_session` 只在工具桥：用户明确要建项目时，把不属于项目的会话放进默认项目目录下的一个新项目（名字默认取会话里最早建的
 *   视频，`Harness.ensureConversationProject`，架构设计 §3.10），会话的视频与文件搬过去，之后在项目里工作。只写 BaoCut 的项目目录下
 *   一个新建的目录、搬的是会话自己的工作目录，不覆盖任何文件，所以按 `edit` 确认。已经属于项目的会话原样返回那个项目。
 */

export interface ProjectToolsDeps {
  harness: Pick<Harness, 'listProjects' | 'openProject' | 'updateProject' | 'getConversation' | 'ensureConversationProject'>;
  videos: Pick<VideoService, 'claimProjectVideos' | 'openRefs' | 'close'>;
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
    name: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe('可选。项目名；不给时取会话里最早建的视频的名字，还没有视频时取会话标题。用户说了名字才给'),
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
    title: '把会话放进新项目',
    description: [
      '用户明确要求建项目（「建个项目」「放进项目里」）时用：在 BaoCut 的项目目录下新建项目，把这个会话的视频与文件搬进去，会话从此属于它。',
      '项目名不给时取会话里最早建的视频的名字（还没有视频时取会话标题）。用户没要求时不要调用：不属于项目的会话照样能新建、下载、编辑视频，视频就留在会话的工作目录里。',
      '会话已经属于项目时原样返回那个项目。搬完之后会话的工作目录换成项目目录；正开着的视频关掉之后再搬过去。',
    ].join('\n'),
    annotations: { destructiveHint: false, idempotentHint: true },
    effect: 'mutation',
    examples: [
      { title: '以视频命名', args: {} },
      { title: '用户给了名字', args: { name: '第 12 期' } },
    ],
    surfaces: ['agent'],
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
    '这个会话不属于任何项目：videos_create、download 的新视频不给 project，建在会话的工作目录里，不必先建项目。用户明确要建项目时用 projects_adopt_session（默认以视频命名）。',
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
    const { scope, harness, videos } = this.#deps;
    const access = scope.authorize(principal, true);
    if (principal.kind !== 'agent') {
      // i18n-ignore: 给模型的工具说明、错误与下一步
      throw new ToolError('UNKNOWN_TOOL', '没有这个工具：projects_adopt_session');
    }
    const conversationId = (principal as AgentPrincipal).conversationId;
    const { conversation } = harness.getConversation(conversationId);
    const owned = conversation.projectId ? harness.listProjects().find((p) => p.id === conversation.projectId) : undefined;
    if (owned) return { ...scopedProject(owned), created: false, existing: true, next: ADOPT_NEXT };
    const approval = await scope.confirm(access, {
      tool: 'projects_adopt_session',
      targets: [conversation.cwd],
      ...confirmSummary(RcAgentTools.adoptSessionSummary({ name: args.name ?? null })),
      risk: 'edit',
    });
    // 这个智能体自己开着的、在工作目录里的视频先放下，才能一起搬走；界面还开着的关掉之后再搬（Harness 稍后重试）。
    const cwd = await fs.realpath(conversation.cwd).catch(() => conversation.cwd);
    for (const ref of videos.openRefs()) {
      if (inside(ref.path, cwd)) await videos.close(ref.videoId, principal).catch(() => {});
    }
    const project = await harness.ensureConversationProject(conversationId, args.name ? { name: args.name } : {});
    return { ...scopedProject(project), created: true, existing: false, ...approvalField(approval), next: ADOPT_NEXT };
  }
}

// i18n-ignore-start: 给模型的工具说明、错误与下一步
const ADOPT_NEXT =
  '会话已经属于这个项目：新视频不给 project 就建在项目里，视频与文件在项目目录里（相对路径不变）。告诉用户项目的名字与位置。';
// i18n-ignore-end

function nextAfterCreate(principal: ToolPrincipal): string {
  // i18n-ignore-start: 给模型的工具说明、错误与下一步
  return principal.kind === 'agent'
    ? '项目已登记，用户能在 BaoCut 的项目列表里看到；这个会话仍在原来的工作目录里工作，videos_create 建不到新项目里。告诉用户项目的位置；要让这个会话和它的视频进项目，用 projects_adopt_session。'
    : '项目已登记：videos_create 的 project 给这个项目目录（path）就建在这个项目里。';
  // i18n-ignore-end
}

/** 还不存在的路径：向上找到第一个存在的祖先，取它的真实路径再接上剩下的部分（判断在不在工作目录里用）。 */
async function nearestReal(target: string): Promise<string> {
  const rest: string[] = [];
  for (let dir = target; ; dir = path.dirname(dir)) {
    const real = await fs.realpath(dir).catch(() => null);
    if (real) return path.join(real, ...rest.reverse());
    if (path.dirname(dir) === dir) return target;
    rest.push(path.basename(dir));
  }
}

function inside(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}
