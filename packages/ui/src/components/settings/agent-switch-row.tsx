import { useEffect, useState } from 'react';
import type { DriverInfo } from '@baocut/protocol';
import { Badge, Switch, ToastQueue } from '@react-spectrum/s2';
import ImageIcon from '@react-spectrum/s2/icons/Image';
import TextIcon from '@react-spectrum/s2/icons/Text';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { probeModelCapabilities, setAgentProviderEnabled } from '../../runtime/agent-commands.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useModels } from '../../state/models-store.ts';
import { CODEX_IMAGE_COPY } from './agent-copy.ts';
import { agentSwitchProvider, agentSwitchRow, agentSwitchToast, type AgentSwitchProbe, type AgentSwitchSpec } from './agent-switch.ts';

const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  paddingX: 20,
  paddingY: 12,
  borderTopWidth: 1,
  borderXWidth: 0,
  borderBottomWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const iconBox = style({
  display: 'flex',
  flexShrink: 0,
  color: { default: 'gray-600', isOn: 'blue-900' },
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const icon = iconStyle({ size: 'S' });
const text = style({ flexGrow: 1, minWidth: 0 });
const titleRow = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 });
const title = style({ font: 'ui-sm', fontWeight: 'bold', color: 'gray-900' });
const body = style({ marginTop: 2, marginBottom: 0, font: 'ui-sm', color: 'gray-700' });

/**
 * 「用 Codex 画图和写文字」「用 Claude Code 写文字」（设计稿 settings-agent-provider.jsx 的 CodexImageRow、ClaudeTextRow）：挂在 Agent 卡头
 * 下面，只在它已找到时出现。开关是智能体 Provider 的启用（`models.configure`）；能不能打开看模型服务的视图——
 * 这一行出现时探测一次（重新检测、升级、登录之后再探测一次），没探测过之前开关先不让拨。
 * Codex 打开后排在生图出厂顺序的第一位（架构设计 §6.2），文本生成都不自动选（§6.9）；不是订阅登录时 Runtime 不自动选它，行上照 Provider
 * 给的说明写。浏览器里开关置灰（`models.configure` 不在 Web 白名单里）。
 */
export function AgentSwitchRow({ spec, driver, connected }: { spec: AgentSwitchSpec; driver: DriverInfo; connected: boolean }) {
  const runtime = useRuntime();
  const web = runtime.host.platform === 'web';
  const provider = useModels((s) => agentSwitchProvider(s.capabilities, spec));
  const [probe, setProbe] = useState<AgentSwitchProbe>('pending');
  const [busy, setBusy] = useState(false);
  const installed = driver.state !== 'not-installed';
  const probeKey = `${driver.state}|${driver.version ?? ''}|${driver.checkedAt ?? ''}`;

  useEffect(() => {
    if (!connected || !installed) return;
    let live = true;
    probeModelCapabilities(runtime).then(
      () => live && setProbe('done'),
      () => live && setProbe((old) => (old === 'done' ? old : 'failed')),
    );
    return () => {
      live = false;
    };
  }, [runtime, connected, installed, probeKey]);

  const state = agentSwitchRow(spec, provider, driver, probe);
  if (!state) return null;

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      await setAgentProviderEnabled(runtime, spec.providerId, enabled);
      ToastQueue.neutral(agentSwitchToast(spec, enabled), { timeout: 3000 });
    } catch (error) {
      ToastQueue.negative(spec.copy.toggleFailed(enabled, (error as Error).message), { timeout: 5000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={row}>
      <span className={iconBox({ isOn: state.ready })} aria-hidden>
        {spec.capability === 'generateImage' ? <ImageIcon styles={icon} /> : <TextIcon styles={icon} />}
      </span>
      <div className={text}>
        <div className={titleRow}>
          <span className={title}>{spec.copy.title}</span>
          {state.ready ? (
            <Badge variant="positive" size="S" fillStyle="subtle">
              {CODEX_IMAGE_COPY.on}
            </Badge>
          ) : null}
        </div>
        <p className={body}>{state.checking ? spec.copy.checking : (state.why ?? state.caution ?? spec.copy.body)}</p>
      </div>
      <Switch
        aria-label={spec.copy.title}
        size="S"
        isSelected={state.enabled}
        isDisabled={web || !connected || busy || (!state.enabled && !state.canEnable)}
        onChange={(enabled) => void toggle(enabled)}
      />
    </div>
  );
}
