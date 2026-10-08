import type { ServiceLevel } from '@baocut/protocol';
import { Badge, Button, Switch, Text } from '@react-spectrum/s2';
import Copy from '@react-spectrum/s2/icons/Copy';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { GATE_LABEL, MCP_TOOL_GROUPS, MCP_TOOLS, toolGate, toolsSummary, type McpToolGate } from '../../model/services-mcp.ts';
import { detail, detailXs, panel } from './service-card.tsx';
import { PlannedNote, SectionHead } from './service-parts.tsx';
import { MCP_COPY } from './services-copy.ts';

/*
 * MCP 服务 › 工具（原型 designs/baocut/app/page-services-mcp-tools.jsx `McpToolsSection`）：tools/list 里会出现什么、
 * 每个工具的去向（直接应答 / 直接执行 / 调用前询问 / 只读权限下不提供）。目录由协议常量 MCP_SERVICE_TOOL_NAMES 推出
 * （model/services-mcp.ts）。原型能逐个开关工具、展开看参数并「复制定义」「复制 tools/list」；Runtime 没有逐个工具的开关，
 * 也没有把工具目录与参数提供给界面，所以开关置灰、不展开参数、复制按钮置灰，原因写在下面。
 */

const BADGE: Record<McpToolGate, 'positive' | 'notice' | 'neutral'> = { answer: 'neutral', auto: 'positive', ask: 'notice', hidden: 'neutral' };

const group = style({ marginTop: 16 });
const ghead = style({ display: 'flex', alignItems: 'baseline', gap: 8, paddingBottom: 4 });
const gname = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const tool = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  paddingY: 8,
  borderTopWidth: 0,
  borderXWidth: 0,
  borderBottomWidth: { default: 1, ':last-child': 0 },
  borderStyle: 'solid',
  borderColor: 'gray-100',
  opacity: { default: 1, isDim: 0.6 },
});
const id = style({ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 });
const name = style({ font: 'code-sm', color: 'gray-900' });
const foot = style({ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 });
const grow = style({ flexGrow: 1, minWidth: 0 });

export function McpTools({ level }: { level: ServiceLevel }) {
  return (
    <>
      <SectionHead title={MCP_COPY.toolsTitle} aside={toolsSummary(level)} />
      <section className={panel}>
        <p className={detail}>{MCP_COPY.toolsLede}</p>
        {MCP_TOOL_GROUPS.map((g) => (
          <div key={g.group} className={group}>
            <div className={ghead}>
              <span className={gname}>{g.label}</span>
              <span className={detailXs}>{g.hint}</span>
            </div>
            {MCP_TOOLS.filter((t) => t.group === g.group).map((t) => {
              const gate = toolGate(t, level);
              return (
                <div key={t.name} className={tool({ isDim: gate === 'hidden' })}>
                  <span className={id}>
                    <code className={name}>{t.name}</code>
                    <span className={detailXs}>{t.title}</span>
                  </span>
                  <Badge size="S" fillStyle="subtle" variant={BADGE[gate]}>
                    {GATE_LABEL[gate]}
                  </Badge>
                  <Switch size="S" aria-label={MCP_COPY.toggleTool(t.name)} isSelected={gate !== 'hidden'} isDisabled />
                </div>
              );
            })}
          </div>
        ))}
        <div className={foot}>
          <span className={`${detailXs} ${grow}`}>{level === 'read' ? MCP_COPY.toolsHiddenNote : ''}</span>
          <Button variant="secondary" size="S" isDisabled>
            <Copy />
            <Text>{MCP_COPY.copyTools}</Text>
          </Button>
        </div>
        <PlannedNote>{MCP_COPY.toolsFixed}</PlannedNote>
      </section>
    </>
  );
}
