import type { FontFaceQuery, FontsResolveResult } from '@baocut/protocol';

/** 下载中的 face 多久再问一次。 */
const POLL_MS = 1_500;
/** 最多等多久（之后照回退字体画，下次打开再要）。 */
const MAX_WAIT_MS = 10 * 60_000;

export interface DownloadWaitOptions {
  pollMs?: number;
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** 一批里先到的 face：本机就有的、已经下载好的、等的时候刚下载完的。 */
export type PartialFaces = (faces: FontsResolveResult['faces']) => void;

/**
 * 按需下载的字体（架构设计 §9.1）：包住 `fonts.resolve`，带 `download: true` 去问——字体目录里有、还没下载的 face
 * 由 Runtime 按设置开始下载，记为 `downloading`。这里隔一会儿再问那几个，直到下载结束（下好了就有，失败、取消就照
 * 回退字体画），再把结果合起来交给 `runtimeFonts`。这段时间预览照回退字体画、不报缺字体（这个 face 还在「取」）。
 * 再问时不带 `download`：只等已经开始的下载。取消不算失败、不挡自动下载，带着的话刚取消的下载会被下一次再问重新开始。
 * 同一批里先到的 face（本机就有的、已经下载好的、等的时候先下载完的）经 `onPartial` 先交出去，不等这一批里最慢的那个。
 */
export function downloadingResolve(
  request: (params: { faces: FontFaceQuery[]; download: boolean }) => Promise<FontsResolveResult>,
  options: DownloadWaitOptions = {},
): (faces: FontFaceQuery[], onPartial?: PartialFaces) => Promise<FontsResolveResult> {
  const pollMs = options.pollMs ?? POLL_MS;
  const maxWaitMs = options.maxWaitMs ?? MAX_WAIT_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return async (faces, onPartial) => {
    const first = await request({ faces, download: true });
    const found = [...first.faces];
    let missing = first.missing.filter((m) => m.reason !== 'downloading');
    let waiting: FontFaceQuery[] = first.missing
      .filter((m) => m.reason === 'downloading')
      .map(({ family, weight, italic }) => ({ family, weight, italic }));
    if (waiting.length > 0 && first.faces.length > 0) onPartial?.(first.faces);
    for (let waited = 0; waiting.length > 0 && waited < maxWaitMs; waited += pollMs) {
      await sleep(pollMs);
      const again = await request({ faces: waiting, download: false });
      found.push(...again.faces);
      missing = [...missing, ...again.missing.filter((m) => m.reason !== 'downloading')];
      waiting = again.missing.filter((m) => m.reason === 'downloading').map(({ family, weight, italic }) => ({ family, weight, italic }));
      if (waiting.length > 0 && again.faces.length > 0) onPartial?.(again.faces);
    }
    return { faces: found, missing: [...missing, ...waiting.map((face) => ({ ...face, reason: 'downloading' as const }))] };
  };
}
