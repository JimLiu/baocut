import { describe, expect, it } from 'vitest';
import type { Conversation, ConversationActivity } from '@baocut/protocol';
import { PRESENCE_MS, attentionChannel, attentionEvents, attentionKind, waitingCount } from './attention.ts';

function conv(id: string, activity: ConversationActivity, archived = false): Conversation {
  return {
    id,
    title: `Title ${id}`,
    projectId: null,
    cwd: '/work',
    driverId: 'claude',
    model: null,
    effort: null,
    createdAt: '2026-10-30T00:00:00Z',
    updatedAt: '2026-10-30T00:00:00Z',
    archived,
    pinned: false,
    unread: false,
    activity,
    activeTaskId: null,
  };
}

describe('attention', () => {
  it('只认状态跳变：等批准、等回答、失败；跑完回到空闲算完成，自己停下的不算', () => {
    expect(attentionKind('running', 'awaiting-approval')).toBe('approval');
    expect(attentionKind('running', 'awaiting-answer')).toBe('question');
    expect(attentionKind('running', 'failed')).toBe('failed');
    expect(attentionKind('running', 'idle')).toBe('finished');
    expect(attentionKind('awaiting-approval', 'idle')).toBe('finished');
    expect(attentionKind('stopping', 'idle')).toBeNull();
    expect(attentionKind('failed', 'idle')).toBeNull();
    expect(attentionKind('idle', 'running')).toBeNull();
    expect(attentionKind('awaiting-approval', 'awaiting-approval')).toBeNull();
  });

  it('两份镜像之间：新出现的与已归档的会话不提醒', () => {
    const prev = [conv('a', 'running'), conv('b', 'running'), conv('c', 'idle')];
    const next = [conv('a', 'awaiting-approval'), conv('b', 'idle', true), conv('c', 'idle'), conv('d', 'failed')];
    expect(attentionEvents(prev, next)).toEqual([{ conversationId: 'a', title: 'Title a', kind: 'approval' }]);
  });

  it('徽标数：在等批准或回答的、没归档的会话', () => {
    expect(
      waitingCount([
        conv('a', 'awaiting-approval'),
        conv('b', 'awaiting-answer'),
        conv('c', 'running'),
        conv('d', 'awaiting-answer', true),
      ]),
    ).toBe(2);
  });

  it('打扰的方式：看着这条且人在跟前不打扰；看着别处弹应用内提示；窗口在后台或人走开了发系统通知', () => {
    const now = 1_000_000;
    const here = { focused: true, viewing: 'a', lastInputAt: now - 1000 };
    expect(attentionChannel(here, 'a', now)).toBe('none');
    expect(attentionChannel(here, 'b', now)).toBe('toast');
    expect(attentionChannel({ ...here, focused: false }, 'a', now)).toBe('system');
    expect(attentionChannel({ ...here, lastInputAt: now - PRESENCE_MS - 1 }, 'a', now)).toBe('system');
    expect(attentionChannel({ ...here, lastInputAt: null }, 'a', now)).toBe('system');
  });
});
