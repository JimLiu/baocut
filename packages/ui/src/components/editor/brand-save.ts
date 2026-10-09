import type { CaptionStyleBody, DocumentRecord } from '@baocut/protocol';
import { ToastQueue } from '@react-spectrum/s2';
import { isDefaultStyleName } from '../../model/caption-presets.ts';
import { captionStyleProblem, clipBrandName } from '../../model/library-brand.ts';
import { libraryErrorText } from '../../model/library-entry.ts';
import { putLibraryEntry } from '../../runtime/library-commands.ts';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useVideo } from '../../state/video-store.ts';
import { BRAND_COPY as IB } from './brand-copy.ts';

/**
 * 把视频里正在用的一份字幕样式存进品牌库（品牌页的「存当前样式」与舞台字幕工具条的「存到品牌库」共用）：
 * 读那份 `caption-style` 文档的当前版本，结果用提示条说。存进去了返回 true。
 */
export async function saveCaptionStyleToBrand(runtime: RuntimeSession, record: DocumentRecord): Promise<boolean> {
  const video = useVideo.getState().video;
  if (!video?.videoId) return false;
  try {
    const { body } = await runtime.client.request('documents.read', {
      videoId: video.videoId,
      documentId: record.id,
      revision: record.currentRevision,
    });
    const problem = captionStyleProblem(body);
    if (problem) {
      ToastQueue.negative(IB.saveProblem(problem), { timeout: 6000 });
      return false;
    }
    const videoName = video.state?.video.name;
    // 缺省的样式文档都叫同一个名字（按建它时的语言）：带上视频名，存了几份也分得清。
    const isDefaultName = isDefaultStyleName(record.name) || record.name === IB.captionStyle;
    const name = clipBrandName(isDefaultName && videoName ? IB.captionStyleName(videoName) : record.name) || IB.captionStyle;
    await putLibraryEntry(runtime, { library: 'brand', content: { name, kind: 'captionStyle', style: body as CaptionStyleBody } });
    ToastQueue.positive(IB.savedStyle(name), { timeout: 4000 });
    return true;
  } catch (error) {
    ToastQueue.negative(libraryErrorText(IB.actionSaveStyle, error), { timeout: 6000 });
    return false;
  }
}
