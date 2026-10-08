#!/usr/bin/env node
/**
 * Rust 一侧的消息引用（仓库约定 §5）：`message-ref` crate 的 `msg!("<区域>.<名字>", "英文模板", 参数…)` 生成英文文本与
 * 引用，译文只在 `packages/protocol/src/messages/` 的目录里。这里把 `crates/` 与 `bindings/` 里的 `msg!` 全部找出来，
 * 测试（`rust-messages.test.ts`）据此核对：每个键都在 TS 目录里，英文条目与 Rust 模板一字不差，同一个键处处同一个模板。
 *
 * 用法：`node tools/rust-messages.mjs` 列出全部键与模板（JSON）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RUST_ROOTS = ['crates', 'bindings'];
// `tests/` 是集成测试；测试里的 `msg!` 不是给人看的文字。
const SKIP_DIRS = new Set(['target', 'node_modules', 'generated', 'tests']);

/** Rust 字符串字面量的内容（只处理 `msg!` 模板会用到的转义）。 */
function unescape(body) {
  return body.replace(/\\(u\{([0-9a-fA-F]+)\}|n|t|"|\\|'|\n\s*)/g, (_, esc, hex) => {
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    if (esc === 'n') return '\n';
    if (esc === 't') return '\t';
    if (esc.startsWith('\n')) return '';
    return esc;
  });
}

const STRING = String.raw`"((?:[^"\\]|\\.)*)"`;
const MSG = new RegExp(String.raw`msg!\(\s*${STRING}\s*,\s*${STRING}`, 'gs');

/** `#[cfg(test)]` 模块所占的区间（按花括号配对，跳过字符串与字符字面量里的括号）。 */
function testRanges(source) {
  const ranges = [];
  for (const m of source.matchAll(/#\[cfg\(test\)\]\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*\{/g)) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (ch === '"') {
        for (i++; i < source.length && source[i] !== '"'; i++) if (source[i] === '\\') i++;
      } else if (ch === "'" && /^'(\\.|[^\\'])'/.test(source.slice(i, i + 4))) {
        i = source.indexOf("'", i + 2);
      } else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) break;
    }
    ranges.push([m.index, i]);
  }
  return ranges;
}

/** 一份 Rust 源码里的 `msg!` 调用：`{ key, template, line }`。注释与 `#[cfg(test)]` 模块里的不算。 */
export function messagesIn(source) {
  const found = [];
  const tests = testRanges(source);
  for (const m of source.matchAll(MSG)) {
    if (tests.some(([from, to]) => m.index >= from && m.index <= to)) continue;
    const lineStart = source.lastIndexOf('\n', m.index) + 1;
    if (source.slice(lineStart, m.index).includes('//')) continue;
    const line = source.slice(0, m.index).split('\n').length;
    found.push({ key: unescape(m[1]), template: unescape(m[2]), line });
  }
  return found;
}

/** 模板里的占位符名（`{name}`；`{{` 与 `}}` 是字面的花括号）。 */
export function placeholders(template) {
  return [...template.replace(/\{\{|\}\}/g, '').matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]);
}

function* rustFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* rustFiles(path.join(dir, entry.name));
    } else if (entry.name.endsWith('.rs')) {
      yield path.join(dir, entry.name);
    }
  }
}

/** 仓库里全部 `msg!` 调用：`{ key, template, file, line }`，`file` 相对仓库根。 */
export function rustMessages(root) {
  const all = [];
  for (const top of RUST_ROOTS) {
    const dir = path.join(root, top);
    if (!fs.existsSync(dir)) continue;
    for (const file of rustFiles(dir)) {
      const rel = path.relative(root, file);
      for (const m of messagesIn(fs.readFileSync(file, 'utf8'))) all.push({ ...m, file: rel });
    }
  }
  return all;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const byKey = new Map();
  for (const m of rustMessages(root)) if (!byKey.has(m.key)) byKey.set(m.key, m.template);
  process.stdout.write(`${JSON.stringify(Object.fromEntries(byKey), null, 2)}\n`);
}
