import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { RpcError, type DocsAnnotation, type DocsOpenResult, type FileTarget, type Id, type TaskSummary } from '@baocut/protocol';
import { RcDocs } from '@baocut/protocol/messages/runtime-core';
import type { Logger, ResolvedDocsAnnotation } from '@baocut/harness';
import { DocsServer, createDocsConnector, readDocInfo, resolveDocsEditorDist, type DocsConnector, type LiveDoc } from '@baocut/docs';
import { localUserName } from '@baocut/slides';
import { dirPathFor, resolveDeckDir } from './slides.ts';

/**
 * 会话里的文档（docs/design/docs §6）：`docs.open` 发编辑器地址，`/docs/<grant>/…` 的页面、接口与 `/docs/<grant>/api/mux` 的
 * WebSocket 由 `@baocut/docs` 的 DocsServer 处理。网关与 Web 服务共用一个 DocsServer：同一个目录在内存里只有一份文档，
 * 编辑器的连接与智能体的 `docs_*` 工具都经它的 door 读写，写入即时推给打开着这份文档的编辑器。
 */

/** 处理函数用的入口：地址的基址各不相同（网关是 `http://127.0.0.1:<端口>`，Web 服务是同源的相对地址）。 */
export interface DocsOpener {
  /** 打开来源目录 `root` 里的文档目录 `rel`。 */
  open(root: string, rel: string): Promise<DocsOpenResult>;
}

/**
 * 消息带的文档标注（docs/design/docs §8）：与设计稿标注相同，每条的文档换成相对会话工作目录的路径
 * （`/` 分隔、以 `/` 结尾，工作目录外是绝对路径）；找不到时由 `locate` 抛 `not-found`。没有标注时为 undefined。
 */
export function resolveDocsAnnotations(
  annotations: readonly DocsAnnotation[] | undefined,
  cwd: string,
  locate: (target: FileTarget) => { root: string; file: string },
): ResolvedDocsAnnotation[] | undefined {
  if (!annotations?.length) return undefined;
  return annotations.map((annotation) => ({ annotation, docPath: dirPathFor(locate(annotation.doc), cwd) }));
}

/** 来源目录里的文档目录：校验同 deck 目录（防越界、不进隐藏与依赖目录），必须认得出是文档。返回真实路径。 */
export async function resolveDocDir(root: string, rel: string): Promise<string> {
  const dir = await resolveDeckDir(root, rel);
  if (!(await readDocInfo(dir))) throw new RpcError('invalid-request', RcDocs.notADoc(), { code: 'DOCS_NOT_A_DOC' });
  return dir;
}

/** 记住多少个会话的当前回合。 */
const MAX_TRACKED_TURNS = 500;

export class DocsService {
  readonly server: DocsServer;
  /** 智能体的 `docs_*` 工具（docs/design/docs §7）：与编辑器经同一份文档读写。 */
  readonly connector: DocsConnector;
  readonly #editorDist: () => string | null;
  #baseUrl = '';
  /** 会话 → 正在跑的任务（回合）：文档的版本按回合分开（版本记录设计 §13.2）。 */
  readonly #turns = new Map<Id, Id>();

  constructor(options: {
    log: Logger;
    editorDist?: () => string | null;
    /** 编辑器里本机用户的显示名；默认取本机账户名。 */
    userName?: () => string | undefined;
  }) {
    const log = options.log.child('docs');
    this.#editorDist = options.editorDist ?? (() => resolveDocsEditorDist());
    this.server = new DocsServer({
      editorDist: this.#editorDist,
      userName: options.userName ?? localUserName,
      onError: (message, error) => log.warn(message, { error: (error as Error)?.name }),
      onWarn: (message) => log.warn(message),
    });
    this.connector = createDocsConnector(this.server);
  }

  /** 智能体的任务（Harness 的 `tasks` 主题）：开始跑的任务就是这个会话的新回合。 */
  noteTask(task: Pick<TaskSummary, 'taskId' | 'conversationId' | 'status'>): void {
    if (task.status !== 'running' || this.#turns.get(task.conversationId) === task.taskId) return;
    this.#turns.delete(task.conversationId);
    this.#turns.set(task.conversationId, task.taskId);
    while (this.#turns.size > MAX_TRACKED_TURNS) this.#turns.delete(this.#turns.keys().next().value!);
  }

  /** 会话现在的回合（任务 id）；不知道时 undefined。 */
  turnOf(conversationId: Id): Id | undefined {
    return this.#turns.get(conversationId);
  }

  /** 网关的 HTTP 基址（监听之后才知道端口）。 */
  setBaseUrl(url: string): void {
    this.#baseUrl = url;
  }

  /** 网关上的路由：桌面界面与 CLI 一侧，能编辑；grant 本身就是凭证（同 `/slides/`），桌面界面是 file:// 页面，不限制嵌入。 */
  handle(request: IncomingMessage, response: ServerResponse): boolean {
    return this.server.handle(request, response, { canEdit: true });
  }

  /** 网关上的 `/docs/<grant>/api/mux` 升级：只认 grant，与 `handle` 相同。 */
  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    return this.server.upgrade(request, socket, head, { canEdit: true });
  }

  /** 给处理函数用的入口。`baseUrl` 不给时用网关的基址。 */
  opener(baseUrl: () => string = () => this.#baseUrl): DocsOpener {
    return {
      open: async (root, rel) => {
        const dir = await resolveDeckDir(root, rel);
        const info = await readDocInfo(dir);
        if (!info) throw new RpcError('invalid-request', RcDocs.notADoc(), { code: 'DOCS_NOT_A_DOC' });
        const grant = await this.server.open(dir);
        return {
          url: `${baseUrl()}/docs/${grant}/`,
          doc: { title: info.name, tabCount: info.tabs, openThreads: info.openThreads },
          editorAvailable: this.#editorDist() !== null,
        };
      },
    };
  }

  /** 文档目录（真实路径）在内存里的那一份：编辑器开着时与它共用，写入推给编辑器。 */
  doc(dir: string): Promise<LiveDoc> {
    return this.server.doc(dir);
  }

  close(): Promise<void> {
    return this.server.close();
  }
}
