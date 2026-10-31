import type { ResourceRef } from '@baocut/protocol';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { videoEntryOf } from '../../../model/bot-refs.ts';
import { videoTargetOf } from '../../../model/space.ts';
import { useRuntime } from '../../../runtime/context.tsx';
import { useChannels } from '../../../state/channels-store.ts';
import { useShell } from '../../../state/shell-store.ts';
import { useSpace } from '../../../state/space-store.ts';
import { useTimeline } from '../../../state/timeline-store.ts';
import { useWorkItem } from '../../../state/work-items-store.ts';
import { jumpTo } from '../bot-jump.ts';
import { BOT_COPY as C } from '../bot-copy.ts';

const line = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8, rowGap: 2, margin: 0, font: 'ui-xs', color: 'gray-600' });
const link = style({
  padding: 0,
  borderWidth: 0,
  backgroundColor: 'transparent',
  font: 'ui-xs',
  color: 'accent-900',
  textDecoration: 'underline',
  cursor: 'pointer',
  maxWidth: 240,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
const plain = style({ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

const SNIPPET = 40;

/**
 * 建议卡的依据链接（BOT-MK-04）：消息跳到频道里那一条，视频在编辑器里打开，任务打开详情；文件、文档等只写名字。
 * 找不到的（视频已删、消息不在任何频道）也只写类型名。
 */
export function EvidenceLinks({ refs }: { refs: readonly ResourceRef[] }) {
  if (!refs.length) return null;
  return (
    <p className={line}>
      <span>{C.proposal.evidence}</span>
      {refs.map((ref, index) => (
        <Evidence key={index} target={ref} />
      ))}
    </p>
  );
}

function Evidence({ target }: { target: ResourceRef }) {
  const runtime = useRuntime();
  const go = useShell((s) => s.go);
  const entries = useSpace((s) => s.entries);
  const channels = useChannels((s) => s.channels);
  const messages = useTimeline((s) => (target.kind === 'message' ? s.byConversationId[target.conversationId]?.items : undefined));
  const task = useWorkItem(target.kind === 'work-item' ? target.workItemId : null);
  const kind = C.detail.resource[target.kind];
  const button = (label: string, onPress: () => void) => (
    <button type="button" className={link} title={label} onClick={onPress}>
      {label}
    </button>
  );
  switch (target.kind) {
    case 'message': {
      const channel = channels.find((c) => c.channel.conversationId === target.conversationId)?.channel;
      const found = messages?.find((i) => i.id === target.itemId);
      const text = found && (found.kind === 'user-message' || found.kind === 'agent-message') ? found.text.trim() : '';
      const label = text ? `${kind} · ${[...text].length > SNIPPET ? `${[...text].slice(0, SNIPPET).join('')}…` : text}` : kind;
      if (!channel) return <span className={plain}>{label}</span>;
      return button(label, () => {
        go({ tab: 'bot', channelId: channel.id, workItemId: null, view: 'channel' });
        void jumpTo(runtime, target.conversationId, target.itemId);
      });
    }
    case 'video':
    case 'video-range': {
      const entry = videoEntryOf(entries, target.videoId);
      if (!entry) return <span className={plain}>{kind}</span>;
      return button(`${kind} · ${entry.name}`, () => useShell.getState().openVideo(videoTargetOf(entry)));
    }
    case 'space': {
      const entry = entries.find((e) => e.id === target.entryId);
      if (!entry) return <span className={plain}>{kind}</span>;
      if (entry.kind !== 'video') return <span className={plain}>{`${kind} · ${entry.name}`}</span>;
      return button(`${kind} · ${entry.name}`, () => useShell.getState().openVideo(videoTargetOf(entry)));
    }
    case 'work-item': {
      if (!task) return <span className={plain}>{kind}</span>;
      return button(`${kind} · ${task.title}`, () => go({ tab: 'bot', channelId: task.channelId, workItemId: task.id, view: 'channel' }));
    }
    case 'file': {
      const name = target.path.split(/[\\/]/).filter(Boolean).pop() ?? target.path;
      return (
        <span className={plain} title={target.path}>
          {`${kind} · ${name}`}
        </span>
      );
    }
    default:
      return <span className={plain}>{kind}</span>;
  }
}
