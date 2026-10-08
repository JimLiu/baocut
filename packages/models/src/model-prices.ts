/**
 * 用量估算的价目表（架构设计 §6.10）：按 `providerId/modelId` 给出标价，只在读用量（`models.usage`）时估算用，
 * 不写进账本，也不参与预算准入（预算读模型描述的 `ModelPrice`，§7.8；两份暂时分开）。
 *
 * 金额是十进制字符串（与 `Money` 相同，最多 6 位小数），币种原样，不换算。每个单价在注释里写明官方价目页与查阅日期；
 * 拿不准的不填——没有单价的模型估算不出，计入「未知」。
 */

export interface ModelUnitPrice {
  currency: 'USD' | 'CNY';
  /** 每百万输入 token（不含缓存命中的部分）。 */
  inputPerMTok?: string;
  /** 每百万输出 token。 */
  outputPerMTok?: string;
  /** 每百万缓存命中的输入 token；不给时这部分按 `inputPerMTok` 算。 */
  cachedPerMTok?: string;
  /** 每分钟音频（转写）。 */
  audioPerMinute?: string;
  /** 每千字符（语音合成，按 Unicode 码点）。 */
  per1kChars?: string;
  /** 每张图。 */
  perImage?: string;
}

export const MODEL_PRICES: Readonly<Record<string, ModelUnitPrice>> = {
  // Anthropic：https://platform.claude.com/docs/en/about-claude/pricing（查阅于 2026-09-25）。
  'anthropic/claude-opus-5-5': { currency: 'USD', inputPerMTok: '4', outputPerMTok: '20', cachedPerMTok: '0.2' },
  'anthropic/claude-sonnet-5-5': { currency: 'USD', inputPerMTok: '2', outputPerMTok: '10', cachedPerMTok: '0.2' },
  // 缓存读取的单价这次没有查到，不填（缓存命中的部分按输入单价算，偏高）。
  'anthropic/claude-haiku-4-5': { currency: 'USD', inputPerMTok: '1', outputPerMTok: '5' },
};

export function modelPrice(providerId: string, modelId: string): ModelUnitPrice | null {
  return MODEL_PRICES[`${providerId}/${modelId}`] ?? null;
}
