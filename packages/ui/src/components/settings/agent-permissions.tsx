import { useState, type ComponentType } from 'react';
import { ACCESS_MODES, DEFAULT_AGENT_MODE, type AgentMode, type AgentPolicy } from '@baocut/protocol';
import { Badge, Disclosure, DisclosurePanel, DisclosureTitle, Switch, Tag, TagGroup, ToastQueue } from '@react-spectrum/s2';
import AIMark from '@react-spectrum/s2/icons/AIMark';
import Edit from '@react-spectrum/s2/icons/Edit';
import Lock from '@react-spectrum/s2/icons/Lock';
import LockOpen from '@react-spectrum/s2/icons/LockOpen';
import Visibility from '@react-spectrum/s2/icons/Visibility';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { ACCESS_MODE_HINT, ACCESS_MODE_LABEL } from '../../copy.ts';
import { removeAgentRule, updateAgentPreferences } from '../../runtime/agent-commands.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';
import { useSettings } from '../../state/settings-store.ts';
import { AGENT_COPY, POLICY_COPY, POLICY_KEYS } from './agent-copy.ts';
import { Panel, SectionHeading, SettingRow } from './agent-panels.tsx';
import { rulesView } from './agent-setup.ts';

/** 四档各一枚图标（data.js `agent.modes`）：图标是输入框下拉收起后唯一的状态提示，所以不共用。「先给方案」原型没画。 */
const MODE_ICON: Record<AgentMode, ComponentType> = { plan: Visibility, ask: Lock, autoAcceptEdits: Edit, auto: AIMark, fullAccess: LockOpen };

const mode = style({
  display: 'flex',
  alignItems: 'start',
  gap: 12,
  paddingY: 12,
  borderTopWidth: 0,
  borderXWidth: 0,
  borderBottomWidth: { default: 1, ':last-child': 0 },
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const modeIcon = style({ display: 'flex', flexShrink: 0, paddingTop: 2, color: 'gray-700' });
const modeText = style({ flexGrow: 1, minWidth: 0 });
const modeLabel = style({ font: 'ui', fontWeight: 'medium', color: 'gray-900' });
const modeHint = style({ marginTop: 2, marginBottom: 0, font: 'ui-sm', color: 'gray-600' });
const rules = style({ marginTop: 24 });
const rulesBody = style({ marginTop: 0, marginBottom: 12, font: 'ui-sm', color: 'gray-700' });

/** Agent 权限（page-settings-agent.jsx 的 AgentPermissionsSection，显示在设置 › 隐私与权限）：访问模式说明、三条放行策略、「总是允许」的规则。 */
export function AgentPermissions() {
  const runtime = useRuntime();
  const connected = useConnection((s) => s.state.status === 'connected');
  const preferences = useConnection((s) => s.agentPreferences);
  const [pending, setPending] = useState<keyof AgentPolicy | 'rule' | null>(null);
  // 新会话的默认（设置 `agent.defaultAccessMode`）：在新会话里选过就记成那一档；「首次默认」是它的出厂值。
  const settings = useSettings((s) => s.snapshot);
  const firstDefault = settings?.defaults['agent.defaultAccessMode'] ?? DEFAULT_AGENT_MODE;
  const last = settings && settings.settings['agent.defaultAccessMode'] !== firstDefault ? settings.settings['agent.defaultAccessMode'] : null;
  const modes: readonly AgentMode[] = last === 'plan' ? ['plan', ...ACCESS_MODES] : ACCESS_MODES;
  const view = rulesView(preferences?.rules);

  const setPolicy = async (key: keyof AgentPolicy, on: boolean) => {
    setPending(key);
    try {
      await updateAgentPreferences(runtime, { policy: { [key]: on } });
    } catch (error) {
      ToastQueue.negative(AGENT_COPY.saveFailed((error as Error).message), { timeout: 5000 });
    } finally {
      setPending(null);
    }
  };

  const remove = async (rule: string) => {
    setPending('rule');
    try {
      await removeAgentRule(runtime, rule);
      ToastQueue.neutral(AGENT_COPY.ruleRemoved(rule), { timeout: 3000 });
    } catch (error) {
      ToastQueue.negative(AGENT_COPY.ruleRemoveFailed((error as Error).message), { timeout: 5000 });
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <SectionHeading
        title={AGENT_COPY.permissionsHeading}
        hint={AGENT_COPY.modeHint(ACCESS_MODE_LABEL[firstDefault], last ? ACCESS_MODE_LABEL[last] : null)}
      />
      <Panel label={AGENT_COPY.accessModes}>
        {modes.map((key) => {
          const Icon = MODE_ICON[key];
          return (
            <div key={key} className={mode}>
              <span className={modeIcon} aria-hidden>
                <Icon />
              </span>
              <div className={modeText}>
                <div className={modeLabel}>{ACCESS_MODE_LABEL[key]}</div>
                <p className={modeHint}>{ACCESS_MODE_HINT[key]}</p>
              </div>
              {key === firstDefault ? (
                <Badge variant="neutral" size="S">
                  {AGENT_COPY.firstDefault}
                </Badge>
              ) : null}
            </div>
          );
        })}
      </Panel>

      <SectionHeading title={AGENT_COPY.policyHeading} hint={AGENT_COPY.policyHint} />
      <Panel label={AGENT_COPY.policyHeading}>
        {POLICY_KEYS.map((key) => (
          <SettingRow key={key} label={POLICY_COPY[key].label} desc={POLICY_COPY[key].desc}>
            <Switch
              aria-label={POLICY_COPY[key].label}
              size="S"
              isSelected={preferences?.policy[key] ?? false}
              isDisabled={!connected || !preferences || pending === key}
              onChange={(on) => void setPolicy(key, on)}
            />
          </SettingRow>
        ))}
      </Panel>

      <div className={rules}>
        <Panel label={AGENT_COPY.alwaysAllowed}>
          <Disclosure isQuiet size="S">
            <DisclosureTitle>{view.title}</DisclosureTitle>
            <DisclosurePanel>
              <p className={rulesBody}>{view.body}</p>
              {view.rules.length ? (
                <TagGroup
                  aria-label={AGENT_COPY.alwaysAllowed}
                  size="S"
                  items={view.rules.map((rule) => ({ id: rule }))}
                  onRemove={(keys) => {
                    if (!connected || pending === 'rule') return;
                    for (const key of keys) void remove(String(key));
                  }}>
                  {(item) => (
                    <Tag id={item.id} textValue={item.id}>
                      {item.id}
                    </Tag>
                  )}
                </TagGroup>
              ) : null}
            </DisclosurePanel>
          </Disclosure>
        </Panel>
      </div>
    </>
  );
}
