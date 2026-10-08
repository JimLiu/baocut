import type { Localized } from '@baocut/protocol';
import { RcSkills } from '@baocut/protocol/messages/runtime-core';

/**
 * `SKILL.md` 的 front matter（架构设计 §3.8）：文件开头 `---` 包起来的一段 YAML。这里只读顶层的字符串字段，不引入 YAML 库：
 *
 * - `key: value`：纯量原样（去掉行尾 ` #注释`）；单引号、双引号包起来的按 YAML 的转义写法还原；
 * - `key: |` / `key: >`（可带 `-`、`+` 与缩进数字）：下面缩进的几行是块纯量，`|` 保留换行，`>` 把行折成空格；
 * - 纯量接着写在下面缩进的几行里：折成一行；
 * - 顶层键下面的嵌套映射、列表（例如 `metadata:`、`allowed-tools:`）整段跳过，值记为空串；
 * - 空行与 `#` 注释行忽略。
 *
 * 顶层出现看不懂的行时整份不合规；字段的取舍（必填、长度）由调用方决定。
 */

export type FrontmatterResult = { ok: true; fields: Map<string, string>; body: string } | { ok: false; problem: Localized };

const KEY_LINE = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)[ \t]*:(?:[ \t]+(.*)|[ \t]*)$/;
const BLOCK_HEADER = /^([|>])([+-]?)(\d?)([+-]?)[ \t]*(?:#.*)?$/;

export function parseSkillFrontmatter(raw: string): FrontmatterResult {
  const lines = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  if (lines[0]?.trimEnd() !== '---') return { ok: false, problem: RcSkills.frontmatterMissingStart() };
  const end = lines.findIndex((line, i) => i > 0 && (line.trimEnd() === '---' || line.trimEnd() === '...'));
  if (end < 0) return { ok: false, problem: RcSkills.frontmatterUnclosed() };
  const block = lines.slice(1, end);
  const fields = new Map<string, string>();
  let i = 0;
  while (i < block.length) {
    const line = block[i]!;
    if (!line.trim() || line.trimStart().startsWith('#')) {
      i++;
      continue;
    }
    if (/^[ \t]/.test(line)) {
      // 上一个键的嵌套内容（映射、列表）：不读。
      i++;
      continue;
    }
    const match = KEY_LINE.exec(line);
    if (!match) return { ok: false, problem: RcSkills.frontmatterBadLine({ line: i + 2, text: line.slice(0, 80) }) };
    const key = match[1]!;
    const rest = (match[2] ?? '').trim();
    i++;
    // 下面缩进的几行（含夹在中间的空行）归这个键。
    const start = i;
    while (i < block.length && (/^[ \t]/.test(block[i]!) || (!block[i]!.trim() && nextIndented(block, i)))) i++;
    const continuation = block.slice(start, i);
    const header = BLOCK_HEADER.exec(rest);
    if (header) {
      fields.set(key, blockScalar(continuation, header[1] as '|' | '>'));
    } else if (rest.startsWith('"')) {
      fields.set(key, doubleQuoted(rest));
    } else if (rest.startsWith("'")) {
      fields.set(key, singleQuoted(rest));
    } else if (rest === '') {
      // 值写在下一行：嵌套的映射或列表不读；缩进的纯文字折成一行。
      const nested = continuation.some((l) => /^\s*-(\s|$)/.test(l) || /^\s*[A-Za-z0-9_][\w.-]*\s*:(\s|$)/.test(l));
      fields.set(key, nested ? '' : fold(continuation.map((l) => l.trim())));
    } else {
      const plain = stripComment(rest);
      fields.set(key, continuation.length ? fold([plain, ...continuation.map((l) => stripComment(l.trim()))]) : plain);
    }
  }
  return { ok: true, fields, body: lines.slice(end + 1).join('\n') };
}

function nextIndented(block: string[], i: number): boolean {
  for (let j = i + 1; j < block.length; j++) {
    if (block[j]!.trim()) return /^[ \t]/.test(block[j]!);
  }
  return false;
}

/** 块纯量：去掉共同的缩进；`|` 保留换行，`>` 把相邻的行折成空格（空行保留为换行）。首尾空白去掉。 */
function blockScalar(lines: string[], style: '|' | '>'): string {
  const indents = lines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length);
  const indent = indents.length ? Math.min(...indents) : 0;
  const body = lines.map((l) => l.slice(indent).trimEnd());
  if (style === '|') return body.join('\n').trim();
  const out: string[] = [];
  let paragraph: string[] = [];
  for (const line of body) {
    if (line) paragraph.push(line);
    else {
      if (paragraph.length) out.push(paragraph.join(' '));
      paragraph = [];
      out.push('');
    }
  }
  if (paragraph.length) out.push(paragraph.join(' '));
  return out
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** 多行纯量：空行之间的行用空格连起来，空行变成换行。 */
function fold(lines: string[]): string {
  return blockScalar(lines, '>');
}

function stripComment(value: string): string {
  return value.replace(/[ \t]+#.*$/, '').trim();
}

function doubleQuoted(value: string): string {
  const close = findClosingQuote(value);
  const literal = close > 0 ? value.slice(0, close + 1) : value;
  try {
    const parsed: unknown = JSON.parse(literal);
    if (typeof parsed === 'string') return parsed;
  } catch {
    // YAML 的转义比 JSON 多（`\'`、`\x41`……）：解析不了时去掉引号原样用。
  }
  return literal.replace(/^"|"$/g, '');
}

function findClosingQuote(value: string): number {
  for (let i = 1; i < value.length; i++) {
    if (value[i] === '\\') i++;
    else if (value[i] === '"') return i;
  }
  return -1;
}

function singleQuoted(value: string): string {
  let out = '';
  for (let i = 1; i < value.length; i++) {
    if (value[i] === "'") {
      if (value[i + 1] === "'") {
        out += "'";
        i++;
      } else {
        return out;
      }
    } else {
      out += value[i];
    }
  }
  return out;
}
