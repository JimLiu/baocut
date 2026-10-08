import { Link } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import type { GateGuide } from '../../model/home-brief.ts';
import { useGateFix } from '../start/gate-card.tsx';
import { EDITOR_COPY as E } from './editor-copy.ts';

const line = style({
  margin: 0,
  font: 'ui-xs',
  color: 'gray-700',
  lineHeight: '[1.5]',
});

/**
 * 编辑器里 Agent 用不了时的那一行（工具页的「用」、右下角悬浮会话）：一句原因加一个去处理的链接。
 * 起始页用整张指引卡（start/gate-card.tsx）；窄面板里放一张橙色卡太重，和周围的设置项不协调。
 */
export function AgentGateLine({ guide }: { guide: GateGuide }) {
  const { busy, fix } = useGateFix(guide);
  return (
    <p className={line} role="status">
      {guide.title}
      {E.gap}
      <Link variant="secondary" onPress={() => !busy && void fix()}>
        {guide.action}
      </Link>
    </p>
  );
}
