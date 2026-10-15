/**
 * 界面语言（架构设计 §5.10 `ui.language`、仓库约定 §5）：界面、Runtime 与 CLI 给人看的文字共用这一套。
 *
 * - 出货语言见 `LOCALES`；英文是缺省与兜底：系统语言没有对应的出货语言时用英文，译文缺条目时回退英文。
 * - 进程里只有一个当前语言（`getLocale`）。界面按偏好与系统语言解析后 `setLocale`；Runtime 按 `ui.language` 设置；
 *   CLI 按环境。环境变量 `BAOCUT_LOCALE` 优先于一切（测试与排查用）。
 * - 文案按模块写成目录：`defineMessages(en, { 'zh-Hans': zh })`。英文目录决定键与类型，其他语言必须逐键对上；条目可以是
 *   字符串，也可以是函数（语序、单复数各语言自己处理）。返回的对象在每次读属性时取当前语言，所以**不要在模块顶层读它**
 *   （那样会把读到的文字冻结在加载时的语言里）。
 */

/** 出货语言，按设置 › 通用里语言列表的顺序（设计稿 page-settings.jsx）。 */
export const LOCALES = ['zh-Hans', 'zh-Hant', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'nl', 'pt-BR', 'it', 'ru', 'pl', 'tr', 'vi'] as const;
export type Locale = (typeof LOCALES)[number];

/** 界面语言的偏好：`system` 跟随系统，否则是一种出货语言。 */
export type LanguagePreference = 'system' | Locale;
export const LANGUAGE_PREFERENCES = ['system', ...LOCALES] as const satisfies readonly LanguagePreference[];

export const DEFAULT_LOCALE: Locale = 'en';

/** 语言的自称：不随界面语言变化。 */
export const LOCALE_NATIVE_NAMES: Readonly<Record<Locale, string>> = {
  en: 'English',
  // i18n-ignore-start: 语言的自称
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
  ja: '日本語',
  ko: '한국어',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  nl: 'Nederlands',
  'pt-BR': 'Português (BR)',
  it: 'Italiano',
  ru: 'Русский',
  pl: 'Polski',
  tr: 'Türkçe',
  vi: 'Tiếng Việt',
  // i18n-ignore-end
};

/** 给 `Intl`、React Spectrum 的 `Provider` 与 `<html lang>` 用的 BCP 47 标签。 */
export const LOCALE_TAGS: Readonly<Record<Locale, string>> = { 'zh-Hans': 'zh-CN', 'zh-Hant': 'zh-TW', en: 'en-US', ja: 'ja-JP', ko: 'ko-KR', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', nl: 'nl-NL', 'pt-BR': 'pt-BR', it: 'it-IT', ru: 'ru-RU', pl: 'pl-PL', tr: 'tr-TR', vi: 'vi-VN' };

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === 'system' || isLocale(value);
}

function shipped(code: string): Locale | null {
  return LOCALES.find((locale) => locale.toLowerCase() === code) ?? null;
}

/**
 * 一个 BCP 47 / POSIX 标签对应的出货语言；没有对应时 null。中文按文字分：写明 `Hant`，或地区是台湾、香港、澳门（`zh-TW`、
 * `zh_HK.UTF-8`）归繁体，写明 `Hans` 与其余写法归简体。葡萄牙语的各地区都归 `pt-BR`：读巴西葡语比读英文近。其余按主语言。
 */
export function localeOfTag(tag: string | null | undefined): Locale | null {
  const lower = (tag ?? '').trim().toLowerCase();
  if (!lower || lower === 'c' || lower === 'posix') return null;
  const [primary = '', ...rest] = lower.split(/[-_.@]/);
  if (primary === 'zh') {
    const traditional = !rest.includes('hans') && rest.some((part) => ['hant', 'tw', 'hk', 'mo'].includes(part));
    return (traditional ? shipped('zh-hant') : null) ?? shipped('zh-hans');
  }
  if (primary === 'pt') return shipped('pt-br');
  return shipped(primary);
}

/** 按优先顺序排好的系统语言里，第一个有出货语言的；都没有时英文。 */
export function matchLocale(tags: readonly (string | null | undefined)[]): Locale {
  for (const tag of tags) {
    const hit = localeOfTag(tag);
    if (hit) return hit;
  }
  return DEFAULT_LOCALE;
}

export function resolveLanguage(preference: LanguagePreference | null | undefined, systemTags: readonly (string | null | undefined)[]): Locale {
  return isLocale(preference) ? preference : matchLocale(systemTags);
}

/** `BAOCUT_LOCALE` 指定的语言；没设或不认识时 null。 */
export function localeOverride(): Locale | null {
  const env = typeof process === 'undefined' ? undefined : process.env?.BAOCUT_LOCALE;
  return env ? localeOfTag(env) : null;
}

/**
 * 非界面进程（Runtime、CLI）眼里的系统语言，按优先顺序：桌面端拉起 Runtime 时传的 `BAOCUT_SYSTEM_LANGUAGES`（逗号分隔，
 * 取自操作系统的首选语言）、POSIX 的 `LC_ALL` / `LC_MESSAGES` / `LANG`，最后是 `Intl` 的缺省语言。
 */
export function processLanguageTags(): string[] {
  const env = typeof process === 'undefined' ? {} : (process.env ?? {});
  const tags = (env.BAOCUT_SYSTEM_LANGUAGES ?? '').split(',').map((t) => t.trim());
  tags.push(env.LC_ALL ?? '', env.LC_MESSAGES ?? '', env.LANG ?? '');
  try {
    tags.push(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    // 没有 Intl 的环境：按上面的取。
  }
  return tags.filter(Boolean);
}

let current: Locale = localeOverride() ?? DEFAULT_LOCALE;
const listeners = new Set<(locale: Locale) => void>();

export function getLocale(): Locale {
  return current;
}

/** 换当前语言。`BAOCUT_LOCALE` 设了时以它为准，这里的取值被忽略。 */
export function setLocale(locale: Locale): void {
  const next = localeOverride() ?? locale;
  if (next === current) return;
  current = next;
  for (const listener of [...listeners]) listener(next);
}

export function onLocaleChange(listener: (locale: Locale) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 当前语言的 BCP 47 标签，给 `Intl.*`、`localeCompare` 用。 */
export function intlLocale(locale: Locale = current): string {
  return LOCALE_TAGS[locale];
}

/**
 * 按语言的复数规则挑词形，译文里带数量的句子用：`forms` 的键是 `Intl.PluralRules` 的类别，缺的类别回退 `other`。
 * 语言显式传（译文文件只属于一种语言，例如 `pluralForm('ru', n, { one: 'видео', few: …, many: …, other: … })`），不读当前语言。
 */
export function pluralForm<T>(locale: string, n: number, forms: { readonly [K in Intl.LDMLPluralRule]?: T } & { readonly other: T }): T {
  let category: Intl.LDMLPluralRule = 'other';
  try {
    category = new Intl.PluralRules(locale).select(n);
  } catch {
    // 不认识的语言标签：用 other。
  }
  return forms[category] ?? forms.other;
}

/** 除英文以外每种出货语言的译文；类型跟英文目录一致，缺键、多键都是类型错误。 */
export type Translations<T> = { readonly [L in Exclude<Locale, 'en'>]: NoInfer<T> };

/**
 * 一个模块的文案目录。返回的对象与英文目录同形，读属性时取当前语言的那一条；某语言缺这一条（只会发生在运行期拼装的目录里）
 * 时回退英文。
 */
export function defineMessages<T extends object>(en: T, translations: Translations<T>): T {
  const tables: Record<Locale, T> = { en, ...translations };
  const out = {} as T;
  for (const key of Object.keys(en) as (keyof T & string)[]) {
    Object.defineProperty(out, key, {
      enumerable: true,
      get: () => {
        const table = translationTable(tables[current]) as Partial<T> | undefined;
        return table && key in table ? table[key] : en[key];
      },
    });
  }
  return Object.freeze(out);
}

/*
 * 开发服务器按语言按需载入的译文（tools/lazy-locales.ts）：渲染页的目录模块对非英文译文文件的静态导入被改写成
 * `lazyTranslations` 登记的句柄，当前语言的在第一次渲染前取齐（`prepareLocale`），其他语言换过去之前再取。
 * 出货包、测试、Runtime 与 CLI 不改写，译文都是普通对象，`translationTable` 原样放行。
 */
const LAZY = Symbol('lazyTranslations');

interface LazySource {
  readonly locale: Locale;
  /** 译文文件的绝对路径。 */
  readonly key: string;
  readonly load: () => Promise<Record<string, unknown>>;
  module?: Record<string, unknown>;
  loading?: Promise<void>;
}

interface LazyTable {
  readonly [LAZY]: LazySource;
  readonly name: string;
}

/** 取到的译文模块，按文件记：热更新重新执行目录模块时直接用上，不必再取，也不先闪一下英文。 */
const lazyModules = new Map<string, Record<string, unknown>>();
/** 还没取到的译文文件，按语言分。 */
const lazyPending = new Map<Locale, Set<LazySource>>();

function loadSource(source: LazySource): Promise<void> {
  source.loading ??= source.load().then(
    (module) => {
      source.module = module;
      lazyModules.set(source.key, module);
      lazyPending.get(source.locale)?.delete(source);
    },
    (error: unknown) => {
      // 取不到时这一份回退英文，不让等它的一方卡住；下次准备这种语言时再取。
      source.loading = undefined;
      console.error(`[i18n] failed to load ${source.key}`, error);
    },
  );
  return source.loading;
}

/**
 * 插件生成的代码调用：登记一个译文文件，返回它导出的各张译文表的句柄（与 `names` 一一对应）。当前语言的立即开始取，
 * 所以入口等齐之后才执行的目录（懒加载的模块、热更新）也不会漏掉。
 */
export function lazyTranslations(locale: Locale, key: string, load: () => Promise<Record<string, unknown>>, names: readonly string[]): unknown[] {
  const source: LazySource = { locale, key, load, module: lazyModules.get(key) };
  if (!source.module) {
    let pending = lazyPending.get(locale);
    if (!pending) lazyPending.set(locale, (pending = new Set()));
    pending.add(source);
    if (locale === current) void loadSource(source);
  }
  return names.map((name): LazyTable => ({ [LAZY]: source, name }));
}

/** 这种语言的译文是否都已取到。出货包里总是。 */
export function isLocaleReady(locale: Locale): boolean {
  return !lazyPending.get(locale)?.size;
}

/** 取齐一种语言的译文；出货包里立即完成。取不到的那几份回退英文。 */
export function prepareLocale(locale: Locale): Promise<void> {
  const pending = lazyPending.get(locale);
  if (!pending?.size) return Promise.resolve();
  return Promise.all([...pending].map(loadSource)).then(() => undefined);
}

/** 目录里一种语言的译文表：按需载入的取载入的那份，还没取到时 undefined（读的一方回退英文）。 */
export function translationTable<T>(table: T): T | undefined {
  if (typeof table !== 'object' || table === null || !(LAZY in table)) return table;
  const { [LAZY]: source, name } = table as unknown as LazyTable;
  return source.module?.[name] as T | undefined;
}

/**
 * 只给了部分语言的译文：测试里的临时目录用，缺的语言在运行期回退英文。出货的目录不要用它，缺一种语言应当是类型错误。
 */
export function partialTranslations<T>(translations: Partial<Translations<T>>): Translations<T> {
  return translations as Translations<T>;
}

/**
 * 把「每次读都要取当前语言」的对象包成一个稳定的引用：模块想保留旧的具名导出（例如 `Record<Mode, string>`）时用，
 * `export const MODE_LABEL = live(() => M.modeLabel)`。只转发读，不支持写。
 */
export function live<T extends object>(read: () => T): T {
  return new Proxy({} as T, {
    get: (_, key) => Reflect.get(read(), key),
    has: (_, key) => Reflect.has(read(), key),
    ownKeys: () => Reflect.ownKeys(read()),
    getOwnPropertyDescriptor: (_, key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(read(), key);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
  });
}
