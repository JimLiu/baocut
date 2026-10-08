import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient } from '@baocut/client';
import { newId, type Id, type Project } from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';
import { startRuntime, type RunningRuntime } from '../runtime.ts';
import { ToolDriver, tool, until, type ToolSession } from './testing/fake-agent.ts';

/**
 * 端到端：任务合同的保护范围（架构设计 §3.2）。假智能体经真实的 MCP 端点读合同、改视频，检查落在真实的 Rust 引擎里：
 * 智能体触碰保护的修改整笔拒绝（`TASK_PROTECTED`），用户的修改不受限制，合同修改之后的提交按新的范围检查。
 * 需要 engine-host 与 ffmpeg，缺了就跳过。
 */

const engine = resolveEngineHostCommand();
const ffmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!engine || !ffmpeg)('任务合同的工具与保护范围（真实引擎）', () => {
  let fixtures: string;
  let clip: string;
  let dir: string;
  let runtime: RunningRuntime;
  let driver: ToolDriver;
  let client: BaoCutClient;
  let project: Project;
  let conversationId: Id;
  let videoId: Id;

  beforeAll(async () => {
    fixtures = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-fixtures-'));
    clip = path.join(fixtures, 'clip.mp4');
    execFileSync('ffmpeg', [
      ...['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=2'],
      ...['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', clip],
    ]);
  });

  afterAll(async () => {
    await fs.rm(fixtures, { recursive: true, force: true });
  });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-test-'));
    driver = new ToolDriver();
    runtime = await startRuntime({
      home: resolveRuntimeHome({ BAOCUT_HOME: dir }),
      drivers: () => [driver],
      watchSpace: false,
      engineHost: engine,
      videoGraceMs: 100,
    });
    const { endpoint, token } = runtime.discovery;
    client = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind: 'desktop', name: 'test', version: '0' },
      reconnect: false,
    });
    await client.connect();
    ({ project } = await client.request('projects.create', { name: '合同测试' }));
    await fs.copyFile(clip, path.join(project.path, 'clip.mp4'));
    videoId = (await client.request('videos.create', { projectId: project.id, name: '样片' })).ref.videoId;
    ({
      conversation: { id: conversationId },
    } = await client.request('conversations.create', { projectId: project.id }));
  });

  afterEach(async () => {
    client.close();
    await runtime.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  function items() {
    const video = runtime.videos.mirror(videoId)!.video;
    return video.sequences[video.rootSequenceId]!.items;
  }

  /** 智能体放两段 clip（0 秒与 3 秒），返回两段的实例 id 与之后的版本。 */
  async function placeTwo(session: ToolSession): Promise<{ first: Id; second: Id; revision: string }> {
    const inspected = await tool(session, 'videos_inspect', { video: videoId });
    const applied = await tool(session, 'edits_apply', {
      video: videoId,
      expectedRevision: inspected.body.revision,
      label: '放两段',
      operations: [
        { type: 'importAsset', path: 'clip.mp4', ref: 'c' },
        { type: 'addItem', asset: { ref: 'c' }, at: 0 },
        { type: 'addItem', asset: { ref: 'c' }, at: 3 },
      ],
    });
    expect(applied.isError).toBe(false);
    const videos = items().filter((item) => item.type === 'video');
    const first = videos.find((item) => item.span.fromFrame === 0)!.id;
    const second = videos.find((item) => item.span.fromFrame === 90)!.id;
    return { first, second, revision: applied.body.revision.after };
  }

  it('智能体读自己的合同；触碰保护的修改整笔拒绝并给出保护项；用户的修改不受限制；合同修改后按新范围检查', async () => {
    const { taskId } = await client.request('tasks.create', {
      conversationId,
      goal: '剪一版',
      commandId: newId('cmd'),
      accessMode: 'auto',
      contract: { acceptanceChecks: [{ kind: 'review', description: '两段都在', required: true }] },
    });
    const session = await until(() => driver.sessions[0]);
    await until(() => session.turnId);

    // 读合同：默认合同加上给出的检查。
    const read = await tool(session, 'tasks_contract', {});
    expect(read.isError).toBe(false);
    expect(read.body).toMatchObject({
      contract: { taskId, revision: 1, autonomy: 'auto', protectedRefs: [], acceptanceChecks: [{ description: '两段都在' }] },
      latestRevision: 1,
      checkResults: [],
    });

    const { first, second } = await placeTwo(session);

    // 用户保护第一段：实体保护与区间保护（第二段所在的 3–5 秒）。
    const view = await client.request('tasks.getContract', { taskId });
    const sequenceId = runtime.videos.mirror(videoId)!.video.rootSequenceId;
    const { contract } = await client.request('tasks.updateContract', {
      taskId,
      expectedRevision: view.contract.revision,
      commandId: newId('cmd'),
      patch: {
        protectedRefs: [
          { videoId, target: { kind: 'entity', entityId: first }, note: '片头' },
          { videoId, target: { kind: 'interval', sequenceId, span: { fromFrame: 90, durationFrames: 60 } } },
        ],
      },
    });
    expect(contract.revision).toBe(2);
    const [entityProtection, intervalProtection] = contract.protectedRefs;

    // 智能体删第一段：整笔拒绝，错误里是被触碰的保护与实体；视频不变。
    const before = items().length;
    const revision = runtime.videos.mirror(videoId)!.video.revision;
    const refused = await tool(session, 'edits_apply', {
      video: videoId,
      expectedRevision: revision,
      label: '删掉片头',
      operations: [{ type: 'deleteItems', itemIds: [first] }],
    });
    expect(refused.isError).toBe(true);
    expect(refused.body.error).toMatchObject({
      code: 'TASK_PROTECTED',
      entityIds: [first],
      details: {
        protections: [{ protectionId: entityProtection!.protectionId, target: { kind: 'entity', entityId: first }, entityIds: [first] }],
      },
      next: expect.stringContaining('protectedRefs'),
    });
    // 区间保护：移动第二段也被拒绝。
    const moved = await tool(session, 'edits_apply', {
      video: videoId,
      expectedRevision: revision,
      label: '挪第二段',
      operations: [{ type: 'moveItem', itemId: second, at: 6 }],
    });
    expect(moved.body.error).toMatchObject({
      code: 'TASK_PROTECTED',
      details: { protections: [{ protectionId: intervalProtection!.protectionId }] },
    });
    // 撤销自己放的两段也会触碰保护。
    const undo = await tool(session, 'edits_undo', { video: videoId });
    expect(undo.body.error).toMatchObject({ code: 'TASK_PROTECTED' });
    expect(items()).toHaveLength(before);
    expect(runtime.videos.mirror(videoId)!.video.revision).toBe(revision);

    // 智能体不能自己撤掉保护。
    const unprotect = await tool(session, 'tasks_update_contract', { expectedRevision: 2, patch: { protectedRefs: [] } });
    expect(unprotect.body.error).toMatchObject({ code: 'CONTRACT_FIELD_READONLY', fields: ['protectedRefs'] });

    // 用户的修改不受任务保护限制。
    await client.request('edits.apply', {
      videoId,
      commandId: newId('cmd'),
      expectedRevision: revision,
      operations: [{ type: 'deleteItems', sequenceId, itemIds: [second] }],
    });
    await until(() => items().length === before - 1);

    // 用户去掉保护之后：智能体之后的提交按新范围检查。
    await client.request('tasks.updateContract', { taskId, expectedRevision: 2, commandId: newId('cmd'), patch: { protectedRefs: [] } });
    const allowed = await tool(session, 'edits_apply', {
      video: videoId,
      expectedRevision: runtime.videos.mirror(videoId)!.video.revision,
      label: '删掉片头',
      operations: [{ type: 'deleteItems', itemIds: [first] }],
    });
    expect(allowed.isError).toBe(false);

    // 记录检查结果：标明由智能体记录。
    const checkId = read.body.contract.acceptanceChecks[0].checkId;
    const recorded = await tool(session, 'tasks_record_check', { checkId, outcome: 'failed', note: '片头被删了' });
    expect(recorded.body.result).toMatchObject({ checkId, outcome: 'failed', recordedBy: 'agent', contractRevision: 3 });
    expect((await client.request('tasks.listChecks', { taskId })).results).toHaveLength(1);
  });

  it('不在任务里的修改（界面）与没有保护的任务照常提交', async () => {
    const { taskId } = await client.request('tasks.create', {
      conversationId,
      goal: '放素材',
      commandId: newId('cmd'),
      accessMode: 'auto',
    });
    const session = await until(() => driver.sessions[0]);
    await until(() => session.turnId);
    const { first } = await placeTwo(session);
    // 保护整个视频：智能体的任何修改都被拒绝。
    await client.request('tasks.updateContract', {
      taskId,
      expectedRevision: 1,
      commandId: newId('cmd'),
      patch: { protectedRefs: [{ videoId, target: { kind: 'video' } }] },
    });
    const refused = await tool(session, 'edits_apply', {
      video: videoId,
      expectedRevision: runtime.videos.mirror(videoId)!.video.revision,
      label: '删',
      operations: [{ type: 'deleteItems', itemIds: [first] }],
    });
    expect(refused.body.error.code).toBe('TASK_PROTECTED');
    // 别的视频不受这个保护影响：保护按视频交给引擎。
    const other = (await client.request('videos.create', { projectId: project.id, name: '另一个' })).ref.videoId;
    const inspected = await tool(session, 'videos_inspect', { video: other });
    const elsewhere = await tool(session, 'edits_apply', {
      video: other,
      expectedRevision: inspected.body.revision,
      label: '放',
      operations: [
        { type: 'importAsset', path: 'clip.mp4', ref: 'c' },
        { type: 'addItem', asset: { ref: 'c' }, at: 0 },
      ],
    });
    expect(elsewhere.isError).toBe(false);
  });
});
