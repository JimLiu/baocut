import { useMemo, useSyncExternalStore } from 'react';
import type { Id } from '@baocut/protocol';
import { ActionButton } from '@react-spectrum/s2';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import Play from '@react-spectrum/s2/icons/Play';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import { OUTPUT_COPY } from '../../copy.ts';
import { outputSourceMissing, posterFrame, type ConversationOutput } from '../../model/conversation-outputs.ts';
import { formatClock } from '../../model/format.ts';
import { formatBytes, isPlayable, KIND_LABEL } from '../../model/space.ts';
import { videoStatus } from '../../model/video-cards.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { sameTarget } from '../../runtime/video-controller.ts';
import { useJobs } from '../../state/jobs-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useSpace } from '../../state/space-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { KIND_ICON } from '../space/space-list.tsx';
import { useEntryThumbnail } from '../use-entry-thumbnail.ts';
import { cardVars, VideoJobRows, VideoStatusBadge } from './video-card-rows.tsx';
import { T } from './thread-copy.ts';

/** 文件是一行卡片（原型 apprail.css `.chat-output` :127-134）：图标、名字与说明、末尾的去向。 */
const outputCard = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexShrink: 0,
  width: 'full',
  minWidth: 0,
  boxSizing: 'border-box',
  paddingY: 12,
  paddingX: { default: 16, isPopover: 12 },
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: '[10px]',
  backgroundColor: { default: 'gray-25', isHovered: 'gray-50', isPressed: 'gray-75' },
  textAlign: 'start',
  font: 'ui',
  color: 'gray-900',
  cursor: 'default',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: -2,
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const outputIcon = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  size: 40,
  borderRadius: 'default',
  backgroundColor: 'gray-75',
  color: 'gray-700',
});
const outputBody = style({ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 });
const outputName = style({ fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
/**
 * 视频是一张竖排的视频卡（产品设计 §3.2.2、§6.5，原型 apprail.css `.chat-output--movie` :142-155、home-session.jsx
 * `SessionArtifactCard`）：上面 16:9 的画面，点了在右侧打开；下面名字、状态词与时长，旁边一个「打开编辑器」；再下面一件活一行。
 */
const videoCard = style({
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
  width: 'full',
  maxWidth: 360,
  minWidth: 0,
  boxSizing: 'border-box',
  overflow: 'hidden',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: '[10px]',
  backgroundColor: 'gray-25',
  font: 'ui',
  color: 'gray-900',
});
/** 视频的画面区：有真帧画真帧和居中的播放钮；拿不到画「暂无缩略图」，源目录不在了画「找不到源文件」；右下角是时长。 */
const videoPreview = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  width: 'full',
  aspectRatio: 'video',
  overflow: 'hidden',
  padding: 0,
  borderWidth: 0,
  backgroundColor: { default: 'gray-75', isHovered: 'gray-100', isPressed: 'gray-200' },
  font: 'ui-sm',
  color: 'gray-600',
  cursor: 'default',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: -2,
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const posterImage = style({ position: 'absolute', inset: 0, width: 'full', height: 'full', objectFit: 'cover' });
const playMark = style({
  position: 'absolute',
  top: '[40%]',
  left: '[50%]',
  translateX: '[-50%]',
  translateY: '[-50%]',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  size: 40,
  borderRadius: 'full',
  backgroundColor: 'gray-25',
  color: 'gray-900',
  boxShadow: 'elevated',
});
const videoDuration = style({
  position: 'absolute',
  insetEnd: 8,
  bottom: 8,
  paddingX: '[6px]',
  paddingY: 4,
  borderRadius: 'sm',
  backgroundColor: 'gray-900',
  font: 'code-xs',
  // font 简写会设置 code 文字色，角标的对比色必须在它之后。
  color: 'gray-25',
});
const videoFooter = style({ display: 'flex', alignItems: 'center', gap: 12, paddingX: 16, paddingY: 12 });
const videoName = style({ fontWeight: 'bold', overflowWrap: 'anywhere' });
const videoMeta = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, minWidth: 0 });
const videoAction = style({ flexShrink: 0 });
const outputDetail = style({ font: 'ui-xs', color: 'gray-600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const outputTail = style({ display: 'flex', flexShrink: 0, color: 'gray-600' });

/**
 * 视频卡的真帧：用 Space 的封面（`space.thumbnail`），不用打开编辑器。
 * 编辑器开着这部视频时优先用当前快照的封面（`media.thumbnail`），没取到时仍画 Space 的封面。
 */
function usePoster(output: ConversationOutput): string | null {
  const thumbnail = useEntryThumbnail(output.kind === 'video' ? output.entry : null);
  const media = useRuntime().videos.media;
  useSyncExternalStore(media.subscribe, media.version);
  const target = output.video;
  const snapshot = useVideo((s) =>
    target && s.video?.status === 'ready' && (s.video.videoId === output.id || sameTarget(s.video.target, target))
      ? (s.video.state?.video ?? null)
      : null,
  );
  const frame = useMemo(() => (snapshot ? posterFrame(snapshot) : null), [snapshot]);
  const editorPoster = frame ? media.thumbnail(frame.asset, frame.at) : null;
  return editorPoster ?? (thumbnail?.kind === 'image' ? thumbnail.url : null);
}

/** 编辑器开着这部视频、文档里已经有转录（`speech`）：视频卡的「已转录」不必等 Job 记录。 */
function useTranscribedInEditor(output: ConversationOutput): boolean {
  const target = output.video;
  return useVideo(
    (s) =>
      output.kind === 'video' &&
      s.video?.status === 'ready' &&
      (s.video.videoId === output.id || (!!target && sameTarget(s.video.target, target))) &&
      Object.values(s.video.state?.video.documents ?? {}).some((doc) => doc.kind === 'speech'),
  );
}

/**
 * 一项产物（原型 home-session.jsx `SessionArtifactCard`）：会话头「产物」弹层、线程里的视频卡与每条回复下面的文件共用。
 * 视频在右边的编辑器里打开；视频文件与音频在功能区播放；其它文件在文件夹中显示。`onOpen` 在打开之前调（弹层用来收起）。
 * `jobIds`：视频卡下面列的活（线程里与弹层里都是整条会话在这部视频上的）。
 */
export function OutputCard({
  output,
  conversationId,
  placement = 'message',
  jobIds,
  onOpen,
}: {
  output: ConversationOutput;
  conversationId: Id;
  placement?: 'message' | 'popover';
  jobIds?: readonly Id[];
  onOpen?: () => void;
}) {
  const transcribed = useTranscribedInEditor(output);
  // 只取状态词这两个字，进度每一跳不重画整张卡（行自己订阅）。
  const statusKey = useJobs((s) => {
    if (output.kind !== 'video') return '';
    const status = videoStatus(output.id, s.jobs, transcribed);
    return status ? `${status.key}\n${status.text}` : '';
  });
  const status = statusKey
    ? { key: statusKey.split('\n')[0] as NonNullable<ReturnType<typeof videoStatus>>['key'], text: statusKey.split('\n')[1]! }
    : null;
  const missing = useSpace((s) => outputSourceMissing(output, s));
  const poster = usePoster(output);
  const Icon = KIND_ICON[output.kind];
  const playable = !output.video && output.entry !== null && isPlayable(output.entry.fileName);
  const isVideo = output.kind === 'video';
  const words = (
    isVideo
      ? [KIND_LABEL.video, output.durationSeconds ? formatClock(output.durationSeconds) : null]
      : [KIND_LABEL[output.kind], output.entry ? formatBytes(output.entry.size) : null, playable ? OUTPUT_COPY.playHere : output.entry ? OUTPUT_COPY.previewHere : null]
  )
    .filter(Boolean)
    .join(' · ');

  const activate = () => {
    onOpen?.();
    const shell = useShell.getState();
    // 原型 home-session.jsx `SessionArtifactCard`：非视频的产物都在功能区的单文件标签里打开；
    // 那里视频与音频用播放器，其余用查看器，预览不了的如实说明并给「在文件夹中显示」。
    if (output.video) shell.openVideo(output.video);
    else if (!isVideo && output.entry) shell.openPane({ kind: 'file', target: { conversationId, path: output.entry.relPath } });
  };

  if (isVideo) {
    const showPoster = poster !== null && !missing;
    // 还不知道在哪打开（流程新建的视频，Space 还没扫到）：画面与「打开编辑器」先置灰。
    const canOpen = output.video !== null;
    return (
      // 画面区里的播放钮与「暂无缩略图」是画面内容，保留自己的尺寸（产品设计 §2.1）
      <div className={`${videoCard} ${cardVars}`} data-bc-icons="own">
        <RACButton
          className={(state) => videoPreview(state)}
          aria-label={OUTPUT_COPY.openVideo(output.name)}
          isDisabled={!canOpen}
          onPress={activate}>
          {showPoster ? (
            <>
              <img className={posterImage} src={poster} alt="" decoding="async" />
              <span className={playMark} aria-hidden>
                <Play />
              </span>
            </>
          ) : (
            <>
              {missing ? <AlertTriangle /> : <Icon />}
              {missing ? OUTPUT_COPY.sourceMissing : OUTPUT_COPY.noThumbnail}
            </>
          )}
          {output.durationSeconds ? <span className={`${videoDuration} bc-tabular`}>{formatClock(output.durationSeconds)}</span> : null}
        </RACButton>
        <div className={videoFooter}>
          <span className={outputBody}>
            <span className={videoName}>{output.name}</span>
            <span className={videoMeta}>
              {status ? <VideoStatusBadge status={status} /> : null}
              <span className={outputDetail}>{words}</span>
            </span>
          </span>
          <ActionButton size="S" styles={videoAction} isDisabled={!canOpen} onPress={activate}>
            {OUTPUT_COPY.openEditor}
          </ActionButton>
        </div>
        {jobIds?.length ? <VideoJobRows jobIds={jobIds} /> : null}
      </div>
    );
  }
  return (
    <RACButton
      className={(state) => outputCard({ ...state, isPopover: placement === 'popover' })}
      aria-label={T.output.aria(output.name, words)}
      onPress={activate}>
      <span className={outputIcon} data-bc-icons="primary">
        <Icon />
      </span>
      <span className={outputBody}>
        <span className={outputName} title={output.name}>
          {output.name}
        </span>
        <span className={outputDetail}>{words}</span>
      </span>
      <span className={outputTail}>
        <ChevronRight />
      </span>
    </RACButton>
  );
}
