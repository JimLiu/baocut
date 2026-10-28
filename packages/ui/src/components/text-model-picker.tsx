import type { TextEffort } from '@baocut/protocol';
import { ActionButton, Header, Heading, Menu, MenuItem, MenuSection, MenuTrigger, SubmenuTrigger, Text } from '@react-spectrum/s2';
import Checkmark from '@react-spectrum/s2/icons/Checkmark';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import Settings from '@react-spectrum/s2/icons/Settings';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { AGENT_PICKER } from '../copy.ts';
import {
  effortOption,
  pickEffort,
  pickModel,
  TEXT_PICKER,
  textEffortName,
  textEffortOf,
  textEffortRows,
  textModelRows,
  textPickLabel,
  textProviderIcon,
  textProviderRows,
  type TextOption,
  type TextPick,
  type TextProviderRow,
} from '../model/text-model-choice.ts';
import { useModels } from '../state/models-store.ts';
import { useShell } from '../state/shell-store.ts';
import { VendorIcon } from './vendor-icon.tsx';

/** 弹层宽 320（原型 text-model-picker.jsx，同会话的 Agent 选择）。 */
const menu = style({ width: 320, maxWidth: '[calc(100vw - 32px)]' });
const label = style({ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 });
const labelText = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '[280px]' });
/** 第一级当前那一家的勾：图标槽给了厂商图标，勾放在名字右边、子菜单箭头前面（同 agent-picker.tsx）。 */
const rowCheck = style({ display: 'flex', alignItems: 'center', color: 'accent' });

export interface TextModelPickerProps {
  /** 无障碍名（这一处叫这只模型的说法）。 */
  label: string;
  options: readonly TextOption[];
  selected: TextOption | null;
  /** 智能体的推理强度；null = 模型自己的默认。API 模型忽略它。 */
  effort: TextEffort | null;
  onChange(pick: TextPick): void;
  /** 没连接的 API 提供方与菜单最后那一项去的地方（模型页的文本生成）。智能体不能用时去设置 › Agent。 */
  onSettings(): void;
  isQuiet?: boolean;
}

/**
 * 文本模型的两级菜单（产品设计 §7.6；原型 text-model-picker.jsx `TextModelPicker`）：第一级每家提供方一行，能用的展开第二级选模型，
 * 智能体再选推理强度；不能用的写原因，点了去设置。收起时是「提供方 · 模型」，智能体再接推理强度。行与文案在 model/text-model-choice.ts。
 */
export function TextModelPicker({ label: name, options, selected, effort, onChange, onSettings, isQuiet }: TextModelPickerProps) {
  const go = useShell((s) => s.go);
  const view = useModels((s) => s.capabilities);
  const rows = textProviderRows(options, selected?.key ?? null);
  const current = rows.find((r) => r.selected) ?? null;

  return (
    <MenuTrigger>
      <ActionButton isQuiet={isQuiet} size="S" aria-label={`${name}: ${textPickLabel(selected, effort)}`}>
        {current ? <VendorIcon spec={textProviderIcon(view, current)} /> : null}
        <Text>
          <span className={label}>
            <span className={labelText}>{textPickLabel(selected, effort)}</span>
            <ChevronDown />
          </span>
        </Text>
      </ActionButton>
      <Menu
        aria-label={name}
        size="M"
        styles={menu}
        onAction={(key) => {
          const id = String(key);
          if (id === 'settings') onSettings();
          else if (id.startsWith('setup:')) {
            const row = rows.find((r) => `setup:${r.providerId}` === id);
            if (row?.agent) go({ tab: 'settings', section: 'agent' });
            else onSettings();
          }
        }}>
        <MenuSection>
          <Header>
            <Heading>{TEXT_PICKER.providers}</Heading>
          </Header>
          {rows.map((row) => {
            const item = (id: string) => (
              <MenuItem key={id} id={id} textValue={row.name}>
                <VendorIcon spec={textProviderIcon(view, row)} />
                <Text slot="label">{row.name}</Text>
                {row.selected && row.ready ? (
                  <Text slot="value">
                    <span className={rowCheck}>
                      <Checkmark />
                    </span>
                  </Text>
                ) : null}
                <Text slot="description">{row.sub}</Text>
                {row.ready ? null : <Settings slot="descriptor" />}
              </MenuItem>
            );
            if (!row.ready) return item(`setup:${row.providerId}`);
            return (
              <SubmenuTrigger key={row.providerId}>
                {item(`provider:${row.providerId}`)}
                <ModelMenu row={row} selected={selected} effort={effort} onChange={onChange} />
              </SubmenuTrigger>
            );
          })}
        </MenuSection>
        <MenuSection>
          <MenuItem id="settings" textValue={TEXT_PICKER.settings}>
            <Settings />
            <Text slot="label">{TEXT_PICKER.settings}</Text>
            <Text slot="description">{TEXT_PICKER.settingsSub}</Text>
          </MenuItem>
        </MenuSection>
      </Menu>
    </MenuTrigger>
  );
}

/** 第二级：这家的模型（不能用的写原因、不能选）；智能体下面再接推理强度，跟着这家选着的模型，没选着时跟「Agent 默认模型」。 */
function ModelMenu({
  row,
  selected,
  effort,
  onChange,
}: {
  row: TextProviderRow;
  selected: TextOption | null;
  effort: TextEffort | null;
  onChange(pick: TextPick): void;
}) {
  const models = textModelRows(row);
  const target = effortOption(row, selected?.key ?? null);
  const efforts = textEffortRows(target);
  const applied = row.selected ? textEffortOf(target, effort) : (target?.info.defaultEffort ?? null);
  return (
    <Menu
      aria-label={row.name}
      size="M"
      styles={menu}
      disabledKeys={models.filter((m) => m.disabled).map((m) => `model:${m.key}`)}
      onAction={(key) => {
        const id = String(key);
        if (id.startsWith('model:')) {
          const option = row.options.find((o) => o.key === id.slice('model:'.length));
          if (option) onChange(pickModel(option, { option: selected, effort }));
        } else if (id.startsWith('effort:') && target) {
          onChange(pickEffort(target, id.slice('effort:'.length) as TextEffort));
        }
      }}>
      <MenuSection selectionMode="single" disallowEmptySelection selectedKeys={row.selected && selected ? [`model:${selected.key}`] : []}>
        <Header>
          <Heading>{AGENT_PICKER.models}</Heading>
        </Header>
        {models.map((m) => (
          <MenuItem key={m.key} id={`model:${m.key}`} textValue={m.label}>
            <Text slot="label">{m.label}</Text>
            {m.sub ? <Text slot="description">{m.sub}</Text> : null}
          </MenuItem>
        ))}
      </MenuSection>
      {efforts.length ? (
        <MenuSection selectionMode="single" disallowEmptySelection selectedKeys={row.selected && applied ? [`effort:${applied}`] : []}>
          <Header>
            <Heading>{AGENT_PICKER.effort(applied ? textEffortName(applied) : AGENT_PICKER.defaultMark)}</Heading>
          </Header>
          {efforts.map((e) => (
            <MenuItem key={e.id} id={`effort:${e.id}`} textValue={e.label}>
              <Text slot="label">{e.label}</Text>
              {e.sub ? <Text slot="description">{e.sub}</Text> : null}
            </MenuItem>
          ))}
        </MenuSection>
      ) : null}
    </Menu>
  );
}
