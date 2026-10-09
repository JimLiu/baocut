import type { CaptionItem } from '@baocut/protocol';
import { create } from 'zustand';
import { useEditor } from '../../state/editor-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { openGallery } from './caption-gallery.tsx';
import { chooseChip, focusDocument } from './transcribe-run.ts';
import { openFlow, setCompare } from './translate-run.ts';

/**
 * 从画面上的字幕打开字幕面板（舞台上双击字幕、字幕工具条的 Edit）：落在这条字幕的文档上，译文字幕对照着它的译文；
 * 收起样式库与翻译流程，露出字幕列表。
 */
export function openCaptionEditor(item: CaptionItem): void {
  const video = useVideo.getState().video;
  if (video?.videoId) {
    const records = video.state?.video.documents ?? {};
    const source = records[item.documentId]?.sourceDocumentId;
    const translation = source && records[source]?.kind === 'translation' ? source : null;
    setCompare(video.videoId, { mode: translation ? 'trans' : 'src', documentId: translation });
    openGallery(video.videoId, false);
    openFlow(video.videoId, false);
    focusDocument(video.videoId, item.documentId);
  }
  useEditor.getState().showPanel('subtitle');
}

/** 打开字幕样式库，落在这一枚字幕轨 chip 上（字幕属性页的「更换样式」、字幕工具条的 Styles）。 */
export function openCaptionStyles(chipKey: string | undefined): void {
  const videoId = useVideo.getState().video?.videoId;
  if (videoId && chipKey) {
    chooseChip(videoId, chipKey);
    openGallery(videoId, true);
  }
  useEditor.getState().showPanel('subtitle');
}

/** 属性页里要滚到的那一段（字幕工具条的「动画」→「当前词」）；属性页滚到之后清掉。 */
export const useCaptionSection = create<{ focus: 'active' | null }>(() => ({ focus: null }));

/** 字幕工具条的「动画」：选中这条字幕、打开属性页，滚到「当前词」那一段（倒鸭子时是倒鸭子那一段）。 */
export function openCaptionActive(item: CaptionItem): void {
  const videoId = useVideo.getState().video?.videoId;
  if (videoId) openGallery(videoId, false);
  useEditor.getState().select([item.id]);
  useCaptionSection.setState({ focus: 'active' });
  useEditor.getState().showPanel('props');
}
