import type {
  AssetRecord,
  BrandMediaKind,
  CaptionStyleBody,
  DocumentRecord,
  Id,
  LibraryEntrySummary,
  LibrarySource,
  TemplateLayers,
} from '@baocut/protocol';
import { brandLogoAsset, templateBrandLogos } from '@baocut/protocol';
import { ToastQueue } from '@react-spectrum/s2';
import { isDefaultStyleName } from '../../model/caption-presets.ts';
import { BRAND_SECTIONS, captionStyleProblem, clipBrandName } from '../../model/library-brand.ts';
import { libraryErrorText } from '../../model/library-entry.ts';
import { definitionOf } from '../../model/template-layers.ts';
import { applyLibraryEntry, putLibraryEntry, waitForAsset } from '../../runtime/library-commands.ts';
import { useLibrary } from '../../state/library-store.ts';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useVideo } from '../../state/video-store.ts';
import { BRAND_COPY as IB } from './brand-copy.ts';
import { TEMPLATE_COPY as TC } from './template-copy.ts';

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

/**
 * 把视频里的一个素材存进品牌库的某一节（品牌页的素材列表与舞台工具条的「存到品牌库」共用）：生成的用产物，
 * 链接的用原文件（`source` 由 `assetLibrarySource` 给）。结果用提示条说，存进去了返回 true。
 */
export async function saveAssetToBrand(runtime: RuntimeSession, asset: AssetRecord, kind: BrandMediaKind, source: LibrarySource): Promise<boolean> {
  const name = clipBrandName(asset.name) || IB.untitled;
  try {
    await putLibraryEntry(runtime, { library: 'brand', content: { name, kind }, source });
    ToastQueue.positive(IB.addedOne(BRAND_SECTIONS.find((section) => section.kind === kind)?.title ?? kind, name), { timeout: 4000 });
    return true;
  } catch (error) {
    ToastQueue.negative(libraryErrorText(IB.actionSaveToBrand, error), { timeout: 6000 });
    return false;
  }
}

/**
 * 把一套模板存进品牌库（模板属性页的「存到品牌库」、版面编辑器与品牌页的「复制一份」共用）：品牌库里同名的模板覆盖
 * （保留条目 ID），否则新建一条；存的是定义（去掉 `from` 与内置标记，经引擎校验）。结果用提示条说；存进去了返回
 * 条目 ID、存成的名字与是不是覆盖了同名的那条。
 */
export async function saveTemplateToBrand(
  runtime: RuntimeSession,
  doc: TemplateLayers,
  name: string,
  brand: readonly LibraryEntrySummary[],
  toast: 'saved' | 'duplicated' = 'saved',
): Promise<{ id: Id; name: string; updated: boolean } | null> {
  const clipped = clipBrandName(name) || TC.untitled;
  const same = brand.find((summary) => summary.kind === 'overlayTemplate' && summary.name === clipped);
  try {
    // 定义里的 ID 只是占位：目录按条目 ID 摆（`brandTemplateDoc`）。
    const template = definitionOf(doc, clipped, same?.id ?? doc.id);
    const { entry } = await putLibraryEntry(runtime, {
      library: 'brand',
      ...(same ? { id: same.id } : {}),
      content: { name: clipped, kind: 'overlayTemplate', template },
    });
    const message = toast === 'duplicated' ? TC.duplicated(clipped) : same ? TC.brandUpdated(clipped) : TC.brandSaved(clipped);
    ToastQueue.positive(message, { timeout: 4000 });
    return { id: entry.id, name: clipped, updated: !!same };
  } catch (error) {
    ToastQueue.negative(TC.saveFailed(error instanceof Error ? error.message : String(error)), { timeout: 6000 });
    return null;
  }
}

/**
 * 改品牌库里的一条模板定义（版面编辑器从品牌页「编辑版面」进来时的「保存」）：按条目 ID 覆盖，改了名字也还是这一条。
 * 已经套用了它的视频不跟着变（套用是拷一份进视频）。结果用提示条说，存进去了返回 true。
 */
export async function updateBrandTemplate(runtime: RuntimeSession, entryId: Id, doc: TemplateLayers, name: string): Promise<boolean> {
  const clipped = clipBrandName(name) || TC.untitled;
  try {
    const template = definitionOf(doc, clipped, entryId);
    await putLibraryEntry(runtime, { library: 'brand', id: entryId, content: { name: clipped, kind: 'overlayTemplate', template } });
    ToastQueue.positive(TC.brandUpdated(clipped), { timeout: 4000 });
    return true;
  } catch (error) {
    ToastQueue.negative(TC.saveFailed(error instanceof Error ? error.message : String(error)), { timeout: 6000 });
    return false;
  }
}

/**
 * 模板台标用到、视频里还没有的品牌库图片拷进视频（视频格式规范 §3.17「用到时按素材登记」）：每张一笔「从品牌库添加」，
 * 拷完再写模板，渲染按来源找到它。拷不进来时提示出来，返回 false（模板不写）。
 */
export async function copyBrandLogos(runtime: RuntimeSession, template: TemplateLayers): Promise<boolean> {
  const video = useVideo.getState().video;
  const assets = video?.state?.video.assets ?? {};
  const missing = templateBrandLogos(template).filter((logo) => !brandLogoAsset(assets, logo));
  if (!missing.length) return true;
  if (!video?.videoId) return false;
  for (const id of missing) {
    try {
      const result = await applyLibraryEntry(runtime, { videoId: video.videoId, entry: { library: 'brand', id } });
      if (result.assetId) await waitForAsset(result.assetId);
    } catch (error) {
      const name = useLibrary.getState().brand.find((entry) => entry.id === id)?.name ?? id;
      ToastQueue.negative(libraryErrorText(IB.actionPlace(name), error), { timeout: 6000 });
      return false;
    }
  }
  return true;
}
