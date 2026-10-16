import { useEffect, useMemo, useState } from 'react';
import {
  templateBrandLogos,
  type AssetRecord,
  type Id,
  type LibraryEntrySummary,
  type TemplateLayers,
  type VersionRef,
} from '@baocut/protocol';
import { entryKey } from '../../model/library-entry.ts';
import { openLibraryHandle } from '../../runtime/library-commands.ts';
import { useRuntime } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useLibrary } from '../../state/library-store.ts';

/** 缩略图与版面编辑器画模板台标用的图片：渲染内核按来源找（视频格式规范 §3.17），这里给记着品牌库条目的素材与字节。 */
export interface TemplateLogos {
  assets: Record<Id, AssetRecord>;
  assetBytes: readonly { asset: VersionRef; bytes: Uint8Array }[];
}

type LogoFile = { entry: LibraryEntrySummary; mimeType: string; bytes: Uint8Array };

/** 读过的台标文件（键是条目与版本）：几个格子画同一张台标只读一次。 */
const files = new Map<string, Promise<LogoFile | null>>();

function readLogo(runtime: RuntimeSession, entry: LibraryEntrySummary): Promise<LogoFile | null> {
  const key = entryKey(entry);
  let pending = files.get(key);
  if (!pending) {
    pending = openLibraryHandle(runtime, { library: 'brand', id: entry.id, version: entry.version })
      .then(async (handle) => {
        const response = await fetch(handle.url);
        if (!response.ok) throw new Error(String(response.status));
        return { entry, mimeType: handle.mimeType, bytes: new Uint8Array(await response.arrayBuffer()) };
      })
      .catch(() => {
        files.delete(key);
        return null;
      });
    files.set(key, pending);
  }
  return pending;
}

/** 一张台标在缩略图里的素材：ID 按条目起，来源写成从品牌库拷来的这一条（与视频里拷进来的同一个认法）。 */
function logoAsset({ entry, mimeType, bytes }: LogoFile): { asset: VersionRef; record: AssetRecord; bytes: Uint8Array } {
  const id = `thumb_logo_${entry.id}`;
  const revision = `v${entry.version}`;
  const record = {
    id,
    kind: 'image',
    name: entry.name,
    currentRevision: revision,
    revisions: {
      [revision]: {
        revision,
        contentHash: `thumb:${entryKey(entry)}`,
        byteLength: bytes.length,
        mediaType: mimeType,
        storage: { mode: 'managed' },
        provenance: { origin: 'library', source: { library: { library: 'brand', entryId: entry.id, version: entry.version } } },
      },
    },
  } as unknown as AssetRecord;
  return { asset: { id, revision }, record, bytes };
}

/**
 * 模板里品牌库台标的图片（缩略图、版面编辑器用）：库里有的读出来；读到之前与读不到的不画（与视频里没拷进来一样）。
 * 没有图片台标、或没有用户库（Web）时是 null。同一组图片返回同一份，缩略图不因此重送序列。
 */
export function useTemplateLogos(doc: TemplateLayers | null): TemplateLogos | null {
  const runtime = useRuntime();
  const brand = useLibrary((s) => s.brand);
  const entries = useMemo(() => {
    const ids = templateBrandLogos(doc);
    return brand.filter((entry) => entry.kind === 'image' && ids.includes(entry.id));
  }, [doc, brand]);
  const signature = entries.map(entryKey).join('|');
  const [loaded, setLoaded] = useState<{ signature: string; logos: TemplateLogos | null }>({ signature: '', logos: null });
  useEffect(() => {
    if (!entries.length) return;
    let live = true;
    void Promise.all(entries.map((entry) => readLogo(runtime, entry))).then((read) => {
      if (!live) return;
      const made = read.filter((file): file is LogoFile => file !== null).map(logoAsset);
      const logos = made.length
        ? {
            assets: Object.fromEntries(made.map(({ asset, record }) => [asset.id, record])),
            assetBytes: made.map(({ asset, bytes }) => ({ asset, bytes })),
          }
        : null;
      setLoaded({ signature, logos });
    });
    return () => {
      live = false;
    };
  }, [runtime, signature]);
  return entries.length && loaded.signature === signature ? loaded.logos : null;
}
