import type { Id } from '@baocut/protocol';
import { ToastQueue } from '@react-spectrum/s2';
import { HOME_COPY } from '../../copy.ts';
import { addMaterials, EMPTY_HOME_BRIEF, MAX_HOME_MATERIALS } from '../../model/home-brief.ts';
import { workspaceKey } from '../../model/workspace.ts';
import { NEW_DRAFT, useShell } from '../../state/shell-store.ts';
import { useStartBrief } from '../../state/start-brief-store.ts';

/** 起始页草稿的键：同 start-page.tsx，按路由上的项目分。 */
export function startDraftKey(projectId: Id | null): string {
  return projectId ? `${NEW_DRAFT}:${projectId}` : NEW_DRAFT;
}

/**
 * 别处带着预置来到起始页（原型 `app.newProject(preset)`：Space 的「从文件新建视频」、帮助中心、导入失败「改用本地文件」）：
 * 落在 `projectId` 这个项目的起始页上。`prompt`：输入框空着时填上这句话（已有的话不动）；`materials`：挂成交给 Agent 的本机素材。
 * 编辑器开着时保持打开（功能区的标签跟到那个起始页）。
 */
export function openHome(projectId: Id | null, prefill: { prompt?: string; materials?: readonly string[] } = {}): void {
  const key = startDraftKey(projectId);
  const shell = useShell.getState();
  if (prefill.prompt && !(shell.drafts[key] ?? '').trim()) shell.setDraft(key, prefill.prompt);
  if (prefill.materials?.length) {
    const current = useStartBrief.getState().briefs[key] ?? EMPTY_HOME_BRIEF;
    const { list, rejected } = addMaterials(current.materials, prefill.materials);
    useStartBrief.getState().patch(key, { materials: list });
    if (rejected) ToastQueue.neutral(HOME_COPY.materialsFull(MAX_HOME_MATERIALS, rejected), { timeout: 5000 });
  }
  const { route } = shell;
  // 从另一个起始页过来时，编辑器的标签跟着搬（同起始页换项目）；会话的标签留在会话里。
  const fromStart = route.tab === 'home' && route.conversationId === null;
  const pane = fromStart ? route.pane : undefined;
  if (fromStart) {
    const from = workspaceKey(null, route.projectId);
    const to = workspaceKey(null, projectId);
    if (from !== to) shell.carryWorkspace(from, to);
  }
  shell.go({ tab: 'home', conversationId: null, projectId, ...(pane ? { pane } : {}) });
}
