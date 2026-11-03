import { useEffect, useState } from 'react';
import { ActionButton, Badge, Switch, ToastQueue } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import type { AgentDefaultState } from '../../model/models-cloud.ts';
import { probeModelCapabilities, setAgentProviderEnabled } from '../../runtime/agent-commands.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';
import { useModels } from '../../state/models-store.ts';
import { useShell } from '../../state/shell-store.ts';
import {
  agentSwitchProvider,
  agentSwitchRow,
  agentSwitchToast,
  CODEX_SWITCH,
  type AgentSwitchCapability,
  type AgentSwitchProbe,
  type AgentSwitchSpec,
  type AgentSwitchState,
} from '../settings/agent-switch.ts';
import { CLAUDE_CARD_COPY, CODEX_CARD_COPY, CLOUD_COPY, MODELS_PAGE_COPY } from './models-copy.ts';

/**
 * 智能体开关在模型页的两处：能力页服务商列表后面的一张卡（设计稿 settings-capability.jsx ④；图像生成有 Codex，文本生成有 Codex 与
 * Claude Code），与默认模型菜单里的「Codex CLI · 画图」「Codex CLI · 文字」「Claude Code · 文字」。开关、能不能打开、原因都复用设置 › Agent
 * 那一行（A2-e）的纯函数与命令，不另起一份；进页时同样探测一次（重新检测、升级、登录之后再探测）。`capability` 决定看哪种能力的 Provider。
 */
export function useAgentSwitch(
  spec: AgentSwitchSpec,
  active: boolean,
  capability: AgentSwitchCapability = spec.capability,
): { spec: AgentSwitchSpec; connected: boolean; state: AgentSwitchState | null; registered: boolean } {
  const runtime = useRuntime();
  const connected = useConnection((s) => s.state.status === 'connected');
  const driver = useConnection((s) => s.drivers?.find((d) => d.id === spec.driverId) ?? null);
  const provider = useModels((s) => agentSwitchProvider(s.capabilities, spec, capability));
  const [probe, setProbe] = useState<AgentSwitchProbe>('pending');
  const installed = !!driver && driver.state !== 'not-installed';
  const probeKey = driver ? `${driver.state}|${driver.version ?? ''}|${driver.checkedAt ?? ''}` : '';

  useEffect(() => {
    if (!active || !connected || !installed) return;
    let live = true;
    probeModelCapabilities(runtime).then(
      () => live && setProbe('done'),
      () => live && setProbe((old) => (old === 'done' ? old : 'failed')),
    );
    return () => {
      live = false;
    };
  }, [runtime, active, connected, installed, probeKey]);

  return { spec, connected, state: driver ? agentSwitchRow(spec, provider, driver, probe) : null, registered: !!provider };
}

/** 这张卡用的文案；只有文本生成的 Agent 没有 `on`。 */
function cardCopyOf(spec: AgentSwitchSpec): Omit<typeof CODEX_CARD_COPY, 'on'> & { on?: string } {
  return spec === CODEX_SWITCH ? CODEX_CARD_COPY : CLAUDE_CARD_COPY;
}

/** 默认模型菜单里这个智能体那一项的状态；Runtime 没注册它时菜单里不出现它。 */
export function agentDefaultState(agent: ReturnType<typeof useAgentSwitch>): AgentDefaultState | null {
  if (!agent.registered) return null;
  const { state, spec } = agent;
  const copy = cardCopyOf(spec);
  if (!state) return { ready: false, why: copy.missing };
  if (state.ready) return { ready: true, why: null };
  return { ready: false, why: state.why ?? (state.checking ? spec.copy.checking : copy.off) };
}

const card = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 12,
  paddingX: 16,
  paddingY: 12,
  marginBottom: 8,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: 'lg',
  backgroundColor: 'layer-1',
});
const text = style({ flexGrow: 1, flexBasis: 0, minWidth: 220, paddingStart: 24 });
const title = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const body = style({ marginTop: 2, marginBottom: 0, font: 'ui-xs', color: 'gray-600' });
const controls = style({ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 });

/**
 * 能力页服务商列表后面的一张：能开时给开关，不能开（没装、没登录、太旧）时给「去设置 › Agent」。关掉开关不清默认值。
 * Codex 两页的开关是同一个（画图和写文字一起开关），说明按这一页的能力写。浏览器里开关置灰（`models.configure` 不在 Web 白名单里），
 * 页头的说明已经写了原因。
 */
export function AgentSwitchCard({
  agent,
  isDefault,
  capability,
}: {
  agent: ReturnType<typeof useAgentSwitch>;
  isDefault: boolean;
  capability: AgentSwitchCapability;
}) {
  const runtime = useRuntime();
  const web = runtime.host.platform === 'web';
  const go = useShell((s) => s.go);
  const [busy, setBusy] = useState(false);
  const { state, connected, spec } = agent;
  const copy = cardCopyOf(spec);
  if (!agent.registered) return null;

  const canSwitch = !!state && (state.enabled || state.canEnable || state.checking);
  const desc = !state
    ? copy.missing
    : state.ready
      ? (state.caution ?? (capability === 'generateText' ? copy.onText : (copy.on ?? copy.onText)))
      : state.checking
        ? spec.copy.checking
        : (state.why ?? copy.off);

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      await setAgentProviderEnabled(runtime, spec.providerId, enabled);
      ToastQueue.neutral(agentSwitchToast(spec, enabled), { timeout: 3000 });
    } catch (error) {
      ToastQueue.negative(copy.toggleFailed(enabled, (error as Error).message), { timeout: 5000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={card} aria-label={copy.title}>
      <div className={text}>
        <div className={title}>{copy.title}</div>
        <p className={body}>{desc}</p>
      </div>
      <div className={controls}>
        {isDefault ? (
          <Badge variant="accent" size="S" fillStyle="subtle">
            {CLOUD_COPY.defaultChip}
          </Badge>
        ) : null}
        {canSwitch && state ? (
          <Switch
            aria-label={copy.switchLabel}
            size="S"
            isSelected={state.enabled}
            isDisabled={web || !connected || busy || state.checking || (!state.enabled && !state.canEnable)}
            onChange={(enabled) => void toggle(enabled)}
          />
        ) : (
          <ActionButton isQuiet size="S" onPress={() => go({ tab: 'settings', section: 'agent' })}>
            {MODELS_PAGE_COPY.goAgent}
          </ActionButton>
        )}
      </div>
    </section>
  );
}
