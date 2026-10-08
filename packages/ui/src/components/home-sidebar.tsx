import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Conversation, Project } from '@baocut/protocol';
import {
  ActionButton,
  Menu,
  MenuItem,
  MenuTrigger,
  SideNav,
  SideNavHeader,
  SideNavSection,
  SubmenuTrigger,
  Text,
  ToastQueue,
} from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import AddCircle from '@react-spectrum/s2/icons/AddCircle';
import Folder from '@react-spectrum/s2/icons/Folder';
import FolderOpen from '@react-spectrum/s2/icons/FolderOpen';
import More from '@react-spectrum/s2/icons/More';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { S } from './shell-copy.ts';
import { untitled } from '../copy.ts';
import { shortenPath } from '../model/format.ts';
import { buildSidebar, type ProjectRow } from '../model/sidebar.ts';
import { useRuntime } from '../runtime/context.tsx';
import { useConnection } from '../state/connection-store.ts';
import { useDirectory } from '../state/directory-store.ts';
import { HOME, hrefFor, useShell } from '../state/shell-store.ts';
import { conversationItem, ProjectItem, type ConversationRowActions } from './home-sidebar-rows.tsx';
import { NameDialog } from './name-dialog.tsx';
import { PageSidebar, SidebarTitle, sidebarBody, useSidebarGo, useSidebarRoute } from './page-sidebar.tsx';
import { useNow } from './use-now.ts';

const top = style({ display: 'flex', alignItems: 'center', paddingBottom: 16 });
const head = style({ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, width: 'full', height: 24, marginY: -4 });
const headLabel = style({ display: 'flex', alignItems: 'center', gap: 4, font: 'ui-sm', fontWeight: 'normal', color: 'gray-600' });
const empty = style({ font: 'ui-sm', color: 'gray-600', paddingX: 8, marginTop: 8, marginBottom: 0 });
/** S2 的 SideNav 默认撑满父级高度；下面还有空列表提示，按内容高度排，滚动交给外层。 */
const nav = style({ height: 'auto' });

type DialogState = { kind: 'new-project' } | { kind: 'rename-project'; project: Project } | null;
type SectionKey = 'pinned' | 'projects' | 'recent';

/**
 * Home 的页面侧栏（产品设计 §3.1，用户修订）：区域标题、新建会话；置顶、项目、最近三段，段头可折叠。
 * 搜索与通知按用户反馈暂时移除。项目段头的「⋯」整理侧栏（按项目分组 / 在一个列表中）与会话排序，
 * 「+」新建项目或打开已有目录。
 */
export function HomeSidebar() {
  const runtime = useRuntime();
  const route = useSidebarRoute();
  // 在浮层里先关浮层再跳：点的就是当前位置（例如已在新会话页时点新建会话）也关。
  const go = useSidebarGo();
  const expanded = useShell((s) => s.expandedProjects);
  const setExpanded = useShell((s) => s.setExpandedProjects);
  const grouping = useShell((s) => s.sidebarGrouping);
  const sort = useShell((s) => s.sidebarSort);
  const projectsDir = useConnection((s) => (s.state.status === 'connected' ? s.state.runtime.projectsDir : null));
  const projects = useDirectory((s) => s.projects);
  const conversations = useDirectory((s) => s.conversations);
  const ready = useDirectory((s) => s.ready);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<SectionKey>>(new Set());
  const now = useNow(60_000);

  const tree = useMemo(() => buildSidebar(projects, conversations, sort), [projects, conversations, sort]);
  // 打开着视频时侧栏仍指向那条会话：选中位置不带视频参数。
  const selectedRoute =
    route.tab === 'home' ? hrefFor({ tab: 'home', conversationId: route.conversationId, projectId: route.projectId }) : undefined;

  // 当前会话所在的项目展开着，新会话在侧栏里才看得见。
  const currentProject =
    route.tab === 'home' ? (route.projectId ?? conversations.find((c) => c.id === route.conversationId)?.projectId ?? null) : null;
  useEffect(() => {
    const key = currentProject ? `proj:${currentProject}` : null;
    if (key && !useShell.getState().expandedProjects.includes(key)) setExpanded([...useShell.getState().expandedProjects, key]);
  }, [currentProject, setExpanded]);
  const expandedKeys = new Set(expanded);

  const toggleSection = (key: SectionKey) =>
    setCollapsed((old) => {
      const next = new Set(old);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const added = (project: Project) => {
    setCollapsed((old) => new Set([...old].filter((key) => key !== 'projects')));
    setExpanded([...new Set([...expanded, `proj:${project.id}`])]);
    go({ tab: 'home', conversationId: null, projectId: project.id });
  };

  const openProject = async () => {
    try {
      const project = await runtime.openProjectFromDialog();
      if (project) added(project);
    } catch (error) {
      ToastQueue.negative(S.sidebar.openFolderFailed((error as Error).message), { timeout: 5000 });
    }
  };

  const fail = (error: Error) => ToastQueue.negative(error.message, { timeout: 5000 });
  const onProjectAction = (project: Project, key: string) => {
    if (key === 'new') go({ tab: 'home', conversationId: null, projectId: project.id });
    else if (key === 'pin') runtime.updateProject(project.id, { pinned: !project.pinned }).catch(fail);
    else if (key === 'rename') setDialog({ kind: 'rename-project', project });
    else if (key === 'space') go({ tab: 'space', category: 'all', projectId: project.id });
    else if (key === 'reveal') void runtime.host.revealPath(project.path);
  };

  const actions: ConversationRowActions = {
    togglePin: (conversation) => runtime.updateConversation(conversation.id, { pinned: !conversation.pinned }).catch(fail),
    archive: (conversation) => {
      const title = conversation.title || untitled();
      runtime
        .updateConversation(conversation.id, { archived: true })
        .then(() => {
          const current = useShell.getState().route;
          if (current.tab === 'home' && current.conversationId === conversation.id) go(HOME);
          ToastQueue.neutral(S.sidebar.archived(title), {
            timeout: 5000,
            actionLabel: S.sidebar.undo,
            onAction: () => void runtime.updateConversation(conversation.id, { archived: false }).catch(fail),
            shouldCloseOnAction: true,
          });
        })
        .catch(fail);
    },
  };
  const projectName = (c: Conversation) => projects.find((p) => p.id === c.projectId)?.name ?? null;
  const conversationRow = (conversation: Conversation, key: string, pinned = false) =>
    conversationItem(conversation, key, { now, projectName: projectName(conversation), pinned, actions });
  const projectItem = (row: ProjectRow, key: string) => (
    <ProjectItem
      key={key}
      id={key}
      row={row}
      open={expandedKeys.has(key)}
      onAction={(k) => onProjectAction(row.project, k)}
      conversationRow={conversationRow}
    />
  );

  const flat = grouping === 'flat';
  const listEmpty = flat ? !tree.flat.length : !tree.projects.length;

  return (
    <PageSidebar label={S.sidebar.sessions}>
      <SidebarTitle>BaoCut</SidebarTitle>
      <div className={top}>
        <ActionButton
          isQuiet
          styles={style({ width: 'full' })}
          UNSAFE_style={{ justifyContent: 'start' }}
          onPress={() => go({ tab: 'home', conversationId: null, projectId: null })}>
          <AddCircle />
          <Text>{S.common.newSession}</Text>
        </ActionButton>
      </div>

      <div className={`${sidebarBody} bc-scroll`}>
        <SideNav
          styles={nav}
          aria-label={S.sidebar.projectsAndSessions}
          selectedRoute={selectedRoute}
          expandedKeys={expandedKeys}
          onExpandedChange={(keys) => setExpanded([...keys].map(String))}>
          {tree.pinned.length ? (
            <SideNavSection id="pinned">
              <SideNavHeader>
                <SectionHead label={S.sidebar.pinned} collapsed={collapsed.has('pinned')} onToggle={() => toggleSection('pinned')} />
              </SideNavHeader>
              {collapsed.has('pinned')
                ? []
                : tree.pinned.map((pin) =>
                    pin.kind === 'project'
                      ? projectItem(pin.row, `pin:${pin.row.project.id}`)
                      : conversationRow(pin.conversation, `pin:${pin.conversation.id}`, true),
                  )}
            </SideNavSection>
          ) : null}
          <SideNavSection id="projects">
            <SideNavHeader>
              <SectionHead label={flat ? S.sidebar.sessions : S.sidebar.projects} collapsed={collapsed.has('projects')} onToggle={() => toggleSection('projects')}>
                <OrganizeMenu />
                <MenuTrigger>
                  <ActionButton isQuiet size="S" aria-label={S.sidebar.newOrOpenProject} isDisabled={!projectsDir}>
                    <Add />
                  </ActionButton>
                  <Menu aria-label={S.sidebar.newOrOpenProject} onAction={(key) => (key === 'new' ? setDialog({ kind: 'new-project' }) : void openProject())}>
                    <MenuItem id="new" textValue={S.sidebar.newProjectEllipsis}>
                      <Folder />
                      <Text slot="label">{S.sidebar.newProjectEllipsis}</Text>
                    </MenuItem>
                    <MenuItem id="open" textValue={S.sidebar.openFolderEllipsis}>
                      <FolderOpen />
                      <Text slot="label">{S.sidebar.openFolderEllipsis}</Text>
                    </MenuItem>
                  </Menu>
                </MenuTrigger>
              </SectionHead>
            </SideNavHeader>
            {collapsed.has('projects')
              ? []
              : flat
                ? tree.flat.map((conversation) => conversationRow(conversation, `flat:${conversation.id}`))
                : tree.projects.map((row) => projectItem(row, `proj:${row.project.id}`))}
          </SideNavSection>
          {!flat && tree.loose.length ? (
            <SideNavSection id="recent">
              <SideNavHeader>
                <SectionHead label={S.sidebar.recent} collapsed={collapsed.has('recent')} onToggle={() => toggleSection('recent')} />
              </SideNavHeader>
              {collapsed.has('recent') ? [] : tree.loose.map((conversation) => conversationRow(conversation, `loose:${conversation.id}`))}
            </SideNavSection>
          ) : null}
        </SideNav>
        {listEmpty && !collapsed.has('projects') ? (
          <p className={empty}>
            {!ready ? S.common.loadingEllipsis : flat ? S.sidebar.noSessions : S.sidebar.noProjects}
          </p>
        ) : null}
      </div>

      {dialog?.kind === 'new-project' ? (
        <NameDialog
          title={S.sidebar.newProjectTitle}
          label={S.sidebar.projectName}
          placeholder={S.sidebar.untitledProject}
          allowEmpty
          description={projectsDir ? S.sidebar.newProjectHint(shortenPath(projectsDir)) : undefined}
          submitLabel={S.sidebar.create}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            const project = await runtime.createProject(name);
            setDialog(null);
            ToastQueue.positive(S.sidebar.projectCreated(project.name), { timeout: 4000 });
            added(project);
          }}
        />
      ) : dialog?.kind === 'rename-project' ? (
        <NameDialog
          title={S.sidebar.renameProjectTitle}
          label={S.common.name}
          initial={dialog.project.name}
          description={S.sidebar.renameProjectHint}
          submitLabel={S.common.save}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            await runtime.updateProject(dialog.project.id, { name });
            setDialog(null);
          }}
        />
      ) : null}
    </PageSidebar>
  );
}

/**
 * 段头：段名 + 折叠钮（展开箭头只在悬停、聚焦或已折叠时出现），右边可以挂这一段的操作。
 * 段头里的控件自己处理焦点与按键，不让 SideNav 把它们转给某一行。
 */
function SectionHead({ label, collapsed, onToggle, children }: { label: string; collapsed: boolean; onToggle: () => void; children?: ReactNode }) {
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <span className={`${head} bc-section-head`} onFocus={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <ActionButton
        isQuiet
        size="S"
        aria-label={S.sidebar.toggleSection(collapsed, label)}
        aria-expanded={!collapsed}
        styles={style({ flexGrow: 1, minWidth: 0, marginStart: -8 })}
        UNSAFE_style={{ justifyContent: 'start' }}
        UNSAFE_className="bc-section-toggle"
        onPress={onToggle}>
        <Text>
          <span className={headLabel}>
            {label}
            <span className="bc-section-chevron">
              <Chevron />
            </span>
          </span>
        </Text>
      </ActionButton>
      {children ? <span className="bc-section-actions">{children}</span> : null}
    </span>
  );
}

/** 项目段头的「⋯」：整理侧栏（按项目分组 / 在一个列表中）与会话排序。 */
function OrganizeMenu() {
  const grouping = useShell((s) => s.sidebarGrouping);
  const sort = useShell((s) => s.sidebarSort);
  const { setSidebarGrouping, setSidebarSort } = useShell.getState();
  return (
    <MenuTrigger>
      <ActionButton isQuiet size="S" aria-label={S.sidebar.organizeLabel}>
        <More />
      </ActionButton>
      <Menu aria-label={S.sidebar.sidebarSettings}>
        <SubmenuTrigger>
          <MenuItem id="organize" textValue={S.sidebar.organize}>
            <Text slot="label">{S.sidebar.organize}</Text>
          </MenuItem>
          <Menu
            aria-label={S.sidebar.organize}
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[grouping]}
            onSelectionChange={(keys) => keys !== 'all' && setSidebarGrouping([...keys][0] === 'flat' ? 'flat' : 'project')}>
            <MenuItem id="project" textValue={S.sidebar.byProject}>
              <Text slot="label">{S.sidebar.byProject}</Text>
            </MenuItem>
            <MenuItem id="flat" textValue={S.sidebar.flat}>
              <Text slot="label">{S.sidebar.flat}</Text>
            </MenuItem>
          </Menu>
        </SubmenuTrigger>
        <SubmenuTrigger>
          <MenuItem id="sort" textValue={S.sidebar.sortSessions}>
            <Text slot="label">{S.sidebar.sortSessions}</Text>
          </MenuItem>
          <Menu
            aria-label={S.sidebar.sortSessions}
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[sort]}
            onSelectionChange={(keys) => keys !== 'all' && setSidebarSort([...keys][0] === 'name' ? 'name' : 'recent')}>
            <MenuItem id="recent" textValue={S.sidebar.byRecent}>
              <Text slot="label">{S.sidebar.byRecent}</Text>
            </MenuItem>
            <MenuItem id="name" textValue={S.sidebar.byName}>
              <Text slot="label">{S.sidebar.byName}</Text>
            </MenuItem>
          </Menu>
        </SubmenuTrigger>
      </Menu>
    </MenuTrigger>
  );
}
