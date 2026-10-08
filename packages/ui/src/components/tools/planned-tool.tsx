import { Button } from '@react-spectrum/s2';
import type { ToolInfo } from '../../model/tool-catalog.ts';
import { EmptyCard } from '../models/model-parts.tsx';
import { useShell } from '../../state/shell-store.ts';
import { TOOL_ICON } from './tool-icon.tsx';
import { ToolPage } from './tool-parts.tsx';
import { PLANNED_COPY } from './tools-copy.ts';

/**
 * 还没有后端的工具（字幕翻译）：深链进来时如实说「即将推出」和为什么，不画能操作的表单
 * （设计稿 tool-llm.jsx 的表单要等能力接进来）。
 */
export function PlannedTool({ tool, reason }: { tool: ToolInfo; reason: string }) {
  const go = useShell((s) => s.go);
  const Icon = TOOL_ICON[tool.icon];
  return (
    <ToolPage title={tool.name}>
      <EmptyCard
        icon={<Icon />}
        title={PLANNED_COPY.title}
        body={PLANNED_COPY.body(reason)}
        actions={
          <Button variant="secondary" onPress={() => go({ tab: 'tools' })}>
            {PLANNED_COPY.back}
          </Button>
        }
        note={tool.desc}
      />
    </ToolPage>
  );
}
