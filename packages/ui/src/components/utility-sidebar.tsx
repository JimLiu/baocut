import { useMemo, type ComponentType, type ReactNode } from 'react';
import { live } from '@baocut/protocol';
import { ProgressCircle, SideNav, SideNavHeader, SideNavItem, SideNavItemContent, SideNavItemLink, SideNavSection, Text } from '@react-spectrum/s2';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import CheckmarkCircle from '@react-spectrum/s2/icons/CheckmarkCircle';
import Clock from '@react-spectrum/s2/icons/Clock';
import ViewGrid from '@react-spectrum/s2/icons/ViewGrid';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { S } from './shell-copy.ts';
import { SERVICE_COPY } from '../copy.ts';
import { SERVICE_IDS, serviceStateLabel, serviceTone, type ServiceTone } from '../model/services.ts';
import { taskGroups } from '../model/task-list.ts';
import { TOOL_GROUPS } from '../model/tool-catalog.ts';
import { plannedReason } from '../model/tools-gallery.ts';
import { hrefFor, type Route } from '../state/shell-store.ts';
import { PageSidebar, SidebarNote, SidebarTitle, sidebarBody, useSidebarRoute } from './page-sidebar.tsx';
import { SERVICE_ICON } from './services/service-icon.tsx';
import { useServiceStates } from './services/use-share-status.ts';
import { useTaskRows } from './tasks/use-task-rows.ts';
import { TOOL_ICON } from './tools/tool-icon.tsx';
import { GALLERY_COPY } from './tools/tools-copy.ts';

export type UtilityKind = 'tasks' | 'tools' | 'services';

const TITLE = live((): Record<UtilityKind, string> => ({ tasks: S.common.tasks, tools: S.common.tools, services: S.common.services }));
const OVERVIEW = live(
  (): Record<UtilityKind, string> => ({
    tasks: S.utilitySidebar.overviewTasks,
    tools: S.utilitySidebar.overviewTools,
    services: S.utilitySidebar.overviewServices,
  }),
);
const NOTE = live(
  (): Record<UtilityKind, string> => ({
    tasks: S.utilitySidebar.noteTasks,
    tools: S.utilitySidebar.noteTools,
    services: S.utilitySidebar.noteServices,
  }),
);

/** SideNav 把文字放在 auto 宽的网格列里：允许它收窄，标题才会省略而不是溢出到行尾按钮下面。 */
const fit = style({ minWidth: 0 });
const row = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, width: 'full' });
const label = style({ flexGrow: 1, flexBasis: 0, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const serviceLabel = style({ flexGrow: 0, flexShrink: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const progress = style({ display: 'flex', flexShrink: 0 });
const dot = style({
  flexShrink: 0,
  width: 6,
  height: 6,
  borderRadius: 'full',
  backgroundColor: { tone: { on: 'green-900', error: 'orange-900', off: 'gray-400' } },
});

/**
 * 工具、服务与后台任务的页面侧栏（产品设计 §2 用户修订）：区域标题、总览一行、按组列出条目，底部一句说明。
 * 选条目只切右侧内容；正在执行的任务和服务继续运行。
 */
export function UtilitySidebar({ kind }: { kind: UtilityKind }) {
  const route = useSidebarRoute();
  const { rows } = useTaskRows();
  const serviceStates = useServiceStates();
  const groups = useMemo(() => taskGroups(rows), [rows]);

  const item = (id: string, text: string, target: Route, Icon: ComponentType, tail?: ReactNode, detail?: string) => {
    const href = hrefFor(target);
    return (
      <SideNavItem key={id} id={id} textValue={text} href={href} data-bc-row="">
        <SideNavItemContent>
          <SideNavItemLink aria-label={detail ?? text}>
            <Icon />
            <Text styles={fit}>
              <span className={row} title={detail ?? text}>
                <span className={kind === 'services' ? serviceLabel : label}>{text}</span>
                {tail}
              </span>
            </Text>
          </SideNavItemLink>
        </SideNavItemContent>
      </SideNavItem>
    );
  };
  const light = (tone: ServiceTone) => <span className={dot({ tone })} aria-hidden="true" />;

  return (
    <PageSidebar label={TITLE[kind]}>
      <SidebarTitle>{TITLE[kind]}</SidebarTitle>
      <div className={`${sidebarBody} bc-scroll`}>
        <SideNav aria-label={S.utilitySidebar.nav(TITLE[kind])} selectedRoute={hrefFor(route)}>
          {item('overview', OVERVIEW[kind], { tab: kind }, ViewGrid)}
          {kind === 'services' ? (
            <SideNavSection id="local">
              <SideNavHeader>{S.utilitySidebar.localServices}</SideNavHeader>
              {SERVICE_IDS.map((id) =>
                item(
                  id,
                  SERVICE_COPY[id].name,
                  { tab: 'services', service: id },
                  SERVICE_ICON[id],
                  light(serviceTone(serviceStates[id])),
                  `${SERVICE_COPY[id].name} · ${serviceStateLabel(id, serviceStates[id])}`,
                ),
              )}
            </SideNavSection>
          ) : null}
          {kind === 'tasks'
            ? groups
                .filter((group) => group.items.length)
                .map((group) => (
                  <SideNavSection key={group.id} id={group.id}>
                    <SideNavHeader>
                      {group.label} · {group.items.length}
                    </SideNavHeader>
                    {group.items.map((row) =>
                      item(
                        row.id,
                        row.title,
                        { tab: 'tasks', taskId: row.id },
                        // 失败的，和跑完但留了要人处理的（旧版项目导入有没导入的）念提醒图标。
                        row.tone === 'negative' || (row.origin === 'legacy-import' && row.tone === 'notice')
                          ? AlertTriangle
                          : group.id === 'active'
                            ? Clock
                            : CheckmarkCircle,
                        row.live && !row.queued && !row.waiting ? (
                          <span className={progress}>
                            <ProgressCircle size="S" isIndeterminate aria-label={S.common.working} />
                          </span>
                        ) : null,
                        `${row.title} · ${row.label}`,
                      ),
                    )}
                  </SideNavSection>
                ))
            : null}
          {kind === 'tools'
            ? TOOL_GROUPS.map((group) => (
                <SideNavSection key={group.key} id={`group:${group.key}`}>
                  <SideNavHeader>{group.label}</SideNavHeader>
                  {group.tools.map((tool) =>
                    item(
                      tool.id,
                      tool.name,
                      { tab: 'tools', tool: tool.id },
                      TOOL_ICON[tool.icon],
                      undefined,
                      plannedReason(tool.id) ? `${tool.name} · ${GALLERY_COPY.planned}` : undefined,
                    ),
                  )}
                </SideNavSection>
              ))
            : null}
        </SideNav>
      </div>
      <SidebarNote>{NOTE[kind]}</SidebarNote>
    </PageSidebar>
  );
}
