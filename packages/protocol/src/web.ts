import type { FileTarget, RpcMethod } from './methods.ts';

/**
 * Web 服务（架构设计 §4.8、§12.8）：本机浏览器里的客户端。浏览器拿到的是一个作用域受限的网关连接：
 * 方法与主题按白名单过滤，操作者是用户本人（`user_local`），不是 `external:web`。
 *
 * - 登录：桌面界面或 CLI 调 `services.web.createAccessLink` 得到一个带一次性代码的链接（代码在 URL fragment 里，
 *   不进服务器日志与 Referer）；页面用代码换一个会话 cookie（HttpOnly、SameSite=Strict），代码用后即废、过期即废。
 * - 能力集合是一份方法白名单（方法名或 `<命名空间>.*`），默认 `WEB_DEFAULT_METHODS`；服务配置只能在它之内收紧，
 *   或设为只读（只剩 `WEB_READ_METHODS`）。设置、凭据、对外服务与节点的管理不在其中，配置也加不进来。
 */

/** Web 服务的默认端口（回环）。与 MCP 服务（47620）、模型接口服务（47621）相邻；被占用时服务进入 `error`，不换端口。 */
export const WEB_DEFAULT_PORT = 47622;
/** 访问链接里一次性代码的有效期。 */
export const WEB_ACCESS_CODE_TTL_MS = 2 * 60_000;
/** 浏览器会话的有效期（从登录起算）。服务停止时会话全部作废。 */
export const WEB_SESSION_TTL_MS = 12 * 60 * 60_000;

/**
 * 默认的能力集合：桌面界面的协议，减去设置的修改、模型服务的配置与凭据、对外服务的管理（`services.*`，含
 * `services.mcp.*`、`services.modelApi.*` 与访问链接的发放）、节点的配对与共享。
 * 内容类命名空间整体开放（以后在这些命名空间里加方法时，要按 §12.8 确认它不越出项目目录）；管理类命名空间逐个列出。
 * 带路径参数的方法在 Web 服务的处理函数里另有约束：`projects.open`、`edits.apply` 的素材路径、`exports.create` 的目标目录、
 * `space.import` 的文件（只能是项目目录里的文件）、`videos.importPackage` 的便携包（只能是项目或会话工作目录里的文件）。
 *
 * 固定流程（`pipelines.*`）不在其中：文件转码的输入与 `outDir` 是任意的绝对路径，不受项目目录约束；要开放得先给它
 * 加上与 `exports.create` 同样的路径约束。名字没在这里的方法，浏览器一律调不了。
 *
 * 本地模型包的安装管理（`models.install`、`models.repair`、`models.cancelInstall`、`models.remove`、`models.test`）也不在其中：
 * 安装与修复让这台机器从网络下载几百 MB 并写入模型目录，删除会让本机的转写不可用，属于这台机器的管理，与模型服务的配置
 * 一样只在桌面界面与 CLI 里做。浏览器能在 `models.list` 与 `models` 主题里看到状态与进度；`jobs.cancel` 能停下一个安装任务
 * （等同暂停，暂存区保留）。模型目录（`models.getDir`、`models.inspectDir`、`models.setDir`）同理不开放：更改要搬动几 GB 的文件、
 * 选择本机的文件夹，结果里是本机路径；浏览器里的设置页不显示模型目录卡片。
 *
 * 受管外部工具（`externalTools.*`，§12.9）整个不在其中，连 `list` 也不开放：安装、指定路径与同意决定这台机器下载并执行哪个
 * 第三方程序；状态里有本机路径。从链接导入（`pipelines.start` 的 `link-import`）随 `pipelines.*` 一并不开放。
 */
export const WEB_DEFAULT_METHODS: readonly string[] = [
  'runtime.info',
  'agents.list',
  'agents.respondToApproval',
  'agents.interrupt',
  'projects.list',
  // 只能打开已登记的项目（Web 服务在处理函数里再查一次）。
  'projects.open',
  'projects.create',
  'projects.update',
  // 项目文件浏览与新建（架构设计 §11.2「项目文件浏览」）：只在项目目录（或无项目会话的工作目录）里，按真实路径判断、不越出根目录；
  // 文件内容走 `media.*` 的受控句柄；新建是独占创建、不覆盖（§12.8）。
  'projects.files.list',
  'projects.files.create',
  'conversations.*',
  'attachments.prepare',
  'tasks.*',
  'space.*',
  'media.*',
  'videos.*',
  'documents.*',
  'edits.*',
  // 代码画面（架构设计 §8）：逐个列出。目录参数按真实路径只能在视频的来源目录（项目目录或不属于项目的会话的工作目录）里，
  // 预览帧写在来源目录的 .baocut-out/frames/ 下（§12.8）。
  'compositions.preview',
  'compositions.import',
  // 含 `jobs.reconcile`（架构设计 §7.5）：对账是用户的决定，浏览器里的用户同样可以做；只读下不开放。
  'jobs.*',
  'artifacts.*',
  'exports.*',
  'models.list',
  'models.capabilities',
  'models.transcribe',
  'models.synthesizeSpeech',
  'models.generateImage',
  'models.generateText',
  // 用量（§6.10）只读、不含密钥与本机路径，也在只读集合里。账号的写方法（`models.addAccount` 等）与 `models.configure` 一样不开放。
  'models.usage',
  // 工具目录与候选输入（§7.9）只读、逐个列出（不是 `tools.*`）：执行方法不在白名单的工具在目录里标为不可用。
  'tools.list',
  'tools.candidates',
  'nodes.list',
  'nodes.discover',
  'settings.get',
  // 创作模板目录（模板包规范 §6）只读：句柄只发给清单登记的随附文件。
  'templates.*',
  // Agent 的 skill（§3.8）：看与开关逐个列出。添加、导入与移除（`skills.add`、`skills.importGithub`、`skills.remove`，§12.9）
  // 不开放：它们往 Runtime Home 写入或删除目录、从本机任意文件夹或网络取内容，与受管外部工具的安装一样只在桌面界面与 CLI 里做。
  'skills.list',
  'skills.get',
  'skills.readFile',
  'skills.setEnabled',
];

/** 只读配置下还剩的方法（逐个列出：以后新增的方法在只读下默认不开放）。 */
export const WEB_READ_METHODS: readonly RpcMethod[] = [
  'runtime.info',
  'models.usage',
  'agents.list',
  'projects.list',
  'projects.files.list',
  'conversations.list',
  'conversations.get',
  'tasks.getContract',
  'tasks.listContracts',
  'tasks.listChecks',
  'space.list',
  'space.get',
  'space.search',
  'space.openForEdit',
  'space.thumbnail',
  'media.resolve',
  'media.playback',
  'media.subtitles',
  'media.peaks',
  'media.thumbnail',
  'videos.open',
  'videos.close',
  'videos.history',
  'videos.assetStatus',
  'documents.read',
  'edits.undoState',
  'exports.get',
  'exports.list',
  'exports.renderText',
  'models.list',
  'models.capabilities',
  'jobs.list',
  'jobs.inspect',
  'jobs.resources',
  'artifacts.openHandle',
  'tools.list',
  'tools.candidates',
  'nodes.list',
  'nodes.discover',
  'settings.get',
  'templates.list',
  'templates.get',
  'templates.openHandle',
  'skills.list',
  'skills.get',
  'skills.readFile',
];

/** 订阅这些主题要求白名单里有对应的读取方法；其余主题（目录、会话、任务、Space、视频）随会话开放。 */
export const WEB_TOPIC_METHODS: Readonly<Record<string, RpcMethod>> = {
  settings: 'settings.get',
  services: 'services.list',
  models: 'models.capabilities',
  jobs: 'jobs.list',
  // 用户库（§5.9）还没有对浏览器开放：`library.*` 不在默认集合里，主题也就订阅不了。
  library: 'library.list',
  // 数据外发的授权与预算（§12.5）不对浏览器开放：`grants.*` 不在默认集合里，主题也就订阅不了；授权只在桌面与 CLI 里发放、撤销。
  grants: 'grants.list',
  // Agent 的探测结果与偏好（§3.11）：与 `agents.list` 同一份视图。
  agents: 'agents.list',
};

/** 白名单里的一项：方法名，或 `<命名空间>.*`（含更深的子命名空间）。 */
export const WEB_METHOD_PATTERN = /^[A-Za-z]+(\.[A-Za-z]+)*(\.\*)?$/;

export function methodMatches(pattern: string, method: string): boolean {
  return pattern.endsWith('.*') ? method.startsWith(pattern.slice(0, -1)) : pattern === method;
}

/** Web 服务的访问配置。 */
export interface WebServiceAccess {
  /** 只读：只剩 `WEB_READ_METHODS`（与白名单的交集）。 */
  readOnly: boolean;
  /** 配置的白名单；null 表示默认集合 `WEB_DEFAULT_METHODS`。 */
  methods: string[] | null;
}

/**
 * 一个方法对浏览器会话是否可用：`subscribe` / `unsubscribe` 总是可用（主题另查，见 `webTopicAllowed`）。
 * 配置的白名单只能收紧：方法要同时在默认集合与配置里。
 */
export function webMethodAccess(method: string, access: WebServiceAccess): 'allowed' | 'not-allowed' | 'read-only' {
  if (method === 'subscribe' || method === 'unsubscribe') return 'allowed';
  const inDefault = WEB_DEFAULT_METHODS.some((p) => methodMatches(p, method));
  const inConfig = access.methods === null || access.methods.some((p) => methodMatches(p, method));
  if (!inDefault || !inConfig) return 'not-allowed';
  if (access.readOnly && !(WEB_READ_METHODS as readonly string[]).includes(method)) return 'read-only';
  return 'allowed';
}

export function webTopicAllowed(topic: string, access: WebServiceAccess): boolean {
  const method = WEB_TOPIC_METHODS[topic];
  return method === undefined || webMethodAccess(method, access) === 'allowed';
}

/** 一个浏览器会话的元数据。会话令牌只在 cookie 里，Runtime 只存哈希。 */
export interface WebSession {
  sessionId: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  /** 这个会话此刻的网关连接数。 */
  connections: number;
  /** 登录时浏览器的 User-Agent（截短），用来认出是哪个浏览器。 */
  userAgent: string | null;
}

/** `services.web.createAccessLink` 的结果。`url` 里的代码只能用一次，`expiresAt` 之后作废。 */
export interface WebAccessLink {
  url: string;
  expiresAt: string;
}

/**
 * 界面内链接的查询串里一个文件目标的写法：`video=` / `file=` 后面是 JSON 的 FileTarget（URL 编码）。界面的路由
 * （`packages/ui` 的 shell-store）与 Web 服务的访问链接都用它，不各拼一份。
 */
export function fileTargetQuery(kind: 'video' | 'file', target: FileTarget): string {
  return new URLSearchParams({ [kind]: JSON.stringify(target) }).toString();
}

/**
 * 直达一个视频的编辑器的界面内链接：Home 的功能区开着这个视频（`/home?video=<JSON 的 FileTarget>`），与界面里
 * `hrefFor({ tab: 'home', conversationId: null, projectId: null, pane: { kind: 'video', target } })` 相同。
 * `services.web.createAccessLink { video }` 把它放在链接的路径与查询里（代码仍只在 fragment 里）。
 */
export function webVideoHref(target: FileTarget): string {
  return `/home?${fileTargetQuery('video', target)}`;
}
