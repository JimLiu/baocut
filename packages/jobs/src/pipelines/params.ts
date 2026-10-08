import { RpcError, type Localized } from '@baocut/protocol';
import { JobsParams } from '@baocut/protocol/messages/jobs/params.ts';
import { joinList } from '../job-text.ts';

/** 流程参数的校验：不合时一律 `invalid-request`，说明是哪个参数。 */
export class ParamReader {
  readonly #raw: Record<string, unknown>;
  readonly #known: Set<string>;

  constructor(raw: Record<string, unknown>, known: string[]) {
    this.#raw = raw;
    this.#known = new Set(known);
    for (const key of Object.keys(raw)) {
      if (!this.#known.has(key)) throw new RpcError('invalid-request', JobsParams.unknownParam({ key }));
    }
  }

  has(key: string): boolean {
    return this.#raw[key] !== undefined;
  }

  string(key: string, options: { max?: number; optional: true }): string | undefined;
  string(key: string, options?: { max?: number; optional?: false }): string;
  string(key: string, options: { max?: number; optional?: boolean } = {}): string | undefined {
    const value = this.#raw[key];
    if (value === undefined && options.optional) return undefined;
    if (typeof value !== 'string' || value.trim() === '') throw invalid(key, JobsParams.mustBeNonEmptyString());
    if (options.max !== undefined && value.length > options.max) throw invalid(key, JobsParams.atMostChars({ max: options.max }));
    return value;
  }

  int(key: string, min: number, max: number): number | undefined {
    const value = this.#raw[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      throw invalid(key, JobsParams.mustBeIntegerBetween({ min, max }));
    }
    return value;
  }

  oneOf<T extends string>(key: string, values: readonly T[]): T | undefined {
    const value = this.#raw[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !values.includes(value as T)) throw invalid(key, JobsParams.mustBeOneOf({ values: joinList(values) }));
    return value as T;
  }

  array(key: string, options: { min?: number; max: number; optional?: boolean }): unknown[] | undefined {
    const value = this.#raw[key];
    if (value === undefined && options.optional) return undefined;
    if (!Array.isArray(value)) throw invalid(key, JobsParams.mustBeArray());
    if (value.length < (options.min ?? 0)) throw invalid(key, JobsParams.atLeastItems({ min: options.min ?? 0 }));
    if (value.length > options.max) throw invalid(key, JobsParams.atMostItems({ max: options.max }));
    return value;
  }
}

/**
 * 参数 `key` 不合：「参数 key 问题」。`problem` 给目录条目（`JobsParams.mustBeBoolean()` 这类谓语：中文以「应为…」开头，
 * 英文是 `must be …`），引用随错误过线；旧的调用给字符串时照原样拼进去。说不成「参数 key 问题」的整句，直接
 * `new RpcError('invalid-request', J.x({ ... }))`。
 */
export function invalid(key: string, problem: string | Localized): RpcError {
  return new RpcError('invalid-request', JobsParams.invalidParam({ key, problem }));
}
