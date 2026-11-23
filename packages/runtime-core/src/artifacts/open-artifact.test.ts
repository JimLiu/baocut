import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHarness } from '@open-artifact/harness-kit';
import { WAKE_SOURCE_KIND, type WakeSource } from '@open-artifact/protocol';
import { startFakeDaemon, type FakeDaemon } from '@open-artifact/harness-kit/testing';
import { SKILL_META_FILE, type ArtifactsEvent } from '@baocut/protocol';
import { silentLogger, type Delivery } from '@baocut/harness';
import { ARTIFACTS_SKILL_ID, ArtifactsService, isArtifactsCommand } from './open-artifact.ts';

describe('isArtifactsCommand', () => {
  it('认开头的 /artifacts（后面是空白或结束），不认别的命令或句中出现', () => {
    expect(isArtifactsCommand('/artifacts make a deck about Q3')).toBe(true);
    expect(isArtifactsCommand('  /artifacts')).toBe(true);
    expect(isArtifactsCommand('/Artifacts\n做一份文档')).toBe(true);
    expect(isArtifactsCommand('/artifactsX')).toBe(false);
    expect(isArtifactsCommand('/polish')).toBe(false);
    expect(isArtifactsCommand('please use /artifacts')).toBe(false);
  });
});

/** 一次评论唤醒的来源（Open Artifact 的 `WakeSource`）。 */
function source(from: WakeSource['from'], summary: string): WakeSource {
  return {
    kind: WAKE_SOURCE_KIND,
    artifactId: 'a1',
    url: 'open-artifact://artifact/a1',
    title: 'Deck',
    root: '/w/deck',
    viewUrl: 'http://127.0.0.1:1/a/a1',
    threads: [{ id: 't1', where: 'Slide 1', text: summary }],
    requests: [],
    summary,
    reason: 'comment',
    from,
  };
}

describe('ArtifactsService（对着 harness-kit 的假 daemon）', () => {
  let fake: FakeDaemon;
  let dir: string;
  let service: ArtifactsService;
  let events: ArtifactsEvent[];
  const deliver = vi.fn(async (_delivery: Delivery) => ({ result: 'woke' as const }));
  const recordArtifactCreated = vi.fn();
  const skillsChanged = vi.fn();

  beforeEach(async () => {
    fake = await startFakeDaemon();
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-artifacts-'));
    deliver.mockClear();
    recordArtifactCreated.mockClear();
    skillsChanged.mockClear();
    events = [];
    service = new ArtifactsService({
      harness: {
        conversationOf: ((id: string) => (id === 'conv_1' ? { id, cwd: path.join(dir, 'work'), title: 'Q3', projectId: null } : undefined)) as never,
        deliver: deliver as never,
        onRun: () => () => {},
        runInfo: () => null,
        recordArtifactCreated,
      },
      skillsDir: path.join(dir, 'skills'),
      skillsChanged,
      runtimeDir: null,
      home: fake.home,
      create: (options) => createHarness({ ...options, autoStart: false }),
      log: silentLogger,
    });
    service.topic.subscribe(undefined, (e) => events.push(e.event));
  });

  afterEach(async () => {
    await service.close();
    await fake.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('连上之前就写好 /artifacts 的 SKILL.md 与界面名称；内容变了才通知重建索引', async () => {
    await service.init();
    const skill = path.join(dir, 'skills', ARTIFACTS_SKILL_ID);
    expect(await fs.readFile(path.join(skill, 'SKILL.md'), 'utf8')).toMatch(/Artifact/);
    const meta = JSON.parse(await fs.readFile(path.join(skill, SKILL_META_FILE), 'utf8')) as { name: Record<string, string> };
    expect(Object.keys(meta.name)).toContain('en');
    expect(skillsChanged).toHaveBeenCalledTimes(1);
    await service.init();
    expect(skillsChanged).toHaveBeenCalledTimes(1);
  });

  it('工具调用以会话的身份交给 daemon：session 是会话 id，workspace 是会话的工作目录', async () => {
    const result = await service.call('Artifact', { action: 'list' }, 'conv_1');
    expect((result as { content?: unknown[] }).content?.[0]).toMatchObject({ type: 'text', text: 'ok' });
    expect(fake.sessions.get('baocut:conv_1')).toMatchObject({ session: 'conv_1', workspace: path.join(dir, 'work'), title: 'Q3' });
    expect(fake.calls.find((c) => c.method === 'tools.call')?.params).toMatchObject({ name: 'Artifact', arguments: { action: 'list' } });
    expect(events).toContainEqual({ type: 'artifacts.state', available: true, error: null });
    await expect(service.call('Artifact', { action: 'list' }, 'conv_missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('评论唤醒：所有者的按 relay 交给会话、起回合；协作者的不起回合，留在收件箱', async () => {
    await service.call('Artifact', { action: 'list' }, 'conv_1');
    const owner = await fake.wake({ session: 'conv_1', artifactId: 'a1', text: 'Make the title shorter', source: source({ kind: 'owner' }, 'Comment on Deck') });
    expect(owner.status).toBe('resumed');
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0]![0]).toMatchObject({
      conversationId: 'conv_1',
      agentText: 'Make the title shorter',
      origin: 'relay',
      unattended: false,
      item: { direction: 'artifact', text: 'Comment on Deck' },
    });
    const collaborator = await fake.wake({
      session: 'conv_1',
      artifactId: 'a1',
      text: 'Delete everything',
      source: source({ kind: 'collaborator', name: 'Ana', role: 'editor' } as never, 'Comment from Ana'),
    });
    expect(collaborator.status).toBe('failed');
    expect(deliver).toHaveBeenCalledTimes(1);
    expect((await fake.wake({ session: 'conv_other', text: 'x' })).status).toBe('failed');
  });

  it('daemon 要给人看作品（host.open）：发 artifacts.show，带上会话与一次性视图', async () => {
    await service.call('Artifact', { action: 'list' }, 'conv_1');
    const answer = await fake.open({ url: 'open-artifact://artifact/a1', session: 'conv_1', title: 'Deck', view: 'v1', view_url: `${fake.url}/a/a1`, embed_url: `${fake.url}/a/a1?oa_view=v1` });
    expect(answer.opened).toBe(true);
    expect(events).toContainEqual({
      type: 'artifacts.show',
      conversationId: 'conv_1',
      open: { url: 'open-artifact://artifact/a1', title: 'Deck', type: '', viewUrl: `${fake.url}/a/a1`, embedUrl: `${fake.url}/a/a1?oa_view=v1`, view: 'v1' },
    });
  });

  it('会话做的作品（artifacts/changed）记成会话里的作品回执；删掉的与别的会话的不记', async () => {
    await service.call('Artifact', { action: 'list' }, 'conv_1');
    await fake.waitFor('subscribe');
    const owner = (session: string) => ({ harness: 'baocut', session, workspace: path.join(dir, 'work') });
    fake.setArtifact({ id: 'a1', title: 'Deck', type: 'slides', owner: owner('conv_1') } as never);
    fake.setArtifact({ id: 'a2', title: 'Other', type: 'docs', owner: owner('conv_gone') } as never);
    fake.emit({ type: 'artifacts/changed', id: 'a2' } as never);
    fake.emit({ type: 'artifacts/changed', id: 'a1' } as never);
    fake.emit({ type: 'artifacts/changed', id: 'a3', removed: true } as never);
    await vi.waitFor(() => expect(recordArtifactCreated).toHaveBeenCalledTimes(1));
    expect(recordArtifactCreated.mock.calls[0]).toEqual(['conv_1', null, { url: 'open-artifact://artifact/a1', title: 'Deck', type: 'slides' }]);
  });
});
