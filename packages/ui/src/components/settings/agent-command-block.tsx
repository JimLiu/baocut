import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { AgentSetupAction, AgentSetupRun, DriverInfo } from '@baocut/protocol';
import { ActionButton, AlertDialog, Button, ProgressCircle, TextField, ToastQueue } from '@react-spectrum/s2';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import CheckmarkCircle from '@react-spectrum/s2/icons/CheckmarkCircle';
import Copy from '@react-spectrum/s2/icons/Copy';
import Play from '@react-spectrum/s2/icons/Play';
import StopProcessing from '@react-spectrum/s2/icons/StopProcessing';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { configureAgent } from '../../runtime/agent-commands.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { AGENT_COPY } from './agent-copy.ts';
import { setupLog } from './agent-setup.ts';

const C = () => AGENT_COPY.command;

/** 复制到剪贴板；拿不到剪贴板权限时让用户自己选中复制（命令与路径都可选中）。 */
export async function copyText(value: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    ToastQueue.positive(C().copied(label), { timeout: 3000 });
  } catch {
    ToastQueue.neutral(C().copyFailed, { timeout: 5000 });
  }
}

const block = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  paddingStart: { default: 12, isRunnable: 4 },
  paddingEnd: 4,
  paddingY: 4,
  borderRadius: 'lg',
  backgroundColor: 'gray-100',
});
const code = style({ flexGrow: 1, minWidth: 0, font: 'code-sm', color: 'gray-900', overflowWrap: 'anywhere', userSelect: 'text' });
// 日志框（settings-agent.css:43-46 的 agset-run）：等宽、可选中、固定高度滚动。
const log = style({
  boxSizing: 'border-box',
  margin: 0,
  height: 144,
  overflow: 'auto',
  paddingX: 12,
  paddingY: 8,
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  backgroundColor: 'gray-75',
  font: 'code-xs',
  color: 'gray-900',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  userSelect: 'text',
});
const runStatus = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, font: 'ui-sm', color: 'gray-800' });
const okIcon = iconStyle({ size: 'S', color: 'positive' });
const failIcon = iconStyle({ size: 'S', color: 'negative' });
const stopIcon = iconStyle({ size: 'S', color: 'neutral' });
const runText = style({ flexGrow: 1, flexBasis: 0, minWidth: 200 });

/**
 * 命令左边的 ▶（设计稿 settings-agent-provider.jsx:24-76 的 useCmdRun / CmdRun）。运行状态在 Runtime（`agent-setup` 主题），
 * 卡片把这条命令最近的一次交进来；起跑前的确认、停止、改到终端里运行都由卡片接。
 */
export interface CommandRunner {
  /** 这条命令最近的一次运行（没有、或不再显示时为 null）。 */
  run: AgentSetupRun | null;
  /** 同一个 Agent 的别的命令正在跑，或者还没连上 Runtime：▶ 不可点。 */
  isDisabled: boolean;
  /** 点 ▶：卡片先弹确认（显示完整命令），确认后才运行。 */
  onRun: () => void;
  onStop: () => void;
  /** 失败后「在终端里运行」：交给系统终端（要输入密码的在这里跑不了）。 */
  onTerminal: () => void;
}

/**
 * 一条命令或路径：原样展示，右边一颗复制。
 *
 * 给了 `runner`（只有 brew、npm 这类安装、升级命令）时左边多一颗 ▶：用户确认后由 Runtime 在应用内运行，
 * 输出原样显示在命令下面的日志框里（也记进 Runtime 日志），运行中 ▶ 变 ■ 可以停止；失败时给「在终端里运行」。
 * `curl … | bash` 这类官方脚本和登录命令不给 ▶，只复制或交给系统终端（架构设计 §12.9）。
 * `note` 排在命令与日志框之间（前置条件这类，设计稿 CmdRun 的顺序）。
 */
export function CommandBlock({ value, copyLabel, runner, note }: { value: string; copyLabel: string; runner?: CommandRunner; note?: ReactNode }) {
  const running = runner?.run?.state === 'running';
  return (
    <>
      <div className={block({ isRunnable: !!runner })}>
        {runner ? (
          <ActionButton
            isQuiet
            size="S"
            aria-label={running ? C().stop : C().run}
            isDisabled={!running && runner.isDisabled}
            onPress={running ? runner.onStop : runner.onRun}>
            {running ? <StopProcessing /> : <Play />}
          </ActionButton>
        ) : null}
        <code className={code}>{value}</code>
        <ActionButton isQuiet size="S" aria-label={C().copy(copyLabel)} onPress={() => void copyText(value, copyLabel)}>
          <Copy />
        </ActionButton>
      </div>
      {note}
      {runner?.run ? <RunOutput run={runner.run} onTerminal={runner.onTerminal} /> : null}
    </>
  );
}

/** 日志框与一行结果。新输出到了就滚到底；用户往上翻着看时不抢滚动条。 */
function RunOutput({ run, onTerminal }: { run: AgentSetupRun; onTerminal: () => void }) {
  const ref = useRef<HTMLPreElement>(null);
  const stick = useRef(true);
  const text = setupLog(run);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [text]);
  return (
    <>
      <pre
        ref={ref}
        className={log}
        role="log"
        aria-live="polite"
        aria-label={C().output}
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
        }}>
        {text}
      </pre>
      <div className={runStatus} role="status">
        {run.state === 'running' ? (
          <>
            <ProgressCircle size="S" isIndeterminate aria-label={C().running} />
            <span>{C().runningText}</span>
          </>
        ) : run.state === 'completed' ? (
          <>
            <CheckmarkCircle styles={okIcon} />
            <span>{C().done}</span>
          </>
        ) : run.state === 'cancelled' ? (
          <>
            <StopProcessing styles={stopIcon} />
            <span>{C().stopped}</span>
          </>
        ) : (
          <>
            <AlertTriangle styles={failIcon} />
            <span className={runText}>{C().failed(failureReason(run))}</span>
            <Button variant="secondary" size="S" onPress={onTerminal}>
              {C().runInTerminal}
            </Button>
          </>
        )}
      </div>
    </>
  );
}

/** 失败的那一句括号里写什么：有退出码写退出码（设计稿原文）；没能启动、被信号结束的设计稿没有，按事实写。 */
function failureReason(run: Pick<AgentSetupRun, 'exitCode' | 'error'>): string {
  if (run.exitCode !== null) return C().exitCode(run.exitCode);
  if (run.error) return C().startFailed(run.error);
  return C().killed;
}

const dialogCode = style({ display: 'block', marginY: 12, padding: 12, borderRadius: 'lg', backgroundColor: 'gray-100', font: 'code-sm', color: 'gray-900', overflowWrap: 'anywhere', userSelect: 'text' });

/**
 * 运行前的确认（架构设计 §12.9：用户逐次确认，确认时显示完整命令）。设计稿点 ▶ 直接起跑，没有这一步；按钮用动词「运行」。
 * 放进调用方的 `DialogContainer`。
 */
export function RunCommandDialog({ action, name, command, onRun }: { action: AgentSetupAction; name: string; command: string; onRun: () => void }) {
  return (
    <AlertDialog variant="confirmation" title={action === 'install' ? C().confirmInstall(name) : C().confirmUpgrade(name)}
      primaryActionLabel={C().confirmRun}
      cancelLabel={C().cancel}
      onPrimaryAction={onRun}>
      {C().confirmBefore}
      <code className={dialogCode}>{command}</code>
      {C().confirmAfter}
    </AlertDialog>
  );
}

const field = style({ display: 'flex', alignItems: 'end', flexWrap: 'wrap', gap: 8 });
const input = style({ flexGrow: 1, minWidth: 220 });

/**
 * 手动指定可执行文件：填完整路径保存；清空保存或点「恢复自动查找」回到自动查找。
 * 保存后 Runtime 用新位置重新探测，返回的就是新结果，不用再点重新检测。
 */
export function ExecutableField({ driver, label, isDisabled }: { driver: DriverInfo; label?: string; isDisabled?: boolean }) {
  const runtime = useRuntime();
  const saved = driver.executableOverride ?? '';
  const [value, setValue] = useState(saved);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(saved), [saved]);
  const next = value.trim();
  const save = async (executable: string | null) => {
    setBusy(true);
    try {
      const view = await configureAgent(runtime, driver.id, { executable });
      const now = view.drivers.find((d) => d.id === driver.id);
      if (!executable) ToastQueue.neutral(C().restored(driver.name), { timeout: 3000 });
      else if (now && now.state !== 'not-installed') ToastQueue.positive(C().switched(executable), { timeout: 3000 });
      else ToastQueue.negative(C().notFoundAt(executable, driver.command), { timeout: 5000 });
    } catch (error) {
      ToastQueue.negative(C().saveFailed((error as Error).message), { timeout: 5000 });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={field}>
      <TextField
        label={label ?? C().locationLabel(driver.name)}
        size="S"
        value={value}
        onChange={setValue}
        placeholder={driver.executable ?? C().locationPlaceholder(driver.command)}
        description={saved ? C().locationSaved : C().locationAuto}
        isDisabled={isDisabled || busy}
        styles={input}
      />
      <Button variant="secondary" size="S" isDisabled={isDisabled || busy || next === saved} onPress={() => void save(next || null)}>
        {C().save}
      </Button>
      {saved ? (
        <Button variant="secondary" size="S" isDisabled={isDisabled || busy} onPress={() => void save(null)}>
          {C().restoreAuto}
        </Button>
      ) : null}
    </div>
  );
}
