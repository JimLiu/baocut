import type { Id, SpaceEntry } from '@baocut/protocol';
import { entryJobId } from '../../model/space-actions.ts';
import { toolById, isVideoTool, type ToolId } from '../../model/tool-catalog.ts';
import { entryLocation, rerunOf, toolOfOrigin, toolOfTask, toolsForEntry, type Rerun } from '../../model/tool-rerun.ts';
import { useJobs } from '../../state/jobs-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useToolStatus } from './use-tool-status.ts';
import { useVideoTools } from './use-video-tools.ts';
import { goRerun } from './video-tool-parts.tsx';

/** Space 查看框里与工具有关的几样：能用哪些工具处理、哪个工具做出来的（再做一次）、在哪个目录。 */
export interface EntryTools {
  tools: readonly { id: ToolId; name: string }[];
  origin: { toolName: string; jobId: Id | null; rerun: Rerun | null } | null;
  location: { label: string; isSaveDir: boolean } | null;
  openTool(id: ToolId): void;
  rerun(): void;
}

export function useEntryTools(entry: SpaceEntry | null): EntryTools | null {
  const jobId = entry ? entryJobId(entry) : null;
  const job = useJobs((s) => (jobId ? s.jobs.find((j) => j.jobId === jobId) : undefined));
  const { saveDirectory } = useToolStatus();
  if (!entry) return null;
  const toolId = job ? toolOfTask(job) : toolOfOrigin(entry.origin);
  const tool = toolId ? toolById(toolId) : null;
  // 回收站里的、还在生成的不给「再做一次」；失败的占位照任务给「重试」。
  const rerun = job && !entry.user.trashedAt ? rerunOf(job) : null;
  return {
    tools: toolsForEntry(entry).map((t) => ({ id: t.id, name: t.name })),
    origin: tool ? { toolName: tool.name, jobId, rerun } : null,
    location: entryLocation(entry, saveDirectory),
    openTool: (id) => {
      const tools = useVideoTools.getState();
      tools.setPreset({ tool: id, entryId: entry.id });
      if (isVideoTool(id)) tools.setView(id, null);
      useShell.getState().go({ tab: 'tools', tool: id });
    },
    rerun: () => {
      if (rerun && jobId) goRerun(rerun, jobId);
    },
  };
}
