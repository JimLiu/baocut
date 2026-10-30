import { useState } from 'react';
import { Button, TextArea, ToastQueue } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { AGENT_CUSTOM_INSTRUCTIONS_MAX } from '@baocut/protocol';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';
import { useSetting, useSettings } from '../../state/settings-store.ts';
import { AGENT_COPY } from './agent-copy.ts';
import { Panel, SectionHeading } from './agent-panels.tsx';
import { M } from './general-settings-copy.ts';

const body = style({ display: 'flex', flexDirection: 'column', gap: 12, paddingY: 16 });
const field = style({ width: 'full' });
const acts = style({ display: 'flex', justifyContent: 'end', gap: 8 });
/** 浏览器里为什么改不了：`settings.set` 不在 Web 白名单里（与「高级与排障」同一句）。 */
const webNote = style({ marginTop: 0, marginBottom: 12, font: 'ui-sm', color: 'gray-800' });

/**
 * 自定义指导（设计稿 page-settings-agent.jsx 的 AgentCustomInstructions，设置 `agent.customInstructions`，架构设计 §3.8）：
 * 每个会话里附在 BaoCut 的指导之后。改完点保存，不边打边存（每次保存都会让开着的会话下一轮重建）。
 * `draft` 为 null 时跟着已存的值走，别处（CLI）改了也跟着换；正在改的草稿不被盖掉。
 */
export function AgentCustomInstructions() {
  const runtime = useRuntime();
  const web = runtime.host.platform === 'web';
  const connected = useConnection((s) => s.state.status === 'connected');
  const loaded = useSettings((s) => s.snapshot !== null);
  const saved = useSetting('agent.customInstructions') ?? '';
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const value = draft ?? saved;
  const dirty = draft !== null && draft !== saved;
  const over = value.length - AGENT_CUSTOM_INSTRUCTIONS_MAX;

  const save = async () => {
    setSaving(true);
    try {
      const snapshot = await runtime.client.request('settings.set', {
        values: { 'agent.customInstructions': value.trim() ? value : null },
      });
      useSettings.getState().replace(snapshot);
      setDraft(null);
      ToastQueue.positive(AGENT_COPY.customSaved, { timeout: 5000 });
    } catch (error) {
      ToastQueue.negative(AGENT_COPY.saveFailed((error as Error).message), { timeout: 5000 });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SectionHeading title={AGENT_COPY.customHeading} hint={AGENT_COPY.customHint} />
      {web ? <p className={webNote}>{M.webViewOnly}</p> : null}
      <Panel label={AGENT_COPY.customHeading}>
        <div className={body}>
          <TextArea
            aria-label={AGENT_COPY.customHeading}
            styles={field}
            value={value}
            onChange={(text) => setDraft(text === saved ? null : text)}
            placeholder={AGENT_COPY.customPlaceholder}
            description={AGENT_COPY.customCount(value.length, AGENT_CUSTOM_INSTRUCTIONS_MAX)}
            isInvalid={over > 0}
            errorMessage={over > 0 ? AGENT_COPY.customTooLong(over, AGENT_CUSTOM_INSTRUCTIONS_MAX) : undefined}
            isReadOnly={web || saving}
            isDisabled={!connected || !loaded}
          />
          {web ? null : (
            <div className={acts}>
              <Button variant="secondary" size="S" isDisabled={!dirty || saving} onPress={() => setDraft(null)}>
                {AGENT_COPY.customRevert}
              </Button>
              <Button
                variant="accent"
                size="S"
                isDisabled={!dirty || over > 0 || !connected}
                isPending={saving}
                onPress={() => void save()}
              >
                {AGENT_COPY.customSave}
              </Button>
            </div>
          )}
        </div>
      </Panel>
    </>
  );
}
