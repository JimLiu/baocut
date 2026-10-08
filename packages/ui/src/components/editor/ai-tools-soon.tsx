import { Badge } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import type { AiTool } from '../../model/ai-tools.ts';
import { AI_TOOLS_COPY as C } from './ai-tools-copy.ts';
import { panelBody, PanelHead } from './panel-head.tsx';

const card = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 12,
  borderRadius: 'lg',
  backgroundColor: 'gray-75',
  font: 'ui-sm',
  color: 'gray-800',
  lineHeight: '[1.5]',
});
const title = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const why = style({ margin: 0, color: 'gray-700' });

/**
 * 还做不了的工具页（智能裁剪、剪成短视频）：要在画面上跟踪重点、调取景框，Runtime 还没有这条流程。
 * 列表里照常列着，点进来只说「即将推出」和为什么，不画能操作的表单（同 tools/planned-tool.tsx）。
 */
export function AiToolSoon({ tool, onBack }: { tool: AiTool; onBack(): void }) {
  return (
    <>
      <PanelHead title={tool.name} back={{ label: C.back, onPress: onBack }}>
        <Badge size="S" variant="neutral">
          {C.soon}
        </Badge>
      </PanelHead>
      <div className={`${panelBody} bc-scroll`}>
        <div className={card}>
          <span className={title}>{tool.name}</span>
          <span>{tool.desc}</span>
          <p className={why}>{tool.why}</p>
        </div>
      </div>
    </>
  );
}
