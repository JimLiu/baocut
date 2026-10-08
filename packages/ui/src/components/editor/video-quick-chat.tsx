import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { PromptField, PromptFieldSubmitButton, PromptFieldToolbar, PromptTokenField } from '@react-spectrum/ai';
import { ActionButton, Button, ToastQueue, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import ArrowUpSend from '@react-spectrum/s2/icons/ArrowUpSend';
import Comment from '@react-spectrum/s2/icons/Comment';
import Minimize from '@react-spectrum/s2/icons/Minimize';
import OpenIn from '@react-spectrum/s2/icons/OpenIn';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import { gateGuide, homeGate } from '../../model/home-brief.ts';
import { sessionStatus } from '../../model/sidebar.ts';
import { targetKey } from '../../model/workspace.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';
import { useConversationMeta } from '../../state/directory-store.ts';
import { useEditor } from '../../state/editor-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { routeVideo, useShell } from '../../state/shell-store.ts';
import { ConversationView } from '../conversation-view.tsx';
import { useEditorReference } from '../use-editor-reference.ts';
import { focusPromptEnd, usePromptValue } from '../use-prompt-value.ts';
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
  // 有会话时卡片里是整条会话：占住一个固定的高度，矮窗口里跟着缩。
  height: { isThread: '[min(560px, calc(100% - 48px))]' },
});
const head = style({ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, paddingStart: 12, paddingEnd: 8, paddingTop: 8 });
const titles = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 });
const title = style({ font: 'title-sm', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const context = style({ font: 'ui-xs', color: 'gray-600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const thread = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 });
const start = style({ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 });
const foot = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  width: 'full',
  font: 'ui-sm',
  color: 'gray-600',
});

/**
 * Space 里打开的视频右下角的悬浮会话（产品设计 §2.2、§5.1 用户修订）：默认展开成一个输入框，说一句就在原地接着做，
 * 编辑器不让开；最小化后缩成图标（记在本机），图标上的点提示 Agent 正在干活或做完未读。想要宽一点就「在左侧展开会话」，
 * 转到 Home 的会话里、编辑器保持打开。项目里的视频第一句话新开一个项目会话，之后都接着它，「新会话」另起一条；
 * 不属于项目的视频在它所属会话的临时目录里，只有那个会话的智能体读写得到，所以一直接着那个会话说。
 */
export function VideoQuickChat() {
  const runtime = useRuntime();
  const source = useVideo((s) => s.video?.ref?.source ?? null);
  const name = useVideo((s) => s.video?.state?.video.name ?? s.video?.ref?.name ?? COPY.untitled);
  const projectId = source?.projectId ?? null;
  const owner = projectId ? null : (source?.conversationId ?? null);
  const key = useShell((s) => {
    const target = routeVideo(s.route);
    return target ? targetKey(target) : null;
  });
  const started = useShell((s) => (key ? (s.videoChats[key] ?? null) : null));
  // 记着的会话被删了（目录里找不到）就当没有，从新会话开始。
  const meta = useConversationMeta(owner ?? started);
  const conversationId = meta?.id ?? null;
  const prefMin = useShell((s) => s.videoChatMin);
  // 工具页（`aitools`）开着时，展开的卡片正好盖住页底的「交给 Agent」：这段时间按最小化显示，但不改记在本机的偏好；
  // 用户自己点开图标则这一次照常展开（`peek`），工具页关掉就复位，回到偏好的状态。工具页上的点开、最小化都只动 `peek`，不碰偏好。
  const toolsOpen = useEditor((s) => s.panelTab === 'aitools');
  const [peek, setPeek] = useState(false);
  const min = toolsOpen ? !peek : prefMin;
  const drivers = useConnection((s) => s.drivers);
  const checking = useConnection((s) => s.checking);
  const guide = gateGuide(homeGate(drivers, checking));
  const editor = useEditorReference({ conversationId: owner, projectId });
  const [draft, setDraft] = useState('');
  const [prompt, setPrompt] = usePromptValue(draft, setDraft);
  const [sending, setSending] = useState(false);
  // 默认展开时不抢编辑器的焦点；用户自己点开的才把光标放进输入框。
  const [opened, setOpened] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<ComponentRef<typeof PromptField>>(null);
  const canSend = draft.trim() !== '' && !sending && !guide && !!source;
  useEffect(() => {
    if (!toolsOpen) setPeek(false);
  }, [toolsOpen]);
  useEffect(() => {
    if (opened && !min) focusPromptEnd(fieldRef.current?.UNSAFE_getDOMNode());
  }, [opened, min]);

  const minimize = () => {
    setPeek(false);
    if (!toolsOpen) useShell.getState().setVideoChatMin(true);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const send = async () => {
    const text = draft.trim();
    if (!canSend || !key) return;
    setSending(true);
    try {
      const capture = await editor.capture();
      const id = (await runtime.createConversation(projectId)).id;
      useShell.getState().setVideoChat(key, id);
      try {
        await runtime.send(id, text, capture);
        editor.reset();
      } catch (error) {
        // 会话已经建好、卡片里换成了它：把文字放回它的输入框，不吞掉用户的输入。
        useShell.getState().setDraft(id, text);
        throw error;
      }
      setDraft('');
    } catch (error) {
      ToastQueue.negative(COPY.failed((error as Error).message), { timeout: 5000 });
    } finally {
      setSending(false);
    }
  };

  const expand = () => {
    if (!conversationId) return;
    const shell = useShell.getState();
    const video = routeVideo(shell.route);
    // 视频要作为会话右侧功能区的标签带过去（Home 的路由里叫 `pane`），并把功能区亮出来；直接拼路由会丢掉视频。
    if (video) shell.openVideo(video, { conversationId });
    else shell.go({ tab: 'home', conversationId, projectId: null });
  };

  if (min) {
    const status = meta ? sessionStatus(meta) : null;
    return (
      <div className={dock({ isOpen: false })}>
        <TooltipTrigger>
          <RACButton
            ref={triggerRef}
            className={(state) => trigger(state)}
            aria-label={COPY.open}
            onPress={() => {
              setOpened(true);
              if (toolsOpen) setPeek(true);
              else useShell.getState().setVideoChatMin(false);
            }}>
            <Comment />
            {status ? <span className={dot({ status })} /> : null}
          </RACButton>
          <Tooltip>{COPY.open}</Tooltip>
        </TooltipTrigger>
      </div>
    );
  }

  return (
    <aside className={`${dock({ isOpen: true })} ${panel({ isThread: !!conversationId })}`} aria-label={COPY.label}>
      <div className={head}>
        <div className={titles}>
          <span className={title}>{meta?.title || COPY.fresh}</span>
          <span className={context} title={COPY.about(name)}>
            {COPY.about(name)}
          </span>
        </div>
        {conversationId && !owner && key ? (
          <TooltipTrigger>
            <ActionButton isQuiet size="S" aria-label={COPY.fresh} onPress={() => useShell.getState().setVideoChat(key, null)}>
              <Add />
            </ActionButton>
            <Tooltip>{COPY.fresh}</Tooltip>
          </TooltipTrigger>
        ) : null}
        {conversationId ? (
          <TooltipTrigger>
            <ActionButton isQuiet size="S" aria-label={COPY.expand} onPress={expand}>
              <OpenIn />
            </ActionButton>
            <Tooltip>{COPY.expand}</Tooltip>
          </TooltipTrigger>
        ) : null}
        <TooltipTrigger>
          <ActionButton isQuiet size="S" aria-label={COPY.minimize} onPress={minimize}>
            <Minimize />
          </ActionButton>
          <Tooltip>{COPY.minimize}</Tooltip>
        </TooltipTrigger>
      </div>
      {conversationId ? (
        <div className={thread}>
          <ConversationView key={conversationId} conversationId={conversationId} autoFocus={opened} />
        </div>
      ) : (
        <div className={start}>
          <PromptField
            ref={fieldRef}
            size="S"
            variant="subtle"
            value={prompt}
            onChange={setPrompt}
            onSubmit={() => void send()}
            aiDisclaimer={<></>}>
            <div role="group" aria-label={COPY.label}>
              <PromptTokenField
                placeholder={COPY.placeholder}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return;
                  event.preventDefault();
                  minimize();
                }}
              />
            </div>
            <PromptFieldToolbar>
              <div className={foot}>
                {guide ? <AgentGateLine guide={guide} /> : <span>{COPY.hint}</span>}
                {canSend ? (
                  <PromptFieldSubmitButton />
                ) : (
                  <Button variant="primary" size="S" isDisabled isPending={sending} aria-label={COPY.send}>
                    <ArrowUpSend />
                  </Button>
                )}
              </div>
            </PromptFieldToolbar>
          </PromptField>
        </div>
      )}
    </aside>
  );
}
