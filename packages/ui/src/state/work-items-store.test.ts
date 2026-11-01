import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_BOT_SETTINGS, type ChannelSummary, type WorkItem, type WorkItemsSnapshot } from '@baocut/protocol';
import { useChannels } from './channels-store.ts';
import { findWorkItem, subscribedWorkItemChannels, syncWorkItemSubscriptions, useWorkItems } from './work-items-store.ts';

const item = (id: string, title = id) => ({ id, title, channelId: 'c1', status: 'upNext' }) as WorkItem;
const snapshot = (items: WorkItem[]): WorkItemsSnapshot => ({ items, resolvedTail: 20, reports: [] });

afterEach(() => {
  syncWorkItemSubscriptions({ subscribeWorkItems: () => () => {} }, []);
  useWorkItems.setState({ byChannel: {}, transitions: {} });
  useChannels.setState({ ready: false, channels: [], groups: [], settings: DEFAULT_BOT_SETTINGS, notification: null });
});

describe('work items store', () => {
  it('keeps a snapshot per channel and applies events', () => {
    const store = useWorkItems.getState();
    store.replace('c1', snapshot([item('a')]));
    store.apply('c1', { type: 'work-item.upsert', item: item('a', 'renamed') });
    store.apply('c1', { type: 'work-item.upsert', item: item('b') });
    store.apply('c1', { type: 'work-item.removed', id: 'b' });
    expect(useWorkItems.getState().byChannel.c1!.items.map((i) => i.title)).toEqual(['renamed']);
    expect(findWorkItem(useWorkItems.getState(), 'a')?.title).toBe('renamed');
  });

  it('counts transition events per task even before the snapshot arrives', () => {
    const transition = { workItemId: 'a', from: 'upNext', to: 'active', actor: 'user', cause: 'user:start', note: null, at: '' } as const;
    useWorkItems.getState().apply('c9', { type: 'work-item.transition', transition });
    useWorkItems.getState().apply('c9', { type: 'work-item.transition', transition });
    expect(useWorkItems.getState().transitions.a).toBe(2);
  });

  it('subscribes only the wanted channels and drops the rest', () => {
    const live = new Set<string>();
    const client = {
      subscribeWorkItems: (channelId: string, handlers: { snapshot(s: WorkItemsSnapshot, seq: number): void }) => {
        live.add(channelId);
        handlers.snapshot(snapshot([item(`${channelId}-1`)]), 1);
        return () => live.delete(channelId);
      },
    } as never;
    syncWorkItemSubscriptions(client, ['c1', 'c2']);
    expect(subscribedWorkItemChannels()).toEqual(['c1', 'c2']);
    syncWorkItemSubscriptions(client, ['c2', 'c3']);
    expect([...live].sort()).toEqual(['c2', 'c3']);
    expect(Object.keys(useWorkItems.getState().byChannel).sort()).toEqual(['c2', 'c3']);
  });
});

describe('channels store', () => {
  it('replaces, upserts and remembers the latest notification', () => {
    const summary = (id: string, needsYou: number) =>
      ({ channel: { id, kind: 'topic', pinned: false }, counts: { needsYou, working: 0, upNext: 0, suggested: 0, scheduled: 0, open: 0 }, lastActivityAt: '', unread: false, spend: null }) as unknown as ChannelSummary;
    const store = useChannels.getState();
    store.replace({ channels: [summary('a', 1)], groups: [], settings: DEFAULT_BOT_SETTINGS });
    store.apply({ type: 'channel.upsert', summary: summary('b', 2) });
    store.apply({ type: 'bot.settings', settings: { ...DEFAULT_BOT_SETTINGS, stallMinutes: 30 } });
    store.apply({ type: 'bot.notification', channelId: 'a', workItemId: 'w', reason: 'needs-input', headline: 'h', question: null, at: '', muted: false });
    const state = useChannels.getState();
    expect(state.ready).toBe(true);
    expect(state.channels.map((r) => r.channel.id).sort()).toEqual(['a', 'b']);
    expect(state.settings.stallMinutes).toBe(30);
    expect(state.notification?.seq).toBe(1);
    expect(state.notification?.event.workItemId).toBe('w');
  });

  it('keeps channel groups from the snapshot and the group events, in creation order', () => {
    const group = (id: string, name = id) => ({ id, name, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' });
    const store = useChannels.getState();
    store.replace({ channels: [], groups: [group('grp_a')], settings: DEFAULT_BOT_SETTINGS });
    store.apply({ type: 'channel-group.upsert', group: group('grp_b') });
    store.apply({ type: 'channel-group.upsert', group: group('grp_a', 'Renamed') });
    expect(useChannels.getState().groups.map((g) => [g.id, g.name])).toEqual([
      ['grp_a', 'Renamed'],
      ['grp_b', 'grp_b'],
    ]);
    store.apply({ type: 'channel-group.removed', id: 'grp_a' });
    expect(useChannels.getState().groups.map((g) => g.id)).toEqual(['grp_b']);
    // 旧版 Runtime 的快照没有 groups：按没有分组算。
    store.replace({ channels: [], settings: DEFAULT_BOT_SETTINGS } as never);
    expect(useChannels.getState().groups).toEqual([]);
  });
});
