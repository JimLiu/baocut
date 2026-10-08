import { getLocale, type Locale, type MediaHandle } from '@baocut/protocol';
import { useTemplateCatalog } from '../state/template-catalog-store.ts';
import type { RuntimeSession } from './session.ts';

/**
 * 模板目录（`templates.*`，命令与协议规范 §4.1；模板包规范 §6）的读取：目录进 state/template-catalog-store，
 * 提示词按「id@版本:语言」缓存（同一版本同一语言的正文不会再变），随附文件的句柄有期限，到期前就重新要。
 * 目录按当前界面语言要（模板包规范 §3.6）：换了界面语言后再取一次，就换成那种语言的文案。
 * 单独成文件，不把会话通道撑大（同 library-commands.ts）。
 */

type Session = Pick<RuntimeSession, 'client'>;

let listing: { language: Locale; done: Promise<void> } | null = null;
/** 同一版本的提示词不会再变：连同还在路上的请求一起记住；失败的不记，下次重取。 */
const prompts = new Map<string, Promise<string>>();
/** 文件句柄有期限：到期前 30 秒就不再用。 */
const handles = new Map<string, Promise<MediaHandle>>();
const HANDLE_MARGIN_MS = 30_000;

/**
 * 按当前界面语言取一次目录；同一语言已经在取时不重复发。旧的列表在取的过程中照常显示。
 * 取的过程中换了界面语言：旧语言的结果不再放进镜像，由新语言的那次取。
 */
export function loadTemplates(session: Session): Promise<void> {
  const language = getLocale();
  if (listing?.language === language) return listing.done;
  const store = useTemplateCatalog.getState();
  store.begin();
  const current = (): boolean => getLocale() === language;
  const done: Promise<void> = session.client
    .request('templates.list', { language })
    .then(
      (result) => {
        if (current()) useTemplateCatalog.getState().succeed(result);
      },
      (error: Error) => {
        if (current()) useTemplateCatalog.getState().fail(error.message);
      },
    )
    .finally(() => {
      if (listing?.done === done) listing = null;
    });
  listing = { language, done };
  return done;
}

/**
 * 模板的提示词（`prompt.md` 或所选语言的译文全文）。`language` 用目录里这个模板的语言（`HomeTemplate.language`），
 * 和卡片上的文案同一版本。`templates.get` 不收版本、总给当前版本，所以按读到的实际版本再记一份。
 */
export function templatePrompt(session: Session, id: string, version: string, language: string): Promise<string> {
  const key = `${id}@${version}:${language}`;
  const cached = prompts.get(key);
  if (cached) return cached;
  const pending = session.client.request('templates.get', { id, language }).then(({ template, prompt }) => {
    // 目录在两次读取之间换了版本：按实际读到的版本也记一份。
    const actual = `${id}@${template.manifest.version}:${language}`;
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
