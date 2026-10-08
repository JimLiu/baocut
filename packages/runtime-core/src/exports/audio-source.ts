import { RpcError, type AudioExportSource, type Id, type VideoSnapshot } from '@baocut/protocol';
import { RcExport } from '@baocut/protocol/messages/runtime-core';

/**
 * 音频导出的声音来源（架构设计 §9.13）换成引擎声音计划里的实例选择（`exports.plan` 的 `audioItems`）：
 *
 * - `original`：停用带 `baocut.dub` 标记的实例（配音与分离出的背景），配音静音掉的原声取消静音（配音计划里记的
 *   `mutedItemIds`，只含配音之前没有静音的实例）；配音触发的压低随触发的实例一起消失。
 * - `{ dubGroupId }`：只留这一组配音的实例，其余一律停用；视频里没有这一组时拒绝。
 *
 * 只影响这一次导出的计划，视频不变。
 */

/** 配音写在实例与配音计划上的标记（视频格式规范 §7.2、§1.4）。 */
const DUB_EXTENSION = 'baocut.dub';

export interface AudioItemSelection {
  disable: Id[];
  unmute: Id[];
}

function dubMark(item: unknown): { groupId?: unknown; stem?: unknown } | null {
  const extensions = (item as { extensions?: Record<string, unknown> }).extensions;
  const mark = extensions?.[DUB_EXTENSION];
  return mark && typeof mark === 'object' ? (mark as { groupId?: unknown; stem?: unknown }) : null;
}

export async function audioItemSelection(
  video: VideoSnapshot,
  sequenceId: Id,
  source: AudioExportSource | undefined,
  readBody: (documentId: Id) => Promise<unknown>,
): Promise<AudioItemSelection | null> {
  if (source === undefined || source === 'mix') return null;
  const items = video.sequences[sequenceId]?.items ?? [];
  if (source === 'original') {
    const ids = new Set(items.map((item) => item.id));
    const unmute = new Set<Id>();
    for (const [documentId, record] of Object.entries(video.documents)) {
      if (record.kind !== 'dubbing-plan') continue;
      const body = (await readBody(documentId).catch(() => null)) as {
        sequenceId?: unknown;
        extensions?: Record<string, { mutedItemIds?: unknown } | undefined>;
      } | null;
      if (body?.sequenceId !== sequenceId) continue;
      const muted = body.extensions?.[DUB_EXTENSION]?.mutedItemIds;
      if (Array.isArray(muted)) for (const id of muted) if (typeof id === 'string' && ids.has(id)) unmute.add(id);
    }
    return { disable: items.filter((item) => dubMark(item) !== null).map((item) => item.id), unmute: [...unmute] };
  }
  const { dubGroupId } = source;
  const keep = new Set(
    items
      .filter((item) => {
        const mark = dubMark(item);
        return mark !== null && mark.groupId === dubGroupId && mark.stem === undefined;
      })
      .map((item) => item.id),
  );
  if (keep.size === 0) {
    throw new RpcError('invalid-request', RcExport.dubGroupNotFound({ groupId: dubGroupId }), { code: 'DUB_GROUP_NOT_FOUND', groupId: dubGroupId });
  }
  return { disable: items.filter((item) => !keep.has(item.id)).map((item) => item.id), unmute: [] };
}
