import { create } from 'zustand';
import { applyChannelsEvent } from '@baocut/client';
import {
  DEFAULT_BOT_SETTINGS,
  type BotNotificationEvent,
  type Channel,
  type ChannelGroup,
  type ChannelSummary,
  type ChannelsEvent,
  type ChannelsSnapshot,
  type Id,
} from '@baocut/protocol';
import { needsYouTotal } from '../model/bot.ts';

/**
 * Bot 模式的频道镜像（docs/design/bot-mode 技术方案 §16.2、§17.2）：`channels` 主题的频道摘要、侧栏分组与 Bot 设置，
 * 外加最近一次 `bot.notification`。只由 Runtime 的快照与事件改写。
 */
export interface ChannelsStore extends ChannelsSnapshot {
  ready: boolean;
  /** 最近一次通知（`seq` 每来一次加一，订阅方据此判断是不是新的）。 */
  notification: { seq: number; event: BotNotificationEvent } | null;
  replace(snapshot: ChannelsSnapshot): void;
  apply(event: ChannelsEvent): void;
}

export const useChannels = create<ChannelsStore>()((set) => ({
  ready: false,
  channels: [],
  groups: [],
  settings: DEFAULT_BOT_SETTINGS,
  notification: null,
  // 旧版 Runtime 的快照没有分组：按没有分组算。
  replace: (snapshot) => set({ ready: true, channels: snapshot.channels, groups: snapshot.groups ?? [], settings: snapshot.settings }),
  apply: (event) =>
    set((s) => {
      if (event.type === 'bot.notification') return { notification: { seq: (s.notification?.seq ?? 0) + 1, event } };
      const next = applyChannelsEvent({ channels: s.channels, groups: s.groups, settings: s.settings }, event);
      return { channels: next.channels, groups: next.groups, settings: next.settings };
    }),
}));

/** Rail 徽标：全部频道里等你的任务数。 */
export function useNeedsYouTotal(): number {
  return useChannels((s) => needsYouTotal(s.channels));
}

export function useChannelSummary(id: Id | null): ChannelSummary | undefined {
  return useChannels((s) => (id ? s.channels.find((row) => row.channel.id === id) : undefined));
}

export function useChannel(id: Id | null): Channel | undefined {
  return useChannelSummary(id)?.channel;
}

/** 频道侧栏的分组，按建立的先后。 */
export function useChannelGroups(): ChannelGroup[] {
  return useChannels((s) => s.groups);
}

export function useChannelGroup(id: Id | null): ChannelGroup | undefined {
  return useChannels((s) => (id ? s.groups.find((group) => group.id === id) : undefined));
}

/** 镜像里的频道（命令里查名字、找频道对话用）。 */
export function channelById(id: Id): Channel | undefined {
  return useChannels.getState().channels.find((row) => row.channel.id === id)?.channel;
}

/** 收到的频道里有没有这个对话：用于判断一条会话是不是某个频道的对话。 */
export function channelOfConversation(conversationId: Id): Channel | undefined {
  return useChannels.getState().channels.find((row) => row.channel.conversationId === conversationId)?.channel;
}
