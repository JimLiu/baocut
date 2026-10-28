/** Hugging Face 上一个文件的地址（`models.add` 的 `repo-file`）。 */
export type HfFileAddress =
  | { ok: true; repo: string; revision: string; path: string }
  | { ok: false; code: 'empty' | 'not-hf' | 'not-gguf' };

/**
 * 认 Hugging Face 上一个 GGUF 文件的地址：网页地址（`https://huggingface.co/<owner>/<repo>/blob|resolve/<版本>/<路径>`，`hf.co`
 * 也认），或 `<owner>/<repo>/<路径>`（版本是 `main`）。别的网站的地址、只到仓库的地址是 `not-hf`；不是 `.gguf` 的是 `not-gguf`。
 */
export function parseHfFileAddress(input: string): HfFileAddress {
  let s = input.trim();
  if (!s) return { ok: false, code: 'empty' };
  let revision = 'main';
  const url = /^https?:\/\/(?:www\.)?(?:huggingface\.co|hf\.co)\/(.+)$/i.exec(s);
  if (/^https?:\/\//i.test(s) && !url) return { ok: false, code: 'not-hf' };
  if (url) {
    const m = /^([^/]+\/[^/]+)\/(?:blob|resolve)\/([^/]+)\/(.+)$/.exec(url[1]!.split(/[?#]/)[0]!);
    if (!m) return { ok: false, code: 'not-hf' };
    s = `${m[1]}/${m[3]}`;
    revision = decode(m[2]!);
  }
  const parts = s.split('/').filter(Boolean);
  if (parts.length < 3 || parts.some((p) => p === '.' || p === '..')) return { ok: false, code: 'not-hf' };
  const path = parts.slice(2).map(decode).join('/');
  if (!/\.gguf$/i.test(path)) return { ok: false, code: 'not-gguf' };
  return { ok: true, repo: `${parts[0]}/${parts[1]}`, revision, path };
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}
