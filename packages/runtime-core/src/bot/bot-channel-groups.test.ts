import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RpcError, type ChannelsEvent } from '@baocut/protocol';
import type { TrustedPrincipal } from '../gateway.ts';
import { botMethods } from './bot-methods.ts';
import { BotKit } from './testing/bot-kit.ts';

/* 频道的图标、颜色与分组（需求 §11.2 修订）：分组的建、改名、删，频道移进移出，主频道不着色不进分组，确认框用的计数。 */

let kit: BotKit;
beforeEach(async () => {
  kit = await BotKit.open();
  kit.events = [];
});
afterEach(async () => {
  await kit.close();
});

async function codeOf(fn: () => unknown): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (error) {
    return error instanceof RpcError ? error.code : `not-rpc: ${String(error)}`;
  }
}

/** 频道主题里的事件，频道只留 id 与分组，方便比顺序。 */
function trace(events: ChannelsEvent[]): string[] {
  return events.flatMap((e) => {
    if (e.type === 'channel.upsert') return [`channel ${e.summary.channel.id} -> ${e.summary.channel.groupId ?? 'none'}`];
    if (e.type === 'channel-group.upsert') return [`group+ ${e.group.id} ${e.group.name}`];
    if (e.type === 'channel-group.removed') return [`group- ${e.id}`];
    return [];
  });
}

describe('channel look', () => {
  it('a new channel has no icon, color or group unless given; the patch sets and clears them', async () => {
    const plain = await kit.bot.createChannel({ name: 'Plain' });
    expect({ icon: plain.icon, color: plain.color, groupId: plain.groupId }).toEqual({ icon: null, color: null, groupId: null });

    const styled = await kit.bot.createChannel({ name: 'Shorts', icon: 'Filmstrip', color: 'orange' });
    expect({ icon: styled.icon, color: styled.color }).toEqual({ icon: 'Filmstrip', color: 'orange' });

    const updated = await kit.bot.updateChannel(styled.id, { icon: 'Video', color: null });
    expect({ icon: updated.icon, color: updated.color }).toEqual({ icon: 'Video', color: null });
    expect(kit.bot.channel(styled.id).icon).toBe('Video');
  });

  it('the main channel keeps no icon, color or group; the other fields in the same patch still apply', async () => {
    const group = await kit.bot.createGroup('Tutorials');
    const main = await kit.bot.updateChannel(kit.main.id, { name: 'Everything else', icon: 'Video', color: 'red', groupId: group.id });
    expect(main.name).toBe('Everything else');
    expect({ icon: main.icon, color: main.color, groupId: main.groupId }).toEqual({ icon: null, color: null, groupId: null });
    expect(kit.bot.channel(kit.main.id)).toMatchObject({ name: 'Everything else', icon: null, color: null, groupId: null });

    // 建分组时把主频道也点进来：跳过主频道，其余照常移进去。
    const other = await kit.bot.createChannel({ name: 'Dub' });
    const grouped = await kit.bot.createGroup('Audio', [kit.main.id, other.id]);
    expect(kit.bot.channel(kit.main.id).groupId).toBeNull();
    expect(kit.bot.channel(other.id).groupId).toBe(grouped.id);
  });
});

describe('channel groups', () => {
  it('creating a group can move channels into it; the group is published before the channels', async () => {
    const a = await kit.bot.createChannel({ name: 'Weekly' });
    const b = await kit.bot.createChannel({ name: 'Dub' });
    await kit.settle();
    kit.events = [];
    const group = await kit.bot.createGroup('Tutorials', [a.id, b.id, a.id]);
    expect(group).toMatchObject({ name: 'Tutorials' });
    expect(group.id).toMatch(/^grp_/);
    expect(trace(kit.events)).toEqual([`group+ ${group.id} Tutorials`, `channel ${a.id} -> ${group.id}`, `channel ${b.id} -> ${group.id}`]);
    expect(kit.bot.listGroups()).toEqual([group]);
    expect(kit.bot.channelsSnapshot().groups).toEqual([group]);
  });

  it('an unknown channel in the list creates nothing', async () => {
    const a = await kit.bot.createChannel({ name: 'Weekly' });
    await kit.settle();
    kit.events = [];
    expect(await codeOf(() => kit.bot.createGroup('Tutorials', [a.id, 'chan_gone']))).toBe('not-found');
    expect(kit.bot.listGroups()).toEqual([]);
    expect(kit.bot.channel(a.id).groupId).toBeNull();
    expect(trace(kit.events)).toEqual([]);
  });

  it('renames a group; unknown ids are not found', async () => {
    const group = await kit.bot.createGroup('Tutorials');
    await kit.settle();
    kit.events = [];
    const renamed = await kit.bot.updateGroup(group.id, { name: 'Series' });
    expect(renamed).toMatchObject({ id: group.id, name: 'Series', createdAt: group.createdAt });
    expect(trace(kit.events)).toEqual([`group+ ${group.id} Series`]);
    expect(kit.bot.listGroups().map((g) => g.name)).toEqual(['Series']);
    expect(await codeOf(() => kit.bot.updateGroup('grp_gone', { name: 'X' }))).toBe('not-found');
    expect(await codeOf(() => kit.bot.deleteGroup('grp_gone'))).toBe('not-found');
  });

  it('moves a channel into a group and back out; an unknown group is rejected and changes nothing', async () => {
    const group = await kit.bot.createGroup('Tutorials');
    const channel = await kit.bot.createChannel({ name: 'Weekly', groupId: group.id });
    expect(channel.groupId).toBe(group.id);
    expect((await kit.bot.updateChannel(channel.id, { groupId: null })).groupId).toBeNull();
    expect((await kit.bot.updateChannel(channel.id, { groupId: group.id })).groupId).toBe(group.id);

    expect(await codeOf(() => kit.bot.updateChannel(channel.id, { name: 'Renamed', groupId: 'grp_gone' }))).toBe('not-found');
    expect(kit.bot.channel(channel.id)).toMatchObject({ name: 'Weekly', groupId: group.id });
    const before = kit.bot.listChannels().length;
    expect(await codeOf(() => kit.bot.createChannel({ name: 'Orphan', groupId: 'grp_gone' }))).toBe('not-found');
    expect(kit.bot.listChannels()).toHaveLength(before);
  });

  it('deleting a group keeps its channels, ungrouped, and publishes them before the removal', async () => {
    const keep = await kit.bot.createGroup('Keep');
    const gone = await kit.bot.createGroup('Gone');
    const a = await kit.bot.createChannel({ name: 'A', groupId: gone.id });
    const b = await kit.bot.createChannel({ name: 'B', groupId: gone.id });
    const c = await kit.bot.createChannel({ name: 'C', groupId: keep.id });
    await kit.settle();
    kit.events = [];
    await kit.bot.deleteGroup(gone.id);
    expect(trace(kit.events)).toEqual([`channel ${a.id} -> none`, `channel ${b.id} -> none`, `group- ${gone.id}`]);
    expect(kit.bot.listGroups().map((g) => g.id)).toEqual([keep.id]);
    expect([a, b, c].map((ch) => kit.bot.channel(ch.id).groupId)).toEqual([null, null, keep.id]);
  });

  it('groups, icons and colors survive a restart', async () => {
    const group = await kit.bot.createGroup('Tutorials');
    const channel = await kit.bot.createChannel({ name: 'Weekly', icon: 'Video', color: 'purple', groupId: group.id });
    await kit.restart();
    expect(kit.bot.listGroups()).toEqual([group]);
    expect(kit.bot.channel(channel.id)).toMatchObject({ icon: 'Video', color: 'purple', groupId: group.id });
  });

  it('channels.list returns the groups next to the channels', async () => {
    const group = await kit.bot.createGroup('Tutorials');
    const desktop: TrustedPrincipal = { kind: 'desktop', connectionId: 'ui', name: 'desktop' };
    const methods = botMethods(() => kit.bot);
    const listed = await methods['channels.list']({}, desktop);
    expect(listed.groups).toEqual([group]);
    expect(listed.channels.map((row) => row.channel.id)).toContain(kit.main.id);
    expect(await methods['channelGroups.delete']({ id: group.id }, desktop)).toEqual({ deleted: true });
    expect(kit.bot.listGroups()).toEqual([]);
  });
});

describe('channel counts for the confirmations', () => {
  it('counts scheduled tasks and the open ones (not suggestions, not resolved)', async () => {
    const channel = await kit.bot.createChannel({ name: 'Counts' });
    const at = new Date(kit.clock.now() + 24 * 3600_000).toISOString();
    const now = new Date(kit.clock.now()).toISOString();
    await kit.bot.createItem({ channelId: channel.id, title: 'Next', owner: 'user' });
    await kit.bot.createItem({ channelId: channel.id, title: 'Later', owner: 'user', status: 'scheduled', startAt: at });
    await kit.bot.createItem({
      channelId: channel.id,
      title: 'Stuck',
      owner: 'user',
      status: 'active',
      active: { state: 'blocked', reason: 'x', since: now },
    });
    await kit.bot.createItem({ channelId: channel.id, title: 'Idea', owner: 'agent', status: 'suggested' });
    await kit.bot.createItem({
      channelId: channel.id,
      title: 'Done',
      owner: 'user',
      status: 'resolved',
      resolution: { kind: 'done', by: 'user', at: now, evidence: null, confirmedBy: null, mergedInto: null },
    });
    const counts = kit.bot.listChannels().find((row) => row.channel.id === channel.id)!.counts;
    expect(counts).toEqual({ needsYou: 0, working: 0, upNext: 2, suggested: 1, scheduled: 1, open: 3 });
  });
});
