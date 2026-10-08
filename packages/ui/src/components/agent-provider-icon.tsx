import type { ComponentProps, FunctionComponent } from 'react';
import { createIcon } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import type { DriverInfo } from '@baocut/protocol';
import { agentIcon, type AgentIconSpec } from '../model/agent-choice.ts';
import anthropic from './vendor-icons/anthropic.svg';
import codex from './vendor-icons/codex.svg';
import cursor from './vendor-icons/cursor.svg';
import githubcopilot from './vendor-icons/githubcopilot.svg';
import google from './vendor-icons/google.svg';
import moonshot from './vendor-icons/moonshot.svg';
import opencode from './vendor-icons/opencode.svg';
import pi from './vendor-icons/pi.svg';
import xai from './vendor-icons/xai.svg';

/*
 * Agent 图标（产品设计 §3.2.3；原型 vendor-icon.jsx `VendorIcon`）：`vendor-icons/` 里的 SVG 与原型 designs/baocut/assets/vendors
 * 逐字节相同（lobe-icons，MIT，署名见仓库根的 THIRD_PARTY_NOTICES.md；原型的 icon-sync.test.js 核对两份一致）。
 * 用 createIcon 包一层、画在 20 网格上，放进 ActionButton 与 MenuItem 的图标槽时和 S2 workflow 图标一样定位、按紧凑档显示 16px（app.css）；
 * 单色的当遮罩填 currentColor（行停用时跟着变淡），彩色的原样画，用户添加的 Agent 画名字首字母。
 */
const FILES: Readonly<Record<string, string>> = { anthropic, codex, cursor, githubcopilot, google, moonshot, opencode, pi, xai };

const letterBox = style({ fill: 'gray-200' });
const letterText = style({ fill: 'gray-800' });

type IconComponent = FunctionComponent<ComponentProps<ReturnType<typeof createIcon>>>;
const cache = new Map<string, IconComponent>();

function iconFor(spec: AgentIconSpec): IconComponent {
  const key = spec.kind === 'letter' ? `letter:${spec.letter}` : `${spec.mono ? 'mono' : 'color'}:${spec.file}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let icon: IconComponent;
  if (spec.kind === 'letter') {
    icon = createIcon((props) => (
      <svg {...props} viewBox="0 0 20 20">
        <rect className={letterBox} x="1" y="1" width="18" height="18" rx="4" />
        <text className={letterText} x="10" y="14.2" textAnchor="middle" fontSize="11" fontWeight="700">
          {spec.letter}
        </text>
      </svg>
    ));
  } else {
    const src = FILES[spec.file] ?? '';
    icon = spec.mono
      ? createIcon((props) => (
          <svg
            {...props}
            viewBox="0 0 20 20"
            style={{
              ...props.style,
              maskImage: `url("${src}")`,
              WebkitMaskImage: `url("${src}")`,
              maskSize: 'contain',
              WebkitMaskSize: 'contain',
              maskRepeat: 'no-repeat',
              WebkitMaskRepeat: 'no-repeat',
            }}>
            <rect width="20" height="20" fill="currentColor" />
          </svg>
        ))
      : createIcon((props) => (
          <svg {...props} viewBox="0 0 20 20">
            <image href={src} width="20" height="20" />
          </svg>
        ));
  }
  cache.set(key, icon);
  return icon;
}

/** 某个 Agent 的图标；`slot` 等透传给 S2 的图标（默认进 `icon` 槽）。 */
export function AgentProviderIcon({
  driver,
  ...props
}: { driver: Pick<DriverInfo, 'id' | 'name'> & { source?: DriverInfo['source'] } } & ComponentProps<IconComponent>) {
  const Icon = iconFor(agentIcon(driver));
  return <Icon {...props} />;
}
