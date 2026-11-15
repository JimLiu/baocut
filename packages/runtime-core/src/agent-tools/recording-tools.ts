// i18n-ignore-file: 给模型的工具说明、错误与下一步
import { z } from 'zod';
import { RpcError, type ConversationRole, type Id, type RecordingOptions, type RecordingSummary, type RecordingTarget } from '@baocut/protocol';
import { RcRecordings } from '@baocut/protocol/messages/runtime-core';
import type { RecordingService } from '../recordings/recording-service.ts';
import { ToolError, type ToolInfo, type ToolSet } from './tool-catalog.ts';
import { confirmSummary, type ToolAccess, type ToolPrincipal, type ToolScope } from './tool-scope.ts';

/**
 * 屏幕录制的工具（屏幕录制设计 §12、§13；Agent 面设计 §4.2、§4.3）：一级动词 `record` 与名词组 `recordings_*`。只在工具桥与
 * CLI 上（`surfaces` 没有 `mcp`）：外部客户端不应该能让这台电脑开始录屏，窗口标题也可能带出隐私。
 *
 * - 会话里的 `record` 不直接采集：录制停在「等待开始」，桌面端经 `recordings` 主题弹出预填的面板，用户按「开始录制」就是批准
 *   （不另放审批卡，任何访问模式下都要这一下）。没有人在场的运行（定时、Bot 频道与线程、Job 叫醒）一律 `RECORDING_UNATTENDED`。
 * - 终端里的 `record` 直接预检、倒计时、开始采集；`--dry-run` 只预检。
 * - 这台电脑能不能录由服务判断：没开桌面端（命令行自己拉起的 Runtime）、没有 Worker、平台不支持都是 `RECORDING_UNAVAILABLE`。
 */

export interface RecordingToolsDeps {
  recordings: () => RecordingService | null;
  scope: ToolScope;
  /** 会话此刻的回合：有没有人在场、会话的角色。没有回合时 null。 */
  run: (conversationId: Id) => { attended: boolean; role: ConversationRole } | null;
}

const recordingId = z.string().min(1).max(80);

const schemas = {
  record: z.strictObject({
    display: z.string().min(1).max(80).optional().describe('Display ID from recordings_sources. Default: the main display.'),
    window: z.string().min(1).max(80).optional().describe('Window ID from recordings_sources: record only this window. Do not combine with display or area.'),
    area: z
      .string()
      .regex(/^\s*\d+(\.\d+)?\s*,\s*\d+(\.\d+)?\s*,\s*\d+(\.\d+)?\s*,\s*\d+(\.\d+)?\s*$/)
      .optional()
      .describe('Area "x,y,width,height" in logical points on the chosen display (display, default the main one).'),
    camera: z.string().min(1).max(200).optional().describe('Camera device ID from recordings_sources. Default: no camera.'),
    mic: z.string().min(1).max(200).optional().describe('Microphone device ID from recordings_sources. Default: the system default microphone.'),
    noMic: z.boolean().optional().describe('Record no microphone.'),
    systemAudio: z.boolean().optional().describe('Also record the system audio. Default: off.'),
    cursor: z
      .enum(['separate', 'baked', 'none'])
      .optional()
      .describe('Pointer: separate (default; drawn by BaoCut, editable, drives auto zoom), baked (drawn into the screen video), none.'),
    keys: z.enum(['off', 'shortcuts', 'all']).optional().describe('Keyboard track: off (default), shortcuts (modifier combinations only), all.'),
    fps: z.number().int().min(1).max(120).optional().describe('Target screen frame rate. Default 30.'),
    countdown: z.number().int().min(0).max(10).optional().describe('Countdown in seconds before capture starts; 0 for none. Default 3.'),
    duration: z.number().positive().max(86_400).optional().describe('Stop automatically after this many seconds. Default: until stopped.'),
    video: z.string().min(1).optional().describe('Record into this existing video (videoId or path). Default: a new video.'),
    name: z.string().min(1).max(120).optional().describe('Name of the new video. Default: "Screen recording <date time>".'),
    project: z.string().min(1).optional().describe('Project (id or directory) for the new video. Default: the current project.'),
    noAutoZoom: z.boolean().optional().describe('Do not generate automatic zooms from the clicks.'),
    includeSelf: z
      .boolean()
      .optional()
      .describe("Also record BaoCut's own windows when recording a display or an area. Default: they are left out. No effect on a window recording."),
    noOpen: z.boolean().optional().describe('Do not open the editor in the desktop app when done.'),
    dryRun: z.boolean().optional().describe('Only check sources, permissions and disk space; report what would be recorded without starting.'),
  }),
  recordings_sources: z.strictObject({}),
  recordings_status: z.strictObject({ recordingId: recordingId.optional().describe('Default: the current recording.') }),
  recordings_list: z.strictObject({}),
  recordings_pause: z.strictObject({ recordingId: recordingId.optional().describe('Default: the current recording.') }),
  recordings_resume: z.strictObject({ recordingId: recordingId.optional().describe('Default: the current recording.') }),
  recordings_stop: z.strictObject({ recordingId: recordingId.optional().describe('Default: the current recording.') }),
  recordings_discard: z.strictObject({ recordingId: recordingId.optional().describe('Default: the current recording.') }),
  recordings_recover: z.strictObject({ recordingId: recordingId.describe('An unfinished recording from recordings_list.') }),
};

type ToolName = keyof typeof schemas;
type Args<N extends ToolName> = z.infer<(typeof schemas)[N]>;

const BOTH = ['agent', 'cli'] as const;

const DEFINITIONS: Record<ToolName, ToolInfo> = {
  record: {
    title: 'Record the screen',
    description: [
      'Record this computer\'s screen into a video.',
      'The source is a display, a window or an area, optionally with a camera, the microphone and system audio.',
      'In a conversation the recording does not start by itself: it waits, and the BaoCut desktop app shows a prefilled recording panel. The user checks it and presses Start; that press is the approval. Closing the panel cancels the job. After calling record, tell the user to press Stop when done and end your turn; do not poll. The finished job comes back to the conversation.',
      'In the terminal it checks permissions and disk space, counts down and starts capturing; the job ends when the recording is in the video. The result has videoId, recordingId, manifestDocumentId, screenViewDocumentId, groupId (the link group of all recorded items), itemIds and duration (seconds). Automatic zooms from the clicks are already in the screen view; regenerateAutoZooms in edits_apply makes them again.',
      'A display or area recording leaves out the BaoCut desktop app\'s own windows unless includeSelf is set.',
      'Refused with RECORDING_UNATTENDED in scheduled, bot or other unattended runs, and with RECORDING_UNAVAILABLE when the desktop app is not open on this computer, on remote connections, or when this system cannot record. Missing system permissions fail with RECORDING_PERMISSION_DENIED; details.systemAccess lists them with their place in System Settings. Tell the user; never try to change those settings. Only one recording at a time (RECORDING_BUSY).',
    ].join('\n'),
    effect: 'job',
    examples: [
      { title: 'Record the main display with the default microphone', args: {} },
      { title: 'Record a window with the camera, stop after 60 seconds', args: { window: '4821', camera: 'cam-1', duration: 60 } },
      { title: 'Check what would be recorded', args: { dryRun: true } },
    ],
    surfaces: BOTH,
  },
  recordings_sources: {
    title: 'List recording sources',
    description: [
      'List the displays, windows, cameras and microphones this computer can record, and the state of each system permission.',
      'Each source has its ID, name and size; permissions cover screen, camera, microphone and inputMonitoring, and available says whether recording works here.',
      'Window titles can be private: use them only to pick a source with the user. Read-only; it never triggers a system permission prompt.',
    ].join('\n'),
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [{ title: 'List sources', args: {} }],
    surfaces: BOTH,
  },
  recordings_status: {
    title: 'Show a recording',
    description:
      'Show one recording: its state, duration, live streams and result.\nStates are waiting, preparing, countdown, recording, paused, stopping, finalizing, importable, importing, in-timeline, failed and discarded. It also says where the recording goes, and the result appears once it is in the video. Read-only.',
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [{ title: 'The current recording', args: {} }],
    surfaces: BOTH,
    positional: 'recordingId',
  },
  recordings_list: {
    title: 'List recordings',
    description:
      'List the current recording and the unfinished ones (interrupted by a crash or a failed import) that recordings_recover can still finish.\nRecordings that failed before capturing anything are listed too, with their error, until discarded or BaoCut restarts. Read-only.',
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [{ title: 'List recordings', args: {} }],
    surfaces: BOTH,
  },
  recordings_pause: {
    title: 'Pause recording',
    description: 'Pause the current recording. Resuming starts a new segment; the pause is not in the video.',
    effect: 'mutation',
    examples: [{ title: 'Pause', args: {} }],
    surfaces: BOTH,
    positional: 'recordingId',
  },
  recordings_resume: {
    title: 'Resume recording',
    description: 'Resume a paused recording.',
    effect: 'mutation',
    examples: [{ title: 'Resume', args: {} }],
    surfaces: BOTH,
    positional: 'recordingId',
  },
  recordings_stop: {
    title: 'Stop recording',
    description: [
      'Stop the recording and keep it. Returns as soon as the stop is received, with jobId; finalizing and adding it to the video happen in that job (jobs_wait).',
      'Stopping during the countdown or while waiting for the user cancels it: nothing was recorded.',
    ].join('\n'),
    effect: 'mutation',
    examples: [{ title: 'Stop the current recording', args: {} }],
    surfaces: BOTH,
    positional: 'recordingId',
  },
  recordings_discard: {
    title: 'Discard a recording',
    description:
      'Discard a recording and delete its recorded files. A recording that is already in a video cannot be discarded here: undo it or delete the items in the video instead.',
    annotations: { destructiveHint: true },
    effect: 'destructive',
    examples: [{ title: 'Discard the current recording', args: {} }],
    surfaces: BOTH,
    positional: 'recordingId',
  },
  recordings_recover: {
    title: 'Recover a recording',
    description:
      'Finish an unfinished recording (from recordings_list) and add it to its video, as a new job. The import repeats with the same command IDs, so nothing is added twice.',
    effect: 'job',
    examples: [{ title: 'Recover', args: { recordingId: 'rec_01H...' } }],
    surfaces: BOTH,
    positional: 'recordingId',
  },
};

export class RecordingTools implements ToolSet {
  readonly schemas = schemas;
  readonly definitions = DEFINITIONS;
  readonly #deps: RecordingToolsDeps;

  constructor(deps: RecordingToolsDeps) {
    this.#deps = deps;
  }

  async dispatch(name: string, args: unknown, principal: ToolPrincipal): Promise<unknown> {
    try {
      switch (name as ToolName) {
        case 'record':
          return await this.#record(args as Args<'record'>, principal);
        case 'recordings_sources':
          return await this.#service(principal, false).sources();
        case 'recordings_status':
          return this.#status((args as Args<'recordings_status'>).recordingId, principal);
        case 'recordings_list':
          return { recordings: this.#service(principal, false).list().map(digest) };
        case 'recordings_pause':
          return await this.#control('recordings_pause', (args as Args<'recordings_pause'>).recordingId, principal);
        case 'recordings_resume':
          return await this.#control('recordings_resume', (args as Args<'recordings_resume'>).recordingId, principal);
        case 'recordings_stop':
          return await this.#control('recordings_stop', (args as Args<'recordings_stop'>).recordingId, principal);
        case 'recordings_discard':
          return await this.#discard((args as Args<'recordings_discard'>).recordingId, principal);
        case 'recordings_recover':
          return await this.#recover((args as Args<'recordings_recover'>).recordingId, principal);
        default:
          throw new ToolError('UNKNOWN_TOOL', `Unknown tool: ${name}`);
      }
    } catch (error) {
      throw relay(error);
    }
  }

  /** 只录这台电脑：对外服务没有这组工具（`surfaces`），这里再挡一次；服务不在（这个平台不能录）时 `RECORDING_UNAVAILABLE`。 */
  #service(principal: ToolPrincipal, write: boolean): RecordingService {
    if (principal.kind === 'service') {
      throw new ToolError('RECORDING_UNAVAILABLE', RcRecordings.remote().text, { reason: 'remote' });
    }
    const service = this.#deps.recordings();
    if (!service) throw new ToolError('RECORDING_UNAVAILABLE', RcRecordings.unsupportedPlatform().text, { reason: 'unsupported' });
    this.#deps.scope.authorize(principal, write);
    return service;
  }

  async #record(args: Args<'record'>, principal: ToolPrincipal) {
    const service = this.#service(principal, !args.dryRun);
    const access = this.#deps.scope.authorize(principal, !args.dryRun);
    if (principal.kind === 'agent') this.#attended(principal.conversationId);
    const options = optionsOf(args);
    if (args.dryRun) {
      const checked = await service.precheck(options);
      return {
        dryRun: true,
        available: true,
        options: checked.options,
        permissions: checked.sources.permissions,
        freeBytes: checked.freeBytes,
        next: 'Nothing was recorded. Run record without dryRun to start.',
      };
    }
    const target = await this.#target(args, access);
    if (principal.kind === 'agent') {
      const summary = await service.request({ options, target, submitter: access.submitter, requestedBy: { conversationId: principal.conversationId } });
      return {
        jobId: summary.jobId,
        recordingId: summary.recordingId,
        state: summary.state,
        next: 'The BaoCut desktop app now shows the recording panel. Tell the user to check it, press Start, and press Stop when done; then end your turn. Do not poll: the finished job comes back to this conversation.',
      };
    }
    const summary = await service.request({ options, target, submitter: access.submitter });
    return {
      jobId: summary.jobId,
      recordingId: summary.recordingId,
      state: summary.state,
      next: `Recording. Stop it with recordings_stop (baocut recordings stop ${summary.recordingId}); jobs_wait ${summary.jobId} waits until it is in the video.`,
    };
  }

  /** 会话里没人在场的运行不录（§13）：定时任务、Bot 的频道与线程、Job 叫醒的回合。 */
  #attended(conversationId: Id): void {
    const run = this.#deps.run(conversationId);
    if (!run || !run.attended || run.role !== 'chat') {
      throw new ToolError('RECORDING_UNATTENDED', RcRecordings.unattended().text, {
        next: 'Do not retry. Tell the user to start the recording from the BaoCut desktop app, or to ask you again while at the computer.',
      });
    }
  }

  async #target(args: Args<'record'>, access: ToolAccess): Promise<RecordingTarget> {
    const { scope } = this.#deps;
    if (args.video !== undefined) {
      const opened = await scope.open(args.video, access);
      return { videoId: opened.ref.videoId };
    }
    const root = await scope.createRoot(access, args.project);
    return { create: { ...(args.name ? { name: args.name } : {}), ...root.scope } };
  }

  #status(id: string | undefined, principal: ToolPrincipal) {
    const summary = this.#service(principal, false).status(id);
    return { recording: summary ? digest(summary) : null };
  }

  async #control(tool: 'recordings_pause' | 'recordings_resume' | 'recordings_stop', id: string | undefined, principal: ToolPrincipal) {
    const service = this.#service(principal, true);
    const access = this.#deps.scope.authorize(principal, true);
    const summary =
      tool === 'recordings_pause'
        ? RcRecordings.confirmPause()
        : tool === 'recordings_resume'
          ? RcRecordings.confirmResume()
          : RcRecordings.confirmStop();
    const approval = await this.#deps.scope.confirm(access, { tool, ...confirmSummary(summary) });
    const result =
      tool === 'recordings_pause' ? await service.pause(id) : tool === 'recordings_resume' ? await service.resume(id) : await service.stop(id);
    return {
      recording: digest(result),
      ...(approval ? { approval } : {}),
      ...(tool === 'recordings_stop' && result.jobId
        ? { jobId: result.jobId, next: `Finalizing and adding it to the video in job ${result.jobId}; jobs_wait waits for it.` }
        : {}),
    };
  }

  async #discard(id: string | undefined, principal: ToolPrincipal) {
    const service = this.#service(principal, true);
    const access = this.#deps.scope.authorize(principal, true);
    const recording = id ?? service.status()?.recordingId;
    if (!recording) throw new ToolError('RECORDING_NOT_FOUND', RcRecordings.notRecording().text);
    service.status(recording);
    const approval = await this.#deps.scope.confirm(access, { tool: 'recordings_discard', targets: [recording], ...confirmSummary(RcRecordings.confirmDiscard()) });
    return { ...(await service.discard(recording)), ...(approval ? { approval } : {}) };
  }

  async #recover(id: string, principal: ToolPrincipal) {
    const service = this.#service(principal, true);
    const access = this.#deps.scope.authorize(principal, true);
    service.status(id);
    const approval = await this.#deps.scope.confirm(access, { tool: 'recordings_recover', targets: [id], ...confirmSummary(RcRecordings.confirmRecover()) });
    const summary = await service.recover(id, access.submitter);
    return {
      jobId: summary.jobId,
      recordingId: summary.recordingId,
      state: summary.state,
      ...(approval ? { approval } : {}),
      next: `Finishing in job ${summary.jobId}; jobs_wait waits until it is in the video.`,
    };
  }
}

/** `record` 的旗标 → 录制选项；没给的不写，按 `RECORDING_DEFAULTS`。 */
export function optionsOf(args: Args<'record'>): Partial<RecordingOptions> {
  const picked = [args.window !== undefined, args.area !== undefined].filter(Boolean).length;
  if (picked > 1 || (args.window !== undefined && args.display !== undefined)) {
    throw new ToolError('INVALID_ARGUMENTS', 'Give only one of window, display or area (area may come with display).');
  }
  if (args.mic !== undefined && args.noMic) throw new ToolError('INVALID_ARGUMENTS', 'Give mic or noMic, not both.');
  const options: Partial<RecordingOptions> = {};
  if (args.window !== undefined) options.source = { kind: 'window', windowId: args.window };
  else if (args.area !== undefined) {
    const [x, y, width, height] = args.area.split(',').map((part) => Number(part.trim())) as [number, number, number, number];
    if (width <= 0 || height <= 0) throw new ToolError('INVALID_ARGUMENTS', 'The area needs a positive width and height.');
    options.source = { kind: 'area', ...(args.display !== undefined ? { displayId: args.display } : {}), rect: { x, y, width, height } };
  } else if (args.display !== undefined) options.source = { kind: 'display', displayId: args.display };
  if (args.camera !== undefined) options.camera = args.camera;
  if (args.noMic) options.microphone = null;
  else if (args.mic !== undefined) options.microphone = args.mic;
  if (args.systemAudio !== undefined) options.systemAudio = args.systemAudio;
  if (args.cursor !== undefined) options.cursor = args.cursor;
  if (args.keys !== undefined) options.keys = args.keys;
  if (args.fps !== undefined) options.fps = args.fps;
  if (args.countdown !== undefined) options.countdown = args.countdown;
  if (args.duration !== undefined) options.duration = args.duration;
  if (args.noAutoZoom) options.autoZoom = false;
  if (args.noOpen) options.open = false;
  if (args.includeSelf) options.includeSelf = true;
  return options;
}

/** 给模型的摘要：不带本机目录（录制目录是 Runtime 的内部文件）。 */
function digest(summary: RecordingSummary) {
  const { dir: _dir, ...rest } = summary;
  return rest;
}

/** 服务的拒绝换成按 `details.code` 的工具错误：智能体与 CLI 看到的是 `RECORDING_*`，不是传输层的 `conflict`。 */
function relay(error: unknown): unknown {
  if (!(error instanceof RpcError)) return error;
  const details = error.details && typeof error.details === 'object' ? (error.details as Record<string, unknown>) : null;
  const code = typeof details?.code === 'string' ? details.code : null;
  if (!code) return error;
  const { code: _code, ...extra } = details!;
  return new ToolError(code, error.message, { ...extra, ...(NEXT[code] ? { next: NEXT[code] } : {}) });
}

const NEXT: Record<string, string> = {
  RECORDING_UNAVAILABLE: 'Do not retry. Tell the user why (the message says it); recording has to start from the BaoCut desktop app on this computer.',
  RECORDING_PERMISSION_DENIED:
    'Tell the user which permissions are missing (details.systemAccess, with the place in System Settings). Never try to change system settings. Retry after the user says they turned them on.',
  RECORDING_BUSY: 'Another recording is running: recordings_status shows it. Stop or discard it first, or wait.',
  RECORDING_DISK_FULL: 'Tell the user to free disk space, then retry.',
  RECORDING_SOURCE_NOT_FOUND: 'Call recordings_sources and pick an existing display, window or device.',
};
