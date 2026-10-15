import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import http, { type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { createDocsConnector, type DocsConnector } from './connector.ts';
import { DocsServer } from './server.ts';

const actor = { id: 'claude', name: 'Agent' };
const INDEX = '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>';

let root: string;
let docDir: string;
let dist: string | null;
let canEdit: boolean;
let docs: DocsServer;
let connector: DocsConnector;
let httpServer: http.Server;
let origin: string;
let grant: string;
let project: { id: string; files: { id: string; content: { id: string } }[] };
const sockets: WebSocket[] = [];

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  json<T = Record<string, unknown>>(): T;
}

function request(method: string, url: string, options: { headers?: Record<string, string>; body?: Buffer | string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${origin}${url}`, { method, headers: options.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body, json: <T>() => JSON.parse(body.toString('utf8')) as T });
      });
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

interface Client {
  socket: WebSocket;
  frames: Record<string, unknown>[];
  next(match: (frame: Record<string, unknown>) => boolean, timeoutMs?: number): Promise<Record<string, unknown>>;
}

function connect(headers: Record<string, string> = {}): Promise<Client> {
  const socket = new WebSocket(`${origin.replace('http', 'ws')}/docs/${grant}/api/mux`, { headers });
  sockets.push(socket);
  const frames: Record<string, unknown>[] = [];
  const waiters: { match: (frame: Record<string, unknown>) => boolean; resolve: (frame: Record<string, unknown>) => void }[] = [];
  socket.on('message', (data) => {
    const frame = JSON.parse(String(data)) as Record<string, unknown>;
    frames.push(frame);
    for (const waiter of [...waiters]) {
      if (!waiter.match(frame)) continue;
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(frame);
    }
  });
  const client: Client = {
    socket,
    frames,
    next: (match, timeoutMs = 3000) =>
      new Promise((resolve, reject) => {
        const seen = frames.find(match);
        if (seen) return resolve(seen);
        const timer = setTimeout(() => reject(new Error('no matching frame')), timeoutMs);
        waiters.push({
          match,
          resolve: (frame) => {
            clearTimeout(timer);
            resolve(frame);
          },
        });
      }),
  };
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve(client));
    socket.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    socket.once('error', reject);
  });
}

function doorFrame(rid: number, kind: 'o' | 'b', body: unknown): Buffer {
  const label = Buffer.from(`~d:${rid}:${kind}:project/${project.id}`);
  const head = Buffer.alloc(2);
  head.writeUInt16LE(label.length);
  return Buffer.concat([head, label, Buffer.from(JSON.stringify(body))]);
}

const isTopic = (topic: string, kind?: string) => (frame: Record<string, unknown>) =>
  frame['op'] === 'msg' && frame['topic'] === topic && (kind === undefined || (JSON.parse(frame['data'] as string) as { kind?: string }).kind === kind);

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'baocut-docs-server-'));
  const built = path.join(root, 'dist');
  await mkdir(path.join(built, 'assets'), { recursive: true });
  await mkdir(path.join(built, 'artifact-type', 'fonts'), { recursive: true });
  await writeFile(path.join(built, 'index.html'), INDEX);
  await writeFile(path.join(built, 'assets', 'app.js'), 'console.log(1)');
  await writeFile(path.join(built, 'artifact-type', 'lfile-runtime.abc123.js'), 'export {}');
  await writeFile(path.join(built, 'artifact-type', 'fonts', 'icons.woff2'), 'font');
  await writeFile(path.join(root, 'secret.txt'), 'secret');
  dist = built;
  canEdit = true;
  docDir = path.join(root, 'plan');
  await mkdir(docDir);
  docs = new DocsServer({ editorDist: () => dist, userName: () => 'Jim' });
  connector = createDocsConnector(docs);
  await connector.batch(docDir, { container: { kind: 'project', create: { name: 'Plan', doc: { markdown: '# Plan\n\nAlpha beta gamma.' } } }, batch: [] }, actor);
  project = (await connector.read(docDir, {}, actor)) as typeof project;
  grant = await docs.open(docDir);
  httpServer = http.createServer((req, res) => {
    if (!docs.handle(req, res, { canEdit })) res.writeHead(404).end();
  });
  httpServer.on('upgrade', (req, socket, head) => {
    if (!docs.upgrade(req, socket, head, { canEdit })) socket.destroy();
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await docs.close();
  await new Promise((resolve) => httpServer.close(resolve));
  await rm(root, { recursive: true, force: true });
});

describe('页面与静态文件', () => {
  it('同一个目录复用 grant；不认识的 grant 404；没有结尾斜杠时 308', async () => {
    expect(await docs.open(docDir)).toBe(grant);
    expect((await request('GET', '/docs/AAAAAAAAAAAAAAAAAAAAAAAA/')).status).toBe(404);
    const redirect = await request('GET', `/docs/${grant}?lang=ja`);
    expect(redirect.status).toBe(308);
    expect(redirect.headers.location).toBe(`/docs/${grant}/?lang=ja`);
  });

  it('页面注入 base 与启动信息，带 CSP；project/<id> 也回同一个页面', async () => {
    const page = await request('GET', `/docs/${grant}/`);
    expect(page.status).toBe(200);
    const html = page.body.toString('utf8');
    expect(html).toContain(`<base href="/docs/${grant}/" />`);
    expect(html).toContain(`window.__BAOCUT_DOCS__={"projectId":"${project.id}","canEdit":true}`);
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    expect((await request('GET', `/docs/${grant}/project/${project.id}`)).status).toBe(200);
  });

  it('编辑器没构建时 503', async () => {
    dist = null;
    const page = await request('GET', `/docs/${grant}/`);
    expect(page.status).toBe(503);
  });

  it('静态文件：assets、运行时（哈希不对时用唯一的那个）、任意层级下的字体；不出构建目录', async () => {
    expect((await request('GET', `/docs/${grant}/assets/app.js`)).headers['content-type']).toContain('text/javascript');
    const runtime = await request('GET', `/docs/${grant}/api/lfile-runtime/ffff00`);
    expect(runtime.status).toBe(200);
    expect(runtime.body.toString()).toBe('export {}');
    expect((await request('GET', `/docs/${grant}/assets/artifact-type/fonts/icons.woff2`)).status).toBe(200);
    expect((await request('GET', `/docs/${grant}/..%2Fsecret.txt`)).status).toBe(404);
    expect((await request('GET', `/docs/${grant}/assets/%2E%2E/%2E%2E/secret.txt`)).status).toBe(404);
  });
});

describe('接口', () => {
  it('本机用户、功能开关、能力表、文档对象、权限、找人', async () => {
    expect((await request('GET', `/docs/${grant}/api/me`)).json()).toMatchObject({ name: 'Jim', flags: { values: { docFonts: true } } });
    expect((await request('GET', `/docs/${grant}/api/v3/manifest?brief=1`)).json()).toHaveProperty('caps');
    expect((await request('GET', `/docs/${grant}/api/v3/manifest`)).json()).toEqual({ door: { dialect: 'final' } });
    expect((await request('GET', `/docs/${grant}/api/object?name=projects/${project.id}`)).json()).toMatchObject({ id: project.id, displayName: 'Plan' });
    expect((await request('GET', `/docs/${grant}/api/object?name=projects/other`)).status).toBe(404);
    expect((await request('GET', `/docs/${grant}/api/v3/project/${project.id}/access`)).json()).toEqual({ access: 'owner' });
    canEdit = false;
    expect((await request('GET', `/docs/${grant}/api/v3/project/${project.id}/access`)).json()).toEqual({ access: 'viewer' });
    expect((await request('GET', `/docs/${grant}/api/v3/project/${project.id}/enums`)).json()).toEqual({ rows: [] });
    const people = (await request('GET', `/docs/${grant}/api/people/search?q=ji`)).json<{ hits: { name: string }[] }>();
    expect(people.hits.map((hit) => hit.name)).toContain('Jim');
    expect((await request('GET', `/docs/${grant}/api/v3/directory`)).json()).toEqual([{ id: project.id, name: 'Plan' }]);
    expect((await request('GET', `/docs/${grant}/api/mux`)).status).toBe(426);
  });

  it('素材：同源且可写才能上传，按 sha 取回', async () => {
    const bytes = Buffer.from([137, 80, 78, 71, 9, 9]);
    const cross = await request('POST', `/docs/${grant}/api/blob`, { headers: { Origin: 'http://evil.example', 'Content-Type': 'image/png' }, body: bytes });
    expect(cross.status).toBe(403);
    canEdit = false;
    expect((await request('POST', `/docs/${grant}/api/blob`, { headers: { 'Content-Type': 'image/png' }, body: bytes })).status).toBe(403);
    canEdit = true;
    const uploaded = await request('POST', `/docs/${grant}/api/blob`, { headers: { Origin: origin, 'Content-Type': 'image/png' }, body: bytes });
    expect(uploaded.status).toBe(200);
    const { sha } = uploaded.json<{ sha: string }>();
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    const served = await request('GET', `/docs/${grant}/api/blob/${sha}`);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.body.equals(bytes)).toBe(true);
    expect((await request('GET', `/docs/${grant}/api/blob/${'0'.repeat(64)}`)).status).toBe(404);
  });

  it('door 的 HTTP 后备：读文档；只读会话写入被拒', async () => {
    const read = await request('POST', `/docs/${grant}/api/v3/door/project/${project.id}`, { body: JSON.stringify({ verb: 'read', ref: { object: 'project', id: project.id } }) });
    expect(read.json()).toMatchObject({ verdict: 'allow' });
    canEdit = false;
    const write = await request('POST', `/docs/${grant}/api/v3/door/project/${project.id}`, {
      body: JSON.stringify({ verb: 'update', ref: { object: 'project', id: project.id }, payload: { kind: 'patch', patch: [{ op: 'set', path: ['name'], value: 'X' }] } }),
    });
    expect(write.json()).toMatchObject({ verdict: 'deny', reason: 'forbidden' });
    const cross = await request('POST', `/docs/${grant}/api/v3/door/project/${project.id}`, { headers: { Origin: 'http://evil.example' }, body: '{}' });
    expect(cross.status).toBe(403);
  });

  it('编辑器读正文时，智能体写的评论与回复带 via（编辑器据此显示为智能体），人写的不带', async () => {
    const node = project.files[0]!.content.id;
    const door = (body: unknown) => request('POST', `/docs/${grant}/api/v3/door/project/${project.id}`, { headers: { Origin: origin }, body: JSON.stringify(body) });
    const asked = await door({ verb: 'create', object: 'utterance', payload: { value: { body: 'Is gamma right?', parent: { object: 'node', id: node } } } });
    const thread = asked.json<{ verdict: string; id: string }>();
    expect(thread.verdict).toBe('allow');
    await connector.create(docDir, { object: 'utterance', payload: { value: { parent: { object: 'utterance', id: thread.id }, body: 'Yes.' } } }, actor);
    await connector.create(docDir, { object: 'utterance', payload: { value: { parent: { object: 'node', id: node, anchor: { kind: 'find', text: 'beta' } }, body: 'Tighten.' } } }, actor);
    const read = (await door({ verb: 'read', ref: { object: 'node', id: node } })).json<{ data: { comments: { body: string; by: string; via: string | null; replies: { body: string; via?: string }[] }[] } }>();
    const byBody = Object.fromEntries(read.data.comments.map((comment) => [comment.body, comment]));
    expect(byBody['Is gamma right?']).toMatchObject({ by: 'me@baocut.local', via: null, replies: [{ body: 'Yes.', via: 'mcp' }] });
    expect(byBody['Tighten.']).toMatchObject({ by: 'claude', via: 'mcp' });
  });

  it('没带 to 的评论以 @Agent（以前的文档里是 @Claude）开头时算问智能体的', async () => {
    const node = project.files[0]!.content.id;
    const door = (body: unknown) => request('POST', `/docs/${grant}/api/v3/door/project/${project.id}`, { headers: { Origin: origin }, body: JSON.stringify(body) });
    for (const body of ['@Agent\u2060 Tighten gamma', '@claude tighten beta', 'Tighten alpha']) {
      expect((await door({ verb: 'create', object: 'utterance', payload: { value: { body, parent: { object: 'node', id: node } } } })).json()).toMatchObject({ verdict: 'allow' });
    }
    const query = (await door({ verb: 'query', object: 'utterance', payload: { under: { object: 'project', id: project.id } } })).json<{ data: { rows: { payload: { value: { body: string } }; to?: string }[] } }>();
    expect(Object.fromEntries(query.data.rows.map((row) => [row.payload.value.body, row.to ?? null]))).toEqual({
      '@Agent\u2060 Tighten gamma': 'claude',
      '@claude tighten beta': 'claude',
      'Tighten alpha': null,
    });
  });

  it('批注说明：挂在原文上的是评论（标签页名 › 原文），路径不对 404', async () => {
    const tab = project.files[0]!;
    const comment = (await connector.create(
      docDir,
      { object: 'utterance', payload: { value: { parent: { object: 'node', id: tab.content.id, anchor: { kind: 'find', text: 'gamma' } }, body: 'Check' } } },
      actor,
    )) as { id: string };
    const annotation = `f-${tab.id}#${tab.content.id}/x.1@0-5;thread=${comment.id}`;
    const info = await request('GET', `/docs/${grant}/api/baocut/annotation?path=${encodeURIComponent(annotation)}`);
    expect(info.json()).toEqual({ kind: 'comment', label: 'Plan › "gamma"', quote: 'gamma' });
    expect((await request('GET', `/docs/${grant}/api/baocut/annotation?path=${encodeURIComponent(`f-${tab.id}#${tab.content.id};thread=nope`)}`)).status).toBe(404);
  });
});

describe('mux', () => {
  it('room 先发索引与各值再 ready；chat 有空闲帧；ping 回 pong', async () => {
    const client = await connect();
    client.socket.send(JSON.stringify({ op: 'sub', topic: `room:project/${project.id}` }));
    client.socket.send(JSON.stringify({ op: 'sub', topic: 'chat' }));
    client.socket.send(JSON.stringify({ op: 'ping' }));
    const index = await client.next(isTopic(`room:project/${project.id}`, 'index'));
    expect(JSON.parse(index['data'] as string)).toMatchObject({ v: 1, refs: expect.arrayContaining([{ ref: `project/${project.id}`, engine: 'json' }]) });
    await client.next(isTopic(`room:project/${project.id}`, 'ready'));
    expect(client.frames.filter(isTopic(`room:project/${project.id}`, 'sync')).length).toBeGreaterThanOrEqual(2);
    expect(await client.next(isTopic('chat'))).toMatchObject({ data: { running: false } });
    await client.next((frame) => frame['op'] === 'pong');
  });

  it('door 调用回 doorack；别的连接从 feed 收到新修订，发起的连接不收', async () => {
    const editor = await connect();
    const watcher = await connect();
    const feed = `feed:project/${project.id}`;
    for (const client of [editor, watcher]) client.socket.send(JSON.stringify({ op: 'sub', topic: feed }));
    await editor.next((frame) => frame['op'] === 'ack' && frame['topic'] === feed);
    await watcher.next((frame) => frame['op'] === 'ack' && frame['topic'] === feed);

    const node = project.files[0]!.content.id;
    editor.socket.send(doorFrame(7, 'o', { verb: 'read', ref: { object: 'node', id: node } }));
    const read = await editor.next((frame) => frame['op'] === 'doorack' && frame['rid'] === 7);
    const value = JSON.parse(read['body'] as string) as { verdict: string; value?: { blocks?: { items?: { id: string }[] }[] } };
    expect(value.verdict).toBe('allow');
    const xml = ((await connector.read(docDir, { ref: { object: 'node', id: node } }, actor)) as { xml: string }).xml;
    const prefix = /id='([a-z0-9]+)\./.exec(xml)![1]!;
    const firstChar = /<text id='([^']+)'>Alpha/.exec(xml)![1]!;
    const charId = firstChar.startsWith('.') ? prefix + firstChar : firstChar;

    editor.socket.send(
      doorFrame(8, 'o', {
        verb: 'update',
        ref: { object: 'node', id: node },
        opId: 'op-1',
        payload: { ops: [{ op: 'insert', target: { kind: 'chars', range: [charId, charId] }, side: 'before', source: { from: { kind: 'inline', content: '>' }, as: 'text' } }] },
      }),
    );
    const ack = await editor.next((frame) => frame['op'] === 'doorack' && frame['rid'] === 8);
    expect(JSON.parse(ack['body'] as string)).toMatchObject({ verdict: 'allow' });
    const envelope = await watcher.next(isTopic(feed));
    const data = JSON.parse(envelope['data'] as string) as { ev: string; data: { opId?: string; diff: { address: { ref: { object: string; id: string } } }[] } };
    expect(data).toMatchObject({ ev: 'envelope', data: { opId: 'op-1', diff: [{ address: { ref: { object: 'node', id: node } } }] } });
    expect(editor.frames.some(isTopic(feed))).toBe(false);
    const after = (await connector.read(docDir, { ref: { object: 'node', id: node } }, actor)) as { xml: string };
    expect(after.xml).toContain('>Alpha');
  });

  it('同一个 opId 重发（编辑器重新打开后从本地日志重放）只生效一次：回上次的回执，不再写、不再通知', async () => {
    const node = project.files[0]!.content.id;
    const xml = ((await connector.read(docDir, { ref: { object: 'node', id: node } }, actor)) as { xml: string }).xml;
    const prefix = /id='([a-z0-9]+)\./.exec(xml)![1]!;
    const firstChar = /<text id='([^']+)'>Alpha/.exec(xml)![1]!;
    const charId = firstChar.startsWith('.') ? prefix + firstChar : firstChar;
    const insert = (opId: string, content: string) => ({
      verb: 'update',
      ref: { object: 'node', id: node },
      opId,
      payload: { ops: [{ op: 'insert', target: { kind: 'chars', range: [charId, charId] }, side: 'before', source: { from: { kind: 'inline', content }, as: 'text' } }] },
    });
    const count = async (text: string) =>
      ((await connector.read(docDir, { ref: { object: 'node', id: node } }, actor)) as { xml: string }).xml.split(text).length - 1;

    const before = await connect();
    before.socket.send(doorFrame(1, 'o', insert('ln-body.a.0', '§')));
    const first = JSON.parse((await before.next((frame) => frame['op'] === 'doorack' && frame['rid'] === 1))['body'] as string) as unknown;
    expect(first).toMatchObject({ verdict: 'allow', changed: true });
    before.socket.close();

    const watcher = await connect();
    const feed = `feed:project/${project.id}`;
    watcher.socket.send(JSON.stringify({ op: 'sub', topic: feed }));
    await watcher.next((frame) => frame['op'] === 'ack' && frame['topic'] === feed);
    const reopened = await connect();
    reopened.socket.send(doorFrame(1, 'o', insert('ln-body.a.0', '§')));
    const again = JSON.parse((await reopened.next((frame) => frame['op'] === 'doorack' && frame['rid'] === 1))['body'] as string) as unknown;
    expect(again).toEqual(first);
    expect(await count('§')).toBe(1);

    // batch 成员同样按 opId 认；被拒的不记，同一个 opId 之后照常生效
    const batch = { batch: [insert('ln-body.a.1', '¶')] };
    reopened.socket.send(doorFrame(2, 'b', batch));
    await reopened.next((frame) => frame['op'] === 'doorack' && frame['rid'] === 2);
    reopened.socket.send(doorFrame(3, 'b', batch));
    const batchAgain = JSON.parse((await reopened.next((frame) => frame['op'] === 'doorack' && frame['rid'] === 3))['body'] as string) as unknown;
    expect(batchAgain).toMatchObject({ verdict: 'allow', acks: [{ verdict: 'allow' }] });
    expect(await count('¶')).toBe(1);
    reopened.socket.send(doorFrame(4, 'o', { ...insert('ln-body.a.2', '†'), ref: { object: 'node', id: 'missing' } }));
    expect(JSON.parse((await reopened.next((frame) => frame['op'] === 'doorack' && frame['rid'] === 4))['body'] as string)).toMatchObject({ verdict: 'deny' });
    reopened.socket.send(doorFrame(5, 'o', insert('ln-body.a.2', '†')));
    expect(JSON.parse((await reopened.next((frame) => frame['op'] === 'doorack' && frame['rid'] === 5))['body'] as string)).toMatchObject({ verdict: 'allow' });
    expect(await count('†')).toBe(1);

    // 只有真正写入的那几次通知开着的编辑器：重发的两次不算
    await watcher.next(isTopic(feed));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(watcher.frames.filter(isTopic(feed))).toHaveLength(2);
  });

  it('智能体经连接器回复评论：开着的编辑器从 feed 收到这个线程的通知', async () => {
    const editor = await connect();
    const feed = `feed:project/${project.id}`;
    editor.socket.send(JSON.stringify({ op: 'sub', topic: feed }));
    await editor.next((frame) => frame['op'] === 'ack' && frame['topic'] === feed);
    const node = project.files[0]!.content.id;
    editor.socket.send(doorFrame(3, 'o', { verb: 'create', object: 'utterance', opId: 'c-1', payload: { value: { body: 'Is gamma right?', parent: { object: 'node', id: node } } } }));
    const asked = JSON.parse((await editor.next((frame) => frame['op'] === 'doorack' && frame['rid'] === 3))['body'] as string) as { verdict: string; id: string };
    expect(asked.verdict).toBe('allow');
    const before = editor.frames.filter(isTopic(feed)).length;
    await connector.create(docDir, { object: 'utterance', payload: { value: { parent: { object: 'utterance', id: asked.id }, body: 'Yes.' } } }, actor);
    await vi.waitFor(() => expect(editor.frames.filter(isTopic(feed)).length).toBeGreaterThan(before));
    const last = JSON.parse(editor.frames.filter(isTopic(feed)).at(-1)!['data'] as string) as {
      data: { actor: object; diff: { address: { ref: { object: string; id: string } } }[] };
    };
    expect(last.data.diff[0]!.address.ref).toEqual({ object: 'utterance', id: asked.id });
    // 编辑器只把 external + via mcp 认作智能体
    expect(last.data.actor).toEqual({ principal: 'claude', channel: 'external', via: 'mcp' });
  });

  it('跨源的升级被拒', async () => {
    await expect(connect({ Origin: 'http://evil.example' })).rejects.toThrow('HTTP 404');
  });
});
