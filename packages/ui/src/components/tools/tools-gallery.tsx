import { Badge } from '@react-spectrum/s2';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Link } from 'react-aria-components';
import { resultLine, TOOL_GROUPS, type ToolInfo } from '../../model/tool-catalog.ts';
import { plannedReason, toolBlock, toolCardStatus, type ToolCardStatus } from '../../model/tools-gallery.ts';
import { useModels } from '../../state/models-store.ts';
import { hrefFor } from '../../state/shell-store.ts';
import { UtilityPage } from '../utility-page.tsx';
import { TOOL_ICON } from './tool-icon.tsx';
import { GALLERY_COPY, TOOLS_HOME_COPY } from './tools-copy.ts';
import { useToolStatus } from './use-tool-status.ts';

/* 设计稿 page-tools.jsx `ToolsGallery` 与 tools.css `.tools__*` / `.toolcard*`（2026-10-03：两组各带说明，每张卡多一行「结果」）。 */

const lede = style({ margin: 0, marginTop: -12, marginBottom: 24, font: 'body-sm', color: 'gray-600' });
const group = style({ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 });
const groupLabel = style({ margin: 0, font: 'detail', fontWeight: 'bold', color: 'gray-700' });
const groupDesc = style({ margin: 0, marginTop: -4, marginBottom: 4, font: 'ui-sm', color: 'gray-700' });
const failed = style({ margin: 0, marginTop: -16, marginBottom: 16, font: 'ui-xs', color: 'orange-1000' });
const grid = style({ display: 'grid', gridTemplateColumns: '[repeat(auto-fill, minmax(320px, 1fr))]', gap: 12 });
const foot = style({ margin: 0, marginTop: 8, font: 'ui-xs', color: 'gray-600' });

const card = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  minHeight: 96,
  boxSizing: 'border-box',
  padding: 16,
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: { default: 'gray-200', isHovered: 'gray-300', isPlanned: 'gray-200' },
  backgroundColor: { default: 'gray-50', isHovered: 'gray-100', isPlanned: 'gray-25' },
  color: 'gray-900',
  textDecoration: 'none',
  textAlign: 'start',
  minWidth: 0,
  cursor: 'default',
  transition: 'default',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: 2,
});
const icon = style({
  display: 'grid',
  placeItems: 'center',
  flexShrink: 0,
  width: 48,
  height: 48,
  borderRadius: 'lg',
  backgroundColor: 'blue-100',
  color: 'blue-1000',
  opacity: { default: 1, isPlanned: 0.6 },
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const text = style({ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 });
const name = style({ display: 'flex', alignItems: 'center', gap: 8, font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const desc = style({ font: 'ui-sm', color: 'gray-700', opacity: { default: 1, isPlanned: 0.6 } });
const result = style({ font: 'ui-xs', color: 'gray-800' });
const status = style({ display: 'flex', alignItems: 'center', gap: '[6px]', font: 'ui-xs', color: 'gray-600' });
const dot = style({ flexShrink: 0, width: 6, height: 6, borderRadius: 'full', backgroundColor: { default: 'gray-400', isOn: 'green-900' } });
const go = style({ display: 'flex', flexShrink: 0, color: 'gray-600', '--iconPrimary': { type: 'fill', value: 'currentColor' } });

function CardBody({ tool, state, planned }: { tool: ToolInfo; state: ToolCardStatus | null; planned: boolean }) {
  const Icon = TOOL_ICON[tool.icon];
  return (
    <>
      <span className={icon({ isPlanned: planned })} data-bc-icons="primary" aria-hidden>
        <Icon />
      </span>
      <span className={text}>
        <span className={name}>
          {tool.name}
          {planned ? (
            <Badge variant="neutral" size="S" fillStyle="subtle">
              {GALLERY_COPY.planned}
            </Badge>
          ) : null}
        </span>
        <span className={desc({ isPlanned: planned })}>{tool.desc}</span>
        <span className={result}>{resultLine(tool.id)}</span>
        {state ? (
          <span className={status}>
            <span className={dot({ isOn: state.on })} aria-hidden />
            {state.text}
          </span>
        ) : null}
      </span>
      {planned ? null : (
        <span className={go} aria-hidden>
          <ChevronRight />
        </span>
      )}
    </>
  );
}

/** 一张工具卡：能用的是指向工具页的链接；还没有后端的置灰、不能点，现状行写原因。 */
function ToolCard({ tool, state }: { tool: ToolInfo; state: ToolCardStatus | null }) {
  const planned = plannedReason(tool.id) !== null;
  if (planned) {
    return (
      <div className={card({ isPlanned: true })} role="group" aria-label={tool.name} aria-disabled="true">
        <CardBody tool={tool} state={state} planned />
      </div>
    );
  }
  return (
    <Link href={hrefFor({ tab: 'tools', tool: tool.id })} className={(rp) => card({ ...rp })} aria-label={GALLERY_COPY.open(tool.name)}>
      <CardBody tool={tool} state={state} planned={false} />
    </Link>
  );
}

/**
 * 工具总览（设计稿 page-tools.jsx `ToolsGallery`）：视频工具、文件工具两组，各一句说明；一张卡一句能做什么、一行结果、
 * 一行现状。能不能用以 `tools.list` 为准（不可用时写它给的原因），能用时再按模型能力视图说几家已连接。
 */
export function ToolsGallery() {
  const view = useModels((s) => s.capabilities);
  const status = useToolStatus();
  const cardStatus = (id: ToolInfo['id']) => toolCardStatus(id, view, status.ready ? toolBlock(status.byId.get(id), status.pipelines) : undefined);
  return (
    <UtilityPage kind="tools" title={GALLERY_COPY.title}>
      <p className={lede}>{TOOLS_HOME_COPY.lede}</p>
      {status.error ? (
        <p className={failed} role="status">
          {TOOLS_HOME_COPY.statusFailed(status.error)}
        </p>
      ) : null}
      {TOOL_GROUPS.map((g) => (
        <section key={g.key} className={group} aria-labelledby={`tools-group-${g.key}`}>
          <h2 className={groupLabel} id={`tools-group-${g.key}`}>
            {g.label}
          </h2>
          <p className={groupDesc}>{g.desc}</p>
          <div className={grid}>
            {g.tools.map((t) => (
              <ToolCard key={t.id} tool={t} state={cardStatus(t.id)} />
            ))}
          </div>
        </section>
      ))}
      <p className={foot}>{TOOLS_HOME_COPY.foot}</p>
    </UtilityPage>
  );
}
