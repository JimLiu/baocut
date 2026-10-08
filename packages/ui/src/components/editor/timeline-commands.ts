import type { Id, Sequence, SequenceItem, TransactionReceipt, VideoSnapshot } from '@baocut/protocol';
import { ToastQueue } from '@react-spectrum/s2';
import { TIMELINE_EDIT_COPY as COPY } from '../../copy.ts';
import { frameAt, itemFrames, itemLabel, rootSequence } from '../../model/editor.ts';
import { deletableItemIds, itemsAtFrame, moveOperation, nudgeDelta, splitOperations } from '../../model/editor-ops.ts';
import { pasteOperations } from '../../model/item-clipboard.ts';
import { createdItemIds } from '../../model/new-items.ts';
import { fallbackUndoOperations, mutedItemsOf } from '../../model/dub-undo.ts';
import { dubGroups, muteOperations } from '../../model/timeline-dub.ts';
import { langName } from '../../model/tools-models.ts';
import { useClipboard } from '../../state/clipboard-store.ts';
import { useEditor, type NudgeDraft } from '../../state/editor-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { TIMELINE_DUB_COPY as DUB } from './dub-copy.ts';
import type { EditorActions } from './editor-context.tsx';

/**
 * 时间线上对选中片段的命令：快捷键（video-editor 的 useEditorKeys）与右键菜单（timeline-menu）走同一份，
 * 同一条撤销记录、同一批提示（原型 editor-keys.jsx 的 clipboard，timeline-menu.jsx 里的 `ctx.clipboard`）。
 * 都在事件里读最新的视频与选区，不靠渲染时的闭包。
 */

/** 修饰键的写法：macOS 是 ⌘，其余是 Ctrl+。 */
export const MOD_KEY = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+';

const TOAST_MS = 2500;
/** ⌥←/→ 连按的合并窗口：停手这么久才提交（原型 history 的合并口径）。 */
export const NUDGE_WINDOW_MS = 900;

interface Live {
  videoId: Id;
  snapshot: VideoSnapshot;
  sequence: Sequence;
  editable: boolean;
}

function live(): Live | null {
  const video = useVideo.getState().video;
  const snapshot = video?.state?.video;
  const sequence = snapshot ? rootSequence(snapshot) : null;
  if (!video?.videoId || !snapshot || !sequence) return null;
  return { videoId: video.videoId, snapshot, sequence, editable: canEdit(video) };
}

/** 选中的片段，按轨道自下而上、时间先后：粘贴时低层先放，新建的轨道也就保持原来的上下次序。 */
function picked(sequence: Sequence): SequenceItem[] {
  const ids = new Set(useEditor.getState().selection);
  const order = new Map(sequence.tracks.map((track) => [track.id, track.order]));
  return sequence.items
    .filter((item) => ids.has(item.id))
    .sort(
      (a, b) =>
        (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0) ||
        itemFrames(a, sequence.fps).start - itemFrames(b, sequence.fps).start,
    );
}

function say(message: string): void {
  ToastQueue.neutral(message, { timeout: TOAST_MS });
}

/** 上一条带撤销的提示：S2 带操作的提示不会自己消失（给读屏留时间），新的一条出来时收掉旧的，不越堆越多。 */
let closeUndoToast: (() => void) | null = null;

/** 带「撤销」的提示：撤的是这一笔事务，不是栈顶（期间可能又做了别的）。 */
function undoToast(actions: EditorActions, message: string, receipt: TransactionReceipt): void {
  closeUndoToast?.();
  const close = ToastQueue.positive(message, {
    actionLabel: COPY.undo,
    onAction: () => void actions.undo({ transaction: receipt.transactionId }),
    shouldCloseOnAction: true,
    onClose: () => {
      if (closeUndoToast === close) closeUndoToast = null;
    },
  });
  closeUndoToast = close;
}

/** ⌘C：选中的片段放进剪贴板。返回复制了几件。 */
export function copySelection(): number {
  const ctx = live();
  if (!ctx) return 0;
  const items = picked(ctx.sequence);
  if (!items.length) {
    say(COPY.pick(COPY.copy));
    return 0;
  }
  useClipboard.getState().put(ctx.videoId, items);
  ToastQueue.positive(COPY.copied(items.length), { timeout: TOAST_MS });
  return items.length;
}

/** ⌘X：复制再删除，一笔事务，提示带撤销。 */
export async function cutSelection(actions: EditorActions): Promise<void> {
  const ctx = live();
  if (!ctx?.editable) return;
  const items = picked(ctx.sequence);
  if (!items.length) return say(COPY.pick(COPY.cutItem));
  useClipboard.getState().put(ctx.videoId, items);
  const receipt = await actions.apply(
    [{ type: 'deleteItems', sequenceId: ctx.sequence.id, itemIds: items.map((item) => item.id) }],
    COPY.labelCut,
  );
  if (!receipt) return;
  useEditor.getState().select([]);
  undoToast(actions, COPY.cut(items.length), receipt);
}

/** Delete：删除选中的片段，提示带撤销。键盘、走带、检查器与右键菜单都走这一条，可删的片段由 `deletableItemIds` 定。 */
export async function deleteSelection(actions: EditorActions): Promise<void> {
  const ctx = live();
  if (!ctx?.editable) return;
  const itemIds = deletableItemIds(ctx.sequence, useEditor.getState().selection);
  if (!itemIds.length) return say(COPY.pick(COPY.remove));
  const receipt = await actions.apply([{ type: 'deleteItems', sequenceId: ctx.sequence.id, itemIds }], COPY.labelDelete);
  if (!receipt) return;
  useEditor.getState().select([]);
  undoToast(actions, COPY.deleted(itemIds.length), receipt);
}

/** ⌘V：把剪贴板粘回复制它的那个视频。 */
export async function pasteClipboard(actions: EditorActions): Promise<void> {
  const ctx = live();
  if (!ctx?.editable) return;
  const { entries, videoId } = useClipboard.getState();
  if (!entries.length) return say(COPY.clipboardEmpty(MOD_KEY));
  if (videoId !== ctx.videoId) return say(COPY.otherVideo);
  await spawn(actions, ctx, entries, COPY.labelPaste, COPY.pasted);
}

/** ⌘D：选中的片段原样再来一份（不经剪贴板）。 */
export async function duplicateSelection(actions: EditorActions): Promise<void> {
  const ctx = live();
  if (!ctx?.editable) return;
  const items = picked(ctx.sequence);
  if (!items.length) return say(COPY.pick(COPY.duplicate));
  await spawn(actions, ctx, items, COPY.labelDuplicate, COPY.duplicated);
}

/** 造副本（原型 spawn）：整批一笔事务、一条撤销记录，之后选中新副本。 */
async function spawn(
  actions: EditorActions,
  ctx: Live,
  entries: readonly SequenceItem[],
  label: string,
  message: (n: number) => string,
): Promise<void> {
  const generation = useClipboard.getState().nextGeneration();
  const { assets, documents } = ctx.snapshot;
  const plan = pasteOperations(ctx.sequence, entries, {
    playheadFrame: frameAt(useEditor.getState().playhead, ctx.sequence.fps),
    generation,
    labelOf: (item) => itemLabel(item, assets, documents),
  });
  if (!plan.count) return;
  const receipt = await actions.apply(plan.operations, label);
  if (!receipt) return;
  const fresh = live()?.sequence ?? ctx.sequence;
  useEditor.getState().select(createdItemIds(receipt.createdIds, fresh));
  undoToast(actions, message(plan.count), receipt);
}

/** 在播放头处拆分：给了片段就只拆它们，否则按选区（没有选中时拆所有跨过播放头的）。 */
export function splitAtPlayhead(actions: EditorActions, itemIds?: readonly Id[]): void {
  const ctx = live();
  if (!ctx?.editable) return;
  const splits = splitOperations(ctx.sequence, itemIds ?? useEditor.getState().selection, frameAt(useEditor.getState().playhead, ctx.sequence.fps));
  if (splits.length) void actions.apply(splits, COPY.labelSplit);
}

/** 这件片段能不能在播放头处拆开（右键菜单的那一项）。 */
export function canSplitAt(sequence: Sequence, itemId: Id, playhead: number): boolean {
  return splitOperations(sequence, [itemId], frameAt(playhead, sequence.fps)).length > 0;
}

/** 停用或启用一件片段：还在时间线上，画面与导出都跳过（`updateItem.enabled`）。 */
export function setItemEnabled(actions: EditorActions, itemId: Id, enabled: boolean): void {
  const ctx = live();
  if (!ctx?.editable) return;
  void actions.apply([{ type: 'updateItem', sequenceId: ctx.sequence.id, itemId, enabled }], enabled ? COPY.labelEnable : COPY.labelDisable);
}

/** ⌘A：选中播放头下的片段（原型 selectAll）。 */
export function selectAtPlayhead(): void {
  const ctx = live();
  if (!ctx) return;
  const ids = itemsAtFrame(ctx.sequence, frameAt(useEditor.getState().playhead, ctx.sequence.fps));
  useEditor.getState().select(ids);
  say(ids.length ? COPY.selectedAtPlayhead(ids.length) : COPY.nothingAtPlayhead);
}

// ---- ⌥←/→：连按合成一笔 ----
// 每按一次只改编辑器里的草稿（时间线照它画位移），停手 900ms、按了别的键、点了别处、换了选区或离开编辑器时才提交，
// 所以一串微调只占一条撤销记录。草稿还没提交时按 ⌘Z 直接丢掉草稿。

let nudgeTimer: ReturnType<typeof setTimeout> | null = null;

const sameIds = (a: readonly Id[], b: readonly Id[]) => a.length === b.length && a.every((id, index) => id === b[index]);

/** 选中的片段在时间上再挪 `step` 帧（挪不动时不变）。 */
export function nudgeTime(actions: EditorActions, step: number): void {
  const ctx = live();
  if (!ctx?.editable) return;
  const { selection, nudge, setNudge } = useEditor.getState();
  if (!selection.length) return;
  let base: NudgeDraft | null = nudge;
  if (base && (base.committing || base.revision !== ctx.snapshot.revision || !sameIds(base.itemIds, selection))) {
    flushNudge(actions);
    base = null;
  }
  const delta = base?.deltaFrames ?? 0;
  const next = nudgeDelta(ctx.sequence, selection, delta, step);
  if (next !== delta) setNudge({ itemIds: [...selection], deltaFrames: next, revision: ctx.snapshot.revision, committing: false });
  if (!base && next === delta) return;
  if (nudgeTimer) clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(() => flushNudge(actions), NUDGE_WINDOW_MS);
}

/** 提交攒下的微调。提交落地（视频版本变了）之后才清掉草稿，时间线不会先弹回原处再跳过去。 */
export function flushNudge(actions: EditorActions): void {
  if (nudgeTimer) clearTimeout(nudgeTimer);
  nudgeTimer = null;
  const draft = useEditor.getState().nudge;
  if (!draft || draft.committing) return;
  const ctx = live();
  const operation =
    ctx?.editable && draft.deltaFrames
      ? moveOperation(ctx.sequence, { itemId: draft.itemIds[0]!, itemIds: draft.itemIds, deltaFrames: draft.deltaFrames, trackId: null })
      : null;
  if (!operation) {
    useEditor.getState().setNudge(null);
    return;
  }
  const committing: NudgeDraft = { ...draft, committing: true };
  const clear = () => {
    if (useEditor.getState().nudge === committing) useEditor.getState().setNudge(null);
  };
  useEditor.getState().setNudge(committing);
  void actions.apply([operation], COPY.labelNudge).then((receipt) => {
    if (!receipt || useVideo.getState().video?.state?.video.revision !== draft.revision) return clear();
    const stop = useVideo.subscribe((state) => {
      if (state.video?.state?.video.revision === draft.revision) return;
      stop();
      clear();
    });
  });
}

/** 丢掉还没提交的微调（⌘Z）。丢掉了返回 true；已经在提交的不算。 */
export function dropNudge(): boolean {
  const draft = useEditor.getState().nudge;
  if (!draft || draft.committing) return false;
  if (nudgeTimer) clearTimeout(nudgeTimer);
  nudgeTimer = null;
  useEditor.getState().setNudge(null);
  return true;
}

// ---- 画布浮动工具条与多选页 ----
// 工具条只对选中框里的那一件下手：选区里可能还带着主视频（⇧ 点过它），所以按片段 ID，不按选区。

/** 工具条的「复制一份」：这几件原样再来一份，与 ⌘D 同一条路（一笔事务、选中新副本、提示带撤销）。 */
export async function duplicateItems(actions: EditorActions, itemIds: readonly Id[]): Promise<void> {
  const ctx = live();
  if (!ctx?.editable) return;
  const entries = ctx.sequence.items.filter((item) => itemIds.includes(item.id));
  if (!entries.length) return say(COPY.pick(COPY.duplicate));
  await spawn(actions, ctx, entries, COPY.labelDuplicate, COPY.duplicated);
}

/** 工具条的「删除」：删掉这几件，选区里去掉它们，提示带撤销。 */
export async function deleteItems(actions: EditorActions, itemIds: readonly Id[]): Promise<void> {
  const ctx = live();
  if (!ctx?.editable || !itemIds.length) return;
  const receipt = await actions.apply([{ type: 'deleteItems', sequenceId: ctx.sequence.id, itemIds: [...itemIds] }], COPY.labelDelete);
  if (!receipt) return;
  const { selection, select } = useEditor.getState();
  select(selection.filter((id) => !itemIds.includes(id)));
  undoToast(actions, COPY.deleted(itemIds.length), receipt);
}

/** 多选页的对齐与分布：整批一笔事务、一步撤销，提示带撤销；没有要挪的就只说一声，不提交空事务。 */
export async function applyArrangement(
  actions: EditorActions,
  operations: Parameters<EditorActions['apply']>[0],
  label: string,
  done: string,
  idle: string,
): Promise<void> {
  const ctx = live();
  if (!ctx?.editable) return;
  if (!operations.length) return say(idle);
  const receipt = await actions.apply(operations, label);
  if (receipt) undoToast(actions, done, receipt);
}

// ---- 配音块（时间线的块菜单，timeline-dub.tsx；设计稿 timeline-dub.jsx `DubBlockMenu`）----
// 都只作用于选中的配音块，选区里别的实例不管；每个命令一笔事务、一条撤销记录。

/** 静音或取消静音这几块配音。 */
export async function muteDubBlocks(actions: EditorActions, itemIds: readonly Id[], muted: boolean): Promise<void> {
  const ctx = live();
  if (!ctx?.editable) return;
  const operations = muteOperations(ctx.sequence, itemIds, muted);
  if (!operations.length) return;
  const receipt = await actions.apply(operations, muted ? DUB.labelMute : DUB.labelUnmute);
  if (receipt) say(muted ? DUB.muted(itemIds.length) : DUB.unmuted(itemIds.length));
}

/** 删除这几块配音（只删实例；配音计划与别的块不动），提示带撤销。 */
export async function deleteDubBlocks(actions: EditorActions, itemIds: readonly Id[]): Promise<void> {
  const ctx = live();
  if (!ctx?.editable) return;
  const present = new Set(ctx.sequence.items.map((item) => item.id));
  const ids = itemIds.filter((id) => present.has(id));
  if (!ids.length) return;
  const receipt = await actions.apply([{ type: 'deleteItems', sequenceId: ctx.sequence.id, itemIds: ids }], DUB.labelRemove);
  if (!receipt) return;
  useEditor.getState().select(useEditor.getState().selection.filter((id) => !ids.includes(id)));
  undoToast(actions, DUB.removed(ids.length), receipt);
}

/**
 * 移除整组配音：走翻译配音收据「撤销这组配音」撤不了时的那条反向操作（model/dub-undo.ts）——一笔事务里删掉这一组的实例
 * （含分离出来的背景声）、恢复这次静音的原声、去掉以配音轨为触发的闪避。这次静音了哪些实例记在配音计划正文里，
 * `readPlan` 取它；取不到时别的照做、提示原声没恢复。空的配音轨与配音计划文档留下（协议没有删轨道与删文档的操作）。
 */
export async function deleteDubGroup(actions: EditorActions, groupId: string, readPlan: () => Promise<unknown>): Promise<void> {
  if (!live()?.editable) return;
  let muted: Id[] = [];
  let unread = false;
  try {
    muted = mutedItemsOf(await readPlan());
  } catch {
    unread = true;
  }
  const ctx = live();
  if (!ctx?.editable) return;
  const group = dubGroups(ctx.sequence).find((candidate) => candidate.groupId === groupId);
  if (!group) return;
  const fallback = fallbackUndoOperations(ctx.sequence, { groupId, trackId: group.trackIds[0]! }, muted);
  if (!fallback.operations.length) return;
  const language = group.language ? langName(group.language) : '';
  const receipt = await actions.apply(fallback.operations, DUB.labelRemoveGroup(language));
  if (!receipt) return;
  useEditor.getState().select([]);
  undoToast(actions, DUB.groupRemoved(language), receipt);
  if (unread) say(DUB.planUnread);
}

/** 正在试听的那一段：再试听一段时先撤掉上一次的监听。 */
let stopAudition: (() => void) | null = null;

/**
 * 试听一段（「听这一句」）：播放头跳到开头、没在播就开播，播到结尾停下。中途用户暂停或跳到这一段之前就不再管。
 * 播放头的更新来自预览引擎，可能晚一拍：先看到它落进这一段才开始盯结尾。
 */
export function auditionRange(actions: EditorActions, start: number, end: number): void {
  stopAudition?.();
  actions.seek(start);
  if (!useEditor.getState().playing) actions.togglePlay();
  let armed = false;
  const done = () => {
    stop();
    if (stopAudition === done) stopAudition = null;
  };
  const stop = useEditor.subscribe((state) => {
    if (!state.playing) return done();
    const t = state.playhead;
    if (!armed) {
      armed = t >= start - 0.05 && t < end;
      return;
    }
    if (t < start - 0.05) return done();
    if (t >= end) {
      done();
      actions.pause();
    }
  });
  stopAudition = done;
}
