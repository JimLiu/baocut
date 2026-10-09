import type { CaptionItem } from '@baocut/protocol';
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
