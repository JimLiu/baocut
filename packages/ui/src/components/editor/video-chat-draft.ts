import { targetKey } from '../../model/workspace.ts';
import { routeVideo, type Route } from '../../state/shell-store.ts';
import { startDraftKey } from '../start/open-home.ts';

/** 悬浮会话的草稿按视频分：换一个视频就是另一个输入框，没发出的话不跟过去。 */
export function videoChatDraftKey(videoKey: string | null): string {
  return `video-chat:${videoKey ?? ''}`;
}

/**
 * 开着的视频旁边是哪个输入框的草稿（轻量视图的评论截图进这里，lite-editor §4.1）：主页上视频开在会话旁时是那个会话的输入框
 * （conversation-view.tsx 以会话 ID 为键；还没有会话时是起始页的草稿），Space 里是右下角的悬浮会话（video-quick-chat.tsx）。
 */
export function openVideoDraftKey(route: Route): string {
  if (route.tab === 'home') return route.conversationId ?? startDraftKey(route.projectId);
  const target = routeVideo(route);
  return videoChatDraftKey(target ? targetKey(target) : null);
}
