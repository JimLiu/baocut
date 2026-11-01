import { useMemo, type ComponentType } from 'react';
import { ActionButton, NotificationBadge, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import Clock from '@react-spectrum/s2/icons/Clock';
import Asset from '@react-spectrum/s2/icons/Asset';
import GlobeGrid from '@react-spectrum/s2/icons/GlobeGrid';
import Home from '@react-spectrum/s2/icons/Home';
import Lightbulb from '@react-spectrum/s2/icons/Lightbulb';
import Tools from '@react-spectrum/s2/icons/Tools';
import Settings from '@react-spectrum/s2/icons/Settings';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { AgentIcon } from './agent-icon.tsx';
import { S } from './shell-copy.ts';
import { useShell, railTabOf, type Tab } from '../state/shell-store.ts';
import { useNeedsYouTotal } from '../state/channels-store.ts';
import { BOT_COPY } from './bot/bot-copy.ts';
import { useJobs } from '../state/jobs-store.ts';
import { useLegacyImport } from '../state/legacy-import-store.ts';
import { isLive, useTasks } from '../state/tasks-store.ts';
import { listedTasks, liveJobRowCount } from '../model/task-list.ts';
import { UpdateRailButton } from './app-update/update-rail-button.tsx';
import { useShellPeekControls } from './shell-peek.tsx';
import { useServicesAlert } from './services/use-share-status.ts';

interface RailTab {
  tab: Tab;
  label: string;
  Icon: ComponentType;
}

/** 主要入口贴顶，横线下方是服务与后台任务，设置固定在底部（产品设计 §2.1 用户修订）。 */
const PRIMARY: RailTab[] = [
  { tab: 'home', label: 'Home', Icon: Home },
  // Bot 模式（docs/design/bot-mode 需求 §11.1）：排在 Home 之后、Space 之前；名字同 Home、Space 不翻译。
  // 图标是机器人：S2 没有，用 AgentIcon（与原型 icons.jsx 的 agent 同一几何）。
  { tab: 'bot', label: 'Bot', Icon: AgentIcon },
  { tab: 'space', label: 'Space', Icon: Asset },
  // Skills 在 Space 下面一格（产品设计 §6.9）；名字同 Home、Space 不翻译（术语表：Skill）。
  { tab: 'skills', label: 'Skills', Icon: Lightbulb },
  { tab: 'tools', get label() { return S.common.tools; }, Icon: Tools },
];
/** 辅助入口（产品设计 §2.1）：服务在前，后台任务在后。 */
const SECONDARY: RailTab[] = [
  { tab: 'services', get label() { return S.common.services; }, Icon: GlobeGrid },
  { tab: 'tasks', get label() { return S.common.tasks; }, Icon: Clock },
];
const END: RailTab[] = [{ tab: 'settings', get label() { return S.common.settings; }, Icon: Settings }];

const rail = style({
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  flexShrink: 0,
  width: 56,
  paddingY: 8,
});
const group = style({ display: 'flex', flexDirection: 'column' });
/**
 * Bot 的「等你」徽标（需求 §11.8）：点徽标打开跨频道的收件箱，点图标进频道。徽标是图标按钮右上角单独的一个按钮，
 * 不套在图标按钮里面（按钮里不能再放按钮）。
 */
const inboxBadge = style({
  position: 'absolute',
  top: 0,
  insetEnd: 4,
  display: 'flex',
  padding: 0,
  borderWidth: 0,
  backgroundColor: 'transparent',
  cursor: 'pointer',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  borderRadius: 'full',
});
/** 每格高 40，图标 20 居中在 32×32 的按钮里。 */
const cell = style({ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', height: 40 });
const divider = style({ borderWidth: 0, borderTopWidth: 1, borderStyle: 'solid', borderColor: 'gray-200', marginX: 16, marginY: 8 });
/** 选中：图标左侧一根短指示竖条，没有底色块。 */
const indicator = style({
  position: 'absolute',
  insetStart: '[9px]',
  top: '50%',
  width: '[2px]',
  height: 16,
  borderRadius: 'full',
  backgroundColor: 'gray-800',
  transform: 'translateY(-50%)',
});
/**
 * 服务出错的角标（原型 apprail.jsx `services.badge`、apprail.css `.apprail__badge--dot` / `.apprail__alert`）：
 * 8px 纯圆点，橙色同服务页「出错」那颗灯。S2 的 NotificationBadge 只有红色，所以自己画；只给视觉，读屏走按钮名。
 */
const alertDot = style({
  position: 'absolute',
  top: '[7px]',
  insetEnd: '[15px]',
  size: 8,
  borderRadius: 'full',
  backgroundColor: 'orange-900',
  pointerEvents: 'none',
});

export function Rail() {
  const route = useShell((s) => s.route);
  const goTab = useShell((s) => s.goTab);
  // 在跑的后台任务：进任务表的 Agent 任务（只检索、问答的不算，产品设计 §6.1）、Job（按任务表的行数，流程的步骤不另算），
  // 和正在导入旧版项目的那一轮。
  const tasks = useTasks((s) => s.tasks);
  const jobs = useJobs((s) => s.jobs);
  const legacy = useLegacyImport((s) => (s.run && s.run.state !== 'finished' ? 1 : 0));
  const running = useMemo(() => listedTasks(tasks, jobs).filter(isLive).length + liveJobRowCount(jobs) + legacy, [tasks, jobs, legacy]);
  // 只有服务出错才亮（原型：每项服务各自的灯在服务页里）；顺带在连上 Runtime 时读一次共享状态。
  const servicesAlert = useServicesAlert();
  // Bot 的徽标：全部频道里「待你审阅 + 需要你输入」的任务数（含静音频道，需求 §11.1）。
  const needsYou = useNeedsYouTotal();
  const go = useShell((s) => s.go);
  // 侧栏隐藏时悬停入口浮出该区域的侧栏（产品设计 §2.5；设置没有侧栏，在 shell-peek 里跳过）。
  const peek = useShellPeekControls();

  const button = ({ tab, label, Icon }: RailTab) => {
    const badge = tab === 'tasks' && running ? <NotificationBadge value={running} /> : null;
    const name =
      tab === 'tasks' && running
        ? S.rail.running(label, running)
        : tab === 'services' && servicesAlert
          ? servicesAlert
          : tab === 'bot' && needsYou
            ? BOT_COPY.rail.label(needsYou)
            : label;
    return (
      <div key={tab} className={cell} onPointerEnter={() => peek?.peekSidebar(tab)} onPointerLeave={() => peek?.leaveSidebar()}>
        {railTabOf(route) === tab ? <span className={indicator} /> : null}
        <TooltipTrigger placement="end" delay={300}>
          <ActionButton
            isQuiet
            aria-label={name}
            aria-current={railTabOf(route) === tab ? 'page' : undefined}
            onPress={() => goTab(tab)}>
            <Icon />
            {badge}
          </ActionButton>
          <Tooltip>{label}</Tooltip>
        </TooltipTrigger>
        {tab === 'services' && servicesAlert ? <span className={alertDot} aria-hidden="true" /> : null}
        {tab === 'bot' && needsYou ? (
          <button
            type="button"
            className={inboxBadge}
            aria-label={BOT_COPY.rail.openInbox}
            title={BOT_COPY.rail.openInbox}
            onClick={() => go({ tab: 'bot', channelId: null, workItemId: null, view: 'inbox' })}>
            <NotificationBadge value={needsYou} />
          </button>
        ) : null}
      </div>
    );
  };

  return (
    // `data-shell-peek-keep`：在 Rail 上按下不关侧栏浮层。
    <nav className={rail} data-bc-icons="primary" data-shell-peek-keep="" aria-label={S.rail.nav}>
      <div>
        <div className={group} aria-label={S.rail.primary}>{PRIMARY.map(button)}</div>
        <hr className={divider} />
        <div className={group} aria-label={S.rail.secondary}>{SECONDARY.map(button)}</div>
      </div>
      <div className={group}>
        {/* 设置正上方：有新版本、下载中、已下载时才占这一格（设计稿 apprail.jsx `apprail__upd`）。 */}
        <UpdateRailButton />
        {END.map(button)}
      </div>
    </nav>
  );
}
