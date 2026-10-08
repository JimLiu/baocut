import type { DriverId, DriverInfo } from '@baocut/protocol';
import { ActionButton, Header, Heading, Menu, MenuItem, MenuSection, MenuTrigger, SubmenuTrigger, Text } from '@react-spectrum/s2';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import Checkmark from '@react-spectrum/s2/icons/Checkmark';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import Download from '@react-spectrum/s2/icons/Download';
import Settings from '@react-spectrum/s2/icons/Settings';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { S } from './shell-copy.ts';
import { AGENT_PICKER } from '../copy.ts';
import { AgentProviderIcon } from './agent-provider-icon.tsx';
import {
  compactHarnessLabel,
  currentEffort,
  draftSelection,
  effectiveModel,
  effortLabel,
  effortRows,
  harnessLabel,
  modelChange,
  modelRows,
  providerRows,
  type AgentChange,
} from '../model/agent-choice.ts';
import { useShell } from '../state/shell-store.ts';

/** 弹层宽 320（原型 agent-picker.jsx `ProviderModelPicker`）。 */
const menu = style({ width: 320, maxWidth: '[calc(100vw - 32px)]' });
const label = style({ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 });
const labelText = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: { default: '[220px]', isCompact: '[120px]' },
});
/** 第一级当前那一行的勾：图标槽给了 Agent 图标，勾放在名字右边、子菜单箭头前面（原型 ui-spectrum.jsx 同样的放法）。 */
const rowCheck = style({ display: 'flex', alignItems: 'center', color: 'accent' });

export interface AgentPickerProps {
  drivers: readonly DriverInfo[] | null;
  /** 当前用的 Agent（会话上的，或新会话草稿上的选择，再不然默认的那个）。 */
  driverId: DriverId | null;
  /** null = Agent 默认模型。 */
  model: string | null;
  /** null = 模型自己的默认强度。 */
  effort: string | null;
  /** 会话有过任务后 Agent 固定成这一个；其他 Agent 标出原因、不能选。 */
  lockedTo: DriverId | null;
  /** 窄的时候 Agent 只剩图标，模型只留级别名（`compactHarnessLabel`）。 */
  compact?: boolean;
  onChange(change: AgentChange): void;
}

/**
 * 编码 Agent · 模型 · 推理强度（原型 agent-picker.jsx、model-agent.js `providerRows` / `modelRows`）。
 * 第一级每个 Agent 一行：能用的展开第二级选模型与推理强度；用不了的写原因，点了去设置 › Agent。
 */
export function AgentPicker({ drivers, driverId, model, effort, lockedTo, compact, onChange }: AgentPickerProps) {
  const go = useShell((s) => s.go);
  const list = drivers ?? [];
  const current = list.find((d) => d.id === driverId) ?? null;
  const rows = providerRows(list, driverId, model, lockedTo);
  const goSettings = () => go({ tab: 'settings', section: 'agent' });
  const text = compact ? compactHarnessLabel(current, model) : harnessLabel(current, model);

  return (
    <MenuTrigger align="end" direction="top">
      <ActionButton isQuiet size="S" aria-label={S.agentPicker.current(harnessLabel(current, model))}>
        {current ? <AgentProviderIcon driver={current} /> : null}
        <Text>
          <span className={label}>
            <span className={labelText({ isCompact: !!compact })}>{text}</span>
            <ChevronDown />
          </span>
        </Text>
      </ActionButton>
      <Menu
        aria-label={S.agentPicker.label}
        size="M"
        styles={menu}
        disabledKeys={rows.filter((r) => r.locked).map((r) => `driver:${r.id}`)}
        onAction={(key) => {
          if (key === 'settings' || String(key).startsWith('setup:')) goSettings();
        }}>
        <MenuSection>
          <Header>
            <Heading>{AGENT_PICKER.group}</Heading>
          </Header>
          {rows.map((row) => {
            const driver = list.find((d) => d.id === row.id)!;
            // 原型：每行前面是 Agent 的图标，当前的那个名字右边打勾；用不了的行尾按原因画「下载 / 警示 / 设置」（能用的行尾是 S2 自带的子菜单箭头）。
            const item = (id: string) => (
              <MenuItem key={id} id={id} textValue={row.name}>
                <AgentProviderIcon driver={driver} />
                <Text slot="label">{row.name}</Text>
                {row.selected && row.ready && !row.locked ? (
                  <Text slot="value">
                    <span className={rowCheck}>
                      <Checkmark />
                    </span>
                  </Text>
                ) : null}
                <Text slot="description">{row.sub}</Text>
                {row.ready ? null : row.state === 'missing' ? (
                  <Download slot="descriptor" />
                ) : row.state === 'attention' ? (
                  <AlertTriangle slot="descriptor" />
                ) : (
                  <Settings slot="descriptor" />
                )}
              </MenuItem>
            );
            if (row.locked) return item(`driver:${row.id}`);
            if (!row.ready) return item(`setup:${row.id}`);
            // 当前这个 Agent 用会话上的选择；别的 Agent 显示换过去会用的（它在偏好里的默认）。
            const own = row.selected ? { model, effort } : draftSelection(driver, undefined);
            return (
              <SubmenuTrigger key={row.id}>
                {item(`driver:${row.id}`)}
                <ModelMenu driver={driver} model={own.model} effort={own.effort} onChange={onChange} />
              </SubmenuTrigger>
            );
          })}
        </MenuSection>
        <MenuSection>
          <MenuItem id="settings" textValue={AGENT_PICKER.settings}>
            <Settings />
            <Text slot="label">{AGENT_PICKER.settings}</Text>
            <Text slot="description">{AGENT_PICKER.settingsSub}</Text>
          </MenuItem>
        </MenuSection>
      </Menu>
    </MenuTrigger>
  );
}

/** 第二级：「模型」打头是「Agent 默认模型」，再是它的模型表；下面是这个模型的推理强度（没有就不出）。 */
function ModelMenu({
  driver,
  model,
  effort,
  onChange,
}: {
  driver: DriverInfo;
  model: string | null;
  effort: string | null;
  onChange(change: AgentChange): void;
}) {
  const active = effectiveModel(driver, model);
  const efforts = effortRows(active);
  const currentId = currentEffort(active, effort);
  const currentLabel = currentId ? effortLabel(currentId, active?.efforts.find((e) => e.id === currentId)?.label) : null;
  return (
    <Menu aria-label={S.agentPicker.models(driver.name)} size="M" styles={menu}>
      <MenuSection
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[`model:${model ?? ''}`]}
        onSelectionChange={(keys) => {
          const key = keys === 'all' ? undefined : String([...keys][0] ?? '');
          if (!key?.startsWith('model:')) return;
          const next = key.slice('model:'.length) || null;
          onChange(modelChange(driver, next, effort));
        }}>
        <Header>
          <Heading>{AGENT_PICKER.models}</Heading>
        </Header>
        {modelRows(driver, model).map((row) => (
          <MenuItem key={row.model ?? ''} id={`model:${row.model ?? ''}`} textValue={row.label}>
            <Text slot="label">{row.label}</Text>
            {row.sub ? <Text slot="description">{row.sub}</Text> : null}
          </MenuItem>
        ))}
      </MenuSection>
      {efforts.length ? (
        <MenuSection
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={currentId ? [`effort:${currentId}`] : []}
          onSelectionChange={(keys) => {
            const key = keys === 'all' ? undefined : String([...keys][0] ?? '');
            if (!key?.startsWith('effort:')) return;
            onChange({ driverId: driver.id, model, effort: key.slice('effort:'.length) });
          }}>
          <Header>
            <Heading>{AGENT_PICKER.effort(currentLabel ?? AGENT_PICKER.defaultMark)}</Heading>
          </Header>
          {efforts.map((row) => (
            <MenuItem key={row.id} id={`effort:${row.id}`} textValue={row.label}>
              <Text slot="label">{row.label}</Text>
              {row.sub ? <Text slot="description">{row.sub}</Text> : null}
            </MenuItem>
          ))}
        </MenuSection>
      ) : null}
    </Menu>
  );
}
