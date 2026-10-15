import type { EditorToHostMessage, HostToEditorMessage } from '@baocut/slides/editor-messages';
import { describe, expect, it, vi } from 'vitest';
import { ackRid, annotationPath, annotationText, answerFlush, createChatHost, createCommentsHost, doorRid, DoorTracker, HostError, type ParentLink } from './host.ts';

/** 假的父窗口：记下编辑器发的消息，`reply` 模拟父窗口回消息。 */
function fakeLink() {
  const posted: EditorToHostMessage[] = [];
  const listeners = new Set<(message: HostToEditorMessage) => void>();
  const link: ParentLink = {
    post: (message) => posted.push(message),
    onMessage: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const reply = (message: HostToEditorMessage) => {
    for (const listener of listeners) listener(message);
  };
  return { link, posted, reply };
}

const PATH = 'f-tab1#node1/m5j4.247@0-6;thread=t1';

describe('批注', () => {
  it('路径去掉字符偏移，正文去掉开头的 @Agent（以前的文档里是 @Claude）', () => {
    expect(annotationPath(PATH)).toBe('f-tab1#node1/m5j4.247;thread=t1');
    expect(annotationPath('f-a#b;thread=t')).toBe('f-a#b;thread=t');
    expect(annotationText('@Agent⁠ make it shorter ')).toBe('make it shorter');
    expect(annotationText('@Claude⁠ make it shorter ')).toBe('make it shorter');
    expect(annotationText('keep @Claude here')).toBe('keep @Claude here');
    expect(annotationText('keep @Agent here')).toBe('keep @Agent here');
  });

  it('发给父窗口，父窗口收下后回线程 id', async () => {
    const { link, posted, reply } = fakeLink();
    const host = createCommentsHost(link, async () => ({ kind: 'comment', label: 'Plan › "gamma"', quote: 'gamma' }), () => 'r1');
    expect(await host.canSendToClaude()).toBe('available');
    const sent = host.sendToClaude({ anchor: { path: PATH, x: 0, y: 0 }, text: '@Claude tighten this' });
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ type: 'editor:annotate', requestId: 'r1', kind: 'comment', path: 'f-tab1#node1/m5j4.247;thread=t1', label: 'Plan › "gamma"', quote: 'gamma', text: 'tighten this' });
    reply({ type: 'editor:annotate-result', requestId: 'r1', ok: true });
    await expect(sent).resolves.toEqual({ threadId: 't1' });
  });

  it('没有父窗口、找不到批注、父窗口拒绝时抛带 code 的错', async () => {
    const alone = createCommentsHost(null, async () => ({ kind: 'ask', label: 'Plan' }));
    expect(await alone.canSendToClaude()).toBe('no_session');
    await expect(alone.sendToClaude({ anchor: { path: PATH, x: 0, y: 0 }, text: 'x' })).rejects.toMatchObject({ code: 'unavailable' });

    const { link, posted, reply } = fakeLink();
    const missing = createCommentsHost(link, async () => {
      throw new Error('404');
    });
    await expect(missing.sendToClaude({ anchor: { path: PATH, x: 0, y: 0 }, text: 'x' })).rejects.toMatchObject({ code: 'not_found' });

    const refused = createCommentsHost(link, async () => ({ kind: 'ask', label: 'Plan' }), () => 'r2');
    const sent = refused.sendToClaude({ anchor: { path: PATH, x: 0, y: 0 }, text: 'do it' });
    await vi.waitFor(() => expect(posted.at(-1)).toMatchObject({ requestId: 'r2', kind: 'ask' }));
    reply({ type: 'editor:annotate-result', requestId: 'r2', ok: false });
    const error = await sent.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HostError);
    expect(error).toMatchObject({ code: 'unavailable' });
  });
});

describe('Ask Agent', () => {
  it('请父窗口把焦点交给会话的输入框', () => {
    const { link, posted } = fakeLink();
    createChatHost(link).focus();
    expect(posted).toEqual([{ type: 'editor:focus-chat' }]);
  });
});

describe('flush', () => {
  function label(text: string): Uint8Array {
    const bytes = new TextEncoder().encode(text);
    return new Uint8Array([bytes.length & 0xff, bytes.length >> 8, ...bytes, ...new TextEncoder().encode('{}')]);
  }

  it('从发出的帧认出 door 调用，从回来的帧认出回执', () => {
    expect(doorRid(label('~d:12:o:project/p'))).toBe(12);
    expect(doorRid(label('~d:3:b:project/p').buffer)).toBe(3);
    expect(doorRid(label('feed'))).toBeUndefined();
    expect(doorRid('{"op":"ping"}')).toBeUndefined();
    expect(ackRid(JSON.stringify({ op: 'doorack', rid: 12, status: 200, body: '{}' }))).toBe(12);
    expect(ackRid(JSON.stringify({ op: 'msg', topic: 'doorack' }))).toBeUndefined();
  });

  it('等在途的 door 调用都有回执再回 flushed；断线算完成', async () => {
    const tracker = new DoorTracker();
    tracker.sent(1);
    tracker.sent(2);
    const { link, posted, reply } = fakeLink();
    answerFlush(link, tracker, 0);
    reply({ type: 'editor:flush', requestId: 'f1' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(posted).toHaveLength(0);
    tracker.acked(1);
    expect(tracker.size).toBe(1);
    tracker.acked(2);
    await vi.waitFor(() => expect(posted).toEqual([{ type: 'editor:flushed', requestId: 'f1', saved: true }]));

    tracker.sent(3);
    reply({ type: 'editor:flush', requestId: 'f2' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    tracker.reset();
    await vi.waitFor(() => expect(posted.at(-1)).toEqual({ type: 'editor:flushed', requestId: 'f2', saved: true }));
  });

  it('等不到回执时超时，saved 为 false', async () => {
    const tracker = new DoorTracker();
    tracker.sent(9);
    await expect(tracker.idle(20)).resolves.toBe(false);
    tracker.acked(9);
    await expect(tracker.idle(20)).resolves.toBe(true);
  });
});
