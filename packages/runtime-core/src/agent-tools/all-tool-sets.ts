import type { ToolSet } from './tool-catalog.ts';
import { CompositionTools } from './composition-tools.ts';
import { DownloadTools } from './download-tools.ts';
import { ExportTools } from './export-tools.ts';
import { FlowTools } from './flow-tools.ts';
import { GrantTools } from './grant-tools.ts';
import { JobTools } from './job-tools.ts';
import { LibraryTools } from './library-tools.ts';
import { LinkImportTools } from './link-import-tools.ts';
import { ModelInstallTools } from './model-install-tools.ts';
import { ModelTools } from './model-tools.ts';
import { ProjectTools } from './project-tools.ts';
import { SkillTools } from './skill-tools.ts';
import { SpaceTools } from './space-tools.ts';
import { TaskTools } from './task-tools.ts';
import { VideoDeleteTools } from './video-delete-tools.ts';
import { VideoTools } from './video-tools.ts';

/**
 * Runtime 组装的全部工具组（`runtime.ts` 的 `toolSets`）的空壳：依赖都是空的，只用来读 schema 与目录项，不能调用。
 * CLI 的离线目录快照（`tools/catalog-snapshot.ts`，构建时生成）与目录的测试用它；所以放在这里而不在 `testing/`。
 * 工具桥的端到端测试断言 tools/list 与这里的工具名一致，Runtime 加了工具组而这里没加时会失败。
 */
export function allToolSets(): ToolSet[] {
  const none = {} as never;
  return [
    new VideoTools(none),
    new ModelTools(none),
    new JobTools(none),
    new ExportTools(none),
    new ModelInstallTools(none),
    new ProjectTools(none),
    new LibraryTools(none),
    new SpaceTools(none),
    new SkillTools(none),
    new GrantTools(none),
    new TaskTools(none),
    new LinkImportTools(none),
    new FlowTools(none),
    new DownloadTools(none),
    new VideoDeleteTools(none),
    new CompositionTools(none),
  ];
}

/** 全部工具名，按字母排序。 */
export function allToolNames(): string[] {
  return allToolSets()
    .flatMap((set) => Object.keys(set.schemas))
    .sort();
}
