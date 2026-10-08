import { useState } from 'react';
import { Button, Disclosure, DisclosurePanel, DisclosureTitle, Switch, ToastQueue } from '@react-spectrum/s2';
import Copy from '@react-spectrum/s2/icons/Copy';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { updateAgentPreferences } from '../../runtime/agent-commands.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';
import { AGENT_COPY, MODEL_AUTO_UPDATE } from './agent-copy.ts';
import { CommandBlock, ExecutableField, copyText } from './agent-command-block.tsx';
import { Panel, SectionHeading, SettingRow } from './agent-panels.tsx';
import { diagnosticsText, isInstalled } from './agent-setup.ts';

const block = style({ marginTop: 16 });
const tech = style({ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 });
const techName = style({ font: 'ui', fontWeight: 'medium', color: 'gray-900' });
const techModels = style({ margin: 0, font: 'ui-sm', color: 'gray-600', overflowWrap: 'anywhere' });
const hint = style({ marginTop: 0, marginBottom: 16, font: 'ui-sm', color: 'gray-700' });
const fields = style({ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 8 });
const subtitle = style({ marginStart: 8, font: 'ui-sm', fontWeight: 'normal', color: 'gray-600' });

/** 高级与排障（page-settings-agent.jsx:167-183，接在 Agent 提供方页底）：模型表自动更新、技术信息与诊断、手动指定位置。 */
export function AgentAdvanced() {
  const runtime = useRuntime();
  const connected = useConnection((s) => s.state.status === 'connected');
  const drivers = useConnection((s) => s.drivers) ?? [];
  const preferences = useConnection((s) => s.agentPreferences);
  const [saving, setSaving] = useState(false);

  const setAutoUpdate = async (modelAutoUpdate: boolean) => {
    setSaving(true);
    try {
      await updateAgentPreferences(runtime, { modelAutoUpdate });
    } catch (error) {
      ToastQueue.negative(AGENT_COPY.saveFailed((error as Error).message), { timeout: 5000 });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SectionHeading title={AGENT_COPY.advancedHeading} hint={AGENT_COPY.advancedHint} />
      <Panel label={AGENT_COPY.advancedHeading}>
        <SettingRow label={MODEL_AUTO_UPDATE.label} desc={MODEL_AUTO_UPDATE.desc}>
          <Switch
            aria-label={MODEL_AUTO_UPDATE.label}
            size="S"
            isSelected={preferences?.modelAutoUpdate ?? false}
            isDisabled={!connected || !preferences || saving}
            onChange={(on) => void setAutoUpdate(on)}
          />
        </SettingRow>
      </Panel>

      <div className={block}>
        <Panel label={AGENT_COPY.techPanel}>
          <Disclosure isQuiet size="S">
            <DisclosureTitle>
              {AGENT_COPY.techTitle}
              <span className={subtitle}>{AGENT_COPY.techSubtitle}</span>
            </DisclosureTitle>
            <DisclosurePanel>
              {drivers.length === 0 ? <p className={hint}>{AGENT_COPY.techEmpty}</p> : null}
              {drivers.map((driver) => (
                <div key={driver.id} className={tech}>
                  <span className={techName}>
                    {driver.name} {isInstalled(driver) ? (driver.version ? `· v${driver.version}` : '') : AGENT_COPY.techNotInstalled}
                  </span>
                  {driver.executable ? <CommandBlock value={driver.executable} copyLabel={AGENT_COPY.pathLabel} /> : null}
                  {isInstalled(driver) ? (
                    <p className={techModels}>{driver.models.length ? driver.models.map((m) => m.label).join(' / ') : AGENT_COPY.techNoModels}</p>
                  ) : null}
                </div>
              ))}
              <Button
                variant="secondary"
                size="S"
                isDisabled={drivers.length === 0}
                onPress={() => void copyText(diagnosticsText(drivers), AGENT_COPY.diagnosticsLabel)}>
                <Copy />
                {AGENT_COPY.copyDiagnostics}
              </Button>
            </DisclosurePanel>
          </Disclosure>
          <Disclosure isQuiet size="S" defaultExpanded={drivers.some((d) => d.executableOverride)}>
            <DisclosureTitle>
              {AGENT_COPY.locateTitle}
              <span className={subtitle}>{AGENT_COPY.locateSubtitle}</span>
            </DisclosureTitle>
            <DisclosurePanel>
              <p className={hint}>{AGENT_COPY.executableHint}</p>
              <div className={fields}>
                {drivers.map((driver) => (
                  <ExecutableField key={driver.id} driver={driver} isDisabled={!connected} />
                ))}
              </div>
            </DisclosurePanel>
          </Disclosure>
        </Panel>
      </div>
    </>
  );
}
