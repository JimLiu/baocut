import { describe, expect, it } from 'vitest';
import type { Conversation, ConversationSnapshot, TimelineItem } from '@baocut/protocol';
import { useTimeline } from './timeline-store.ts';

const conversation = { id: 'conv_1', title: 'x' } as Conversation;
const item = (id: string) => ({ kind: 'agent-message', id, taskId: 't1', text: '', streaming: false }) as unknown as TimelineItem;

describe('会话镜像分页', () => {
  it('prepend 接上起点相符的一页；起点不符时镜像保持同一引用', () => {
    const snapshot: ConversationSnapshot = { conversation, items: [item('m4')], offset: 4 };
    useTimeline.getState().replace('conv_1', snapshot);

    const before = useTimeline.getState().byConversationId;
    useTimeline.getState().prepend('conv_1', 3, { items: [item('m1')], offset: 1 });
    expect(useTimeline.getState().byConversationId).toBe(before);

    useTimeline.getState().prepend('conv_1', 4, { items: [item('m2'), item('m3')], offset: 2 });
    const next = useTimeline.getState().byConversationId.conv_1!;
    expect(next.items.map((i) => i.id)).toEqual(['m2', 'm3', 'm4']);
    expect(next.offset).toBe(2);
  });

  it('没载入的会话收到一页什么也不做', () => {
    const before = useTimeline.getState().byConversationId;
    useTimeline.getState().prepend('conv_missing', 4, { items: [item('m1')], offset: 0 });
    expect(useTimeline.getState().byConversationId).toBe(before);
  });
});
