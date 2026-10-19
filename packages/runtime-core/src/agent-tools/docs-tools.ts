import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { RpcError, type DocsCreated } from '@baocut/protocol';
import { RcAgentTools } from '@baocut/protocol/messages/runtime-core';
import { DocsRefusal, readDocInfo, type DocsActor, type DocsConnector } from '@baocut/docs';
import { contentTypeOf } from '@baocut/slides';
import { resolveDeckDir } from '../slides.ts';
import { isIgnoredName } from '../space-catalog.ts';
import { inside } from './artifact-save.ts';
import { formatBytes } from './model-install-tools.ts';
import { ToolError, type ToolInfo, type ToolSet } from './tool-catalog.ts';
import { approvalField, confirmSummary, type ToolAccess, type ToolPrincipal, type ToolScope } from './tool-scope.ts';

/**
 * 会话里的文档（docs/design/docs §7）：文档的文件（`doc.json`、`tabs/`、`comments.json`、`assets/`）不由智能体直接写，全部经这组工具，
 * 语义照搬 Claude Docs 的连接器（`batch` / `create` / `read` / `update` / `query` / `delete`，加 `upload` 与 `export`）。
 * 工具经 `@baocut/docs` 的连接器读写编辑器用的同一份文档：编辑器开着时，写入即时出现在页面上，评论以智能体的身份出现。
 *
 * - 每个工具多一个 `doc`：文档目录，相对工作目录（代替连接器里文档的 id；`container` / `ref` 里写文档自己的 id 也认）。
 * - `docs_batch` 带 `container.create` 时在 `doc` 处新建文档（目录不存在或是空的），会话里记一条 `docs-created`，线程里出现文档卡片；
 *   之后的写入更新那张卡片的标题与标签页数。
 * - 连接器的拒绝（`find_none`、`guard_mismatch` 这类）原样作为错误码返回，什么也没改。
 *
 * 文档必须在会话的来源目录里（卡片按来源目录与相对路径打开）。只给会话里的智能体（`surfaces` 只有 `agent`）。
 */

/** 一个上传文件的上限：图片与小的数据文件；再大的图片先缩小。 */
export const DOCS_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

/** `docs_export` 不写文件时，结果里至多带这么多字符的 Markdown；更长的写成文件。 */
const MAX_INLINE_MARKDOWN = 100_000;

/** 文档目录在会话里的写法：来源目录 + 相对路径（`/` 分隔），打开时原样交给 `docs.open`。 */
type DocTarget = DocsCreated['target'];

export interface DocsToolsDeps {
  scope: ToolScope;
  /** `turnOf`：会话现在的回合（任务 id），文档的版本按回合分开（版本记录设计 §13.2）。 */
  docs: { connector: DocsConnector; turnOf?: (conversationId: string) => string | undefined };
}

// i18n-ignore-start: 给模型的工具说明、错误与下一步
const docPath = z.string().min(1).max(1000).describe('文档目录（里面有 doc.json），相对工作目录的路径；新建时是要建的目录');
const objectRef = z
  .strictObject({
    object: z.enum(['project', 'file', 'node', 'utterance', 'enum', 'blob']),
    id: z.string().min(1).max(400),
  })
  .describe('要操作的对象：文档本身 project、标签页 file、正文 node、评论 utterance、下拉选项 enum、素材 blob；id 写全');
const container = z
  .looseObject({
    kind: z.enum(['project', 'file']),
    id: z.string().min(1).max(400).optional(),
  })
  .describe('文档：{"kind":"project","id":"<文档 id>"}；新建时 {"kind":"project","create":{"name","doc":{"markdown","blocks"?}}}');
const engine = z.string().min(1).max(40).describe('对象的引擎：正文 prose、文档与标签页 json、素材 blob；可以不给');
const payload = z.record(z.string(), z.unknown());
const member = z.record(z.string(), z.unknown());

const schemas = {
  docs_batch: z.strictObject({
    doc: docPath,
    container,
    batch: z.array(member).max(100).describe('成员：{verb, object|ref, engine?, payload, $lid?}，按顺序原子地执行；新建文档时可以是 []'),
  }),
  docs_create: z.strictObject({
    doc: docPath,
    object: z.enum(['utterance', 'enum', 'file', 'node']).describe('utterance 评论或回复、enum 下拉选项、file 标签页、node 正文'),
    container: container.optional(),
    engine: engine.optional(),
    payload: payload.describe('评论或回复：{"value":{"body","parent"}}；下拉选项、标签页与正文的写法见 docs skill'),
  }),
  docs_read: z.strictObject({
    doc: docPath,
    ref: objectRef.optional().describe('不给时读文档本身（标签页与各自正文的 id）'),
    engine: engine.optional(),
    container: container.optional(),
    payload: payload
      .optional()
      .describe('正文：{"projection":"outline"}、{"kind":"view","parentId"}、{"kind":"search","text"}、{"kind":"view","sinceRev"}、{"kind":"versions"}'),
  }),
  docs_update: z.strictObject({
    doc: docPath,
    ref: objectRef,
    engine: engine.optional(),
    container: container.optional(),
    payload: z.union([payload, z.string().max(200_000)]).describe('正文：{"ops":[…]}；文档：{"kind":"patch","patch":[…]}'),
    answering: z.string().min(1).max(64).optional().describe('这次修改回答的评论线程（第一条评论的 id）'),
  }),
  docs_query: z.strictObject({
    doc: docPath,
    object: z.literal('utterance').describe('只列评论：utterance'),
    container: container.optional(),
    payload: payload.describe('{"under":{"object":"node","id":"<正文 id>"}}，可带 afterSeq、limit'),
  }),
  docs_delete: z.strictObject({
    doc: docPath,
    ref: objectRef,
    container: container.optional(),
  }),
  docs_upload: z.strictObject({
    doc: docPath,
    path: z.string().min(1).max(1000).describe('要上传的文件，相对工作目录的路径：图片 png、jpg、gif、webp、avif、svg，或 csv、pdf 这类文件'),
  }),
  docs_export: z.strictObject({
    doc: docPath,
    tab: z.string().min(1).max(400).optional().describe('只导出这个标签页（file id）；不给时全部标签页'),
    to: z.string().min(1).max(1000).optional().describe('写成工作目录里的这个 .md 文件（不能已存在）；不给时 Markdown 放在结果里'),
  }),
};

type ToolName = keyof typeof schemas;
type Args<N extends ToolName> = z.infer<(typeof schemas)[N]>;

const READ_MORE = '用法、例子与每个拒绝码的处理见 docs skill（skills_read）。';

const DEFINITIONS: Record<ToolName, ToolInfo> = {
  docs_batch: {
    title: '新建文档或批量修改',
    description: [
      '新建一份文档，或在一份文档上原子地执行一组成员（任一条被拒，什么也不改）。',
      '新建：container = {"kind":"project","create":{"name":"<标题>","doc":{"blocks":{…},"markdown":"# <标题>\\n\\n<?claude block asof?> · <?claude block me?>\\n\\n<?claude block s1?>…"}}}，batch = []；doc 是要建的目录（不存在或是空的）。回执的 lids 给出标签页 f 与正文 n 的 id，n 的回执是写下的大纲（每个 pending 块一个 id）。',
      '已有文档：container = {"kind":"project","id":"<文档 id>"}，成员 {verb, object|ref, engine?, payload, $lid?}，$lid:<名字> 在同一批里引用前面新建的对象（加标签页、下拉选项列与正文）。',
      `图表、示意图与 widget 不支持：用表格或列表。${READ_MORE}`,
    ].join('\n'),
    annotations: { destructiveHint: false },
    effect: 'mutation',
    examples: [
      {
        title: '新建文档的骨架',
        args: {
          doc: 'q3-launch-plan',
          container: {
            kind: 'project',
            create: {
              name: 'Q3 launch plan',
              doc: {
                blocks: {
                  asof: { type: 'date', value: '2026-09-04' },
                  me: { type: 'mention', user: 'me' },
                  s1: { type: 'pending', intent: 'Goals: the three outcomes this quarter commits to' },
                },
                markdown: '# Q3 launch plan\n\n<?claude block asof?> · <?claude block me?>\n\n<?claude block s1?>',
              },
            },
          },
          batch: [],
        },
      },
    ],
    surfaces: ['agent'],
  },
  docs_create: {
    title: '在文档里新建',
    description: [
      '在文档里新建一样东西：评论或回复（utterance）、下拉选项（enum）、标签页（file）或正文（node）。',
      '评论一段文字：payload = {"value":{"body":"…","parent":{"object":"node","id":"<正文 id>","anchor":{"kind":"find","text":"<原文里的 3–6 个词>"}}}}；回复：parent = {"object":"utterance","id":"<线程第一条的 id>"}，不带 anchor。',
      `用户把评论发给你时，在那个线程里回复（parent 是线程第一条的 id）。${READ_MORE}`,
    ].join('\n'),
    annotations: { destructiveHint: false },
    effect: 'mutation',
    examples: [
      {
        title: '在线程里回复',
        args: { doc: 'q3-launch-plan', object: 'utterance', payload: { value: { body: 'Done: raised the target to 750.', parent: { object: 'utterance', id: 'u-3f2a9c1e' } } } },
      },
    ],
    surfaces: ['agent'],
  },
  docs_read: {
    title: '读文档',
    description: [
      '读文档：不给 ref 时是文档本身（files[]：每个标签页的 id 与正文 id），给正文 node 时按 payload 读。',
      '长文档不要整篇读：先 {"projection":"outline"}（每块的 id 与 h），再 {"kind":"view","parentId":"<块 id>"} 读一张表或一个列表，或 {"kind":"search","text":"…"}；回合之间文档可能被人改过，从上次的 rev 起读 {"kind":"view","sinceRev":<rev>}。',
      '标签页的版本（最近 10 段工作，新的在前，每版的 rev、时间段、谁改的与改了哪几个小节）：{"kind":"versions"}；读某一版用 {"kind":"view","atRev":<那一版的 rev>}。',
      READ_MORE,
    ].join('\n'),
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [
      { title: '读文档的标签页', args: { doc: 'q3-launch-plan' } },
      { title: '读正文大纲', args: { doc: 'q3-launch-plan', ref: { object: 'node', id: 'be1476b2-62c1' }, engine: 'prose', payload: { projection: 'outline' } } },
    ],
    surfaces: ['agent'],
    positional: 'doc',
  },
  docs_update: {
    title: '改文档',
    description: [
      '改文档的正文（prose ops）或文档本身（标签页的名字、顺序与层级）。',
      '正文 node 的 payload 是 {"ops":[…]}（insert、replace、delete、move、set、restore），文档本身的 payload 是 {"kind":"patch","patch":[…]}。',
      '目标：能引用的文字用 {"kind":"find","text":"…"}（原样照抄，重复时加 nth）；整块用 {"kind":"blocks","ids":[…]}，replace/delete 整块要带 ifHash（块的 h）与 ifRev（读到它的 rev），或者被要求覆盖时 force。insert 用 source，replace 用 with，都是 {"from":{"kind":"inline","content":"…"},"as":"text"|"markdown"}。',
      `新建文档之后一节一次：replace 那一节的 pending 块（with 是 "## 标题" 加正文）。回答评论线程里的请求时带 answering = 线程第一条的 id。${READ_MORE}`,
    ].join('\n'),
    annotations: { destructiveHint: false },
    effect: 'mutation',
    examples: [
      {
        title: '填一节',
        args: {
          doc: 'q3-launch-plan',
          ref: { object: 'node', id: 'be1476b2-62c1' },
          engine: 'prose',
          payload: {
            ops: [
              {
                op: 'replace',
                target: { kind: 'blocks', ids: ['kq2b7w3m9pa.105'] },
                with: { from: { kind: 'inline', content: '## Goals\n\n- Ship the connector to every workspace' }, as: 'markdown' },
              },
            ],
          },
        },
      },
    ],
    surfaces: ['agent'],
  },
  docs_query: {
    title: '列评论',
    description: [
      '列一份正文、一个标签页或一个线程下的评论。',
      'payload = {"under":{"object":"node","id":"<正文 id>"}}，可带 afterSeq 与 limit 翻页。',
      `结果里 to:"claude" 的是发给你的，answered='true' 的线程已经有人回答过。${READ_MORE}`,
    ].join('\n'),
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [{ title: '列评论', args: { doc: 'q3-launch-plan', object: 'utterance', payload: { under: { object: 'node', id: 'be1476b2-62c1' } } } }],
    surfaces: ['agent'],
  },
  docs_delete: {
    title: '删文档里的东西',
    description: [
      '删文档里的一样东西：标签页（file，最后一个不能删）、评论（utterance，只能删自己的）或下拉选项（enum）。正文里的文字与块用 docs_update 的 delete。',
      READ_MORE,
    ].join('\n'),
    annotations: { destructiveHint: true },
    effect: 'destructive',
    examples: [{ title: '删一个标签页', args: { doc: 'q3-launch-plan', ref: { object: 'file', id: 'afc001d0-ce07' } } }],
    surfaces: ['agent'],
  },
  docs_upload: {
    title: '上传文件到文档',
    description: [
      '把工作目录里的一个文件放进文档的 assets/，返回正文里引用它的地址 blob/<id>。',
      `图片在 markdown 里写 ![说明](blob/<id>)。按内容寻址，同一份只存一份；不超过 ${formatBytes(DOCS_UPLOAD_MAX_BYTES)}。会按访问模式向用户确认。`,
    ].join('\n'),
    annotations: { destructiveHint: false, idempotentHint: true },
    effect: 'mutation',
    examples: [{ title: '上传一张图', args: { doc: 'q3-launch-plan', path: 'images/timeline.png' } }],
    surfaces: ['agent'],
  },
  docs_export: {
    title: '导出文档为 Markdown',
    description: [
      '把文档（或其中一个标签页）导出为 Markdown：给 to 时写成工作目录里的 .md 文件（不覆盖），否则放在结果里。',
      '用户要 Word 或 PDF 时告诉他们在文档编辑器里导出。',
    ].join('\n'),
    annotations: { readOnlyHint: false, destructiveHint: false },
    effect: 'mutation',
    examples: [{ title: '导出为文件', args: { doc: 'q3-launch-plan', to: 'q3-launch-plan.md' } }],
    surfaces: ['agent'],
    positional: 'doc',
  },
};
// i18n-ignore-end

export class DocsTools implements ToolSet {
  readonly schemas = schemas;
  readonly definitions = DEFINITIONS;
  readonly #deps: DocsToolsDeps;

  constructor(deps: DocsToolsDeps) {
    this.#deps = deps;
  }

  dispatch(name: string, args: unknown, principal: ToolPrincipal): Promise<unknown> {
    switch (name as ToolName) {
      case 'docs_batch':
        return this.#batch(args as Args<'docs_batch'>, principal);
      case 'docs_create':
        return this.#create(args as Args<'docs_create'>, principal);
      case 'docs_read':
        return this.#read(args as Args<'docs_read'>, principal);
      case 'docs_update':
        return this.#update(args as Args<'docs_update'>, principal);
      case 'docs_query':
        return this.#query(args as Args<'docs_query'>, principal);
      case 'docs_delete':
        return this.#delete(args as Args<'docs_delete'>, principal);
      case 'docs_upload':
        return this.#upload(args as Args<'docs_upload'>, principal);
      case 'docs_export':
        return this.#export(args as Args<'docs_export'>, principal);
      default:
        // i18n-ignore: 给模型的工具说明、错误与下一步
        return Promise.reject(new ToolError('UNKNOWN_TOOL', `没有这个工具：${name}`));
    }
  }

  async #batch(args: Args<'docs_batch'>, principal: ToolPrincipal) {
    const { scope, docs } = this.#deps;
    const access = scope.authorize(principal, true);
    const birth = 'create' in args.container && args.container.create !== undefined;
    const doc = birth ? await this.#newDoc(access, args.doc) : await this.#doc(access, args.doc);
    const label = doc.target.path;
    const approval = await scope.confirm(access, {
      tool: 'docs_batch',
      targets: [doc.dir],
      ...confirmSummary(birth ? RcAgentTools.docsCreateSummary({ doc: label }) : RcAgentTools.docsEditSummary({ doc: label })),
    });
    if (birth) await fs.mkdir(doc.dir, { recursive: true });
    const result = await refused(() => docs.connector.batch(doc.dir, { container: args.container, batch: args.batch }, this.#actor(access)));
    await this.#record(access, doc, !birth);
    return { ...asObject(result), ...approvalField(approval) };
  }

  async #create(args: Args<'docs_create'>, principal: ToolPrincipal) {
    const { scope, docs } = this.#deps;
    const access = scope.authorize(principal, true);
    const doc = await this.#doc(access, args.doc);
    const label = doc.target.path;
    const approval = await scope.confirm(access, {
      tool: 'docs_create',
      targets: [doc.dir],
      ...confirmSummary(args.object === 'utterance' ? RcAgentTools.docsCommentSummary({ doc: label }) : RcAgentTools.docsEditSummary({ doc: label })),
    });
    const { doc: _doc, ...rest } = args;
    const result = await refused(() => docs.connector.create(doc.dir, rest, this.#actor(access)));
    await this.#record(access, doc, true);
    return { ...asObject(result), ...approvalField(approval) };
  }

  async #read(args: Args<'docs_read'>, principal: ToolPrincipal) {
    const { scope, docs } = this.#deps;
    const access = scope.authorize(principal, false);
    const doc = await this.#doc(access, args.doc);
    const { doc: _doc, ...rest } = args;
    return refused(() => docs.connector.read(doc.dir, rest, this.#actor(access)));
  }

  async #update(args: Args<'docs_update'>, principal: ToolPrincipal) {
    const { scope, docs } = this.#deps;
    const access = scope.authorize(principal, true);
    const doc = await this.#doc(access, args.doc);
    const approval = await scope.confirm(access, {
      tool: 'docs_update',
      targets: [doc.dir],
      ...confirmSummary(RcAgentTools.docsEditSummary({ doc: doc.target.path })),
    });
    const { doc: _doc, ...rest } = args;
    const result = await refused(() => docs.connector.update(doc.dir, rest, this.#actor(access)));
    await this.#record(access, doc, true);
    return { ...asObject(result), ...approvalField(approval) };
  }

  async #query(args: Args<'docs_query'>, principal: ToolPrincipal) {
    const { scope, docs } = this.#deps;
    const access = scope.authorize(principal, false);
    const doc = await this.#doc(access, args.doc);
    const { doc: _doc, ...rest } = args;
    return refused(() => docs.connector.query(doc.dir, rest, this.#actor(access)));
  }

  async #delete(args: Args<'docs_delete'>, principal: ToolPrincipal) {
    const { scope, docs } = this.#deps;
    const access = scope.authorize(principal, true);
    const doc = await this.#doc(access, args.doc);
    const approval = await scope.confirm(access, {
      tool: 'docs_delete',
      targets: [doc.dir],
      ...confirmSummary(RcAgentTools.docsDeleteSummary({ doc: doc.target.path })),
    });
    const { doc: _doc, ...rest } = args;
    const result = await refused(() => docs.connector.delete(doc.dir, rest, this.#actor(access)));
    await this.#record(access, doc, true);
    return { ...asObject(result), ...approvalField(approval) };
  }

  async #upload(args: Args<'docs_upload'>, principal: ToolPrincipal) {
    const { scope, docs } = this.#deps;
    const access = scope.authorize(principal, true);
    const doc = await this.#doc(access, args.doc);
    const file = await this.#sourceFile(access, args.path);
    const approval = await scope.confirm(access, {
      tool: 'docs_upload',
      targets: [doc.dir],
      ...confirmSummary(RcAgentTools.docsUploadSummary({ file: args.path, doc: doc.target.path })),
    });
    const bytes = await fs.readFile(file.path);
    // i18n-ignore: 给模型的工具说明、错误与下一步
    if (bytes.byteLength !== file.size) throw new ToolError('FILE_CHANGED', '文件在确认期间被改了：重新调用一次');
    const contentType = contentTypeOf(file.path);
    const uploaded = await refused(() =>
      docs.connector.upload(doc.dir, { bytes, contentType, name: path.basename(file.path) }, this.#actor(access)),
    );
    return {
      ...uploaded,
      ...approvalField(approval),
      // i18n-ignore-start: 给模型的工具说明、错误与下一步
      next: contentType.startsWith('image/')
        ? `在要放图的地方插入 markdown：![<一句说明>](${uploaded.blob})，原样用这个地址。`
        : `在正文里用链接引用它：[<文件名>](${uploaded.blob})。`,
      // i18n-ignore-end
    };
  }

  async #export(args: Args<'docs_export'>, principal: ToolPrincipal) {
    const { scope, docs } = this.#deps;
    const access = scope.authorize(principal, args.to !== undefined);
    const doc = await this.#doc(access, args.doc);
    if (args.to === undefined) {
      const exported = await refused(() => docs.connector.exportMarkdown(doc.dir, args.tab ? { tab: args.tab } : {}));
      const truncated = exported.markdown.length > MAX_INLINE_MARKDOWN;
      return {
        tabs: exported.tabs,
        markdown: truncated ? exported.markdown.slice(0, MAX_INLINE_MARKDOWN) : exported.markdown,
        // i18n-ignore: 给模型的工具说明、错误与下一步
        ...(truncated ? { truncated: true, next: '太长，结果里只有开头：给 to 写成文件。' } : {}),
      };
    }
    const target = await this.#exportTarget(access, args.to);
    const approval = await scope.confirm(access, {
      tool: 'docs_export',
      targets: [target],
      ...confirmSummary(RcAgentTools.docsExportSummary({ doc: doc.target.path, file: args.to })),
    });
    const exported = await refused(() => docs.connector.exportMarkdown(doc.dir, args.tab ? { tab: args.tab } : {}));
    try {
      await fs.writeFile(target, exported.markdown, { flag: 'wx' });
    } catch (error) {
      // i18n-ignore: 给模型的工具说明、错误与下一步
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ToolError('FILE_EXISTS', `${args.to} 已经存在：换一个文件名`);
      throw error;
    }
    return { path: args.to, bytes: Buffer.byteLength(exported.markdown), tabs: exported.tabs, ...approvalField(approval) };
  }

  /** 写入之后：更新会话里这份文档的卡片（新建时添一张）。读不出概要（被删了）时不记。 */
  /** 智能体在文档里的身份：评论与修改记在它名下（编辑器里显示为助手），带上会话与回合（版本按回合分开）。 */
  #actor(access: ToolAccess): DocsActor {
    const driverId = 'conversation' in access ? (access as { conversation: { driverId: string } }).conversation.driverId : '';
    const conversation = access.principal.kind === 'agent' ? access.principal.conversationId : undefined;
    const turn = conversation ? this.#deps.docs.turnOf?.(conversation) : undefined;
    return {
      id: 'claude',
      name: driverId && !driverId.startsWith('claude') ? driverId : 'Claude',
      ...(conversation ? { conversation } : {}),
      ...(turn ? { turn } : {}),
    };
  }

  async #record(access: ToolAccess, doc: { dir: string; target: DocTarget }, onlyExisting: boolean): Promise<void> {
    const info = await readDocInfo(doc.dir);
    if (!info) return;
    this.#deps.scope.recordDocs?.(access, { target: doc.target, title: info.name, tabCount: info.tabs }, onlyExisting);
  }

  /** 已有的文档目录：相对工作目录，在会话的来源目录里，有合格的 doc.json。 */
  async #doc(access: ToolAccess, given: string): Promise<{ dir: string; target: DocTarget }> {
    const located = await this.#locate(access, given);
    let dir: string;
    try {
      dir = await resolveDeckDir(located.root, located.relNative);
    } catch (error) {
      if (!(error instanceof RpcError)) throw error;
      // i18n-ignore: 给模型的工具说明、错误与下一步
      if (error.code === 'not-found') throw new ToolError('DOC_NOT_FOUND', `工作目录里没有这个目录：${given}`);
      throw docOutside();
    }
    if (!(await readDocInfo(dir))) {
      // i18n-ignore: 给模型的工具说明、错误与下一步
      throw new ToolError('NOT_A_DOC', `${given} 不是文档（没有合格的 doc.json）：新建用 docs_batch 带 container.create`);
    }
    return { dir, target: located.target };
  }

  /**
   * 要新建的文档目录：在会话的来源目录里；目录本身不存在，或是空的（不经过符号链接）。
   * 缺的父目录这时不建（用户可能不批准），确认之后由 `#batch` 连同文档目录一起建。
   */
  async #newDoc(access: ToolAccess, given: string): Promise<{ dir: string; target: DocTarget }> {
    const located = await this.#locate(access, given);
    const parts = located.relNative.split(path.sep).filter(Boolean);
    // 从文档目录往上找已经存在的最近一级：它要在来源目录里（resolveDeckDir 按真实路径判断）；下面缺的各级之后再建。
    let existing: string | undefined;
    let rest: string[] = [];
    for (let depth = parts.length; depth >= 0 && existing === undefined; depth -= 1) {
      try {
        existing = await resolveDeckDir(located.root, parts.slice(0, depth).join(path.sep));
        rest = parts.slice(depth);
      } catch (error) {
        if (!(error instanceof RpcError)) throw error;
        const stat = depth > 0 ? await fs.lstat(path.join(located.root, ...parts.slice(0, depth))).catch(() => null) : null;
        if (error.code === 'not-found' && !stat) continue;
        // 这一级是个普通文件：路径被占了；其余（指向来源目录外或不存在处的符号链接）都算出界。
        throw stat && !stat.isSymbolicLink() && !stat.isDirectory() ? pathTaken(given) : docOutside();
      }
    }
    if (existing === undefined) throw docOutside();
    const dir = path.join(existing, ...rest);
    if (rest.length === 0) {
      if ((await fs.lstat(path.join(located.root, located.relNative))).isSymbolicLink()) throw pathTaken(given);
      // i18n-ignore-start: 给模型的工具说明、错误与下一步
      if (await readDocInfo(dir)) throw new ToolError('DOC_EXISTS', `${given} 已经是一份文档：用 container = {"kind":"project","id":"<文档 id>"} 改它，不要重建`);
      if ((await fs.readdir(dir)).length > 0) throw new ToolError('DOC_PATH_TAKEN', `${given} 里已经有别的文件：换一个目录名`);
      // i18n-ignore-end
    }
    return { dir, target: located.target };
  }

  /** 调用方给的文档目录：相对工作目录，必须在会话的来源目录里，不能是来源目录本身，不进隐藏与依赖目录。 */
  async #locate(access: ToolAccess, given: string): Promise<{ root: string; relNative: string; target: DocTarget }> {
    const { scope } = this.#deps;
    const { root, scope: source } = await scope.createRoot(access, undefined, { locate: true });
    const absolute = path.resolve(scope.fileBase(access), given);
    const relNative = path.relative(root, absolute);
    if (!relNative || relNative === '..' || relNative.startsWith(`..${path.sep}`) || path.isAbsolute(relNative)) throw docOutside();
    const parts = relNative.split(path.sep).filter(Boolean);
    if (parts.some(isIgnoredName)) throw docOutside();
    return { root, relNative, target: { ...source, path: parts.join('/') } };
  }

  /** 要上传的文件：工作目录里的普通文件（按真实路径判断，不经过符号链接），不超过上限。 */
  async #sourceFile(access: ToolAccess, given: string): Promise<{ path: string; size: number }> {
    const base = await fs.realpath(this.#deps.scope.fileBase(access));
    if (path.isAbsolute(given) || path.win32.isAbsolute(given) || given.split(/[\\/]+/).includes('..')) throw fileOutside();
    const resolved = path.resolve(base, given);
    if (resolved === base || !inside(resolved, base)) throw fileOutside();
    const stat = await fs.lstat(resolved).catch(() => null);
    // i18n-ignore-start: 给模型的工具说明、错误与下一步
    if (!stat) throw new ToolError('FILE_NOT_FOUND', `工作目录里没有这个文件：${given}`);
    if (stat.isSymbolicLink()) throw new ToolError('PATH_IS_SYMLINK', 'path 是一个符号链接：给它指向的、在工作目录里的文件');
    if (!stat.isFile()) throw new ToolError('NOT_A_FILE', 'path 要是一个普通文件（不是目录）');
    const dirReal = await fs.realpath(path.dirname(resolved));
    if (!inside(dirReal, base)) throw fileOutside();
    if (stat.size > DOCS_UPLOAD_MAX_BYTES) {
      throw new ToolError('FILE_TOO_LARGE', `文件有 ${formatBytes(stat.size)}，超过了 ${formatBytes(DOCS_UPLOAD_MAX_BYTES)} 的上限：图片先缩小，数据先汇总`, {
        bytes: stat.size,
        limit: DOCS_UPLOAD_MAX_BYTES,
      });
    }
    // i18n-ignore-end
    return { path: path.join(dirReal, path.basename(resolved)), size: stat.size };
  }

  /** 导出的目标文件：工作目录里的 .md，父目录已经存在。 */
  async #exportTarget(access: ToolAccess, given: string): Promise<string> {
    const base = await fs.realpath(this.#deps.scope.fileBase(access));
    if (path.isAbsolute(given) || path.win32.isAbsolute(given) || given.split(/[\\/]+/).includes('..')) throw fileOutside();
    // i18n-ignore: 给模型的工具说明、错误与下一步
    if (!/\.(md|markdown)$/i.test(given)) throw new ToolError('INVALID_ARGUMENTS', 'to 要是 .md 文件');
    const resolved = path.resolve(base, given);
    const dirReal = await fs.realpath(path.dirname(resolved)).catch(() => null);
    if (!dirReal || !inside(dirReal, base)) throw fileOutside();
    return path.join(dirReal, path.basename(resolved));
  }
}


/** 连接器的拒绝原样作为错误返回：`code` 是连接器的拒绝码（`find_none` 这类），附带的细节一起给。 */
async function refused<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof DocsRefusal) throw new ToolError(error.code, error.message, error.details ?? {});
    throw error;
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : { result: value };
}

function docOutside(): ToolError {
  // i18n-ignore: 给模型的工具说明、错误与下一步
  return new ToolError('PATH_OUTSIDE_WORKSPACE', '文档要是会话工作目录里的一个子目录（相对路径，不在隐藏目录或依赖目录里，不经过指向别处的符号链接）');
}

function pathTaken(given: string): ToolError {
  // i18n-ignore: 给模型的工具说明、错误与下一步
  return new ToolError('DOC_PATH_TAKEN', `${given} 那里已经是一个文件（或符号链接）：换一个目录名`);
}

function fileOutside(): ToolError {
  // i18n-ignore: 给模型的工具说明、错误与下一步
  return new ToolError('PATH_OUTSIDE_WORKSPACE', 'path 要是这个会话工作目录里的文件（相对路径，不含 ..，不经过指向别处的符号链接）');
}
