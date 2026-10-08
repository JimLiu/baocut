import type { ComponentType } from 'react';
import { ACCESS_MODES, type AgentMode } from '@baocut/protocol';
import { ActionButton, Menu, MenuItem, MenuTrigger, Text, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import Edit from '@react-spectrum/s2/icons/Edit';
import Lock from '@react-spectrum/s2/icons/Lock';
import LockOpen from '@react-spectrum/s2/icons/LockOpen';
import MagicWand from '@react-spectrum/s2/icons/MagicWand';
import Visibility from '@react-spectrum/s2/icons/Visibility';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { S } from './shell-copy.ts';
import { ACCESS_MODE_HINT, ACCESS_MODE_LABEL } from '../copy.ts';

/** 四档的图标（原型 data.js `agent.modes`：lock / edit / sparkle / unlock）；「先给方案」原型没画，用 visibility。 */
export const MODE_ICON: Record<AgentMode, ComponentType> = {
  plan: Visibility,
  ask: Lock,
  autoAcceptEdits: Edit,
  auto: MagicWand,
  fullAccess: LockOpen,
};

/** 菜单宽 288，说明整段折行（原型 agent-thread.jsx `AccessPicker`）。 */
const menu = style({ width: 288, maxWidth: '[calc(100vw - 32px)]' });
/** 箭头放在文字后面：放进 Text 里，不占 ActionButton 前面的图标位。 */
const label = style({ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' });

/**
 * 访问模式（架构设计 §3.12，原型 agent-thread.jsx `AccessPicker`）：四档永远全部可选，切档不弹确认框。
 * 收起时是图标加档名；输入区窄的时候（`compact`，产品设计 §3.2.3）只剩图标和箭头，档名留在无障碍标签与提示里。
 * 菜单每行是图标、档名、一句说明，当前档打勾。
 * 「先给方案」只在当前就是它时列出，切走之后不再出现（原型只有四档）。
 */
export function AccessPicker({ value, compact, onChange }: { value: AgentMode; compact?: boolean; onChange(mode: AgentMode): void }) {
  const Icon = MODE_ICON[value];
  const modes: readonly AgentMode[] = value === 'plan' ? ['plan', ...ACCESS_MODES] : ACCESS_MODES;
  const button = (
    <ActionButton isQuiet size="S" aria-label={S.accessPicker.current(ACCESS_MODE_LABEL[value])}>
      <Icon />
      <Text>
        <span className={label}>
          {compact ? null : ACCESS_MODE_LABEL[value]}
          <ChevronDown />
        </span>
      </Text>
    </ActionButton>
  );
  return (
    <MenuTrigger align="start" direction="top">
      {compact ? (
        <TooltipTrigger>
          {button}
          <Tooltip>{ACCESS_MODE_LABEL[value]}</Tooltip>
        </TooltipTrigger>
      ) : (
        button
      )}
      <Menu
        aria-label={S.accessPicker.label}
        size="M"
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[value]}
        styles={menu}
        onSelectionChange={(keys) => {
          const key = keys === 'all' ? undefined : [...keys][0];
          if (key && key !== value) onChange(key as AgentMode);
        }}>
        {modes.map((mode) => {
          const ModeIcon = MODE_ICON[mode];
          return (
            <MenuItem key={mode} id={mode} textValue={ACCESS_MODE_LABEL[mode]}>
              <ModeIcon />
              <Text slot="label">{ACCESS_MODE_LABEL[mode]}</Text>
              <Text slot="description">{ACCESS_MODE_HINT[mode]}</Text>
            </MenuItem>
          );
        })}
      </Menu>
    </MenuTrigger>
  );
}
