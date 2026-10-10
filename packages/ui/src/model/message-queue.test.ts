import { describe, expect, it, vi } from 'vitest';
import {
  editQueuedMessage,
  enqueueMessage,
  isQueuedMessage,
  readQueuedMessage,
  removeQueuedMessage,
  sendQueueHead,
  sendQueuedNow,
  type QueueAccess,
  type QueuedMessage,
  type SteerStatus,
} from './message-queue.ts';

const msg = (id: string, text = id): QueuedMessage => ({ id, text, attachments: [], queuedAt: '2026-10-03T00:00:00Z' });

function memoryQueue(initial: QueuedMessage[]): QueueAccess & { items: QueuedMessage[] } {
  const box = {
    items: initial,
    read: () => box.items,
    write: (next: QueuedMessage[]) => {
      box.items = next;
    },
  };
  return box;
}

const ids = (queue: { items: QueuedMessage[] }) => queue.items.map((m) => m.id);

describe('排队的增删改', () => {
  it('入队排在最后；删除只删那一条', () => {
    const queue = enqueueMessage(enqueueMessage([], msg('a')), msg('b'));
    expect(queue.map((m) => m.id)).toEqual(['a', 'b']);
    expect(removeQueuedMessage(queue, 'a').map((m) => m.id)).toEqual(['b']);
  });

  it('编辑改文字，图片跟着；改成空的就删掉（图片不能单独发）', () => {
    const image = { id: 'img', kind: 'image' as const, fileName: 'x.png', mimeType: 'image/png', size: 1 };
    const queue = [msg('a'), msg('b'), { ...msg('c'), attachments: [image] }];
    expect(editQueuedMessage(queue, 'a', '  新的  ')[0]!.text).toBe('新的');
    expect(editQueuedMessage(queue, 'c', '换个说法')[2]).toMatchObject({ text: '换个说法', attachments: [image] });
    expect(editQueuedMessage(queue, 'b', '   ').map((m) => m.id)).toEqual(['a', 'c']);
    expect(editQueuedMessage(queue, 'c', '').map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('读回持久化的条目时认形状', () => {
    expect(isQueuedMessage(msg('a'))).toBe(true);
    expect(isQueuedMessage({ id: 'a', text: 'x' })).toBe(false);
    expect(isQueuedMessage({ ...msg('a'), attachments: [{}] })).toBe(false);
    expect(isQueuedMessage(null)).toBe(false);
    // 点选的 skill 随排队消息一起存；形状不对的不要。
    expect(isQueuedMessage({ ...msg('a'), skill: { id: 'subtitle-style' } })).toBe(true);
    expect(isQueuedMessage({ ...msg('a'), skill: 'subtitle-style' })).toBe(false);
    expect(isQueuedMessage({ ...msg('a'), skill: {} })).toBe(false);
    expect(isQueuedMessage({ ...msg('a'), skills: [{ id: 'a' }, { id: 'b' }] })).toBe(true);
    expect(isQueuedMessage({ ...msg('a'), skills: [{ id: 'a' }, {}] })).toBe(false);
    expect(isQueuedMessage({ ...msg('a'), skills: { id: 'a' } })).toBe(false);
  });

  it('读回时把只能点一个 skill 时存的 skill 换成 skills', () => {
    expect(readQueuedMessage({ ...msg('a'), skill: { id: 'old' } })).toEqual({ ...msg('a'), skills: [{ id: 'old' }] });
    expect(readQueuedMessage({ ...msg('a'), skills: [{ id: 'x' }, { id: 'y' }] })).toEqual({ ...msg('a'), skills: [{ id: 'x' }, { id: 'y' }] });
    expect(readQueuedMessage({ ...msg('a'), skill: { id: 'x' }, skills: [{ id: 'x' }, { id: 'y' }] })?.skills).toEqual([{ id: 'x' }, { id: 'y' }]);
    expect(readQueuedMessage(msg('a'))).toEqual(msg('a'));
    expect(readQueuedMessage({ id: 'a' })).toBeNull();
  });
});

describe('立即发送（steer 与回退）', () => {
  const transport = (status: SteerStatus | Error, send = vi.fn(async () => {})) => ({
    steer: vi.fn(async () => {
      if (status instanceof Error) throw status;
      return status;
    }),
    send,
  });

  it('steered：移出队列，不再另发', async () => {
    const queue = memoryQueue([msg('a'), msg('b')]);
    const t = transport('steered');
    expect(await sendQueuedNow(queue, t, 'b')).toEqual({ status: 'steered' });
    expect(ids(queue)).toEqual(['a']);
    expect(t.send).not.toHaveBeenCalled();
  });

  it('unsupported：留在队列（放到队首，任务结束后先发它），不发送', async () => {
    const queue = memoryQueue([msg('a'), msg('b')]);
    const t = transport('unsupported');
    expect(await sendQueuedNow(queue, t, 'b')).toEqual({ status: 'deferred' });
    expect(ids(queue)).toEqual(['b', 'a']);
    expect(t.send).not.toHaveBeenCalled();
  });

  it('no-active-turn：直接 send 这一条', async () => {
    const queue = memoryQueue([msg('a'), msg('b')]);
    const t = transport('no-active-turn');
    expect(await sendQueuedNow(queue, t, 'a')).toEqual({ status: 'sent' });
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(t.send).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    expect(ids(queue)).toEqual(['b']);
  });

  it('send 出错：放回队首，其他的不动也不发', async () => {
    const queue = memoryQueue([msg('a'), msg('b')]);
    const t = transport(
      'no-active-turn',
      vi.fn(async () => {
        throw new Error('busy');
      }),
    );
    expect(await sendQueuedNow(queue, t, 'b')).toEqual({ status: 'failed', error: 'busy' });
    expect(ids(queue)).toEqual(['b', 'a']);
    expect(t.send).toHaveBeenCalledTimes(1);
  });

  it('steer 出错同样放回；已经不在队列里的什么也不做', async () => {
    const queue = memoryQueue([msg('a')]);
    expect(await sendQueuedNow(queue, transport(new Error('断开')), 'a')).toEqual({ status: 'failed', error: '断开' });
    expect(ids(queue)).toEqual(['a']);
    const t = transport('steered');
    expect(await sendQueuedNow(queue, t, 'zzz')).toEqual({ status: 'missing' });
    expect(t.steer).not.toHaveBeenCalled();
  });

  it('移出发生在等待之前：同一条不会被自动发送再取到', async () => {
    const queue = memoryQueue([msg('a'), msg('b')]);
    let release: (status: SteerStatus) => void = () => {};
    const pending = sendQueuedNow(queue, { steer: () => new Promise((r) => (release = r)), send: async () => {} }, 'a');
    expect(ids(queue)).toEqual(['b']);
    release('steered');
    await pending;
    expect(ids(queue)).toEqual(['b']);
  });
});

describe('任务结束后自动发送', () => {
  it('只发队首一条', async () => {
    const queue = memoryQueue([msg('a'), msg('b')]);
    const send = vi.fn(async () => {});
    expect(await sendQueueHead(queue, { send })).toEqual({ status: 'sent' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(ids(queue)).toEqual(['b']);
  });

  it('失败放回队首，不重试', async () => {
    const queue = memoryQueue([msg('a'), msg('b')]);
    const send = vi.fn(async () => {
      throw new Error('没连上');
    });
    expect(await sendQueueHead(queue, { send })).toEqual({ status: 'failed', error: '没连上' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(ids(queue)).toEqual(['a', 'b']);
  });

  it('空队列什么也不做', async () => {
    const send = vi.fn(async () => {});
    expect(await sendQueueHead(memoryQueue([]), { send })).toEqual({ status: 'missing' });
    expect(send).not.toHaveBeenCalled();
  });
});
