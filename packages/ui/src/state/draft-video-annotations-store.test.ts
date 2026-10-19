import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mark } from '../model/markup.ts';
import type { DraftVideoAnnotation } from '../model/video-annotations.ts';
import { paintFrame } from '../render/markup-paint.ts';
import { draftShotUrl, uploadDraftVideoShots, useDraftVideoAnnotations } from './draft-video-annotations-store.ts';

/** 视频标注草稿里每一帧的截图归这一帧的标注所有（lite-editor §4.1）：一起留、一起重画、一起丢、一起发。 */

vi.mock('../render/markup-paint.ts', () => ({
  paintFrame: vi.fn(async (_base: Blob, marks: readonly Mark[], _group: readonly Mark[], timeMs: number) =>
    marks.length ? new File([`png:${marks.map((m) => m.id).join(',')}`], `frame-${timeMs}.png`, { type: 'image/png' }) : null,
  ),
}));

const video = { conversationId: 'c1', path: 'talk' };
const note = (id: string, timeMs: number, over: Partial<DraftVideoAnnotation> = {}): DraftVideoAnnotation => ({
  id,
  videoId: 'v1',
  video,
  revision: '3',
  timeMs,
  kind: 'box',
  region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
  label: '',
  text: '',
  style: { color: 'red', width: 4 },
  shot: { timeMs },
  ...over,
});
const mark = (id: string, timeMs: number): Mark => ({ id, timeMs, kind: 'box', color: 'red', width: 4, x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
const frame = { base: new Blob(['base'], { type: 'image/png' }), layer: { w: 640, h: 360 }, initials: 'J' };
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const store = () => useDraftVideoAnnotations.getState();
const shot = (timeMs: number) => store().shots.v1?.[timeMs];
const painted = () => (paintFrame as unknown as ReturnType<typeof vi.fn>).mock.calls;

let urls = 0;
beforeEach(() => {
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => `blob:${++urls}`), revokeObjectURL: vi.fn() });
});
afterEach(() => {
  useDraftVideoAnnotations.setState({ annotations: {}, shots: {} });
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('draft-video-annotations-store · 截图', () => {
  it('同一帧的几条共一张图：底图留第一次的，标记并进去再画；不在草稿里的标注不画', async () => {
    store().add('v1', note('a', 3000));
    store().add('v1', note('b', 3000));
    store().addShot('v1', 3000, frame, [mark('a', 3000), mark('zzz', 3000)]);
    store().addShot('v1', 3000, { ...frame, base: new Blob(['other']) }, [mark('b', 3000)]);
    await tick();
    expect(shot(3000)?.base).toBe(frame.base);
    expect(Object.keys(shot(3000)!.marks)).toEqual(['a', 'b']);
    expect(shot(3000)?.file?.name).toBe('frame-3000.png');
    expect(await shot(3000)!.file!.text()).toBe('png:a,b');
    expect(draftShotUrl(note('a', 3000), store().shots.v1!)).toBe(shot(3000)!.url!);
    expect(draftShotUrl(note('c', 9000), store().shots.v1!)).toBeUndefined();
  });

  it('移除一条：那张图上它的标记重画掉，旧地址收回；这一帧最后一条也没了，图一起丢', async () => {
    store().add('v1', note('a', 3000));
    store().add('v1', note('b', 3000));
    store().add('v1', note('c', 7000));
    store().addShot('v1', 3000, frame, [mark('a', 3000), mark('b', 3000)]);
    store().addShot('v1', 7000, frame, [mark('c', 7000)]);
    await tick();
    const first = shot(3000)!.url!;
    store().remove('v1', 'a');
    await tick();
    expect(Object.keys(shot(3000)!.marks)).toEqual(['b']);
    expect(await shot(3000)!.file!.text()).toBe('png:b');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(first);
    expect(shot(3000)!.url).not.toBe(first);
    const last = shot(7000)!.url!;
    store().remove('v1', 'c');
    expect(shot(7000)).toBeUndefined();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(last);
    expect(painted()).toHaveLength(3);
    store().clear('v1');
    expect(store().shots).toEqual({});
  });

  it('发送前每一帧各传一次，同一帧的几条共一个附件 id；传过的不重传，重画后作废；有一张失败就整个抛出', async () => {
    store().add('v1', note('a', 3000));
    store().add('v1', note('b', 3000));
    store().add('v1', note('c', 7000));
    store().add('v1', note('d', 9000, { shot: undefined }));
    store().addShot('v1', 3000, frame, [mark('a', 3000), mark('b', 3000)]);
    store().addShot('v1', 7000, frame, [mark('c', 7000)]);
    await tick();
    const upload = vi.fn(async (file: File) => ({
      id: `att_${file.name}`,
      kind: 'image' as const,
      fileName: file.name,
      mimeType: file.type,
      size: 1,
    }));
    const notes = store().annotations.v1!;
    const first = await uploadDraftVideoShots('v1', notes, upload);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(first.attachments.map((a) => a.id)).toEqual(['att_frame-3000.png', 'att_frame-7000.png']);
    expect(notes.map(first.attachmentOf)).toEqual(['att_frame-3000.png', 'att_frame-3000.png', 'att_frame-7000.png', undefined]);
    // 再发一次（上一次发失败了）：传过的不重传
    const again = await uploadDraftVideoShots('v1', notes, upload);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(again.attachments.map((a) => a.id)).toEqual(['att_frame-3000.png', 'att_frame-7000.png']);
    // 重画后作废：移除 a 之后 3000 那张要重传
    store().remove('v1', 'a');
    await tick();
    await uploadDraftVideoShots('v1', store().annotations.v1!, upload);
    expect(upload).toHaveBeenCalledTimes(3);
    expect(upload.mock.lastCall?.[0]?.name).toBe('frame-3000.png');
    // 失败整个抛出，已传的记录留着
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    store().add('v1', note('e', 11000));
    store().addShot('v1', 11000, frame, [mark('e', 11000)]);
    await tick();
    await expect(uploadDraftVideoShots('v1', store().annotations.v1!, failing)).rejects.toThrow('offline');
    expect(failing).toHaveBeenCalledTimes(1);
    expect(shot(3000)!.ref?.id).toBe('att_frame-3000.png');
  });

  it('发出去的那几条摘掉，它们的帧随之丢掉；发送期间新加的留着', async () => {
    store().add('v1', note('a', 3000));
    store().addShot('v1', 3000, frame, [mark('a', 3000)]);
    await tick();
    store().add('v1', note('b', 5000));
    store().addShot('v1', 5000, frame, [mark('b', 5000)]);
    await tick();
    store().sent('v1', ['a']);
    expect(store().annotations.v1!.map((n) => n.id)).toEqual(['b']);
    expect(Object.keys(store().shots.v1!)).toEqual(['5000']);
  });
});
