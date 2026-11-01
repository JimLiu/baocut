import { describe, expect, it } from 'vitest';
import { CHANNEL_COLORS, CHANNEL_ICONS } from './bot.ts';
import { methodParamSchemas } from './schemas.ts';

/** 频道的图标、颜色、分组与分组方法的入站校验：只认两张固定的表，名字必填、最多 40 字，多出的字段拒绝。 */

describe('channel look and group params', () => {
  const create = methodParamSchemas['channels.create'];
  const update = methodParamSchemas['channels.update'];

  it('the fixed lists have 24 icons and 10 colors, without the main channel icon', () => {
    expect(CHANNEL_ICONS).toHaveLength(24);
    expect(new Set(CHANNEL_ICONS).size).toBe(24);
    expect(CHANNEL_ICONS).not.toContain('Layers');
    expect(CHANNEL_COLORS).toHaveLength(10);
  });

  it('channels.create and channels.update take a listed icon and color, a group id, or null', () => {
    expect(create.safeParse({ name: 'Weekly', icon: 'Video', color: 'purple', groupId: 'grp_1' }).success).toBe(true);
    expect(create.safeParse({ name: 'Weekly', icon: null, color: null, groupId: null }).success).toBe(true);
    for (const icon of CHANNEL_ICONS) expect(update.safeParse({ id: 'chan_1', patch: { icon } }).success).toBe(true);
    for (const color of CHANNEL_COLORS) expect(update.safeParse({ id: 'chan_1', patch: { color } }).success).toBe(true);
    expect(update.safeParse({ id: 'chan_1', patch: { icon: null, color: null, groupId: null } }).success).toBe(true);
  });

  it('rejects icons and colors outside the lists, and an empty group id', () => {
    expect(create.safeParse({ name: 'Weekly', icon: 'Layers' }).success).toBe(false);
    expect(create.safeParse({ name: 'Weekly', color: '#ff0000' }).success).toBe(false);
    expect(update.safeParse({ id: 'chan_1', patch: { icon: 'Rocket' } }).success).toBe(false);
    expect(update.safeParse({ id: 'chan_1', patch: { color: 'teal' } }).success).toBe(false);
    expect(update.safeParse({ id: 'chan_1', patch: { groupId: '' } }).success).toBe(false);
    expect(update.safeParse({ id: 'chan_1', patch: { look: 'x' } }).success).toBe(false);
  });

  it('group names are required and at most 40 characters, trimmed', () => {
    const createGroup = methodParamSchemas['channelGroups.create'];
    const updateGroup = methodParamSchemas['channelGroups.update'];
    expect(createGroup.parse({ name: '  Tutorials  ' })).toEqual({ name: 'Tutorials' });
    expect(createGroup.safeParse({ name: 'x'.repeat(40), channelIds: ['chan_1', 'chan_2'] }).success).toBe(true);
    expect(createGroup.safeParse({ name: '' }).success).toBe(false);
    expect(createGroup.safeParse({ name: '   ' }).success).toBe(false);
    expect(createGroup.safeParse({ name: 'x'.repeat(41) }).success).toBe(false);
    expect(createGroup.safeParse({}).success).toBe(false);
    expect(createGroup.safeParse({ name: 'A', color: 'red' }).success).toBe(false);

    expect(updateGroup.safeParse({ id: 'grp_1', patch: { name: 'Series' } }).success).toBe(true);
    expect(updateGroup.safeParse({ id: 'grp_1', patch: { name: '' } }).success).toBe(false);
    expect(updateGroup.safeParse({ id: 'grp_1', patch: { name: 'x'.repeat(41) } }).success).toBe(false);
    expect(updateGroup.safeParse({ id: 'grp_1', patch: { order: 1 } }).success).toBe(false);

    expect(methodParamSchemas['channelGroups.delete'].safeParse({ id: 'grp_1' }).success).toBe(true);
    expect(methodParamSchemas['channelGroups.delete'].safeParse({ id: 'grp_1', moveTo: null }).success).toBe(false);
  });
});
