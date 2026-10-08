import { useState, type ComponentType, type ReactNode } from 'react';
import { PROTOCOL_VERSION, RUNTIME_VERSION } from '@baocut/protocol';
import {
  ActionButton,
  Button,
  Picker,
  PickerItem,
  SideNav,
  SideNavHeader,
  SideNavItem,
  SideNavItemContent,
  SideNavItemLink,
  SideNavSection,
  Text,
  ToastQueue,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2';
import FileText from '@react-spectrum/s2/icons/FileText';
import HelpCircle from '@react-spectrum/s2/icons/HelpCircle';
import InfoCircle from '@react-spectrum/s2/icons/InfoCircle';
import Keyboard from '@react-spectrum/s2/icons/Keyboard';
import Code from '@react-spectrum/s2/icons/Code';
import Lock from '@react-spectrum/s2/icons/Lock';
import Properties from '@react-spectrum/s2/icons/Properties';
import Settings from '@react-spectrum/s2/icons/Settings';
import TextIcon from '@react-spectrum/s2/icons/Text';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { S } from './shell-copy.ts';
import { HELP_COPY, revealLabel } from '../copy.ts';
import { shortenPath } from '../model/format.ts';
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTION_INFO,
  MODEL_CATEGORY_INFO,
  modelPageFor,
  type ModelCategory,
  type ModelPage,
} from '../model/settings-nav.ts';
import { useRuntime } from '../runtime/context.tsx';
import { useAppUpdate } from '../state/app-update-store.ts';
import { useConnection } from '../state/connection-store.ts';
import { useHelp } from '../state/help-store.ts';
import { hrefFor, useShell, type SettingsSection, type Route } from '../state/shell-store.ts';
import { CATEGORY_ICON, ModelSettings } from './models-page.tsx';
import { AgentIcon } from './agent-icon.tsx';
import { UpdateStatus } from './app-update/update-status.tsx';
import { SidebarTitle } from './page-sidebar.tsx';
import { paneEdge } from './pane-edges.ts';
import { RuntimeCard } from './services/runtime-card.tsx';
import { AGENT_COPY } from './settings/agent-copy.ts';
import { AgentPermissions } from './settings/agent-permissions.tsx';
import { AgentSettings } from './settings/agent-settings.tsx';
import { AgentSkills } from './settings/agent-skills.tsx';
import { DataGrants } from './settings/data-grants.tsx';
import { FontSettings } from './settings/font-settings.tsx';
import { GeneralSettings } from './settings/general-settings.tsx';
import { GlossarySettings } from './settings/glossary-settings.tsx';
import { ResourceCapacity } from './settings/resource-capacity.tsx';

/*
 * 窄窗口（设计稿 settings-local.css）：整页宽 ≤760 时左栏收起、正文顶上换成「设置 + 分节下拉」；正文那一栏 ≤560 时边距收小。
 * 两处都是容器查询：整页（page）是一个容器，左栏与下拉条量它；滚动区（scroll）是另一个，正文量它——
 * 下拉条放在滚动区外面，免得量到正文那一栏（量自己所在的那一栏会随左栏显隐来回翻）。
 */
const page = style({ display: 'flex', flexGrow: 1, minHeight: 0, minWidth: 0, containerType: 'inline-size' });
/** 左栏固定宽、不跟页面侧栏一起拖宽；行的底色与其它页面侧栏一致（app.css 的 `[data-bc-row]`）。 */
const nav = style({
  display: { default: 'flex', '@container (max-width: 760px)': 'none' },
  flexDirection: 'column',
  flexShrink: 0,
  boxSizing: 'border-box',
  width: 240,
  minHeight: 0,
  padding: 16,
  overflowY: 'auto',
  borderTopWidth: 0,
  borderBottomWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 2,
  borderStyle: 'solid',
  borderColor: 'gray-100',
  '--bc-row-hover': { type: 'backgroundColor', value: 'gray-75' },
  '--bc-row-current': { type: 'backgroundColor', value: 'gray-100' },
});
const main = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, minHeight: 0 });
const compact = style({
  display: { default: 'none', '@container (max-width: 760px)': 'flex' },
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexShrink: 0,
  paddingY: 16,
  paddingX: 24,
  borderTopWidth: 0,
  borderXWidth: 0,
  borderBottomWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const compactTitle = style({ font: 'ui', color: 'gray-900' });
const compactEnd = style({ display: 'flex', alignItems: 'center', gap: 4 });
/** 左栏底部的「帮助」（设计稿 settings-local.css `.setpage__help`：上边距 spacing-300）。 */
const helpEntry = style({ alignSelf: 'start', flexShrink: 0, marginTop: 16 });
/** 只滚右侧；表单居中，最宽 960（.setpage__in）。 */
const scroll = style({ flexGrow: 1, minHeight: 0, overflowY: 'auto', containerType: 'inline-size' });
const column = style({
  boxSizing: 'border-box',
  width: 'full',
  maxWidth: '[960px]',
  marginX: 'auto',
  paddingY: 32,
  paddingX: { default: 32, '@container (max-width: 560px)': 24 },
});
const title = style({
  marginTop: 0,
  marginBottom: { default: 48, '@container (max-width: 560px)': 32 },
  fontSize: '[22px]',
  fontWeight: 'bold',
  lineHeight: '[28px]',
  color: 'gray-900',
});
const group = style({ marginBottom: 48 });
const groupHead = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 });
const groupTitle = style({ margin: 0, font: 'ui', fontWeight: 'medium', color: 'gray-900' });
const lead = style({ marginTop: -8, marginBottom: 16, font: 'ui-sm', color: 'gray-600' });
const card = style({ paddingX: 16, borderWidth: 1, borderStyle: 'solid', borderColor: 'gray-200', borderRadius: 'xl' });
const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  paddingY: 16,
  borderTopWidth: 0,
  borderXWidth: 0,
  borderBottomWidth: { default: 1, ':last-child': 0 },
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const rowText = style({ flexGrow: 1, minWidth: 0 });
const rowLabel = style({ font: 'ui', fontWeight: 'medium', color: 'gray-900' });
const rowDesc = style({ marginTop: 4, font: 'ui-sm', color: 'gray-600', overflowWrap: 'anywhere', userSelect: 'text' });
const rowControl = style({ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 });
const rowValue = style({ font: 'ui', color: 'gray-800', userSelect: 'text' });
const about = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  boxSizing: 'border-box',
  maxWidth: '[480px]',
  marginX: 'auto',
  padding: 24,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: 'xl',
  textAlign: 'center',
});
const aboutName = style({ font: 'heading-sm', color: 'gray-900' });
const aboutVersion = style({ font: 'code-sm', color: 'gray-700', userSelect: 'text' });
const aboutNote = style({ marginTop: 12, marginBottom: 0, font: 'ui-sm', color: 'gray-600' });

/** 左栏各节的图标（page-settings.jsx 的 `icons`；Agent 用自绘的机器人，S2 没有这个语义）。 */
const SECTION_ICON: Record<SettingsSection, ComponentType> = {
  general: Settings,
  shortcuts: Keyboard,
  fonts: TextIcon,
  agent: AgentIcon,
  skills: Code,
  glossary: FileText,
  privacy: Lock,
  diagnostics: Properties,
  about: InfoCircle,
};

const labelOf = (key: SettingsSection) => SETTINGS_SECTION_INFO.find((s) => s.key === key)?.label ?? S.settingsPage.general;

/**
 * 设置（产品设计 §2.1，设计稿 page-settings.jsx）：左栏按「偏好设置 / Agent / 模型 / 应用」分组、固定不滚，只滚右侧；
 * 每节一个标题加若干组行卡片。Agent 提供方自己画标题（它的标题下面紧跟一句说明和三条事实）。
 * 窗口窄时左栏收起，换成正文顶上的分节下拉（换节用 replace，和点左栏一样不进前进后退）。
 * 左栏底部（窄窗时是下拉条末尾的图标按钮）是帮助中心的入口（设计稿 page-settings.jsx）。
 */
export function SettingsPage({ section = 'general', model, platform }: {
  section?: SettingsSection;
  model?: { category: ModelCategory; page?: ModelPage };
  platform: string;
}) {
  const replace = useShell((s) => s.replace);
  const web = useRuntime().host.platform === 'web';
  const last = useShell((s) => s.modelPages);
  const selected = model?.category ?? section;
  const modelItems = MODEL_CATEGORY_INFO.map((item) => ({
    ...item,
    Icon: CATEGORY_ICON[item.key],
    route: {
      tab: 'models' as const,
      category: item.key,
      page: modelPageFor(item.key, model?.category === item.key ? model.page : undefined, last[item.key]),
    },
  }));
  const sectionGroups = SETTINGS_GROUPS.map((group) => ({
    ...group,
    // 字体只在桌面端：浏览器会话没有 `fonts.*`。
    items: group.keys.filter((key) => key !== 'fonts' || !web).map((key) => ({
      key, label: labelOf(key), Icon: SECTION_ICON[key], route: { tab: 'settings' as const, section: key },
    })),
  }));
  type NavGroup = {
    id: string;
    label: string;
    items: { key: SettingsSection | ModelCategory; label: string; Icon: ComponentType; route: Route }[];
  };
  // 模型组夹在 Agent 与应用之间；组 id 不得与条目 key 相同（`agents` 对 `agent`）。
  const groups: NavGroup[] = sectionGroups.flatMap((group): NavGroup[] =>
    group.id === 'app' ? [{ id: 'models', label: S.settingsPage.models, items: modelItems }, group] : [group],
  );
  const items = groups.flatMap((group) => group.items);
  const current = items.find((item) => item.key === selected)!;
  return (
    <div className={page}>
      <nav ref={paneEdge} className={nav} aria-label={S.settingsPage.nav}>
        <SidebarTitle>{S.common.settings}</SidebarTitle>
        <SideNav aria-label={S.settingsPage.sections} selectedRoute={hrefFor(current.route)}>
          {groups.map((group) => (
            <SideNavSection key={group.id} id={group.id}>
              <SideNavHeader>{group.label}</SideNavHeader>
              {group.items.map(({ key, Icon, label: text, route }) => {
                const href = hrefFor(route);
                return (
                  <SideNavItem key={key} id={key} textValue={text} href={href} data-bc-row="">
                    <SideNavItemContent>
                      <SideNavItemLink>
                        <Icon />
                        <Text>{text}</Text>
                      </SideNavItemLink>
                    </SideNavItemContent>
                  </SideNavItem>
                );
              })}
            </SideNavSection>
          ))}
        </SideNav>
        <ActionButton isQuiet styles={helpEntry} onPress={(event) => useHelp.getState().open(event.target)}>
          <HelpCircle />
          <Text>{HELP_COPY.settingsEntry}</Text>
        </ActionButton>
      </nav>
      <div className={main}>
        <div className={compact}>
          <span className={compactTitle}>{S.common.settings}</span>
          <div className={compactEnd}>
            <Picker
              aria-label={S.settingsPage.sections}
              selectedKey={selected}
              onSelectionChange={(key) => {
                const item = items.find((item) => item.key === key);
                if (item && key !== selected) replace(item.route);
              }}>
              {items.map((item) => (
                <PickerItem key={item.key} id={item.key}>
                  {item.label}
                </PickerItem>
              ))}
            </Picker>
            <TooltipTrigger>
              <ActionButton isQuiet aria-label={HELP_COPY.settingsEntry} onPress={(event) => useHelp.getState().open(event.target)}>
                <HelpCircle />
              </ActionButton>
              <Tooltip>{HELP_COPY.settingsEntry}</Tooltip>
            </TooltipTrigger>
          </div>
        </div>
        <div key={selected} className={`${scroll} bc-scroll`}>
          <div className={column}>
            {model || section === 'agent' ? null : <h1 className={title}>{labelOf(section)}</h1>}
            {model ? (
              <ModelSettings category={model.category} page={model.page} />
            ) : section === 'general' ? (
              <GeneralSettings />
            ) : section === 'shortcuts' ? (
              <Shortcuts mac={platform === 'darwin'} />
            ) : section === 'fonts' && !web ? (
              <FontSettings />
            ) : section === 'agent' ? (
              <AgentSettings />
            ) : section === 'skills' ? (
              <AgentSkills />
            ) : section === 'glossary' ? (
              <GlossarySettings />
            ) : section === 'privacy' ? (
              <Privacy />
            ) : section === 'diagnostics' ? (
              <Diagnostics />
            ) : (
              <About />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 外壳快捷键：[文案 key（null 为固定名）、macOS 键、其他平台键]；名字在渲染时读，切换语言即更新。 */
const SHELL_KEYS: [string, string, string][] = [
  ['newSession', '⌘N', 'Ctrl+N'],
  ['Space', '⇧⌘H', 'Ctrl+Shift+H'],
  ['tasks', '⇧⌘B', 'Ctrl+Shift+B'],
  ['settings', '⌘,', 'Ctrl+,'],
  ['sidebar', '⌃⌘S', '—'],
  ['back', '⌘[', 'Alt+←'],
  ['forward', '⌘]', 'Alt+→'],
];
const shellKeyLabel = (key: string): string => {
  const p = S.settingsPage;
  const labels: Record<string, string> = {
    newSession: p.shortcutNewSession,
    tasks: p.shortcutTasks,
    settings: p.shortcutSettings,
    sidebar: p.shortcutSidebar,
    back: p.shortcutBack,
    forward: p.shortcutForward,
  };
  return labels[key] ?? key;
};

function Shortcuts({ mac }: { mac: boolean }) {
  return (
    <Group title={S.settingsPage.app}>
      {SHELL_KEYS.map(([key, macKey, otherKey]) => (
        <Row key={key} label={shellKeyLabel(key)}>
          <span className={rowValue}>{mac ? macKey : otherKey}</span>
        </Row>
      ))}
    </Group>
  );
}

function PathRow({ label, path }: { label: string; path: string | null }) {
  const runtime = useRuntime();
  return (
    <Row label={label} desc={path ? shortenPath(path) : '—'}>
      <Button variant="secondary" size="S" isDisabled={!path} onPress={() => path && void runtime.host.revealPath(path)}>
        {revealLabel()}
      </Button>
    </Row>
  );
}

function useRuntimeInfo() {
  return useConnection((s) => (s.state.status === 'connected' ? s.state.runtime : null));
}

function Privacy() {
  const info = useRuntimeInfo();
  return (
    <>
      <Group
        title={S.settingsPage.privacyTitle}
        hint={S.settingsPage.privacyHint}>
        <PathRow label={S.settingsPage.dataDir} path={info?.home ?? null} />
        <PathRow label={S.settingsPage.projectsDir} path={info?.projectsDir ?? null} />
        <WebDataRow />
      </Group>
      <DataGrants />
      <section className={group} aria-label={AGENT_COPY.permissionsTitle}>
        <h2 className={groupTitle}>{AGENT_COPY.permissionsTitle}</h2>
        <AgentPermissions />
      </section>
    </>
  );
}

/** 功能区网页标签的数据（`persist:web` 分区）：Cookie、登录状态、存储与缓存。只有桌面宿主有网页标签。 */
function WebDataRow() {
  const web = useRuntime().host.web;
  const [busy, setBusy] = useState(false);
  const clear = () => {
    if (!web) return;
    setBusy(true);
    web
      .clearData()
      .then(() => ToastQueue.positive(S.settingsPage.webCleared, { timeout: 3000 }))
      .catch((error: Error) => ToastQueue.negative(S.settingsPage.webClearFailed(error.message), { timeout: 5000 }))
      .finally(() => setBusy(false));
  };
  return (
    <Row label={S.settingsPage.webData} desc={web ? S.settingsPage.webDataHint : S.settingsPage.webDataNone}>
      <Button variant="secondary" size="S" isDisabled={!web} isPending={busy} onPress={clear}>
        {S.settingsPage.clear}
      </Button>
    </Row>
  );
}

function Diagnostics() {
  const info = useRuntimeInfo();
  // 连接状态、版本、进程、启动时间与数据目录在 Runtime 卡里（原来是服务总览的第一张卡）。
  return (
    <>
      <Group title="Runtime" hint={S.settingsPage.runtimeHint}>
        <RuntimeCard />
        <PathRow label={S.settingsPage.logsDir} path={info?.logsDir ?? null} />
      </Group>
      <ResourceCapacity />
    </>
  );
}

/** 关于：居中一张卡片，写桌面应用、Runtime 与协议的版本。 */
function About() {
  const info = useRuntimeInfo();
  // 桌面应用自己的版本与 build（更新比的就是它）；网页宿主没有。
  const app = useAppUpdate((s) => s.snapshot?.current ?? null);
  return (
    <section className={about} aria-label={S.settingsPage.version}>
      <div className={aboutName}>BaoCut</div>
      {app ? (
        <div className={aboutVersion}>{S.settingsPage.appVersion(app.version, app.build)}</div>
      ) : null}
      <div className={aboutVersion}>{S.settingsPage.uiVersion(RUNTIME_VERSION, PROTOCOL_VERSION)}</div>
      <div className={aboutVersion}>Runtime {info ? S.settingsPage.runtimeVersion(info.runtimeVersion, info.protocolVersion) : '—'}</div>
      <UpdateStatus />
      <p className={aboutNote}>{S.settingsPage.versionNote}</p>
    </section>
  );
}

function Group({ title: text, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={group} aria-label={text}>
      <div className={groupHead}>
        <h2 className={groupTitle}>{text}</h2>
        {action}
      </div>
      {hint ? <p className={lead}>{hint}</p> : null}
      <div className={card}>{children}</div>
    </section>
  );
}

/** 一行：左边名字与说明，右边控件或值。 */
function Row({ label, desc, children }: { label: string; desc?: string; children?: ReactNode }) {
  return (
    <div className={row}>
      <div className={rowText}>
        <div className={rowLabel}>{label}</div>
        {desc ? <div className={rowDesc}>{desc}</div> : null}
      </div>
      {children ? <div className={rowControl}>{children}</div> : null}
    </div>
  );
}
