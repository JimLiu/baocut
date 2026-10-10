import { useEffect, useRef, useState } from 'react';
import { messageSkills, type DriverId, type Id, type TimelineItem } from '@baocut/protocol';
import { ActionButton, Button, Menu, MenuItem, MenuTrigger, Text, ToastQueue } from '@react-spectrum/s2';
import Refresh from '@react-spectrum/s2/icons/Refresh';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { RECOVERY_COPY } from '../../copy.ts';
import { modelChange, modelRows } from '../../model/agent-choice.ts';
import { detectAgents, openAgentTerminal } from '../../runtime/agent-commands.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';
import { useConversationMeta } from '../../state/directory-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useTimelineItems } from '../../state/timeline-store.ts';

type Task = Extract<TimelineItem, { kind: 'task' }>;

const box = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  marginStart: 36,
  padding: 12,
  borderRadius: 'lg',
  backgroundColor: 'gray-50',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  font: 'ui-sm',
  color: 'gray-800',
});
const title = style({ font: 'title-sm', margin: 0 });
const body = style({ margin: 0, color: 'gray-700' });
const acts = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 });
const retryRow = style({ display: 'flex', marginStart: 36 });
const menu = style({ width: 320, maxWidth: '[calc(100vw - 32px)]' });

/**
 * 任务失败后的恢复区（原型 agent-thread.jsx `ErrorMsg`）：按 Runtime 给的错误码给出路。
 * 要登录：打开系统终端运行探测到的登录命令（经 Runtime 的 `agents.openTerminal`；BaoCut 不经手账号密码），
 * 打不开就退回复制命令，回到窗口时重新检测一次；模型用不了：换个模型再把这一轮原样重发；
 * 其余：重试，把这一轮的那句话原样重发（不带当时的编辑器状态，那已经过时了）。
 */
export function TaskRecovery({ item, conversationId }: { item: Task; conversationId: Id }) {
  const runtime = useRuntime();
  const meta = useConversationMeta(conversationId);
  const driver = useConnection((s) => s.drivers?.find((d) => d.id === meta?.driverId) ?? null);
  const items = useTimelineItems(conversationId);
  const go = useShell((s) => s.go);
  const [pending, setPending] = useState(false);
  const stopWatchingReturn = useRef<(() => void) | null>(null);
  useEffect(() => () => stopWatchingReturn.current?.(), []);
  const taskId = item.taskId ?? item.id;
  const message = items.find((i): i is Extract<TimelineItem, { kind: 'user-message' }> => i.kind === 'user-message' && i.taskId === taskId);
  const name = driver?.name ?? 'Agent';

  const resend = async (before?: () => Promise<void>) => {
    if (!message) {
      ToastQueue.negative(RECOVERY_COPY.nothingToResend, { timeout: 5000 });
      return;
    }
    setPending(true);
    try {
      await before?.();
      // 那一轮点选的 skill 也按原顺序一起重发（只带 id，Runtime 读它当前的 SKILL.md）。
      await runtime.send(
        conversationId,
        message.text,
        undefined,
        message.attachments?.map((a) => a.id),
        undefined,
        messageSkills(message).map((s) => ({ id: s.id })),
      );
    } catch (error) {
      ToastQueue.negative(RECOVERY_COPY.resendFailed((error as Error).message), { timeout: 5000 });
    } finally {
      setPending(false);
    }
  };
  // 终端里登录完回到这个窗口时重新检测，Agent 的登录状态跟着变。
  const recheckOnReturn = (driverId: DriverId) => {
    stopWatchingReturn.current?.();
    const onFocus = () => {
      stopWatchingReturn.current?.();
      void detectAgents(runtime, driverId).catch(() => {});
    };
    window.addEventListener('focus', onFocus);
    stopWatchingReturn.current = () => {
      window.removeEventListener('focus', onFocus);
      stopWatchingReturn.current = null;
    };
  };
  const copyLogin = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      ToastQueue.neutral(RECOVERY_COPY.loginCopied, { timeout: 5000 });
    } catch {
      ToastQueue.neutral(RECOVERY_COPY.loginManual(command), { timeout: 8000 });
    }
  };
  const openLogin = async () => {
    if (!driver) return;
    // 探测结果里没有登录命令时 Runtime 不收，退回复制直接起 CLI 的命令（同设置 › Agent）。
    if (!driver.loginCommand) return void copyLogin(driver.command);
    try {
      const result = await openAgentTerminal(runtime, driver.id, 'login');
      if (result.status === 'opened') {
        ToastQueue.neutral(RECOVERY_COPY.loginOpened(result.command), { timeout: 5000 });
        recheckOnReturn(driver.id);
        return;
      }
      await copyLogin(result.command);
    } catch {
      await copyLogin(driver.loginCommand);
    }
  };
  const settings = (
    <ActionButton size="S" isQuiet onPress={() => go({ tab: 'settings', section: 'agent' })}>
      <Text>{RECOVERY_COPY.agentSettings}</Text>
    </ActionButton>
  );

  if (item.errorCode === 'AGENT_AUTH_REQUIRED') {
    return (
      <div className={box} role="group" aria-label={RECOVERY_COPY.authTitle(name)}>
        <h3 className={title}>{RECOVERY_COPY.authTitle(name)}</h3>
        <p className={body}>{RECOVERY_COPY.authBody(name)}</p>
        <div className={acts}>
          {driver ? (
            <Button variant="accent" size="S" onPress={() => void openLogin()}>
              {RECOVERY_COPY.openLogin}
            </Button>
          ) : null}
          <Button variant="secondary" size="S" isPending={pending} onPress={() => void resend()}>
            {RECOVERY_COPY.resend}
          </Button>
          {settings}
        </div>
      </div>
    );
  }

  if (item.errorCode === 'AGENT_MODEL_UNAVAILABLE' && driver) {
    const rows = modelRows(driver, meta?.model ?? null).filter((row) => row.model !== (meta?.model ?? null));
    return (
      <div className={box} role="group" aria-label={RECOVERY_COPY.modelTitle(meta?.model ?? null)}>
        <h3 className={title}>{RECOVERY_COPY.modelTitle(meta?.model ?? null)}</h3>
        <p className={body}>{RECOVERY_COPY.modelBody}</p>
        <div className={acts}>
          <MenuTrigger>
            <Button variant="accent" size="S" isPending={pending}>
              {RECOVERY_COPY.pickModel}
            </Button>
            <Menu
              aria-label={RECOVERY_COPY.pickModel}
              size="M"
              styles={menu}
              onAction={(key) => {
                const model = String(key).slice('model:'.length) || null;
                const change = modelChange(driver, model, meta?.effort ?? null);
                void resend(() => runtime.updateConversation(conversationId, { model: change.model, effort: change.effort }));
              }}>
              {rows.map((row) => (
                <MenuItem key={row.model ?? ''} id={`model:${row.model ?? ''}`} textValue={row.label}>
                  <Text slot="label">{row.label}</Text>
                  {row.sub ? <Text slot="description">{row.sub}</Text> : null}
                </MenuItem>
              ))}
            </Menu>
          </MenuTrigger>
          {settings}
        </div>
      </div>
    );
  }

  return (
    <div className={retryRow}>
      <Button variant="secondary" size="S" isPending={pending} onPress={() => void resend()}>
        <Refresh />
        <Text>{RECOVERY_COPY.retry}</Text>
      </Button>
    </div>
  );
}
