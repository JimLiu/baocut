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
import { fileLogoAsset, templateFileLogos } from '@baocut/protocol';
import { ToastQueue } from '@react-spectrum/s2';
import { isDefaultStyleName } from '../../model/caption-presets.ts';
import { BRAND_SECTIONS, assetLibrarySource, captionStyleProblem, clipBrandName } from '../../model/library-brand.ts';
import { libraryErrorText } from '../../model/library-entry.ts';
import { definitionOf } from '../../model/template-layers.ts';
import { getLibraryEntry, putLibraryEntry } from '../../runtime/library-commands.ts';
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
    // 定义里的 ID 只是占位：目录按条目 ID 摆（`brandTemplateDoc`）。按路径引用的台标换成品牌库的图片。
    const template = definitionOf(await brandLogosForFiles(runtime, doc), clipped, same?.id ?? doc.id);
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
    const template = definitionOf(await brandLogosForFiles(runtime, doc), clipped, entryId);
    await putLibraryEntry(runtime, { library: 'brand', id: entryId, content: { name: clipped, kind: 'overlayTemplate', template } });
    ToastQueue.positive(TC.brandUpdated(clipped), { timeout: 4000 });
    return true;
  } catch (error) {
    ToastQueue.negative(TC.saveFailed(error instanceof Error ? error.message : String(error)), { timeout: 6000 });
    return false;
  }
}

/**
 * 模板里按路径引用的台标（`{ file }`）换成品牌库的图片（`{ brandLogo }`）：存进品牌库的模板要能套到别的项目里，
 * 项目里的相对路径到了别处就找不到了。视频里登记了的那张图（视频格式规范 §3.17）存进品牌库，库里已经有同一张图片
 * （文件摘要相同）就用那一条；没登记的（文件不在了）照旧留着路径。
 */
export async function brandLogosForFiles(runtime: RuntimeSession, template: TemplateLayers): Promise<TemplateLayers> {
  const files = templateFileLogos(template);
  if (!files.length) return template;
  const assets = useVideo.getState().video?.state?.video.assets ?? {};
  const known = new Map<string, Id>();
  const replaced = new Map<string, Id>();
  for (const file of files) {
    const ref = fileLogoAsset(assets, file);
    const asset = ref ? assets[ref.id] : undefined;
    const revision = asset?.revisions[asset.currentRevision];
    if (!asset || !revision) continue;
    const existing = await brandImageWithHash(runtime, revision.contentHash, known);
    if (existing) {
      replaced.set(file, existing);
      continue;
    }
    const source = assetLibrarySource(asset);
    if (!('source' in source)) continue;
    const name = clipBrandName(asset.name) || IB.untitled;
    const { entry } = await putLibraryEntry(runtime, { library: 'brand', content: { name, kind: 'image' }, source: source.source });
    replaced.set(file, entry.id);
  }
  if (!replaced.size) return template;
  return {
    ...template,
    layers: template.layers.map((layer) => {
      if (layer.kind !== 'logo' || !layer.src || typeof layer.src !== 'object' || !('file' in layer.src)) return layer;
      const id = replaced.get(layer.src.file);
      return id ? { ...layer, src: { brandLogo: id } } : layer;
    }),
  };
}

/** 品牌库里文件摘要是 `sha256` 的图片条目；`known` 记着读过的条目的摘要，一次存几张台标只读一遍。 */
async function brandImageWithHash(runtime: RuntimeSession, sha256: string, known: Map<string, Id>): Promise<Id | null> {
  if (!known.size) {
    for (const summary of useLibrary.getState().brand.filter((entry) => entry.kind === 'image')) {
      try {
        const entry = await getLibraryEntry(runtime, summary);
        if ('file' in entry.content) known.set(entry.content.file.sha256, entry.id);
      } catch {
        // 读不到的条目当作没有。
      }
    }
  }
  return known.get(sha256) ?? null;
}
