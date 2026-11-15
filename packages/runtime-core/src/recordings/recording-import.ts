import path from 'node:path';
import { refOf, RpcError, type Actor, type EditOperation, type Id, type RecordingResult, type SequenceItem, type TransactionReceipt } from '@baocut/protocol';
import { RcRecordings } from '@baocut/protocol/messages/runtime-core';
import type { VideoService } from '../videos/video-service.ts';
import { defaultScreenView, manifestBody, TIMESCALE, type PackageStream, type RecordingPackage, type VersionRef } from './recording-package.ts';

/**
 * 把一份录制导入视频（屏幕录制设计 §7「导入」，视频格式规范 §3.18、§4.7–§4.10）。三笔事务，命令 ID 都由 `recordingId` 定下，
 * 中途退出之后再来一次时已经提交的那几笔按同一个命令 ID 重放（引擎回答原来的回执），不会导入两份：
 *
 * 1. `assets`：全部文件导入成 `managed` 素材（来源 `recording`），加上屏幕、摄像头、麦克风、系统音频各一条新轨道。
 * 2. `documents`：录制清单、屏幕取景文档（缺省取景，没有缩放区间）。
 * 2a. `auto-zoom`：紧跟着的一笔 `regenerateAutoZooms`，按指针轨的点击生成 `origin: 'auto'` 的缩放区间（视频格式规范 §4.9）。
 *    操作要已经提交的取景文档与清单（引擎在事务之前读它们与指针轨），所以不能并进上一笔。不要自动缩放（`autoZoom: false`）
 *    或录制实际的鼠标模式是 `none`（没有指针轨）时不调；引擎拒绝时导入照常完成，只记一条警告。
 * 3. 每一段 `items-<n>`：这一段每路流一个实例，放在 `at + 流的 start` 秒处，盖住整个素材；`trim-<n>`：每个实例都修到
 *    有内容的区间结尾（文件常比区间长一点，时长按帧取整也可能多一帧，不修的话会压到下一段的实例上）。
 * 4. `link`：全部实例登记成一个联动组，屏幕实例挂上取景，摄像头裁成正方形、圆形遮罩、放在右下角。
 *
 * 实例 ID 要等提交之后才有（修剪与 `linkItems` 要真的 ID），所以分成几笔；撤销要按笔撤。
 *
 * 重放要求同一个命令 ID 带完全相同的内容（引擎按内容摘要比对，含 `expectedRevision` 与标签），所以每一笔第一次提交之前把它用的
 * 版本与标签交给 `steps` 记下来（会话落盘），重做时照原样再发；还没提交过的那一笔遇到版本冲突（视频在中间被改过）时按当前版本重发。
 */

const VIDEO_ROLES = new Set(['screen', 'camera']);
const MEDIA_ROLES = new Set(['screen', 'camera', 'microphone', 'system-audio']);

export interface ImportRecordingRequest {
  videoId: Id;
  recordingId: Id;
  pkg: RecordingPackage;
  /** 联动组放在序列的哪一秒。 */
  at: number;
  actor: Actor;
  /** 提交完一笔之后（任务的阶段与日志）。 */
  onStep?: (step: 'assets' | 'timeline' | 'link') => void;
  /** 每一笔第一次提交时用的版本与标签（按命令 ID）；调用方在 `persist` 里落盘，重做时原样传回来。 */
  steps: Record<string, { expectedRevision: string; label: string }>;
  persist: () => Promise<void>;
  /** 收尾时生成自动缩放（`RecordingOptions.autoZoom`）。 */
  autoZoom: boolean;
  /** 不影响导入结果的问题（英文，进任务的警告）。 */
  onWarning?: (detail: string) => void;
}

export async function importRecording(videos: VideoService, request: ImportRecordingRequest): Promise<RecordingResult> {
  const { videoId, recordingId, pkg, actor } = request;
  const snapshot = () => {
    const mirror = videos.mirror(videoId);
    if (!mirror) throw new Error(`Video ${videoId} is not open`);
    return mirror.video;
  };
  const sequenceId = snapshot().rootSequenceId;
  const apply = async (step: string, operations: EditOperation[], label: ReturnType<typeof RcRecordings.importLabel>): Promise<TransactionReceipt> => {
    const commandId = `${recordingId}_${step}`;
    const send = (sent: { expectedRevision: string; label: string }) =>
      videos.applyAs({ videoId, commandId, expectedRevision: sent.expectedRevision, operations, label: sent.label, labelRef: refOf(label) } as never, actor);
    let sent = request.steps[commandId];
    if (!sent) {
      sent = { expectedRevision: snapshot().revision, label: label.text };
      request.steps[commandId] = sent;
      await request.persist();
    }
    try {
      return (await send(sent)).receipt;
    } catch (error) {
      const code = error instanceof RpcError ? (error.details as { code?: string } | undefined)?.code : undefined;
      if (code !== 'PROJECT_REVISION_CONFLICT') throw error;
      // 这一笔没有提交过（提交过的会按命令 ID 重放，不查版本）：按当前版本重发。
      const fresh = { expectedRevision: snapshot().revision, label: sent.label };
      request.steps[commandId] = fresh;
      await request.persist();
      return (await send(fresh)).receipt;
    }
  };

  // 1. 素材与轨道。
  const files: Array<{ file: string; role: string }> = [
    ...pkg.streams.map((s) => ({ file: s.file, role: s.role })),
    ...pkg.cursors.map((c) => ({ file: c.file, role: 'cursor' })),
  ];
  const media = pkg.streams.filter((s) => MEDIA_ROLES.has(s.role));
  const roles = [...new Set(media.map((s) => s.role))].sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));
  const assetsReceipt = await apply(
    'assets',
    [
      ...files.map(
        ({ file, role }, n): EditOperation => ({
          type: 'importAsset',
          path: file,
          ref: `file${n}`,
          name: path.basename(file),
          storage: 'managed',
          provenance: { origin: 'recording', source: { recording: { recorder: pkg.recorder, role } } },
        }),
      ),
      ...roles.map((role): EditOperation => ({ type: 'addTrack', sequenceId, kind: VIDEO_ROLES.has(role) ? 'visual' : 'audio', ref: `track-${role}` })),
    ],
    RcRecordings.importLabel(),
  );
  const refs = assetsReceipt.refs ?? {};
  const assets = snapshot().assets;
  const versionOf = new Map<string, VersionRef>();
  files.forEach(({ file }, n) => {
    const assetId = refs[`file${n}`];
    const record = assetId ? assets[assetId] : undefined;
    if (!record) throw new Error(`Imported asset for ${path.basename(file)} is missing from the video`);
    versionOf.set(file, { id: assetId!, revision: record.currentRevision });
  });
  const trackOf = (role: string): Id => {
    const id = refs[`track-${role}`];
    if (!id) throw new Error(`Track for ${role} is missing`);
    return id;
  };
  request.onStep?.('assets');

  // 2. 清单与取景。
  const seconds = (ticks: number) => (request.at + ticks / TIMESCALE).toFixed(6);
  const documentsReceipt = await apply(
    'documents',
    [
      { type: 'putDocument', kind: 'recording', ref: 'manifest', body: manifestBody(pkg, versionOf) },
      { type: 'putDocument', kind: 'screen-view', ref: 'view', sourceDocument: { ref: 'manifest' }, body: defaultScreenView() },
    ],
    RcRecordings.importLabel(),
  );
  const manifestDocumentId = documentsReceipt.refs?.manifest;
  const screenViewDocumentId = documentsReceipt.refs?.view;
  if (!manifestDocumentId || !screenViewDocumentId) throw new Error('The recording documents were not created');

  // 2a. 自动缩放：引擎按清单与指针轨生成，规则只有一份（视频格式规范 §4.9）。
  if (request.autoZoom && pkg.cursor !== 'none') {
    try {
      await apply('auto-zoom', [{ type: 'regenerateAutoZooms', documentId: screenViewDocumentId }], RcRecordings.importLabel());
    } catch (error) {
      if (!(error instanceof RpcError)) throw error;
      request.onWarning?.(`Automatic zooms were not generated: ${error.message}`);
    }
  }

  // 3. 一段一段放实例，放完修到有内容的区间结尾，下一段才不会压上来。
  const itemOf = new Map<PackageStream, SequenceItem>();
  for (const [n, segment] of pkg.segments.entries()) {
    const streams = media.filter((s) => s.segmentId === segment.id);
    if (streams.length === 0) continue;
    const receipt = await apply(
      `items-${n + 1}`,
      streams.map(
        (s): EditOperation => ({
          type: 'addItem',
          sequenceId,
          asset: { assetId: versionOf.get(s.file)!.id },
          trackId: trackOf(s.role),
          at: { unit: 'seconds', value: seconds(s.start) },
          alignment: 'nearest-frame',
        }),
      ),
      RcRecordings.importLabel(),
    );
    const items = snapshot().sequences[sequenceId]?.items ?? [];
    const created = new Set(receipt.createdIds);
    for (const s of streams) {
      const assetId = versionOf.get(s.file)!.id;
      const item = items.find((i) => created.has(i.id) && 'assetRef' in i && (i as { assetRef: VersionRef }).assetRef.id === assetId);
      if (!item) throw new Error(`No timeline item for the ${s.role} stream of segment ${s.segmentId}`);
      itemOf.set(s, item);
    }
    // 每一路都修：素材时长按帧取整后可能比有内容的区间多出一帧，压到下一段开头。
    const trims = streams
      .map(
        (s): EditOperation => ({
          type: 'trimItem',
          sequenceId,
          itemId: itemOf.get(s)!.id,
          edge: 'end',
          at: { unit: 'seconds', value: seconds(s.coverage.t1) },
          alignment: 'nearest-frame',
        }),
      );
    if (trims.length) await apply(`trim-${n + 1}`, trims, RcRecordings.importLabel());
  }
  request.onStep?.('timeline');

  // 4. 成组、取景与摄像头的样子。
  const ops: EditOperation[] = [];
  const itemIds = media.map((s) => itemOf.get(s)!.id);
  ops.push({ type: 'linkItems', sequenceId, itemIds, kind: 'recording', recording: { documentId: manifestDocumentId } });
  for (const s of media) {
    const itemId = itemOf.get(s)!.id;
    if (s.role === 'screen') ops.push({ type: 'setStyle', sequenceId, itemId, screenView: { documentId: screenViewDocumentId } });
    if (s.role === 'camera') ops.push(...cameraBubble(sequenceId, itemId, videos, videoId, versionOf.get(s.file)!));
  }
  await apply('link', ops, RcRecordings.importLabel());
  const after = snapshot();
  const groupId = after.sequences[sequenceId]?.items.find((i) => i.id === itemIds[0]) as { linkGroupId?: Id } | undefined;
  request.onStep?.('link');
  return {
    videoId,
    recordingId,
    manifestDocumentId,
    screenViewDocumentId,
    groupId: groupId?.linkGroupId ?? '',
    itemIds,
    duration: pkg.duration / TIMESCALE,
    autoZoomPending: false,
  };
}

const ROLE_ORDER = ['screen', 'camera', 'microphone', 'system-audio'];

/** 摄像头：裁成正方形（取中间）、圆形遮罩、画中画放在右下角，宽是画面的 22%。 */
function cameraBubble(sequenceId: Id, itemId: Id, videos: VideoService, videoId: Id, asset: VersionRef): EditOperation[] {
  const revision = videos.mirror(videoId)?.video.assets[asset.id]?.revisions[asset.revision];
  const width = revision?.video?.displayWidth ?? 0;
  const height = revision?.video?.displayHeight ?? 0;
  const side = width > height && height > 0 ? (1 - height / width) / 2 : 0;
  const top = height > width && width > 0 ? (1 - width / height) / 2 : 0;
  return [
    {
      type: 'setStyle',
      sequenceId,
      itemId,
      mode: 'pip',
      fit: 'cover',
      mask: { shape: 'ellipse' },
      crop: { left: side, right: side, top, bottom: top },
    },
    { type: 'setTransform', sequenceId, itemId, x: 85, y: 80, w: 22 },
  ];
}
