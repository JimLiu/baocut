import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { DEFAULT_AGENT_MODE, type AttachmentRef, type Id, type SkillSendRef } from '@baocut/protocol';
import { ActionButton, ToastQueue, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import Comment from '@react-spectrum/s2/icons/Comment';
import Minimize from '@react-spectrum/s2/icons/Minimize';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import { applyAgentChange, draftSelection } from '../../model/agent-choice.ts';
import { sendFailureMessage } from '../../model/agent-skills.ts';
import { gateGuide, homeGate } from '../../model/home-brief.ts';
import { sessionStatus } from '../../model/sidebar.ts';
import { targetKey } from '../../model/workspace.ts';
import { setDefaultAccessMode } from '../../runtime/agent-commands.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { defaultDriver, useConnection } from '../../state/connection-store.ts';
import { useConversationMeta } from '../../state/directory-store.ts';
import { useDraftImages } from '../../state/draft-images-store.ts';
import { useDraftSkills } from '../../state/draft-skills-store.ts';
import { hostPanelTab, useEditor } from '../../state/editor-store.ts';
import { useSetting } from '../../state/settings-store.ts';
import { routeVideo, useShell } from '../../state/shell-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { Composer } from '../composer.tsx';
import { useEditorReference } from '../use-editor-reference.ts';
import { AgentGateLine } from './agent-gate-line.tsx';
import { QUICK_CHAT_COPY as COPY } from './quick-chat-copy.ts';

// 展开的卡片让开右侧竖排的工具栏（48px 宽的一列加 24px 间距）；最小化的圆形图标照旧贴在右下角、工具栏下方。
const dock = style({ position: 'absolute', insetEnd: { default: 24, isOpen: '[72px]' }, bottom: 24, zIndex: 20 });
const trigger = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  size: 48,
  padding: 0,
  borderWidth: 0,
  borderRadius: 'full',
  // 浮在编辑器上的面用 elevated 底色：深色下比面板亮一档，不至于和身后的面板糊成一片（gray-25 在深色下与面板同色）。
  '--s2-container-bg': { type: 'backgroundColor', value: { default: 'elevated', isHovered: 'gray-100', isPressed: 'gray-200' } },
  backgroundColor: '--s2-container-bg',
  boxShadow: 'elevated',
  color: 'gray-800',
  cursor: 'default',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: 2,
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
/** 最小化时图标右上角的点：颜色沿用 Home 侧栏会话行的状态灯（model/sidebar.ts `sessionStatus`）：进行中蓝、等批准橙、失败红、完成未读绿。 */
const dot = style({
  position: 'absolute',
  top: 2,
  insetEnd: 2,
  size: 8,
  borderRadius: 'full',
  borderWidth: 2,
  borderStyle: 'solid',
  // 描一圈图标的底色，把点和图标隔开。
  borderColor: '[var(--s2-container-bg)]',
  backgroundColor: { status: { running: 'accent', waiting: 'notice', failed: 'negative', unread: 'positive' } },
});
const panel = style({
  display: 'flex',
  flexDirection: 'column',
  boxSizing: 'border-box',
  width: 400,
  maxWidth: '[calc(100% - 96px)]',
  borderRadius: '[16px]',
  backgroundColor: 'elevated',
  boxShadow: 'elevated',
  overflow: 'hidden',
});
const head = style({ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, paddingStart: 16, paddingEnd: 8, paddingTop: 8 });
const title = style({ flexGrow: 1, minWidth: 0, font: 'title-sm', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
// 输入框自带左右 12 的留白，上面与标题之间再空 4；下面紧贴工具栏，只留输入框自己的那一点（产品设计 §5.1「输入区底栏」）。
const body = style({ paddingTop: 4, marginBottom: -8 });
const gate = style({ paddingX: 16, paddingBottom: 12 });

/** 悬浮会话的草稿按视频分：换一个视频就是另一个输入框，没发出的话不跟过去。 */
function draftKeyOf(videoKey: string | null): string {
  return `video-chat:${videoKey ?? ''}`;
}

/**
 * Space 里打开的视频右下角的悬浮会话（产品设计 §2.2、§5.1）：默认展开成一个新会话的输入框，不抢编辑器的焦点；最小化后缩成图标
 * （记在本机），图标上的点提示这里最近发起的会话正在干活、等批准或做完未读。输入框与 Home 起始页同一个（`Composer`）：左边访问模式，
 * 右边 Agent · 模型 · 推理强度，选择的语义也一样（按这个视频的草稿记，发出时带给新会话，选过的访问模式记成默认）。
 *
 * 发出即转到 Home 的这条会话，第一句话就是这段 prompt，编辑器此刻的状态随它带进去，会话里出这部视频的视频卡，点「打开编辑器」回来
 * （`video-cards.ts` `openingVideo`）。发送前不建空会话；每次都新建一条会话，回到 Space 仍从空的输入框开始。会话归入视频所在的项目；
 * 视频不属于项目（在某条无项目会话的工作目录里）时新会话也不属于项目，显示在「最近」。
 */
export function VideoQuickChat() {
  const runtime = useRuntime();
  const source = useVideo((s) => s.video?.ref?.source ?? null);
  const projectId = source?.projectId ?? null;
  const owner = projectId ? null : (source?.conversationId ?? null);
  const key = useShell((s) => {
    const target = routeVideo(s.route);
    return target ? targetKey(target) : null;
  });
  const draftKey = draftKeyOf(key);
  // 图标上的点看这里最近发起的那条会话；被删了（目录里找不到）就不亮。
  const started = useShell((s) => (key ? (s.videoChats[key] ?? null) : null));
  const watched = useConversationMeta(started);
  const prefMin = useShell((s) => s.videoChatMin);
  // 工具页（`aitools`）开着时，展开的卡片正好盖住页底的「交给 Agent」：这段时间按最小化显示，但不改记在本机的偏好；
  // 用户自己点开图标则这一次照常展开（`peek`），工具页关掉就复位，回到偏好的状态。工具页上的点开、最小化都只动 `peek`，不碰偏好。
  // 网页宿主没有 AI 工具 Tab：记着的 `aitools` 在那里落回文稿，不算开着。
  const web = runtime.host.platform === 'web';
  const toolsOpen = useEditor((s) => hostPanelTab(s.panelTab, web) === 'aitools');
  const [peek, setPeek] = useState(false);
  const min = toolsOpen ? !peek : prefMin;
  const drivers = useConnection((s) => s.drivers);
  const checking = useConnection((s) => s.checking);
  const guide = gateGuide(homeGate(drivers, checking));
  // 新会话的访问模式与 Agent · 模型 · 强度：这个视频的草稿上选过的，否则设置里的默认（同起始页）。
  const draftMode = useShell((s) => s.draftAccessModes[draftKey]);
  const defaultMode = useSetting('agent.defaultAccessMode');
  const choice = useShell((s) => s.draftAgents[draftKey]);
  // 草稿上选的 Agent 还在首次探测时显示「正在检测」，不退回默认的那个（发送时照旧带草稿上的选择）。
  const driver =
    choice?.driverId && checking.includes(choice.driverId)
      ? null
      : (drivers?.find((d) => d.id === choice?.driverId) ?? defaultDriver(drivers, checking));
  const { model, effort } = draftSelection(driver, choice);
  // 引用标签与发送时取的编辑器状态按视频自己的来源（项目，或它所在的那条无项目会话）认，不按新会话：新会话发出前还不存在。
  // 不属于项目的视频，新会话的智能体打不开它（工具只认会话自己的工作目录，`VIDEO_OUTSIDE_WORKSPACE`）；
  // 状态照样带上，为的是视频卡，也让智能体知道用户在看哪部视频。
  const editor = useEditorReference({ conversationId: owner, projectId });
  // 默认展开时不抢编辑器的焦点；用户自己点开的才把光标放进输入框（Composer 挂上时聚焦一次）。
  const [opened, setOpened] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!toolsOpen) setPeek(false);
  }, [toolsOpen]);

  const minimize = () => {
    setPeek(false);
    if (!toolsOpen) useShell.getState().setVideoChatMin(true);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  /** 新建一条会话（项目里的视频归那个项目，否则不属于项目），转到它，再把第一句话发出去（同起始页 `onSend`）。 */
  const startConversation = async (text: string, attachments: AttachmentRef[], skills: SkillSendRef[], videoKey: string) => {
    // 编辑器此刻的状态在离开 Space 之前取：引用标签只认眼前显示的视频。
    const context = await editor.capture();
    let conversationId: Id | null = null;
    try {
      // 只传草稿上选过的；没选的由 Runtime 按偏好给。选过的访问模式同时记成新会话的默认。
      const conversation = await runtime.createConversation(projectId, {
        ...(draftMode ? { accessMode: draftMode } : {}),
        ...(choice?.driverId ? { driverId: choice.driverId } : {}),
        ...(choice && 'model' in choice ? { model: choice.model ?? null } : {}),
        ...(choice && 'effort' in choice ? { effort: choice.effort ?? null } : {}),
      });
      conversationId = conversation.id;
      if (draftMode && draftMode !== defaultMode) void setDefaultAccessMode(runtime, draftMode).catch(() => {});
      const shell = useShell.getState();
      shell.setDraftAccessMode(draftKey, null);
      shell.setDraftAgent(draftKey, null);
      shell.setVideoChat(videoKey, conversation.id);
      // 编辑器不跟去：视频卡上的「打开编辑器」再打开它。
      shell.go({ tab: 'home', conversationId: conversation.id, projectId: null });
      await runtime.send(
        conversation.id,
        text,
        context,
        attachments.map((a) => a.id),
        undefined,
        skills,
      );
      editor.reset();
      return true;
    } catch (error) {
      ToastQueue.negative(sendFailureMessage(error), { timeout: 5000 });
      // 会话已经建好、人也转过去了：话、图片与点选的 skill 放回那条会话的输入框，不吞掉用户的输入。
      if (conversationId) {
        useShell.getState().setDraft(conversationId, text);
        useDraftImages.getState().move(draftKey, conversationId);
        useDraftSkills.getState().move(draftKey, conversationId);
        return true;
      }
      // 会话没建成：输入框放回原话，人留在编辑器。
      return false;
    }
  };

  // 输入框里按 Esc 收起；补全弹层开着时 Esc 先关弹层。
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (event.key !== 'Escape' || event.defaultPrevented || target.getAttribute('role') !== 'textbox') return;
    if (target.getAttribute('aria-expanded') === 'true') return;
    event.preventDefault();
    minimize();
  };

  if (min) {
    const status = watched ? sessionStatus(watched) : null;
    return (
      <div className={dock({ isOpen: false })}>
        <TooltipTrigger>
          <RACButton
            ref={triggerRef}
            className={(state) => trigger(state)}
            aria-label={COPY.expand}
            onPress={() => {
              setOpened(true);
              if (toolsOpen) setPeek(true);
              else useShell.getState().setVideoChatMin(false);
            }}>
            <Comment />
            {status ? <span className={dot({ status })} /> : null}
          </RACButton>
          <Tooltip>{COPY.expand}</Tooltip>
        </TooltipTrigger>
      </div>
    );
  }

  return (
    <aside className={`${dock({ isOpen: true })} ${panel}`} aria-label={COPY.label} onKeyDown={onKeyDown}>
      <div className={head}>
        <span className={title}>{COPY.fresh}</span>
        <TooltipTrigger>
          <ActionButton isQuiet size="S" aria-label={COPY.minimize} onPress={minimize}>
            <Minimize />
          </ActionButton>
          <Tooltip>{COPY.minimize}</Tooltip>
        </TooltipTrigger>
      </div>
      <div className={body}>
        <Composer
          draftKey={draftKey}
          driverId={driver?.id ?? null}
          model={model}
          effort={effort}
          lockedTo={null}
          onAgentChange={(change) => useShell.getState().setDraftAgent(draftKey, applyAgentChange(choice, driver?.id ?? null, change))}
          accessMode={draftMode ?? defaultMode ?? DEFAULT_AGENT_MODE}
          onAccessModeChange={(accessMode) => useShell.getState().setDraftAccessMode(draftKey, accessMode)}
          busy={false}
          placeholder={COPY.placeholder}
          autoFocus={opened}
          reference={editor.reference}
          mentionScope={{ projectId, conversationId: null }}
          onSend={async (text, attachments, skills) => {
            // 视频还没载入（不知道它在哪个项目）时先不发，话留在输入框里。
            if (!source || !key) return false;
            return startConversation(text, attachments, skills, key);
          }}
        />
      </div>
      {guide ? (
        <div className={gate}>
          <AgentGateLine guide={guide} />
        </div>
      ) : null}
    </aside>
  );
}
