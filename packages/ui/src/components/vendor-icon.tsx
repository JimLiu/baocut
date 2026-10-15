import type { ComponentProps, FunctionComponent } from 'react';
import { createIcon } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import type { AgentIconSpec } from '../model/agent-choice.ts';
import anthropic from './vendor-icons/anthropic.svg';
import codex from './vendor-icons/codex.svg';
import cursor from './vendor-icons/cursor.svg';
import deepseek from './vendor-icons/deepseek.svg';
import elevenlabs from './vendor-icons/elevenlabs.svg';
import githubcopilot from './vendor-icons/githubcopilot.svg';
import google from './vendor-icons/google.svg';
import groq from './vendor-icons/groq.svg';
import minimax from './vendor-icons/minimax.svg';
import mistral from './vendor-icons/mistral.svg';
import moonshot from './vendor-icons/moonshot.svg';
import openai from './vendor-icons/openai.svg';
import opencode from './vendor-icons/opencode.svg';
import openrouter from './vendor-icons/openrouter.svg';
import pi from './vendor-icons/pi.svg';
import qwen from './vendor-icons/qwen.svg';
import siliconflow from './vendor-icons/siliconflow.svg';
import volcengine from './vendor-icons/volcengine.svg';
import xai from './vendor-icons/xai.svg';
import zhipu from './vendor-icons/zhipu.svg';

/*
 * 厂商图标（产品设计 §3.2.3、§7.6；原型 vendor-icon.jsx `VendorIcon`）：Agent 与 API 提供方共用。`vendor-icons/` 里的 SVG 与原型
 * designs/baocut/assets/vendors 逐字节相同（lobe-icons，MIT，署名见仓库根的 THIRD_PARTY_NOTICES.md；原型的 icon-sync.test.js
 * 核对两份一致）。用 createIcon 包一层、画在 20 网格上，放进 ActionButton 与 MenuItem 的图标槽时和 S2 workflow 图标一样定位、
 * 按紧凑档显示 16px（app.css）；单色的当遮罩填 currentColor（行停用时跟着变淡），彩色的原样画，没有图标的画名字首字母。
 */
const FILES: Readonly<Record<string, string>> = {
  anthropic,
  codex,
  cursor,
  deepseek,
  elevenlabs,
  githubcopilot,
  google,
  groq,
  minimax,
  mistral,
  moonshot,
  openai,
  opencode,
  openrouter,
  pi,
  qwen,
  siliconflow,
  volcengine,
  xai,
  zhipu,
};

const letterBox = style({ fill: 'gray-200' });
const letterText = style({ fill: 'gray-800' });

export type VendorIconComponent = FunctionComponent<ComponentProps<ReturnType<typeof createIcon>>>;
const cache = new Map<string, VendorIconComponent>();

/** 一个图标规格对应的 S2 图标组件（按规格缓存，免得每次渲染换组件）。认不出的文件名画成空白。 */
export function vendorIconFor(spec: AgentIconSpec): VendorIconComponent {
  const key = spec.kind === 'letter' ? `letter:${spec.letter}` : `${spec.mono ? 'mono' : 'color'}:${spec.file}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let icon: VendorIconComponent;
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

/** 按规格画一个厂商图标；`slot` 等透传给 S2 的图标。 */
export function VendorIcon({ spec, ...props }: { spec: AgentIconSpec } & ComponentProps<VendorIconComponent>) {
  const Icon = vendorIconFor(spec);
  return <Icon {...props} />;
}
