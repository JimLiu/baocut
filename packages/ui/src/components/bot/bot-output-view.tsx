import { useEffect, useMemo, useState } from 'react';
import type { MediaTarget } from '@baocut/protocol';
import { ActionButton, Button, ProgressCircle, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import OpenIn from '@react-spectrum/s2/icons/OpenIn';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { findOutput, opensAsTab, outputKind } from '../../model/bot.ts';
import type { BotSideTab } from '../../model/bot-side.ts';
import type { ConversationOutput } from '../../model/conversation-outputs.ts';
import { formatClock } from '../../model/format.ts';
import { targetKey } from '../../model/media.ts';
import { decodeSubtitleText, parseSubtitles, subtitleFormatOf, type Cue, type SubtitleFormat } from '../../model/subtitles.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useBotLayout } from '../../state/bot-layout-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useWorkItem } from '../../state/work-items-store.ts';
import { EditorWorkspace } from '../editor/editor-workspace.tsx';
import { FilePreview } from '../file-preview.tsx';
import { P } from '../player/player-copy.ts';
import { S } from '../shell-copy.ts';
import { OutputCard } from '../thread/output-card.tsx';
import { BOT_COPY as C } from './bot-copy.ts';
import { OUTPUT_ICON, outputLabel } from './bot-output-link.tsx';
import { useWorkItemRecord } from './task-detail.tsx';
import { seekTo, useRefResolver } from './task-refs.tsx';

const frame = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, minHeight: 0 });
const head = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexShrink: 0,
  padding: 8,
  borderStyle: 'solid',
  borderColor: 'gray-100',
  borderTopWidth: 0,
  borderXWidth: 0,
  borderBottomWidth: 2,
});
const kindIcon = style({ display: 'flex', flexShrink: 0, marginX: 4, color: 'gray-700' });
const heading = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 });
const title = style({
  margin: 0,
  font: 'ui',
  fontWeight: 'bold',
  color: 'gray-900',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
const subline = style({ font: 'ui-sm', color: 'gray-700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
/** 「种类 · 任务名」里的任务名：按下切到那个任务的页签（原型 `.bot-output__task`）。 */
const taskLink = style({
  padding: 0,
  borderWidth: 0,
  borderRadius: 'sm',
  backgroundColor: 'transparent',
  font: 'ui-sm',
  color: { default: 'gray-700', ':hover': 'gray-900' },
  textDecoration: 'underline',
  cursor: 'default',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: 1,
});
const body = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  flexGrow: 1,
  minWidth: 0,
  minHeight: 0,
  backgroundColor: 'gray-50',
});
const scroll = style({ display: 'flex', flexDirection: 'column', gap: 16, flexGrow: 1, minHeight: 0, overflowY: 'auto', padding: 16 });
const centered = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  flexGrow: 1,
  padding: 24,
  font: 'body-sm',
  color: 'gray-600',
  textAlign: 'center',
});
const picture = style({
  display: 'block',
  maxWidth: 'full',
  maxHeight: 'full',
  marginX: 'auto',
  objectFit: 'contain',
  borderRadius: 'default',
});
const caption = style({ font: 'ui-xs', color: 'gray-600', textAlign: 'center' });
const cueList = style({ display: 'flex', flexDirection: 'column', margin: 0, padding: 0, listStyleType: 'none' });
const cueRow = style({
  display: 'grid',
  gridTemplateColumns: '[72px 1fr]',
  gap: 12,
  paddingY: 8,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderTopWidth: 0,
  borderXWidth: 0,
  borderBottomWidth: 1,
});
const cueTime = style({ font: 'ui-xs', color: 'gray-600', fontVariantNumeric: 'tabular-nums', paddingTop: 2 });
const cueText = style({ font: 'ui', color: 'gray-900', whiteSpace: 'pre-line', overflowWrap: 'anywhere' });

/** 字幕预览读的上限（同播放器叠加字幕）。 */
const SUBTITLE_LIMIT = 5 * 1024 * 1024;

type OutputTab = Extract<BotSideTab, { kind: 'output' }>;

/**
 * 产物页签（需求 §11.6 的修订稿，原型 page-bot-side.jsx `BotOutputView`）：头部是种类图标、产物名与「种类 · 任务名」
 * （任务名按下切到那个任务的页签），视频多一个「在 Home 打开」。返回、占满与关闭都在页签条上。
 * 内容按产物画：视频是嵌进来的编辑器（与 Home 功能区、Space 同一个），字幕是一句一行的列表，图片只看不改，文档与其他文件用文件预览；
 * 幻灯片、设计稿与协作文档这里看不了，给一张会话里的产物卡去功能区打开。产物从任务的 `outputs` 按 `outputKey` 找，
 * 任务里已经没有它时如实说并给「打开任务」。
 */
export function BotOutputView({ tab, onOpenTask }: { tab: OutputTab; onOpenTask: () => void }) {
  const live = useWorkItem(tab.workItemId);
  const { record, missing } = useWorkItemRecord(tab.workItemId);
  const item = live ?? record?.item;
  // 幻灯片、设计稿这类开不了产物页签（只有手改的链接会到这里），当作不在。
  const found = findOutput(item, tab.output);
  const ref = found && opensAsTab(found) ? found : null;
  const { conversationId, resolve } = useRefResolver(item);
  const output = useMemo(() => (ref ? resolve(ref) : null), [ref, resolve]);
  const video = output?.video ?? null;
  const videoKey = video ? targetKey(video) : null;

  // 认出视频的位置就记下，AppShell 照 Home 的视频标签打开它（页签开着就不关）。
  useEffect(() => {
    if (video) useBotLayout.getState().setVideo(tab.key, video);
  }, [tab.key, videoKey]);
  // 视频片段：编辑器打开这部视频时停在片段开头。
  const rangeKey = ref?.kind === 'video-range' ? `${ref.videoId}:${ref.startMs}` : null;
  useEffect(() => {
    if (ref?.kind === 'video-range') seekTo(ref);
  }, [rangeKey]);

  if (!item || !ref) {
    return (
      <section className={frame} aria-label={C.output.missingTab}>
        {!item && !missing ? (
          <div className={centered}>
            <ProgressCircle size="S" isIndeterminate aria-label={C.common.loading} />
          </div>
        ) : (
          <div className={centered}>
            <span>{C.output.missing}</span>
            {item ? (
              <Button variant="secondary" onPress={onOpenTask}>
                {C.output.openTask}
              </Button>
            ) : null}
          </div>
        )}
      </section>
    );
  }

  const kind = outputKind(ref) ?? 'doc';
  const Icon = OUTPUT_ICON[kind];
  const label = outputLabel(ref);
  return (
    <section className={frame} aria-label={label}>
      <header className={head}>
        <span className={kindIcon} aria-hidden="true">
          <Icon />
        </span>
        <div className={heading}>
          <h2 className={title} title={label}>
            {label}
          </h2>
          <span className={subline}>
            {`${C.make.outputKind[kind]} · `}
            <button type="button" className={taskLink} title={item.title} aria-label={C.output.task(item.title)} onClick={onOpenTask}>
              {item.title}
            </button>
          </span>
        </div>
        {video ? (
          <TooltipTrigger>
            <ActionButton isQuiet size="S" aria-label={C.output.openInHome} onPress={() => useShell.getState().openVideo(video)}>
              <OpenIn />
            </ActionButton>
            <Tooltip>{C.output.openInHome}</Tooltip>
          </TooltipTrigger>
        ) : null}
      </header>
      <div className={body}>
        <OutputBody output={output} conversationId={conversationId} />
      </div>
    </section>
  );
}

function OutputBody({ output, conversationId }: { output: ConversationOutput | null; conversationId: string | null }) {
  if (!output) return <p className={centered}>{C.output.notFound}</p>;
  if (output.video) return <EditorWorkspace />;
  if (output.kind === 'video') return <p className={centered}>{C.output.videoNotReady}</p>;
  if (output.slides || output.design || output.designSystem || output.docs) {
    return (
      <div className={scroll}>
        <p className={centered}>{C.output.elsewhere}</p>
        <OutputCard output={output} conversationId={conversationId ?? ''} />
      </div>
    );
  }
  const target: MediaTarget | null = output.file?.target ?? (output.entry ? { entryId: output.entry.id } : null);
  if (!target) return <p className={centered}>{C.output.notFound}</p>;
  const fileName = output.entry?.fileName ?? ('path' in target ? (target.path.split(/[\\/]/).pop() ?? output.name) : output.name);
  const format = subtitleFormatOf(fileName);
  return (
    <div className={`${scroll} bc-scroll`}>
      {output.kind === 'image' ? (
        <OutputImage key={targetKey(target)} target={target} name={output.name} fileName={fileName} />
      ) : format ? (
        <SubtitleCues key={targetKey(target)} target={target} format={format} />
      ) : (
        <FilePreview key={targetKey(target)} target={target} fileName={fileName} />
      )}
    </div>
  );
}

type ImageState = { status: 'loading' } | { status: 'ready'; url: string } | { status: 'error'; message: string };

/** 图片：只看，不带图片查看器的工具（原型 `BotOutputImages`）；下面一行文件名与尺寸。 */
function OutputImage({ target, name, fileName }: { target: MediaTarget; name: string; fileName: string }) {
  const runtime = useRuntime();
  const [state, setState] = useState<ImageState>({ status: 'loading' });
  const [size, setSize] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    runtime.resolveMedia(target).then(
      (handle) => !cancelled && setState({ status: 'ready', url: handle.url }),
      (error: Error) => !cancelled && setState({ status: 'error', message: error.message }),
    );
    return () => {
      cancelled = true;
    };
    // target 由 key 唯一确定（调用方按 targetKey 换实例）。
  }, [runtime]);

  if (state.status === 'loading') {
    return (
      <div className={centered}>
        <ProgressCircle size="S" isIndeterminate aria-label={S.filePreview.loading} />
      </div>
    );
  }
  if (state.status === 'error') return <p className={centered}>{S.filePreview.failed(state.message)}</p>;
  return (
    <>
      <img
        className={picture}
        src={state.url}
        alt={name}
        onLoad={(event) => setSize(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`)}
      />
      <span className={caption}>{size ? `${fileName} · ${size}` : fileName}</span>
    </>
  );
}

type CueState = { status: 'loading' } | { status: 'ready'; cues: Cue[] } | { status: 'error'; message: string };

/** 字幕：一句一行，左边是开始时刻，右边是文字（双语字幕的两行照原样换行；原型 `BotOutputCues`）。只读。 */
function SubtitleCues({ target, format }: { target: MediaTarget; format: SubtitleFormat }) {
  const runtime = useRuntime();
  const [state, setState] = useState<CueState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const handle = await runtime.resolveMedia(target);
      if (handle.size > SUBTITLE_LIMIT) throw new Error(P.tooLarge);
      const response = await fetch(handle.url);
      if (!response.ok) throw new Error(P.fetchFailed(response.status));
      return parseSubtitles(decodeSubtitleText(new Uint8Array(await response.arrayBuffer())), format);
    })().then(
      (cues) => !cancelled && setState({ status: 'ready', cues }),
      (error: Error) => !cancelled && setState({ status: 'error', message: error.message }),
    );
    return () => {
      cancelled = true;
    };
    // target 由 key 唯一确定（调用方按 targetKey 换实例）。
  }, [runtime]);

  if (state.status === 'loading') {
    return (
      <div className={centered}>
        <ProgressCircle size="S" isIndeterminate aria-label={S.filePreview.loading} />
      </div>
    );
  }
  if (state.status === 'error') return <p className={centered}>{S.filePreview.failed(state.message)}</p>;
  if (!state.cues.length) return <p className={centered}>{C.output.noCues}</p>;
  return (
    <ol className={cueList} aria-label={C.output.cues}>
      {state.cues.map((cue) => (
        <li key={cue.index} className={cueRow}>
          <span className={cueTime}>{formatClock(cue.start)}</span>
          <span className={cueText}>{cue.text}</span>
        </li>
      ))}
    </ol>
  );
}
