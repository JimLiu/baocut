import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDocsConnector, DocsRefusal, type DocsActor, type DocsConnector } from './connector.ts';
import { DocsServer } from './server.ts';
import type { VersionSummary } from './versions.ts';

const MINUTE = 60_000;
const agent = (turn?: string): DocsActor => ({ id: 'claude', name: 'Agent', conversation: 'c-1', ...(turn ? { turn } : {}) });

let root: string;
let dir: string;
let clock: number;
let server: DocsServer;
let docs: DocsConnector;
let project: { id: string; files: { id: string; content: { id: string } }[] };
let ref: { object: string; id: string };

function start(): void {
  server = new DocsServer({ editorDist: () => null, userName: () => 'Jim', now: () => clock });
  docs = createDocsConnector(server);
}

/** 在正文末尾加一段：每次落下一个新 rev。 */
async function append(text: string, actor: DocsActor = agent('t-1')): Promise<void> {
  await docs.update(dir, { ref, payload: { ops: [{ op: 'insert', target: { kind: 'root' }, side: 'end', source: { from: { kind: 'inline', content: text }, as: 'markdown' } }] } }, actor);
}

async function versions(): Promise<{ rev: number; versions: VersionSummary[] }> {
  return (await docs.read(dir, { ref, payload: { kind: 'versions' } }, agent())) as { rev: number; versions: VersionSummary[] };
}

async function refusal(work: Promise<unknown>): Promise<DocsRefusal> {
  try {
    await work;
  } catch (error) {
    if (error instanceof DocsRefusal) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'baocut-docs-versions-'));
  dir = path.join(root, 'plan');
  await mkdir(dir);
  clock = Date.parse('2026-10-18T10:00:00.000Z');
  start();
  await docs.batch(dir, { container: { kind: 'project', create: { name: 'Plan', doc: { markdown: '# Plan\n\nAlpha.\n\n## Risks\n\nBeta.' } } }, batch: [] }, agent('t-1'));
  project = (await docs.read(dir, {}, agent())) as typeof project;
  ref = { object: 'node', id: project.files[0]!.content.id };
});

afterEach(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});

describe('分版', () => {
  it('新建落下第一版；同一回合 5 分钟内的改动并进还开着的那一版', async () => {
    const born = await versions();
    expect(born.versions).toEqual([expect.objectContaining({ n: 1, baseRev: 1, rev: born.rev, open: true, by: [{ name: 'Agent', channel: 'agent', conversation: 'c-1' }] })]);
    clock += 4 * MINUTE;
    await append('Gamma.');
    const later = await versions();
    expect(later.versions).toHaveLength(1);
    expect(later.versions[0]).toMatchObject({ n: 1, rev: later.rev, start: '2026-10-18T10:00:00.000Z', end: '2026-10-18T10:04:00.000Z', open: true });
  });

  it('智能体的新回合另开一版；同一回合、没有回合的改动不分', async () => {
    const first = (await versions()).rev;
    clock += MINUTE;
    await append('Gamma.', agent('t-2'));
    clock += MINUTE;
    await append('Delta.', agent('t-2'));
    clock += MINUTE;
    await append('Epsilon.', agent());
    const { rev, versions: list } = await versions();
    expect(list.map((version) => version.n)).toEqual([2, 1]);
    expect(list[1]).toMatchObject({ n: 1, rev: first, cut: 'turn' });
    expect(list[1]!.open).toBeUndefined();
    expect(list[0]).toMatchObject({ n: 2, baseRev: first, rev, open: true });
  });

  it('安静满 5 分钟另开一版；一直在改时满 30 分钟另开一版', async () => {
    clock += 5 * MINUTE;
    await append('Gamma.');
    expect((await versions()).versions[1]).toMatchObject({ n: 1, cut: 'quiet' });
    for (let step = 0; step < 8; step++) {
      clock += 4 * MINUTE;
      await append(`Step ${step}.`);
    }
    const list = (await versions()).versions;
    expect(list.map((version) => [version.n, version.cut ?? null])).toEqual([
      [3, null],
      [2, 'max'],
      [1, 'quiet'],
    ]);
    expect(list[1]).toMatchObject({ start: '2026-10-18T10:05:00.000Z', end: '2026-10-18T10:33:00.000Z' });
  });

  it('最多留 10 个版本，删最旧的', async () => {
    for (let turn = 2; turn <= 12; turn++) {
      clock += MINUTE;
      await append(`Turn ${turn}.`, agent(`t-${turn}`));
    }
    const list = (await versions()).versions;
    expect(list.map((version) => version.n)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    expect(list[list.length - 1]!.changed).toBeUndefined();
  });

  it('列版本时给出和前一版比改了几块、在哪几节', async () => {
    clock += MINUTE;
    await append('Gamma.', agent('t-2'));
    const [latest, first] = (await versions()).versions;
    expect(latest).toMatchObject({ n: 2, changed: 1, sections: ['Risks'] });
    expect(first!.changed).toBeUndefined();
  });

  it('被拒的 batch 不动版本表', async () => {
    const before = await versions();
    clock += MINUTE;
    const insert = { op: 'insert', target: { kind: 'root' }, side: 'end', source: { from: { kind: 'inline', content: 'Gamma.' }, as: 'markdown' } };
    const failed = await refusal(
      docs.batch(
        dir,
        {
          container: { kind: 'project', id: project.id },
          batch: [
            { verb: 'update', ref, payload: { ops: [insert] } },
            { verb: 'update', ref, payload: { ops: [{ op: 'delete', target: { kind: 'find', text: 'zeta' } }] } },
          ],
        },
        agent('t-2'),
      ),
    );
    expect(failed.code).toBeTruthy();
    expect(await versions()).toEqual(before);
  });
});

describe('回到版本', () => {
  it('回到的那一版单独成一版，生来收口；前一版记成因回到版本收口，之后的改动另开一版', async () => {
    const first = (await versions()).rev;
    clock += MINUTE;
    await append('Gamma.', agent('t-2'));
    const current = (await versions()).rev;
    clock += MINUTE;
    const restored = (await docs.update(dir, { ref, payload: { ifRev: current, ops: [{ op: 'restore', rev: first }] } }, agent('t-2'))) as { xml: string };
    expect(restored.xml).not.toContain('Gamma.');
    let list = (await versions()).versions;
    expect(list.map((version) => [version.n, version.cut ?? null, version.restoredFrom ?? null, version.open ?? null])).toEqual([
      [3, null, first, null],
      [2, 'restore', null, null],
      [1, 'turn', null, null],
    ]);
    expect(list[0]).toMatchObject({ changed: 1, sections: ['Risks'] });
    clock += MINUTE;
    await append('Delta.', agent('t-2'));
    list = (await versions()).versions;
    expect(list[0]).toMatchObject({ n: 4, open: true, baseRev: list[1]!.rev });
  });

  it('收口的版本超出 50 个 rev 之后，atRev 与 restore 仍然读得到', async () => {
    const first = (await versions()).rev;
    clock += MINUTE;
    for (let step = 0; step < 55; step++) await append(`Step ${step}.`, agent('t-2'));
    const old = (await docs.read(dir, { ref, payload: { atRev: first } }, agent())) as { xml: string };
    expect(old.xml).toContain('Beta.');
    expect(old.xml).not.toContain('Step 0.');
    const latest = (await versions()).rev;
    const restored = (await docs.update(dir, { ref, payload: { ifRev: latest, ops: [{ op: 'restore', rev: first }] } }, agent('t-2'))) as { xml: string };
    expect(restored.xml).not.toContain('Step 0.');
  });
});

describe('存盘', () => {
  const versionsPath = () => path.join(dir, 'tabs', `${ref.id}.versions.json`);

  it('关掉再打开：版本还在，还开着的那一版 5 分钟内接着并', async () => {
    clock += MINUTE;
    await append('Gamma.', agent('t-2'));
    const before = await versions();
    expect(JSON.parse(await readFile(versionsPath(), 'utf8'))).toMatchObject({ versions: [{ n: 1 }, { n: 2 }] });
    await server.close();
    start();
    expect(await versions()).toEqual(before);
    clock += MINUTE;
    await append('Delta.', agent('t-2'));
    expect((await versions()).versions.map((version) => version.n)).toEqual([2, 1]);
  });

  it('有版本记录之前的文档：现在的正文记成收口的第一版', async () => {
    clock += MINUTE;
    await append('Gamma.');
    const rev = (await versions()).rev;
    await server.close();
    await rm(versionsPath());
    start();
    const legacy = (await versions()).versions;
    expect(legacy).toEqual([expect.objectContaining({ n: 1, baseRev: rev, rev, by: [] })]);
    expect(legacy[0]!.open).toBeUndefined();
    clock += MINUTE;
    await append('Delta.');
    expect((await versions()).versions[0]).toMatchObject({ n: 2, baseRev: rev, open: true });
  });

  it('删掉标签页连同它的版本文件', async () => {
    await docs.batch(
      dir,
      {
        container: { kind: 'project', id: project.id },
        batch: [
          { $lid: 'f', verb: 'create', object: 'file', payload: { value: { birthName: 'Notes.ldoc' } } },
          { $lid: 'n', verb: 'create', object: 'node', engine: 'prose', payload: { parent: { object: 'file', id: '$lid:f' }, source: { as: 'markdown', from: { kind: 'inline', content: '# Notes' } } } },
          { verb: 'update', ref: { object: 'file', id: '$lid:f' }, payload: { kind: 'value', value: { birthName: 'Notes.ldoc', content: { kind: 'node', id: '$lid:n' } } } },
          { verb: 'update', ref: { object: 'project', id: project.id }, payload: { kind: 'patch', patch: [{ op: 'set', path: ['tabs', '$lid:f'], value: { name: 'Notes', order: 'a1' } }] } },
        ],
      },
      agent('t-2'),
    );
    await access(versionsPath());
    await docs.batch(dir, { container: { kind: 'project', id: project.id }, batch: [{ verb: 'delete', ref: { object: 'file', id: project.files[0]!.id } }] }, agent('t-2'));
    await expect(access(versionsPath())).rejects.toThrow();
  });
});

describe('编辑器的版本接口', () => {
  let httpServer: http.Server;
  let origin: string;
  let grant: string;
  let canEdit: boolean;
  let tab: string;

  const base = () => `/docs/${grant}/api/v3/project/${project.id}/file/${tab}`;

  function request(method: string, url: string, headers: Record<string, string> = {}): Promise<{ status: number; json<T>(): T }> {
    return new Promise((resolve, reject) => {
      const req = http.request(`${origin}${url}`, { method, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: <T>() => JSON.parse(Buffer.concat(chunks).toString('utf8')) as T }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  beforeEach(async () => {
    canEdit = true;
    tab = project.files[0]!.id;
    grant = await server.open(dir);
    httpServer = http.createServer((req, res) => {
      if (!server.handle(req, res, { canEdit })) res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
    clock += MINUTE;
    await append('Gamma.', agent('t-2'));
  });

  afterEach(async () => {
    await new Promise((resolve) => httpServer.close(resolve));
  });

  it('history：每个版本一行，新的在前，都带 checkpoint；before 只要更早的', async () => {
    const rows = (await request('GET', `${base()}/history`)).json<{ id: string; tool: string; at: string; actor: string; params: Record<string, unknown> }[]>();
    expect(rows.map((row) => row.params['upto'])).toEqual([2, 1]);
    expect(rows[0]).toMatchObject({
      id: `v3:${project.id}:${tab}:2`,
      tool: 'v3.checkpoint',
      actor: 'agent:claude',
      at: '2026-10-18T10:01:00.000Z',
      params: { key: `node/${ref.id}`, upto: 2, checkpoint: { stored: true }, cause: 'current', contributors: [{ user: 'claude', actor: 'agent:claude' }] },
    });
    expect(rows[1]!.params['cause']).toBeUndefined();
    expect((await request('GET', `${base()}/history?before=2`)).json<unknown[]>()).toHaveLength(1);
  });

  it('at：那一版结束时的正文（编辑器读的 XML）', async () => {
    const first = (await request('GET', `${base()}/at/1`)).json<{ xml: string }>();
    expect(first.xml).toContain('Beta.');
    expect(first.xml).not.toContain('Gamma.');
    expect((await request('GET', `${base()}/at/2`)).json<{ xml: string }>().xml).toContain('Gamma.');
  });

  it('restore：换成那一版、记成人回到的一版；和现在一样时不改', async () => {
    const back = await request('POST', `${base()}/restore/1`, { Origin: origin });
    expect(back.status).toBe(200);
    expect(back.json()).toMatchObject({ restored: true });
    const list = (await versions()).versions;
    expect(list[0]).toMatchObject({ n: 3, restoredFrom: list[2]!.rev, by: [{ name: 'Jim', channel: 'human' }] });
    expect(list[1]).toMatchObject({ n: 2, cut: 'restore' });
    const rows = (await request('GET', `${base()}/history`)).json<{ params: { restoredFrom?: number; cause?: string } }[]>();
    expect(rows[0]!.params).toMatchObject({ restoredFrom: list[2]!.rev, cause: 'current' });
    expect(rows[1]!.params.cause).toBeUndefined();
    expect((await request('POST', `${base()}/restore/3`)).json()).toMatchObject({ restored: false });
    expect((await versions()).versions).toHaveLength(3);
  });

  it('restore 要能编辑、同源；不认识的文档、标签页、版本 404，方法不对 405', async () => {
    expect((await request('POST', `${base()}/restore/1`, { Origin: 'http://evil.example' })).status).toBe(403);
    canEdit = false;
    expect((await request('POST', `${base()}/restore/1`)).status).toBe(403);
    expect((await request('GET', `${base()}/history`)).status).toBe(200);
    expect((await request('GET', `/docs/${grant}/api/v3/project/other/file/${tab}/history`)).status).toBe(404);
    expect((await request('GET', `/docs/${grant}/api/v3/project/${project.id}/file/missing/history`)).status).toBe(404);
    expect((await request('GET', `${base()}/at/9`)).status).toBe(404);
    expect((await request('POST', `${base()}/history`)).status).toBe(405);
    expect((await request('GET', `${base()}/restore/1`)).status).toBe(405);
    expect((await versions()).versions).toHaveLength(2);
  });
});
