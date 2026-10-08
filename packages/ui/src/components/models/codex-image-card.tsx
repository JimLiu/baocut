import { useEffect, useState } from 'react';
import { ActionButton, Badge, Switch, ToastQueue } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import type { CodexDefaultState } from '../../model/models-cloud.ts';
import { probeModelCapabilities, setAgentProviderEnabled } from '../../runtime/agent-commands.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';
import { useModels } from '../../state/models-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { CODEX_IMAGE_COPY } from '../settings/agent-copy.ts';
import {
  CODEX_IMAGE_PROVIDER,
  codexImageProvider,
  codexImageRow,
  codexImageToast,
  type CodexImageProbe,
  type CodexImageRowState,
} from '../settings/codex-image.ts';
import { CODEX_CARD_COPY, CLOUD_COPY, MODELS_PAGE_COPY } from './models-copy.ts';

/**
 * 「用 Codex 画图」在模型页的两处：图像生成云端页服务商列表的第一张卡（设计稿 settings-cloud.jsx:278-298），
 * 与默认模型菜单里的「Codex CLI · 画图」。开关、能不能打开、原因都复用设置 › Agent 那一行（A2-e）的纯函数与命令，
 * 不另起一份；进页时同样探测一次（Codex 重新检测、升级、登录之后再探测）。
 */
export function useCodexImage(active: boolean): { connected: boolean; state: CodexImageRowState | null; registered: boolean } {
  const runtime = useRuntime();
  const connected = useConnection((s) => s.state.status === 'connected');
  const driver = useConnection((s) => s.drivers?.find((d) => d.id === 'codex') ?? null);
  const provider = useModels((s) => codexImageProvider(s.capabilities));
  const [probe, setProbe] = useState<CodexImageProbe>('pending');
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

  return { connected, state: driver ? codexImageRow(provider, driver, probe) : null, registered: !!provider };
}

/** 默认模型菜单里 Codex 那一项的状态；Runtime 没注册 `agent:codex` 时菜单里不出现它。 */
export function codexDefaultState(codex: ReturnType<typeof useCodexImage>): CodexDefaultState | null {
  if (!codex.registered) return null;
  const { state } = codex;
  if (!state) return { ready: false, why: CODEX_CARD_COPY.missing };
  if (state.ready) return { ready: true, why: null };
  return { ready: false, why: state.why ?? (state.checking ? CODEX_IMAGE_COPY.checking : CODEX_CARD_COPY.off) };
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

/** 图像生成云端页服务商列表的第一张：能开时给开关，不能开（没装、没登录、太旧）时给「去设置 › Agent」。关掉开关不清默认值。 */
export function CodexImageCard({ codex, isDefault }: { codex: ReturnType<typeof useCodexImage>; isDefault: boolean }) {
  const runtime = useRuntime();
  const go = useShell((s) => s.go);
  const [busy, setBusy] = useState(false);
  const { state, connected } = codex;
  if (!codex.registered) return null;

  const canSwitch = !!state && (state.enabled || state.canEnable || state.checking);
  const desc = !state
    ? CODEX_CARD_COPY.missing
    : state.ready
      ? CODEX_CARD_COPY.on
      : state.checking
        ? CODEX_IMAGE_COPY.checking
        : (state.why ?? CODEX_CARD_COPY.off);

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      await setAgentProviderEnabled(runtime, CODEX_IMAGE_PROVIDER, enabled);
      ToastQueue.neutral(codexImageToast(enabled), { timeout: 3000 });
    } catch (error) {
      ToastQueue.negative(CODEX_CARD_COPY.toggleFailed(enabled, (error as Error).message), { timeout: 5000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={card} aria-label={CODEX_CARD_COPY.title}>
      <div className={text}>
        <div className={title}>{CODEX_CARD_COPY.title}</div>
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
            aria-label={CODEX_CARD_COPY.switchLabel}
            size="S"
            isSelected={state.enabled}
            isDisabled={!connected || busy || state.checking || (!state.enabled && !state.canEnable)}
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
