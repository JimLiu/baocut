import type { ReactNode } from 'react';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { VideoEditor } from './video-editor.tsx';
import { EDITOR_COPY as E } from './editor-copy.ts';

const editorArea = style({ position: 'relative', display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, minHeight: 0 });

/**
 * Space 打开视频后的内容区（产品设计 §2.1、§5.1，用户修订）：只有编辑器，右下角浮着一个悬浮会话（`overlay`）。
 * Home 的视频在功能区的标签里（workspace/workspace-panes.tsx），会话列与编辑器的布局在 HomePage。
 * 视频的打开与关闭跟着路由与功能区标签走（见 AppShell），这里只管布局。
 */
export function EditorWorkspace({ overlay }: { overlay?: ReactNode }) {
  return (
    <section className={editorArea} aria-label={E.editor}>
      <VideoEditor />
      {overlay}
    </section>
  );
}
