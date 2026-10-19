import { create } from 'zustand';
import type { AttachmentRef, Id } from '@baocut/protocol';
import type { Mark } from '../model/lite-markup.ts';
import {
  addVideoAnnotation,
  removeVideoAnnotation,
  type DraftVideoAnnotation,
  type Size,
  type VideoAnnotationError,
} from '../model/video-annotations.ts';
import { paintFrame } from '../render/lite-markup-paint.ts';

/**
 * 编辑器预览画面上加进对话的视频标注（产品设计 §3.2.3「视频标注」），按**视频 id** 分：编辑器的快聊会话常常还没建，
 * 所以草稿挂在视频上，不挂在会话上（原型 store.jsx 的 `videoNotes[videoId]`）。composer 上显示「视频标注 · N 条」，
 * 发送时随消息交出去，发出去的那几条摘掉。只在这个窗口里，不持久化（同另外三种标注）。
 *
 * 每条标注连着它那一帧的截图（lite-editor §4.1）：`shots[videoId][timeMs]` 是那一帧的底图加上这一帧还在草稿里的标记画成的 PNG，
 * 同一帧的几条共一张。截图归标注所有，不是输入框里另一张可以单独删的图片——移除一条标注，那张图上它的标记就重画掉，这一帧
 * 最后一条也没了图就一起丢；发送时每张各上传一次作为消息的附件，标注的 `shot.attachment` 记它的附件 id。
 */
export interface DraftVideoShot {
  /** 那一帧的底图（预览画布或窗口截下的 PNG）。 */
  base: Blob;
  /** 画标记时画面的尺寸（CSS 像素）：线宽、字号与印章按底图比它的比例放大。 */
  layer: Size;
  /** 印章上的缩写。 */
  initials: string;
  /** 标注 id → 这条标注画的标记（画到图上；按加进来的顺序，编号据此数）。 */
  marks: Record<string, Mark>;
  /** 底图加上标记画好的那张图；还在画、或画不出来时 null。 */
  file: File | null;
  /** 缩略图地址（object URL），随 `file`。 */
  url: string | null;
  /** 这张图已经上传过：再发时不重传；重画后作废。 */
  ref: AttachmentRef | null;
}

interface DraftVideoAnnotationsStore {
  /** 视频 id → 按添加顺序的标注。 */
  annotations: Record<Id, readonly DraftVideoAnnotation[]>;
  /** 视频 id → 帧（毫秒）→ 那一帧的截图。 */
  shots: Record<Id, Record<number, DraftVideoShot>>;
  /** 接在后面加一条；加不进去时返回原因，草稿不变。 */
  add(videoId: Id, note: DraftVideoAnnotation): VideoAnnotationError | null;
  /**
   * 给这一帧加截图：底图第一次来时留下（已经有的不换），这几条标注的标记并进去，再画一张。标注要先 `add` 进来——
   * 不在草稿里的标注的标记不画。
   */
  addShot(videoId: Id, timeMs: number, frame: { base: Blob; layer: Size; initials: string }, marks: readonly Mark[]): void;
  remove(videoId: Id, id: string): void;
  clear(videoId: Id): void;
  /** 发出去了：摘掉发出去的那几条（发送期间新加的留着），它们的截图随之丢掉或重画。 */
  sent(videoId: Id, ids: readonly string[]): void;
  /** 一张图上传完：记下附件，再发时不重传。 */
  uploaded(videoId: Id, timeMs: number, file: File, ref: AttachmentRef): void;
}

const EMPTY: readonly DraftVideoAnnotation[] = [];
const NO_SHOTS: Record<number, DraftVideoShot> = {};

const revoke = (url: string | null) => {
  if (url) URL.revokeObjectURL(url);
};
const objectUrl = (file: File): string | null => {
  try {
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
};

export const useDraftVideoAnnotations = create<DraftVideoAnnotationsStore>()((set, get) => {
  /** 每一帧最近一次重画的序号：慢的那次画完回来时已经被更新的盖掉，不写回。 */
  const painting = new Map<string, number>();
  const key = (videoId: Id, timeMs: number) => `${videoId}:${timeMs}`;

  const setShot = (videoId: Id, timeMs: number, shot: DraftVideoShot | null) =>
    set((s) => {
      const forVideo = { ...(s.shots[videoId] ?? NO_SHOTS) };
      if (shot) forVideo[timeMs] = shot;
      else delete forVideo[timeMs];
      const shots = { ...s.shots };
      if (Object.keys(forVideo).length) shots[videoId] = forVideo;
      else delete shots[videoId];
      return { shots };
    });

  /** 这部视频草稿里所有画到图上的标记，按标注的顺序（编号按整组数，同标记层上的样子）。 */
  const group = (videoId: Id): Mark[] => {
    const shots = get().shots[videoId] ?? NO_SHOTS;
    const marks: Mark[] = [];
    for (const note of get().annotations[videoId] ?? EMPTY) {
      const mark = note.shot ? shots[note.shot.timeMs]?.marks[note.id] : undefined;
      if (mark) marks.push(mark);
    }
    return marks;
  };

  /** 把这一帧的图重画一遍（底图 + 还在草稿里的标记）；画好写回，旧地址收回，上传过的附件作废。 */
  const repaint = (videoId: Id, timeMs: number) => {
    const seq = (painting.get(key(videoId, timeMs)) ?? 0) + 1;
    painting.set(key(videoId, timeMs), seq);
    const shot = get().shots[videoId]?.[timeMs];
    if (!shot) return;
    void paintFrame(shot.base, Object.values(shot.marks), group(videoId), timeMs, shot.layer, shot.initials)
      .catch(() => null)
      .then((file) => {
        if (painting.get(key(videoId, timeMs)) !== seq) return;
        const current = get().shots[videoId]?.[timeMs];
        if (!current) return;
        revoke(current.url);
        setShot(videoId, timeMs, { ...current, file, url: file ? objectUrl(file) : null, ref: null });
      });
  };

  /** 标注变了：每一帧的图只留还在草稿里的标注的标记；没有标注指着的那一帧连图一起丢。 */
  const write = (videoId: Id, next: readonly DraftVideoAnnotation[]) => {
    if (next === (get().annotations[videoId] ?? EMPTY)) return;
    set((s) => {
      const annotations = { ...s.annotations };
      if (next.length) annotations[videoId] = next;
      else delete annotations[videoId];
      return { annotations };
    });
    const shots = get().shots[videoId] ?? NO_SHOTS;
    const kept = new Set(next.map((n) => n.id));
    const framesInUse = new Set(next.map((n) => n.shot?.timeMs).filter((t): t is number => t !== undefined));
    for (const [at, shot] of Object.entries(shots)) {
      const timeMs = Number(at);
      if (!framesInUse.has(timeMs)) {
        painting.set(key(videoId, timeMs), (painting.get(key(videoId, timeMs)) ?? 0) + 1);
        revoke(shot.url);
        setShot(videoId, timeMs, null);
        continue;
      }
      const remaining = Object.fromEntries(Object.entries(shot.marks).filter(([id]) => kept.has(id)));
      if (Object.keys(remaining).length === Object.keys(shot.marks).length) continue;
      setShot(videoId, timeMs, { ...shot, marks: remaining });
      repaint(videoId, timeMs);
    }
  };

  return {
    annotations: {},
    shots: {},
    add: (videoId, note) => {
      const { list, error } = addVideoAnnotation(get().annotations[videoId] ?? EMPTY, note);
      if (!error) write(videoId, list);
      return error;
    },
    addShot: (videoId, timeMs, frame, marks) => {
      const inDraft = new Set((get().annotations[videoId] ?? EMPTY).map((n) => n.id));
      const current = get().shots[videoId]?.[timeMs];
      const next: DraftVideoShot = current
        ? { ...current, marks: { ...current.marks } }
        : { base: frame.base, layer: frame.layer, initials: frame.initials, marks: {}, file: null, url: null, ref: null };
      for (const mark of marks) if (inDraft.has(mark.id)) next.marks[mark.id] = mark;
      setShot(videoId, timeMs, next);
      repaint(videoId, timeMs);
    },
    remove: (videoId, id) => write(videoId, removeVideoAnnotation(get().annotations[videoId] ?? EMPTY, id)),
    clear: (videoId) => write(videoId, EMPTY),
    sent: (videoId, ids) => {
      const gone = new Set(ids);
      const before = get().annotations[videoId] ?? EMPTY;
      const after = before.filter((n) => !gone.has(n.id));
      write(videoId, after.length === before.length ? before : after);
    },
    uploaded: (videoId, timeMs, file, ref) => {
      const current = get().shots[videoId]?.[timeMs];
      if (current && current.file === file) setShot(videoId, timeMs, { ...current, ref });
    },
  };
});

/** 这部视频草稿里的视频标注；没有时是同一个空数组（订阅不抖）。 */
export function useDraftVideoAnnotationList(videoId: Id | null | undefined): readonly DraftVideoAnnotation[] {
  return useDraftVideoAnnotations((s) => (videoId ? (s.annotations[videoId] ?? EMPTY) : EMPTY));
}

/** 这部视频草稿里各帧的截图（毫秒 → 截图）；没有时是同一个空对象。 */
export function useDraftVideoShots(videoId: Id | null | undefined): Record<number, DraftVideoShot> {
  return useDraftVideoAnnotations((s) => (videoId ? (s.shots[videoId] ?? NO_SHOTS) : NO_SHOTS));
}

/** 一条标注在列表里的缩略图地址：它那一帧画好的图；还没画好、或没截到时 undefined。 */
export function draftShotUrl(note: DraftVideoAnnotation, shots: Record<number, DraftVideoShot>): string | undefined {
  return (note.shot && shots[note.shot.timeMs]?.url) || undefined;
}

/**
 * 发送前把这几条标注涉及的每一帧截图各上传一次（同一帧的几条共一张；上传过的不重传），返回要附在消息上的附件与每条标注对应的
 * 附件 id（这一帧没截到图、或画不出来时 undefined）。有一张传不上去就整个抛出，草稿与已传的记录都留着，再发时只传没传上的。
 */
export async function uploadDraftVideoShots(
  videoId: Id,
  notes: readonly DraftVideoAnnotation[],
  upload: (file: File) => Promise<AttachmentRef>,
): Promise<{ attachments: AttachmentRef[]; attachmentOf: (note: DraftVideoAnnotation) => Id | undefined }> {
  const shots = useDraftVideoAnnotations.getState().shots[videoId] ?? NO_SHOTS;
  const frames = [...new Set(notes.map((n) => n.shot?.timeMs).filter((t): t is number => t !== undefined))].filter((t) => shots[t]?.file);
  const refs = new Map<number, AttachmentRef>();
  const results = await Promise.allSettled(
    frames.map(async (timeMs) => {
      const shot = shots[timeMs]!;
      const file = shot.file!;
      const ref = shot.ref ?? (await upload(file));
      useDraftVideoAnnotations.getState().uploaded(videoId, timeMs, file, ref);
      refs.set(timeMs, ref);
    }),
  );
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) throw failed.reason;
  return {
    attachments: frames.map((timeMs) => refs.get(timeMs)!),
    attachmentOf: (note) => (note.shot ? refs.get(note.shot.timeMs)?.id : undefined),
  };
}
