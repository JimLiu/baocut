import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DocsCreated } from '@baocut/protocol';
import { createDoc, DocsRefusal, type DocsActor, type DocsConnector } from '@baocut/docs';
import { DOCS_UPLOAD_MAX_BYTES, DocsTools } from './docs-tools.ts';
import type { AgentPrincipal } from './grants.ts';
import { ToolError } from './tool-catalog.ts';
import { toolRisk, type ToolConfirmation, type ToolScope } from './tool-scope.ts';

/**
 * `docs_*`（docs/design/docs §7）：文档必须是会话来源目录里的子目录；新建时目录不存在或是空的，确认之后才建；
 * 写入之后会话里记一条 `docs-created`（新建时添，之后只更新）；连接器的拒绝原样作为错误码返回。
 * 连接器在这里是假的，只记下调用；它本身的语义由 `@baocut/docs` 的测试覆盖。
 */

let tmp: string;
let root: string;

beforeEach(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-docs-tools-')));
  root = path.join(tmp, 'scratch');
  await fs.mkdir(root);
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function rejected(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ToolError) return error.code;
    throw error;
  }
  throw new Error('应当拒绝');
}

async function writeDoc(rel: string, name = 'Q3 Plan'): Promise<string> {
  const dir = path.join(root, rel);
  await fs.mkdir(path.dirname(dir), { recursive: true });
  await createDoc(dir, { name });
  return dir;
}

interface Call {
  verb: string;
  dir: string;
  args: unknown;
  actor?: DocsActor;
}

/** 假连接器：记下每次调用；新建时在目录里建一份文档；`refuse` 给了时拒绝下一次写入。 */
function fakeConnector(options: { markdown?: string; refuse?: DocsRefusal } = {}) {
  const calls: Call[] = [];
  const write = (verb: string) => async (dir: string, args: unknown, actor: DocsActor) => {
    calls.push({ verb, dir, args, actor });
    if (options.refuse) throw options.refuse;
    if (verb === 'batch' && (args as { container: { create?: { name: string } } }).container.create) {
      expect((await fs.readdir(dir)).length).toBe(0);
      await createDoc(dir, { name: (args as { container: { create: { name: string } } }).container.create.name });
      return { rev: 1, xml: '<doc rev="1"/>' };
    }
    return { rev: 2 };
  };
  const connector: DocsConnector = {
    batch: write('batch'),
    create: write('create'),
    update: write('update'),
    delete: write('delete'),
    read: async (dir, args, actor) => {
      calls.push({ verb: 'read', dir, args, actor });
      return { xml: '<doc rev="2"/>' };
    },
    query: async (dir, args, actor) => {
      calls.push({ verb: 'query', dir, args, actor });
      return { utterances: [] };
    },
    upload: async (dir, file, actor) => {
      calls.push({ verb: 'upload', dir, args: { ...file, bytes: Buffer.from(file.bytes).toString() }, actor });
      return { blob: 'blob/abc', id: 'abc', bytes: file.bytes.byteLength, contentType: file.contentType };
    },
    exportMarkdown: async (dir, args) => {
      calls.push({ verb: 'export', dir, args });
      return { markdown: options.markdown ?? '# Q3 Plan\n', tabs: [{ id: 'tab_1', name: 'Untitled' }] };
    },
  };
  return { connector, calls };
}

/** 工具用到的：授权、确认（记下请求，`deny` 时拒绝）、来源目录与工作目录、记卡片。 */
function fakeScope(options: { write?: boolean; deny?: boolean } = {}) {
  const confirmed: ToolConfirmation[] = [];
  const recorded: { created: DocsCreated; onlyExisting: boolean }[] = [];
  const scope = {
    authorize: (principal: AgentPrincipal, wants: boolean) => {
      if (wants && options.write === false) throw new ToolError('PLAN_ONLY', '规划模式只读');
      return { principal, submitter: { kind: 'agent', id: principal.conversationId, taskId: 'task_1' } };
    },
    confirm: async (_access: unknown, request: ToolConfirmation) => {
      confirmed.push(request);
      if (options.deny) throw new ToolError('DENIED', '用户拒绝了');
      return { mode: 'auto', risk: toolRisk(request), decidedBy: 'auto' };
    },
    createRoot: async () => ({ root, scope: { conversationId: 'conv_1' } }),
    fileBase: () => root,
    recordDocs: (_access: unknown, created: DocsCreated, onlyExisting: boolean) => void recorded.push({ created, onlyExisting }),
  } as unknown as ToolScope;
  return { scope, confirmed, recorded };
}

const principal = { kind: 'agent', conversationId: 'conv_1' } as unknown as AgentPrincipal;

function tools(scope: ToolScope, connector: DocsConnector) {
  return new DocsTools({ scope, docs: { connector } });
}

const birth = (name: string) => ({ kind: 'project', create: { name, doc: { markdown: `# ${name}` } } });

describe('docs_batch', () => {
  it('新建：缺的父目录确认之后才建，连接器拿到空目录；记一张新卡片；风险 edit', async () => {
    const { connector, calls } = fakeConnector();
    const { scope, confirmed, recorded } = fakeScope();
    const result = await tools(scope, connector).dispatch('docs_batch', { doc: 'reports/q3', container: birth('Q3 Plan'), batch: [] }, principal);
    expect(result).toMatchObject({ rev: 1, xml: '<doc rev="1"/>' });
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]).toMatchObject({ tool: 'docs_batch', targets: [path.join(root, 'reports', 'q3')] });
    expect(toolRisk(confirmed[0]!)).toBe('edit');
    expect(calls).toEqual([
      { verb: 'batch', dir: path.join(root, 'reports', 'q3'), args: { container: birth('Q3 Plan'), batch: [] }, actor: { id: 'claude', name: 'Claude', conversation: 'conv_1' } },
    ]);
    expect(recorded).toEqual([{ created: { target: { conversationId: 'conv_1', path: 'reports/q3' }, title: 'Q3 Plan', tabCount: 1 }, onlyExisting: false }]);
  });

  it('新建被拒绝时什么目录也不留下', async () => {
    const { connector, calls } = fakeConnector();
    const { scope } = fakeScope({ deny: true });
    expect(await rejected(tools(scope, connector).dispatch('docs_batch', { doc: 'reports/q3', container: birth('Q3'), batch: [] }, principal))).toBe('DENIED');
    expect(calls).toEqual([]);
    await expect(fs.stat(path.join(root, 'reports'))).rejects.toThrow();
  });

  it('新建的位置：已有文档 DOC_EXISTS；非空目录或文件 DOC_PATH_TAKEN；空目录可以', async () => {
    const { connector } = fakeConnector();
    const set = tools(fakeScope().scope, connector);
    await writeDoc('plan');
    expect(await rejected(set.dispatch('docs_batch', { doc: 'plan', container: birth('Plan'), batch: [] }, principal))).toBe('DOC_EXISTS');
    await fs.mkdir(path.join(root, 'busy'));
    await fs.writeFile(path.join(root, 'busy', 'notes.txt'), 'x');
    expect(await rejected(set.dispatch('docs_batch', { doc: 'busy', container: birth('Busy'), batch: [] }, principal))).toBe('DOC_PATH_TAKEN');
    await fs.writeFile(path.join(root, 'file'), 'x');
    expect(await rejected(set.dispatch('docs_batch', { doc: 'file', container: birth('File'), batch: [] }, principal))).toBe('DOC_PATH_TAKEN');
    expect(await rejected(set.dispatch('docs_batch', { doc: 'file/inner', container: birth('Inner'), batch: [] }, principal))).toBe('DOC_PATH_TAKEN');
    await fs.mkdir(path.join(root, 'empty'));
    await expect(set.dispatch('docs_batch', { doc: 'empty', container: birth('Empty'), batch: [] }, principal)).resolves.toMatchObject({ rev: 1 });
  });

  it('文档要在工作目录里：不出界、不是工作目录本身、不进隐藏或依赖目录、不经过指向外面的符号链接', async () => {
    const { connector, calls } = fakeConnector();
    const set = tools(fakeScope().scope, connector);
    await fs.mkdir(path.join(tmp, 'outside'));
    await fs.symlink(path.join(tmp, 'outside'), path.join(root, 'link'));
    for (const doc of ['../elsewhere', tmp, '.', 'node_modules/pkg', '.git/doc', 'link/doc']) {
      expect(await rejected(set.dispatch('docs_batch', { doc, container: birth('X'), batch: [] }, principal)), doc).toBe('PATH_OUTSIDE_WORKSPACE');
    }
    expect(await rejected(set.dispatch('docs_batch', { doc: 'link', container: birth('X'), batch: [] }, principal))).toBe('PATH_OUTSIDE_WORKSPACE');
    expect(calls).toEqual([]);
    expect(await fs.readdir(path.join(tmp, 'outside'))).toEqual([]);
  });

  it('改已有的文档：记卡片时只更新已有的；不是文档 NOT_A_DOC，没有这个目录 DOC_NOT_FOUND', async () => {
    const dir = await writeDoc('plan');
    const { connector, calls } = fakeConnector();
    const { scope, confirmed, recorded } = fakeScope();
    const set = tools(scope, connector);
    const container = { kind: 'project', id: 'whatever' };
    const batch = [{ verb: 'update', ref: { object: 'file', id: 'f' }, payload: {} }];
    await expect(set.dispatch('docs_batch', { doc: 'plan/', container, batch }, principal)).resolves.toMatchObject({ rev: 2 });
    expect(calls[0]).toMatchObject({ verb: 'batch', dir, args: { container, batch } });
    expect(confirmed[0]).toMatchObject({ tool: 'docs_batch', targets: [dir] });
    expect(recorded).toEqual([{ created: { target: { conversationId: 'conv_1', path: 'plan' }, title: 'Q3 Plan', tabCount: 1 }, onlyExisting: true }]);

    await fs.mkdir(path.join(root, 'plain'));
    expect(await rejected(set.dispatch('docs_batch', { doc: 'plain', container, batch }, principal))).toBe('NOT_A_DOC');
    expect(await rejected(set.dispatch('docs_batch', { doc: 'missing', container, batch }, principal))).toBe('DOC_NOT_FOUND');
  });

  it('连接器的拒绝原样作为错误码返回，带着细节，不记卡片', async () => {
    await writeDoc('plan');
    const refusal = new DocsRefusal('guard_mismatch', 'block changed', { id: '.90', h: 'abcd' });
    const { connector } = fakeConnector({ refuse: refusal });
    const { scope, recorded } = fakeScope();
    const call = tools(scope, connector).dispatch('docs_batch', { doc: 'plan', container: { kind: 'project' }, batch: [] }, principal);
    const error = await call.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolError);
    expect(error).toMatchObject({ code: 'guard_mismatch', message: 'block changed', extra: { id: '.90', h: 'abcd' } });
    expect(recorded).toEqual([]);
  });

  it('规划模式不能写', async () => {
    await writeDoc('plan');
    const { connector, calls } = fakeConnector();
    const set = tools(fakeScope({ write: false }).scope, connector);
    expect(await rejected(set.dispatch('docs_batch', { doc: 'plan', container: { kind: 'project' }, batch: [] }, principal))).toBe('PLAN_ONLY');
    expect(await rejected(set.dispatch('docs_update', { doc: 'plan', ref: { object: 'node', id: '.1' }, payload: {} }, principal))).toBe('PLAN_ONLY');
    expect(calls).toEqual([]);
  });
});

describe('docs_read、docs_query', () => {
  it('只读：不确认，规划模式也能用，参数去掉 doc 原样交给连接器', async () => {
    const dir = await writeDoc('plan');
    const { connector, calls } = fakeConnector();
    const { scope, confirmed } = fakeScope({ write: false });
    const set = tools(scope, connector);
    await expect(set.dispatch('docs_read', { doc: 'plan', ref: { object: 'project', id: 'p' } }, principal)).resolves.toEqual({ xml: '<doc rev="2"/>' });
    await expect(set.dispatch('docs_query', { doc: 'plan', object: 'utterance', payload: { status: 'open' } }, principal)).resolves.toEqual({ utterances: [] });
    expect(calls).toEqual([
      { verb: 'read', dir, args: { ref: { object: 'project', id: 'p' } }, actor: { id: 'claude', name: 'Claude', conversation: 'conv_1' } },
      { verb: 'query', dir, args: { object: 'utterance', payload: { status: 'open' } }, actor: { id: 'claude', name: 'Claude', conversation: 'conv_1' } },
    ]);
    expect(confirmed).toEqual([]);
    expect(toolRisk({ tool: 'docs_read' } as ToolConfirmation)).toBe('read');
    expect(toolRisk({ tool: 'docs_query' } as ToolConfirmation)).toBe('read');
  });
});

describe('docs_create、docs_update、docs_delete', () => {
  it('确认之后交给连接器，之后更新卡片', async () => {
    const dir = await writeDoc('plan');
    const { connector, calls } = fakeConnector();
    const { scope, confirmed, recorded } = fakeScope();
    const set = tools(scope, connector);
    await set.dispatch('docs_create', { doc: 'plan', object: 'utterance', payload: { text: 'done' } }, principal);
    await set.dispatch('docs_update', { doc: 'plan', ref: { object: 'node', id: '.1' }, payload: { ops: [] }, answering: 'u_1' }, principal);
    await set.dispatch('docs_delete', { doc: 'plan', ref: { object: 'utterance', id: 'u_2' } }, principal);
    expect(calls.map((c) => [c.verb, c.dir, c.args])).toEqual([
      ['create', dir, { object: 'utterance', payload: { text: 'done' } }],
      ['update', dir, { ref: { object: 'node', id: '.1' }, payload: { ops: [] }, answering: 'u_1' }],
      ['delete', dir, { ref: { object: 'utterance', id: 'u_2' } }],
    ]);
    expect(confirmed.map((c) => c.tool)).toEqual(['docs_create', 'docs_update', 'docs_delete']);
    expect(confirmed.every((c) => toolRisk(c) === 'edit')).toBe(true);
    expect(recorded.map((r) => r.onlyExisting)).toEqual([true, true, true]);
  });

  it('写的人带上会话与这个会话现在的回合（文档版本按回合分开）', async () => {
    const dir = await writeDoc('plan');
    const { connector, calls } = fakeConnector();
    const set = new DocsTools({ scope: fakeScope().scope, docs: { connector, turnOf: (conversationId) => (conversationId === 'conv_1' ? 'task_7' : undefined) } });
    await set.dispatch('docs_update', { doc: 'plan', ref: { object: 'node', id: '.1' }, payload: { ops: [] } }, principal);
    expect(calls[0]).toMatchObject({ verb: 'update', dir, actor: { id: 'claude', name: 'Claude', conversation: 'conv_1', turn: 'task_7' } });
  });
});

describe('docs_upload', () => {
  it('工作目录里的文件交给连接器；图片给 markdown 图片写法，其他给链接', async () => {
    const dir = await writeDoc('plan');
    await fs.mkdir(path.join(root, 'images'));
    await fs.writeFile(path.join(root, 'images', 'chart.png'), 'png-bytes');
    await fs.writeFile(path.join(root, 'data.csv'), 'a,b\n1,2\n');
    const { connector, calls } = fakeConnector();
    const { scope, confirmed } = fakeScope();
    const set = tools(scope, connector);
    const image = (await set.dispatch('docs_upload', { doc: 'plan', path: 'images/chart.png' }, principal)) as Record<string, unknown>;
    expect(image).toMatchObject({ blob: 'blob/abc', bytes: 9, contentType: 'image/png' });
    expect(image.next).toEqual(expect.stringContaining('![<一句说明>](blob/abc)'));
    expect(calls[0]).toMatchObject({ verb: 'upload', dir, args: { bytes: 'png-bytes', contentType: 'image/png', name: 'chart.png' } });
    expect(confirmed[0]).toMatchObject({ tool: 'docs_upload', targets: [dir] });
    const csv = (await set.dispatch('docs_upload', { doc: 'plan', path: 'data.csv' }, principal)) as Record<string, unknown>;
    expect(csv.next).toEqual(expect.stringContaining('(blob/abc)'));
    expect(csv.next).not.toEqual(expect.stringContaining('!['));
  });

  it('要上传的文件：在工作目录里、普通文件、不经过符号链接、不超过上限', async () => {
    await writeDoc('plan');
    const { connector, calls } = fakeConnector();
    const set = tools(fakeScope().scope, connector);
    await fs.writeFile(path.join(tmp, 'secret.png'), 'x');
    await fs.symlink(path.join(tmp, 'secret.png'), path.join(root, 'link.png'));
    await fs.mkdir(path.join(root, 'folder'));
    const big = path.join(root, 'big.png');
    await fs.writeFile(big, '');
    await fs.truncate(big, DOCS_UPLOAD_MAX_BYTES + 1);
    const upload = (file: string) => rejected(set.dispatch('docs_upload', { doc: 'plan', path: file }, principal));
    expect(await upload('../secret.png')).toBe('PATH_OUTSIDE_WORKSPACE');
    expect(await upload(path.join(tmp, 'secret.png'))).toBe('PATH_OUTSIDE_WORKSPACE');
    expect(await upload('missing.png')).toBe('FILE_NOT_FOUND');
    expect(await upload('link.png')).toBe('PATH_IS_SYMLINK');
    expect(await upload('folder')).toBe('NOT_A_FILE');
    expect(await upload('big.png')).toBe('FILE_TOO_LARGE');
    expect(calls).toEqual([]);
  });
});

describe('docs_export', () => {
  it('不给 to：Markdown 放在结果里（只读），太长时截断并说明', async () => {
    await writeDoc('plan');
    const { connector, calls } = fakeConnector();
    const { scope, confirmed } = fakeScope({ write: false });
    await expect(tools(scope, connector).dispatch('docs_export', { doc: 'plan', tab: 'tab_1' }, principal)).resolves.toEqual({
      tabs: [{ id: 'tab_1', name: 'Untitled' }],
      markdown: '# Q3 Plan\n',
    });
    expect(calls[0]).toMatchObject({ verb: 'export', args: { tab: 'tab_1' } });
    expect(confirmed).toEqual([]);

    const long = fakeConnector({ markdown: 'x'.repeat(100_001) });
    const result = (await tools(scope, long.connector).dispatch('docs_export', { doc: 'plan' }, principal)) as Record<string, unknown>;
    expect(result).toMatchObject({ truncated: true });
    expect((result.markdown as string).length).toBe(100_000);
  });

  it('给 to：确认之后写成工作目录里的 .md，不覆盖已有文件', async () => {
    await writeDoc('plan');
    const { connector } = fakeConnector();
    const { scope, confirmed } = fakeScope();
    const set = tools(scope, connector);
    await expect(set.dispatch('docs_export', { doc: 'plan', to: 'out/plan.md' }, principal)).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKSPACE' });
    await fs.mkdir(path.join(root, 'out'));
    await expect(set.dispatch('docs_export', { doc: 'plan', to: 'out/plan.md' }, principal)).resolves.toMatchObject({ path: 'out/plan.md', bytes: 10 });
    expect(await fs.readFile(path.join(root, 'out', 'plan.md'), 'utf8')).toBe('# Q3 Plan\n');
    expect(confirmed.at(-1)).toMatchObject({ tool: 'docs_export', targets: [path.join(root, 'out', 'plan.md')] });
    expect(await rejected(set.dispatch('docs_export', { doc: 'plan', to: 'out/plan.md' }, principal))).toBe('FILE_EXISTS');
    expect(await rejected(set.dispatch('docs_export', { doc: 'plan', to: 'out/plan.txt' }, principal))).toBe('INVALID_ARGUMENTS');
    expect(await rejected(set.dispatch('docs_export', { doc: 'plan', to: '../plan.md' }, principal))).toBe('PATH_OUTSIDE_WORKSPACE');
    const readOnly = tools(fakeScope({ write: false }).scope, connector);
    expect(await rejected(readOnly.dispatch('docs_export', { doc: 'plan', to: 'out/other.md' }, principal))).toBe('PLAN_ONLY');
  });
});
