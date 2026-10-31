// i18n-ignore-file: 给模型的工具错误
import { BOT_LIMITS, type WorkItemQuestion } from '@baocut/protocol';
import { ToolError } from '../agent-tools/tool-catalog.ts';

/*
 * Bot 的文字校验（技术方案 §10.4、§5.4、§10.5）：任务文字里不放链接与号码，记忆里不放密钥，相似的任务报给协调者。
 * 都是纯函数，工具与 RPC 共用。
 */

const URL_PATTERN = /\bhttps?:\/\/|\bwww\./i;
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/;
/** 连续 11 位以上的数字（手机号、卡号、证件号的长度）；中间夹空格或连字符的也算。日期（8 位）与短编号不受影响。 */
const LONG_NUMBER = /(?:\d[\s-]?){11,}/;

/** 任务文字（标题、描述、步骤、更新、问题、提示）里有没有链接、邮箱或长号码。 */
export function hasLinkOrNumber(text: string): boolean {
  return URL_PATTERN.test(text) || EMAIL_PATTERN.test(text) || LONG_NUMBER.test(text.replace(/\d{4}-\d{2}-\d{2}/g, ''));
}

/** 工具层的校验：有就拒绝，提示放进 resources。 */
export function assertPlainText(...texts: (string | null | undefined)[]): void {
  for (const text of texts) {
    if (text && hasLinkOrNumber(text)) {
      throw new ToolError('INVALID_TEXT', 'Do not put links, email addresses or long numbers in task text. Use resources for links and files.');
    }
  }
}

/** 超长报错，不截断（§10.4）。 */
export function assertMax(field: string, text: string | null | undefined, max: number): void {
  if (text && [...text].length > max) throw new ToolError('TEXT_TOO_LONG', `${field} is longer than ${max} characters. Shorten it.`, { field, max });
}

/** 问题的规则：risky 时不推荐（§10.4）。 */
export function assertQuestion(question: WorkItemQuestion | null | undefined): void {
  if (!question) return;
  assertMax('question.text', question.text, BOT_LIMITS.questionText);
  assertPlainText(question.text, ...question.options.map((o) => o.label), ...question.options.map((o) => o.description));
  if (question.options.length > BOT_LIMITS.questionOptions) throw new ToolError('TOO_MANY_OPTIONS', `At most ${BOT_LIMITS.questionOptions} options.`);
  if (question.pick !== null && (question.pick < 0 || question.pick >= question.options.length)) {
    throw new ToolError('INVALID_PICK', 'pick must be the index of one of the options.');
  }
  if (question.risky && question.pick !== null) {
    throw new ToolError('RISKY_PICK', 'This step spends money, sends something out or cannot be undone: do not recommend an option. Set pick to null.');
  }
}

/** 记忆里的敏感内容（§5.4）：命中返回原因，没有返回 null。 */
export function sensitiveMemory(content: string): string | null {
  if (LONG_NUMBER.test(content.replace(/\d{4}-\d{2}-\d{2}/g, ''))) return 'long-number';
  if (/\b(sk-[A-Za-z0-9_-]{8,}|AKIA[0-9A-Z]{8,}|ghp_[A-Za-z0-9]{8,}|xox[abprs]-[A-Za-z0-9-]{6,})/.test(content)) return 'api-key';
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content)) return 'private-key';
  // 「密码」「口令」「password」「passcode」后面紧跟冒号与非空字段。
  if (/(?:password|passcode|passwd|密码|口令)\s*[:=：]\s*\S+/i.test(content)) return 'password';
  return null;
}

/** UTF-8 字节数。 */
export function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/** 字符 3-gram 的 Jaccard 相似度（§10.5）。短于 3 个字的按整段比。 */
export function trigramJaccard(a: string, b: string): number {
  const grams = (text: string) => {
    const chars = [...text.toLowerCase().replace(/\s+/g, ' ').trim()];
    const set = new Set<string>();
    if (chars.length < 3) {
      if (chars.length) set.add(chars.join(''));
      return set;
    }
    for (let i = 0; i + 3 <= chars.length; i++) set.add(chars.slice(i, i + 3).join(''));
    return set;
  };
  const x = grams(a);
  const y = grams(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const g of x) if (y.has(g)) shared++;
  return shared / (x.size + y.size - shared);
}

/** 第一句（≤ max 字）：兜底报告的 headline 用（§7.4）。 */
export function firstSentence(text: string, max: number = BOT_LIMITS.headline): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const match = /^(.+?[.!?。！？])(\s|$)/.exec(flat);
  const sentence = match ? match[1]! : flat;
  const chars = [...sentence];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : sentence;
}

/** 截成至多 n 个字，超出时加省略号。 */
export function clip(text: string, max: number): string {
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text;
}

/**
 * 用户写的文字主要是什么语言（Runtime 自己写的文字用它，BH-10）：只认一种文字系统就能确定的语言。
 * 拉丁、西里尔等文字被许多语言共用，单看字母分不出英语还是西班牙语，返回 null，由模型照消息本身判断，不假定英语。
 */
export function guessLanguage(texts: readonly string[]): string | null {
  const sample = texts.join(' ').slice(-2000);
  if (!sample.trim()) return null;
  const count = (re: RegExp) => (sample.match(re) ?? []).length;
  const kana = count(/[぀-ヿ]/g);
  const hangul = count(/[가-힯]/g);
  const han = count(/[一-鿿]/g);
  const latin = count(/[A-Za-z]/g);
  if (kana > 5) return 'ja';
  if (hangul > 5) return 'ko';
  // 汉字不分简繁：只说是中文，书写形式由模型照消息决定。
  if (han > latin / 3 && han > 3) return 'zh';
  return null;
}
