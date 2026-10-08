import type { EditorContext, Id } from '@baocut/protocol';
import { targetKey } from '../model/workspace.ts';
import { useEditor } from './editor-store.ts';
import { routeVideo, useShell, type Route } from './shell-store.ts';
import { useVideo, type OpenVideo } from './video-store.ts';

/**
 * 发给智能体的编辑器上下文（产品设计 §3.2.3 引用标签、§6.7 上下文理解）：打开的视频、它的版本、
 * 选中的片段和播放头。只在视频属于这个会话的来源目录时附带——智能体只能读写那里的视频。
 */

/** 会话的来源：所属项目，或不属于项目的会话自己。 */
export interface ContextScope {
  conversationId: Id | null;
  projectId: Id | null;
}

const MAX_SELECTION = 200;

/**
 * 打开的视频就是眼前这个位置的视频（Home 的当前视频标签，或 Space 打开的视频）。换会话、换标签时视频不关
 * （功能区标签还引用着它），但别的会话里开着的视频不随这里的消息附带。
 */
function routeKey(route: Route): string | null {
  const target = routeVideo(route);
  return target ? targetKey(target) : null;
}

function inScope(video: OpenVideo | null, scope: ContextScope, shown: string | null): video is OpenVideo & { ref: NonNullable<OpenVideo['ref']> } {
  const source = video?.ref?.source;
  if (!source || shown === null || targetKey(video.target) !== shown) return false;
  return scope.projectId
    ? source.projectId === scope.projectId
    : scope.conversationId !== null && source.conversationId === scope.conversationId;
}

/** 发送时取一次：版本、选区与播放头都是这一刻的。 */
export function captureEditorContext(scope: ContextScope): EditorContext | null {
  const video = useVideo.getState().video;
  if (!inScope(video, scope, routeKey(useShell.getState().route)) || !video.state || !video.videoId) return null;
  const editor = useEditor.getState();
  const snapshot = video.state.video;
  const items = new Set(snapshot.sequences[snapshot.rootSequenceId]?.items.map((item) => item.id) ?? []);
  const selection = editor.videoId === video.videoId ? editor.selection.filter((id) => items.has(id)).slice(0, MAX_SELECTION) : [];
  return {
    videoId: video.videoId,
    videoName: snapshot.name.slice(0, 200),
    videoPath: video.ref.relPath,
    revision: snapshot.revision,
    selection,
    playheadSeconds: editor.videoId === video.videoId ? Math.round(editor.playhead * 1000) / 1000 : 0,
  };
}

/** 输入框上方的引用标签要显示的内容；播放头不在里面，免得播放时整个会话跟着重绘。 */
export function useContextTag(scope: ContextScope): { videoId: Id; videoName: string; selected: number } | null {
  const shown = useShell((s) => routeKey(s.route));
  const videoId = useVideo((s) => (inScope(s.video, scope, shown) && s.video.state ? s.video.videoId : null));
  const videoName = useVideo((s) => s.video?.state?.video.name ?? '');
  const selected = useEditor((s) => (s.videoId === videoId ? s.selection.length : 0));
  return videoId ? { videoId, videoName, selected } : null;
}
