import { useState } from 'react';
import { Button, ToastQueue } from '@react-spectrum/s2';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { HOME_COPY } from '../../copy.ts';
import type { GateGuide } from '../../model/home-brief.ts';
import { configureAgent } from '../../runtime/agent-commands.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useShell } from '../../state/shell-store.ts';

const card = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  marginTop: 16,
  paddingY: 12,
  paddingX: 16,
  borderRadius: 'lg',
  backgroundColor: 'orange-100',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'orange-300',
});
const icon = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  size: 32,
  borderRadius: 'default',
  backgroundColor: 'orange-1000',
  color: 'gray-25',
});
const text = style({ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0, font: 'ui', color: 'gray-900' });
const title = style({ fontWeight: 'bold' });
const body = style({ margin: 0, font: 'ui-sm', color: 'gray-700' });

/** 指引上的那个动作：装好了只是停用就直接启用它（写回 Agent 列表后指引自己消失）；其余去设置 › Agent。 */
export function useGateFix(guide: GateGuide): { busy: boolean; fix(): Promise<void> } {
  const runtime = useRuntime();
  const go = useShell((s) => s.go);
  const [busy, setBusy] = useState(false);
  const fix = async () => {
    if (!guide.enable) {
      go({ tab: 'settings', section: 'agent' });
      return;
    }
    setBusy(true);
    try {
      await configureAgent(runtime, guide.enable.id, { enabled: true });
    } catch (error) {
      ToastQueue.negative(HOME_COPY.enableFailed((error as Error).message), { timeout: 5000 });
    } finally {
      setBusy(false);
    }
  };
  return { busy, fix };
}

/** Agent 用不了时起始页下面的指引卡（原型 new-options.jsx `GateCard`）。 */
export function GateCard({ guide }: { guide: GateGuide }) {
  const { busy, fix } = useGateFix(guide);
  return (
    <div className={card} role="status">
      <span className={icon} aria-hidden>
        <AlertTriangle />
      </span>
      <div className={text}>
        <span className={title}>{guide.title}</span>
        <p className={body}>{guide.body}</p>
      </div>
      <Button variant="accent" size="S" isPending={busy} onPress={() => void fix()}>
        {guide.action}
      </Button>
    </div>
  );
}
