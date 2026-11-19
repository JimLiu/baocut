/*
 * 部分机制移植自 paseo（Apache-2.0，Copyright (c) 2025-present Mohamed Boudra），modified：
 * packages/server/src/server/agent/providers/jsonl-frame-decoder.ts 的分行（只按 LF 切、去掉行尾 CR、单行上限）与
 * codex/app-server-transport.ts 不用 readline 的理由（U+2028 / U+2029）。改成按字符计的上限与回调式接口。
 */
import { StringDecoder } from 'node:string_decoder';

/** 单行上限（UTF-16 字符数）。远低于 V8 的字符串上限，超过时由调用方结束进程，而不是在 data 回调里抛 RangeError。 */
export const JSONL_MAX_LINE_CHARS = 64 * 1024 * 1024;

export interface JsonlLineReaderOptions {
  /** 每读到一行非空内容调用一次（已去掉行尾 CR）。 */
  onLine: (line: string) => void;
  /** 一行超过上限时调用一次；之后的输出全部丢弃。 */
  onOverflow: (chars: number) => void;
  maxLineChars?: number;
}

/**
 * stdout 上「每行一个 JSON」的分行器。
 *
 * - 只认 LF：JSON 字符串里可以原样出现 U+2028 / U+2029，Node 的 readline 会在那里把一条消息切成两半。
 * - Buffer 块经 StringDecoder 解码，跨块的多字节字符不会被切坏；已经 `setEncoding` 的字符串块原样使用。
 * - 只在新到的块里找换行，长行分很多块到达时不会反复扫描已经攒下的部分。
 */
export class JsonlLineReader {
  readonly #onLine: (line: string) => void;
  readonly #onOverflow: (chars: number) => void;
  readonly #max: number;
  readonly #decoder = new StringDecoder('utf8');
  #partial = '';
  #overflowed = false;

  constructor(options: JsonlLineReaderOptions) {
    this.#onLine = options.onLine;
    this.#onOverflow = options.onOverflow;
    this.#max = options.maxLineChars ?? JSONL_MAX_LINE_CHARS;
  }

  push(chunk: Buffer | string): void {
    if (this.#overflowed) return;
    let text = typeof chunk === 'string' ? chunk : this.#decoder.write(chunk);
    let newline = text.indexOf('\n');
    while (newline !== -1) {
      const line = this.#partial + text.slice(0, newline);
      this.#partial = '';
      text = text.slice(newline + 1);
      if (line.length > this.#max) {
        this.#overflow(line.length);
        return;
      }
      this.#emit(line);
      if (this.#overflowed) return;
      newline = text.indexOf('\n');
    }
    if (this.#partial.length + text.length > this.#max) {
      this.#overflow(this.#partial.length + text.length);
      return;
    }
    this.#partial += text;
  }

  /** 流结束：最后一段没有换行的内容也当作一行。 */
  end(): void {
    if (this.#overflowed) return;
    const rest = this.#partial + this.#decoder.end();
    this.#partial = '';
    if (rest) this.#emit(rest);
  }

  #emit(line: string): void {
    const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (trimmed.trim()) this.#onLine(trimmed);
  }

  #overflow(chars: number): void {
    this.#overflowed = true;
    this.#partial = '';
    this.#onOverflow(chars);
  }
}
