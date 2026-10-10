import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { MediaHandle, MediaTarget } from '@baocut/protocol';
import { ProgressCircle, SegmentedControl, SegmentedControlItem } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { S } from './shell-copy.ts';
import { targetKey } from '../model/media.ts';
import { previewModeOfFileName } from '../model/space.ts';
import { useRuntime } from '../runtime/context.tsx';
import { DocumentContent } from './document-preview.tsx';
import { TEXT_PREVIEW_LIMIT, PDF_PREVIEW_LIMIT, type DocumentPreview, type FilePreviewMode, resolvedPreviewMode, readPreviewText } from '../model/file-preview.ts';
import { CompactPlayer } from './media/compact-player.tsx';
import { MediaPlayer } from './player/media-player.tsx';
import { P } from './player/player-copy.ts';
import { ImagePreview } from './image-preview.tsx';
import type { ImageCandidate } from '../model/image-preview.ts';
import { PANEL as M } from './panel-copy.ts';
import './thread/markdown.css';

/** 文本预览的上限：再大就只给「在文件夹中显示」。 */
const PdfPreview = lazy(() => import('./pdf-preview.tsx'));
const richFrame = style({ display: 'flex', flexDirection: 'column', width: 'full', height: 'full', minHeight: 160, overflow: 'auto' });

const frame = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 160,
  borderRadius: 'lg',
  backgroundColor: 'gray-75',
  overflow: 'hidden',
});
const media = style({ display: 'block', maxWidth: 'full', maxHeight: '[60vh]', objectFit: 'contain' });
const note = style({ font: 'ui-sm', color: 'gray-600', padding: 24, textAlign: 'center' });

type State =
  | { status: 'loading' }
  | { status: 'ready'; handle: MediaHandle; mode: FilePreviewMode; text: string | null }
  | { status: 'unsupported' }
  | { status: 'error'; message: string };

/**
 * 一个文件的预览（Space 的查看框与会话的文件查看器共用）。经媒体通道取受限地址（架构设计 §4.5），
 * 图片、音视频用浏览器元素，字幕与文档按文字显示；预览不了的如实说。
 */
export function FilePreview({ target, fileName, sourceMode, playback, onResolved, imagePanel, resolvedHandle, active = true, filePath }: {
  filePath?:string; resolvedHandle?:MediaHandle; active?:boolean;
  target: MediaTarget; fileName: string; sourceMode?: boolean;
  playback?: { layout?: 'column' | 'row'; memoryKey?: string };
  onResolved?: (handle: MediaHandle, mode: FilePreviewMode | null) => void;
  imagePanel?: { conversationId?: string | null; gallery: ImageCandidate[]; onSelect(image: ImageCandidate): void };
}) {
  const runtime = useRuntime();
  const legacyMode = previewModeOfFileName(fileName);
  const [localSource, setLocalSource] = useState(false);
  const source = sourceMode ?? localSource;
  const key = targetKey(target);
  const [state, setState] = useState<State>({ status: 'loading' });
  const notify = useRef(onResolved);
  notify.current = onResolved;

  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();
    setState({ status: 'loading' });
    (async () => {
      const handle = resolvedHandle ?? await runtime.resolveMedia(target);
      if (cancelled) return;
      const mode = resolvedPreviewMode(fileName, handle, legacyMode);
      notify.current?.(handle, mode);
      if (!mode) { setState({ status: 'unsupported' }); return; }
      let text: string | null = null;
      if (mode === 'pdf' && handle.size > PDF_PREVIEW_LIMIT) throw new Error(S.filePreview.tooLarge);
      if (['text', 'markdown', 'html', 'table', 'json'].includes(mode)) {
        if (handle.size > TEXT_PREVIEW_LIMIT) throw new Error(S.filePreview.tooLarge);
        const response = await fetch(handle.url, { signal: abort.signal });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const result = await readPreviewText(response, handle.textEncoding);
        if ('error' in result) {
          if (result.error === 'limit') throw new Error(S.filePreview.tooLarge);
          if (!cancelled) setState({ status: 'unsupported' });
          return;
        }
        text = result.text;
      }
      if (!cancelled) setState({ status: 'ready', handle, mode, text });
    })().catch((error: Error) => {
      if (!cancelled) setState({ status: 'error', message: error.message });
    });
    return () => {
      cancelled = true;
      abort.abort();
    };
    // target 由 key 唯一确定，不把每次新建的对象放进依赖。
  }, [runtime, key, legacyMode, fileName, resolvedHandle]);

  if (state.status === 'loading') {
    return (
      <div className={frame}>
        <ProgressCircle isIndeterminate aria-label={S.filePreview.loading} />
      </div>
    );
  }
  if (state.status === 'unsupported') {
    return (
      <div className={frame}>
        <span className={note}>{S.filePreview.unsupported}</span>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className={frame}>
        <span className={note}>{S.filePreview.failed(state.message)}</span>
      </div>
    );
  }
  const { handle, text, mode } = state;
  if (mode === 'image') return <ImagePreview active={active} target={target} handle={handle} fileName={fileName} {...imagePanel} />;
  if (mode === 'audio' || mode === 'video') return <CompactPlayer active={active} handle={handle} fileName={fileName} memoryKey={playback?.memoryKey??key} kind={mode} path={filePath??('path' in target?target.path:fileName)} subtitles={<MediaPlayer target={target} fileName={fileName} {...playback} resolvedHandle={handle} mediaKind={mode}/>}/>;
  if (mode === 'pdf') return <Suspense fallback={<ProgressCircle isIndeterminate aria-label={S.filePreview.loading} />}><PdfPreview url={handle.url} fileName={fileName} /></Suspense>;
  if (['text', 'markdown', 'html', 'table', 'json'].includes(mode!)) return <div className={richFrame}>
    {sourceMode === undefined && mode !== 'text' && <DocumentViewControl mode={mode as DocumentPreview} source={source} onChange={setLocalSource} />}
    <DocumentContent mode={mode as DocumentPreview} text={text ?? ''} source={source} fileName={fileName} target={target} />
  </div>;
  return null;
}

export function DocumentViewControl({ mode, source, onChange }: { mode: DocumentPreview; source: boolean; onChange: (source: boolean) => void }) {
  if (mode === 'pdf' || mode === 'text') return null;
  const label = mode === 'table' ? M.table : mode === 'json' ? M.formatted : M.preview;
  return <SegmentedControl aria-label={M.preview} selectedKey={source ? 'source' : 'preview'} onSelectionChange={key => onChange(key === 'source')}>
    <SegmentedControlItem id="preview">{label}</SegmentedControlItem><SegmentedControlItem id="source">{M.source}</SegmentedControlItem>
  </SegmentedControl>;
}
