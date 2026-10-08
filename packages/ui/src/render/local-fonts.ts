import type { FontFaceQuery, FontsResolveResult } from '@baocut/protocol';
import { R } from './render-copy.ts';

/** 一次 `fonts.resolve` 最多问几个 face（与协议一致）。 */
const RESOLVE_BATCH = 32;
/** 同时按区间取几张表。 */
const FETCH_CONCURRENCY = 4;

/**
 * 一个本机字体 face：`key` 认同一个 face（几个查询落到同一个 face 时只注入一次）；`load` 重新要一次它的字节（渲染内核
 * 重新载入、缩略图的实例新建时用，界面不留字节的副本）。
 */
export interface LocalFont {
  key: string;
  load(): Promise<Uint8Array>;
}

/** 取到的 face：哪个查询要的、它是谁、字节（注入渲染内核之后就不再留着）。 */
export interface LoadedFace {
  query: FontFaceQuery;
  font: LocalFont;
  bytes: Uint8Array;
}

/**
 * 预览要的本机字体：按 face（族名、字重、斜体）给出抽好的字体字节（找不到的不给）。同一批里先到的（本机就有的、已经
 * 下载好的）经 `onPartial` 先给，不等这一批里还在下载的；先给过的不再出现在最后的结果里。
 */
export interface FontSource {
  load(faces: readonly FontFaceQuery[], onPartial?: (faces: LoadedFace[]) => void): Promise<LoadedFace[]>;
}

type ResolvedFace = FontsResolveResult['faces'][number];

/** 认同一个 face：文件名、文件字节数与文件里第几个。 */
function faceKey(face: ResolvedFace): string {
  return `${face.file.fileName}\u0000${face.fileSize}\u0000${face.faceIndex}`;
}

/**
 * 按引擎给的做法拼出这一个 face：文件头之后，每张表按区间（`Range`）从文件里取。只认 206 且字节数对得上的回应——
 * 回了整个文件（200）的不读，免得把整个字体集合拉下来。
 */
async function assemble(face: ResolvedFace, fetcher: (url: string, init?: RequestInit) => Promise<Response>): Promise<Uint8Array> {
  const out = new Uint8Array(face.size);
  const header = face.header;
  for (let i = 0; i < header.length / 2; i++) out[i] = parseInt(header.slice(i * 2, i * 2 + 2), 16);
  const tables = face.tables.filter((table) => table.length > 0);
  let next = 0;
  const worker = async () => {
    while (next < tables.length) {
      const table = tables[next++]!;
      const response = await fetcher(face.file.url, { headers: { Range: `bytes=${table.from}-${table.from + table.length - 1}` } });
      if (response.status !== 206) {
        await response.body?.cancel();
        throw new Error(R.fonts.tableFailed(response.status));
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== table.length) throw new Error(R.fonts.tableLength(table.length, bytes.length));
      out.set(bytes, table.to);
    }
  };
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, tables.length) }, worker));
  return out;
}

/**
 * 经 Runtime 的 `fonts.resolve` 取本机字体（架构设计 §9.1）：引擎按「族名、字重、斜体」挑 face（与成片导出冻结的是
 * 同一份解析与抽法），这里按读取句柄只取这个 face 的表拼成单独的字体——字体集合（一个几十 MB 的 .ttc 里有几十个
 * face）不整个下载。只要预览报缺的族里排字点了名的 face，不列字体目录。同一个 face（几个查询落到它时）只给一次。
 * 浏览器会话没有这个方法，请求被拒时当作都没有。
 */
export function runtimeFonts(
  resolve: (faces: FontFaceQuery[], onPartial?: (faces: ResolvedFace[]) => void) => Promise<FontsResolveResult>,
  fetcher: (url: string, init?: RequestInit) => Promise<Response> = (url, init) => fetch(url, init),
): FontSource {
  const given = new Set<string>();
  const font = (query: FontFaceQuery, face: ResolvedFace): LocalFont => ({
    key: faceKey(face),
    // 句柄会过期：重新要的时候重新解析一次。
    async load() {
      const { faces } = await resolve([query]);
      const again = faces.find((f) => faceKey(f) === faceKey(face));
      if (!again) throw new Error(R.fonts.localMissing(query.family));
      return assemble(again, fetcher);
    },
  });
  /** 一批 face 里还没给过的，取字节；取不到时放回去，下次还能再要。 */
  const take = async (pairs: readonly { query: FontFaceQuery; face: ResolvedFace }[]): Promise<LoadedFace[]> => {
    const fresh = pairs.filter(({ face }) => {
      const key = faceKey(face);
      if (given.has(key)) return false;
      given.add(key);
      return true;
    });
    try {
      return await Promise.all(
        fresh.map(async ({ query, face }) => ({ query, font: font(query, face), bytes: await assemble(face, fetcher) })),
      );
    } catch (error) {
      for (const { face } of fresh) given.delete(faceKey(face));
      throw error;
    }
  };
  const match = (batch: readonly FontFaceQuery[], faces: readonly ResolvedFace[]) =>
    faces.flatMap((face) => {
      const query = batch.find((q) => q.family === face.family && q.weight === face.weight && q.italic === face.italic);
      return query ? [{ query, face }] : [];
    });
  return {
    async load(queries, onPartial) {
      const found: { query: FontFaceQuery; face: ResolvedFace }[] = [];
      const early: Promise<void>[] = [];
      for (let start = 0; start < queries.length; start += RESOLVE_BATCH) {
        const batch = queries.slice(start, start + RESOLVE_BATCH);
        const partial = onPartial
          ? (faces: ResolvedFace[]) => {
              // 先到的先给；取不到的（`take` 已放回）留给最后一起再试。
              early.push(
                take(match(batch, faces)).then(
                  (loaded) => void (loaded.length && onPartial(loaded)),
                  () => {},
                ),
              );
            }
          : undefined;
        const { faces } = await resolve([...batch], partial);
        found.push(...match(batch, faces));
      }
      await Promise.all(early);
      // 这一批没取到的下次还能再要。
      return take(found);
    },
  };
}
