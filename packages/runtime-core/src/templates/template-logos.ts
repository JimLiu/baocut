import fs from 'node:fs/promises';
import path from 'node:path';
import {
  TEMPLATE_LOGO_ORIGIN,
  brandLogoAsset,
  fileLogoAsset,
  templateBrandLogos,
  templateFileLogos,
  type EditOperation,
  type TemplateLayers,
  type VideoRef,
} from '@baocut/protocol';
import type { OperationPreparer, VideoService } from '../videos/video-service.ts';

/** 品牌库一张图片台标导入成素材要的东西（`LibraryService.pinBrandLogos`）。 */
export interface BrandLogoImport {
  path: string;
  name: string;
  provenance: { origin: string; source: unknown };
}

export interface TemplateLogoOptions {
  videos: Pick<VideoService, 'mirror' | 'ref'>;
  /** 品牌库：固定住这些图片条目、给出导入用的路径与来源，写完之后 `release`。库里没有的不给。 */
  brand: { pinBrandLogos(ids: readonly string[]): { logos: Map<string, BrandLogoImport>; release: () => Promise<void> } } | null;
}

/** 按路径引用的台标只收这些图片。 */
const LOGO_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
/** 补上的导入用的 `ref` 前缀：不和调用方自己的 `ref` 撞。 */
const REF_PREFIX = 'baocut-template-logo-';

/**
 * 模板台标的素材登记（视频格式规范 §3.17「用到时按素材登记」）：写模板（`setTemplate`）时，台标用到、视频里还没有的图片
 * 在同一笔事务里导入，一步撤销。品牌库的图片（`{ brandLogo }`）从库里拷进来（`managed`，来源记着库条目）；项目里的文件
 * （`{ file }`，相对来源目录）按路径链接（`linked`，来源 `template-logo` 记着路径）。库里已经没有的、项目外的、不在了的
 * 与不是图片的不导入，画的时候报出来，模板照写。
 */
export function templateLogoPreparer(options: TemplateLogoOptions): OperationPreparer {
  return async (videoId, operations) => {
    const templates = operations.flatMap((op) => (op.type === 'setTemplate' && op.template ? [op.template as TemplateLayers] : []));
    if (!templates.length) return null;
    const assets = options.videos.mirror(videoId)?.video.assets ?? {};
    const brandIds = unique(templates.flatMap(templateBrandLogos)).filter((id) => !brandLogoAsset(assets, id));
    const files = unique(templates.flatMap(templateFileLogos)).filter((file) => !fileLogoAsset(assets, file));
    if (!brandIds.length && !files.length) return null;

    const taken = new Set(operations.flatMap((op) => ('ref' in op && typeof op.ref === 'string' ? [op.ref] : [])));
    let next = 0;
    const ref = () => {
      while (taken.has(`${REF_PREFIX}${next}`)) next += 1;
      const value = `${REF_PREFIX}${next}`;
      taken.add(value);
      return value;
    };

    const imports: EditOperation[] = [];
    const pinned = brandIds.length && options.brand ? options.brand.pinBrandLogos(brandIds) : null;
    try {
      for (const id of brandIds) {
        const logo = pinned?.logos.get(id);
        if (!logo) continue;
        imports.push({
          type: 'importAsset',
          path: logo.path,
          name: logo.name,
          ref: ref(),
          storage: 'managed',
          provenance: logo.provenance,
        });
      }
      const root = files.length ? sourceRoot(options.videos.ref(videoId)) : null;
      for (const file of files) {
        const located = root ? await locateLogoFile(root, file) : null;
        if (!located) continue;
        imports.push({
          type: 'importAsset',
          path: located,
          name: path.posix.basename(file),
          ref: ref(),
          storage: 'linked',
          provenance: { origin: TEMPLATE_LOGO_ORIGIN, source: { templateLogo: { file } } },
        });
      }
    } catch (error) {
      await pinned?.release();
      throw error;
    }
    if (!imports.length) {
      await pinned?.release();
      return null;
    }
    return { operations: [...imports, ...operations], ...(pinned ? { release: pinned.release } : {}) };
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** 视频所在的来源目录（项目，或会话的工作目录）：视频目录去掉相对来源目录的那段。 */
export function sourceRoot(ref: VideoRef | null): string | null {
  if (!ref) return null;
  const segments = ref.relPath.split('/').filter((segment) => segment && segment !== '.');
  return segments.length ? path.resolve(ref.path, ...segments.map(() => '..')) : path.resolve(ref.path);
}

/** 按路径引用的台标文件的绝对路径：解开链接后还在来源目录里、是图片文件。不是的 null。 */
export async function locateLogoFile(root: string, file: string): Promise<string | null> {
  if (!LOGO_EXTENSIONS.has(path.extname(file).toLowerCase())) return null;
  try {
    const realRoot = await fs.realpath(root);
    const real = await fs.realpath(path.resolve(root, ...file.split(/[\\/]/)));
    const rel = path.relative(realRoot, real);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return (await fs.stat(real)).isFile() ? real : null;
  } catch {
    return null;
  }
}
