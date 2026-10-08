import type { MediaHandle } from '@baocut/protocol';
import { useTemplateCatalog } from '../state/template-catalog-store.ts';
import type { RuntimeSession } from './session.ts';

/**
 * 模板目录（`templates.*`，命令与协议规范 §4.1；模板包规范 §6）的读取：目录进 state/template-catalog-store，
 * 提示词按「id@版本」缓存（同一版本的正文不会再变），随附文件的句柄有期限，到期前就重新要。
 * 单独成文件，不把会话通道撑大（同 library-commands.ts）。
 */

type Session = Pick<RuntimeSession, 'client'>;

let listing: Promise<void> | null = null;
/** 同一版本的提示词不会再变：连同还在路上的请求一起记住；失败的不记，下次重取。 */
const prompts = new Map<string, Promise<string>>();
/** 文件句柄有期限：到期前 30 秒就不再用。 */
const handles = new Map<string, Promise<MediaHandle>>();
const HANDLE_MARGIN_MS = 30_000;

/** 取一次目录；已经在取时不重复发。旧的列表在取的过程中照常显示。 */
export function loadTemplates(session: Session): Promise<void> {
  if (listing) return listing;
  const store = useTemplateCatalog.getState();
  store.begin();
  listing = session.client
    .request('templates.list', {})
    .then(
      (result) => useTemplateCatalog.getState().succeed(result),
      (error: Error) => useTemplateCatalog.getState().fail(error.message),
    )
    .finally(() => {
      listing = null;
    });
  return listing;
}

/** 模板的提示词（`prompt.md` 全文）。`templates.get` 只收 id、总给当前版本，所以按读到的实际版本再记一份。 */
export function templatePrompt(session: Session, id: string, version: string): Promise<string> {
  const key = `${id}@${version}`;
  const cached = prompts.get(key);
  if (cached) return cached;
  const pending = session.client.request('templates.get', { id }).then(({ template, prompt }) => {
    // 目录在两次读取之间换了版本：按实际读到的版本也记一份。
    const actual = `${id}@${template.manifest.version}`;
    if (actual !== key) prompts.set(actual, Promise.resolve(prompt));
    return prompt;
  });
  prompts.set(key, pending);
  pending.catch(() => prompts.delete(key));
  return pending;
}

/** 清单登记的随附文件（`cover.file`、`preview.file`、`assets[].path`）的媒体地址。 */
export function templateFileUrl(session: Session, id: string, path: string): Promise<string> {
  const key = `${id}:${path}`;
  const cached = handles.get(key);
  if (cached) return cached.then((handle) => (fresh(handle) ? handle.url : renew()));
  return renew();

  function renew(): Promise<string> {
    const pending = session.client.request('templates.openHandle', { id, path });
    handles.set(key, pending);
    pending.catch(() => handles.delete(key));
    return pending.then((handle) => handle.url);
  }
}

function fresh(handle: MediaHandle): boolean {
  return Date.parse(handle.expiresAt) - Date.now() > HANDLE_MARGIN_MS;
}

/** 文件取不到了（媒体元素报错、Runtime 重启）：丢掉这个句柄，下次重新要。 */
export function forgetTemplateFile(id: string, path: string): void {
  handles.delete(`${id}:${path}`);
}

/** 测试用：清掉进行中的请求与缓存。 */
export function resetTemplateCommands(): void {
  listing = null;
  prompts.clear();
  handles.clear();
}
