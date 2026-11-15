import { describe, expect, it } from 'vitest';
import { RpcError, type RecordingSummary } from '@baocut/protocol';
import type { RecordingRequest, RecordingService } from '../recordings/recording-service.ts';
import { RecordingTools, optionsOf } from './recording-tools.ts';
import { ToolError } from './tool-catalog.ts';
import { TOOL_RISK, type ToolPrincipal, type ToolScope } from './tool-scope.ts';

const agent = { kind: 'agent', conversationId: 'conv_1', connectionId: 'c1', name: 'agent' } as ToolPrincipal;
const local = { kind: 'local', connectionId: 'c2', name: 'cli', client: 'cli', cwd: '/tmp', projectDir: null } as unknown as ToolPrincipal;
const service = { kind: 'service', connectionId: 'c3', name: 'svc' } as unknown as ToolPrincipal;

function summary(patch: Partial<RecordingSummary> = {}): RecordingSummary {
  return {
    recordingId: 'rec_1',
    state: 'waiting',
    jobId: 'job_1',
    options: {} as RecordingSummary['options'],
    target: { create: { projectId: 'prj_1' } },
    requestedBy: null,
    createdAt: '2026-11-15T00:00:00.000Z',
    startedAt: null,
    elapsed: 0,
    streams: [],
    videoId: null,
    unfinished: false,
    dir: '/home/recordings/rec_1',
    error: null,
    result: null,
    ...patch,
  };
}

function setup(run: { attended: boolean; role: 'chat' | 'channel' | 'thread' } | null = { attended: true, role: 'chat' }) {
  const requests: RecordingRequest[] = [];
  const confirms: string[] = [];
  const calls: string[] = [];
  const fake = {
    request: async (request: RecordingRequest) => {
      requests.push(request);
      return summary({ state: request.requestedBy ? 'waiting' : 'preparing', requestedBy: request.requestedBy ?? null });
    },
    precheck: async (options: object) => ({
      options: { ...options, countdown: 3 },
      sources: { permissions: { screen: 'granted', camera: 'unknown', microphone: 'granted', inputMonitoring: 'unknown' } },
      freeBytes: 9e9,
    }),
    sources: async () => ({ available: true }),
    status: () => summary({ state: 'recording' }),
    list: () => [summary()],
    stop: async () => {
      calls.push('stop');
      return summary({ state: 'stopping' });
    },
    pause: async () => {
      calls.push('pause');
      return summary({ state: 'paused' });
    },
    resume: async () => summary({ state: 'recording' }),
    discard: async (id: string) => {
      calls.push(`discard:${id}`);
      return { recordingId: id, removed: true as const };
    },
    recover: async () => summary({ state: 'finalizing', jobId: 'job_2' }),
  } as unknown as RecordingService;
  const scope = {
    authorize: (principal: ToolPrincipal) => ({ principal, submitter: { kind: 'connection', id: 'c' } }),
    confirm: async (_access: unknown, request: { tool: string }) => {
      confirms.push(request.tool);
    },
    createRoot: async () => ({ root: '/projects/a', scope: { projectId: 'prj_1' } }),
    open: async () => ({ ref: { videoId: 'vid_9' } }),
  } as unknown as ToolScope;
  const tools = new RecordingTools({ recordings: () => fake, scope, run: () => run });
  return { tools, requests, confirms, calls };
}

describe('屏幕录制的工具（屏幕录制设计 §12、§13）', () => {
  it('会话里的 record 停在等待开始：带 requestedBy，不放审批卡；返回 jobId 与「让用户按开始、结束这一轮」', async () => {
    const { tools, requests, confirms } = setup();
    const result = (await tools.dispatch('record', { camera: 'cam-1' }, agent)) as Record<string, unknown>;
    expect(result).toMatchObject({ jobId: 'job_1', recordingId: 'rec_1', state: 'waiting' });
    expect(String(result.next)).toContain('Start');
    expect(requests[0]).toMatchObject({ requestedBy: { conversationId: 'conv_1' }, target: { create: { projectId: 'prj_1' } }, options: { camera: 'cam-1' } });
    expect(confirms).toEqual([]);
  });

  it('没人在场的回合、Bot 的频道与线程、没有回合：RECORDING_UNATTENDED，不开录制', async () => {
    for (const run of [{ attended: false, role: 'chat' as const }, { attended: true, role: 'channel' as const }, { attended: true, role: 'thread' as const }, null]) {
      const { tools, requests } = setup(run);
      await expect(tools.dispatch('record', {}, agent)).rejects.toMatchObject({ code: 'RECORDING_UNATTENDED' });
      expect(requests).toEqual([]);
    }
  });

  it('终端里的 record 直接开始：没有 requestedBy，名字与落点进 target，给了 video 录进那个视频', async () => {
    const { tools, requests } = setup();
    const result = (await tools.dispatch('record', { window: '42', noMic: true, keys: 'shortcuts', name: 'Demo' }, local)) as Record<string, unknown>;
    expect(result).toMatchObject({ jobId: 'job_1', state: 'preparing' });
    expect(requests[0]!.requestedBy).toBeUndefined();
    expect(requests[0]).toMatchObject({
      target: { create: { name: 'Demo', projectId: 'prj_1' } },
      options: { source: { kind: 'window', windowId: '42' }, microphone: null, keys: 'shortcuts' },
    });
    await tools.dispatch('record', { video: 'vid_9' }, local);
    expect(requests[1]!.target).toEqual({ videoId: 'vid_9' });
  });

  it('dryRun 只预检：报告选项、权限与磁盘，不开录制', async () => {
    const { tools, requests } = setup();
    const result = (await tools.dispatch('record', { dryRun: true, display: '2' }, local)) as Record<string, unknown>;
    expect(result).toMatchObject({ dryRun: true, available: true, options: { source: { kind: 'display', displayId: '2' } }, freeBytes: 9e9 });
    expect(requests).toEqual([]);
  });

  it('服务的拒绝按 details.code 转成工具错误，带下一步；对外服务一律 RECORDING_UNAVAILABLE', async () => {
    const { tools } = setup();
    const busy = new RecordingTools({
      recordings: () =>
        ({
          request: async () => {
            throw new RpcError('conflict', 'busy', { code: 'RECORDING_BUSY', recordingId: 'rec_0' });
          },
        }) as unknown as RecordingService,
      scope: { authorize: (principal: ToolPrincipal) => ({ principal, submitter: { kind: 'connection', id: 'c' } }), createRoot: async () => ({ root: '/', scope: { projectId: 'p' } }) } as unknown as ToolScope,
      run: () => ({ attended: true, role: 'chat' }),
    });
    const error = await busy.dispatch('record', {}, local).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolError);
    expect(error).toMatchObject({ code: 'RECORDING_BUSY', extra: { recordingId: 'rec_0', next: expect.any(String) } });
    await expect(tools.dispatch('recordings_sources', {}, service)).rejects.toMatchObject({ code: 'RECORDING_UNAVAILABLE' });
    const none = new RecordingTools({ recordings: () => null, scope: {} as ToolScope, run: () => null });
    await expect(none.dispatch('recordings_list', {}, local)).rejects.toMatchObject({ code: 'RECORDING_UNAVAILABLE' });
  });

  it('暂停、停止、丢弃先按风险确认；丢弃不给 ID 时是当前这一次；摘要不带本机目录', async () => {
    const { tools, confirms, calls } = setup();
    const stopped = (await tools.dispatch('recordings_stop', {}, agent)) as Record<string, unknown>;
    expect(stopped).toMatchObject({ jobId: 'job_1', recording: { state: 'stopping' } });
    expect((stopped.recording as Record<string, unknown>).dir).toBeUndefined();
    await tools.dispatch('recordings_pause', {}, agent);
    await tools.dispatch('recordings_discard', {}, agent);
    expect(confirms).toEqual(['recordings_stop', 'recordings_pause', 'recordings_discard']);
    expect(calls).toEqual(['stop', 'pause', 'discard:rec_1']);
  });

  it('目录项：都只在工具桥与 CLI 上（不进 MCP）；风险等级按设计 §13', () => {
    const { tools } = setup();
    for (const [name, info] of Object.entries(tools.definitions)) {
      expect(info.surfaces, name).toEqual(['agent', 'cli']);
      expect(TOOL_RISK[name], name).toBeDefined();
    }
    expect(TOOL_RISK.record).toBe('high');
    expect(TOOL_RISK.recordings_discard).toBe('high');
    expect([TOOL_RISK.recordings_pause, TOOL_RISK.recordings_resume, TOOL_RISK.recordings_stop]).toEqual(['command', 'command', 'command']);
    expect([TOOL_RISK.recordings_sources, TOOL_RISK.recordings_status, TOOL_RISK.recordings_list]).toEqual(['read', 'read', 'read']);
  });

  it('optionsOf：只写给了的；window 与 display、mic 与 noMic 不能同时给；区域按逗号分隔', () => {
    expect(optionsOf({})).toEqual({});
    expect(optionsOf({ area: '10, 20, 300, 200', display: '1', noAutoZoom: true })).toEqual({
      source: { kind: 'area', displayId: '1', rect: { x: 10, y: 20, width: 300, height: 200 } },
      autoZoom: false,
    });
    expect(() => optionsOf({ window: '1', display: '2' })).toThrow(ToolError);
    expect(() => optionsOf({ mic: 'm', noMic: true })).toThrow(ToolError);
  });
});
