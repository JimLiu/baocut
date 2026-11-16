import type { Id } from '@baocut/protocol';
import { useDirectory } from '../../state/directory-store.ts';
import { useHomeMemory } from '../../state/home-memory-store.ts';
import { useVideo } from '../../state/video-store.ts';

/**
 * 起始页此刻用哪个项目（产品设计 §3.2.1）：路由带的；没有时旁边编辑器开着的视频所在的项目（新会话建在那里，智能体才能读写它，§1.5）；
 * 再没有时托盘上次选的（记在这台电脑上，还在、没归档、目录还在才算）；都没有时不用项目。
 * 工具总览的「屏幕录制」不在哪个项目里，按路由没带项目算，录进 Home 此刻会用的那个项目（屏幕录制设计 §11）。
 */
export function useHomeProjectId(routeProjectId: Id | null): Id | null {
  const projects = useDirectory((s) => s.projects);
  const videoProjectId = useVideo((s) => s.video?.ref?.source.projectId ?? null);
  const lastProject = useHomeMemory((s) => s.project);
  const remembered = lastProject && projects.some((p) => p.id === lastProject && !p.archived && !p.missing) ? lastProject : null;
  return routeProjectId ?? videoProjectId ?? remembered;
}
