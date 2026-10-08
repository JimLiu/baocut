#!/usr/bin/env node
/**
 * 找出源码里还没进文案目录的中文（仓库约定 §5）：注释与正则字面量以外的 CJK 字符都算。
 *
 * 豁免：
 * - 译文文件 `*.<语言>.ts`（例如 `foo-copy.zh-Hans.ts`）、测试（`*.test.*`）与 `testing/` 目录；
 * - 该行或上一行有 `i18n-ignore`（写明理由，例如「语言的自称」「给模型的提示词」「解析中文标点」）；
 * - `i18n-ignore-start` 与 `i18n-ignore-end` 之间的行；
 * - 文件前 20 行里有 `i18n-ignore-file` 的整个文件。
 *
 * 用法：`node tools/i18n-scan.mjs [目录或文件…]`，不给时扫 `SCAN_ROOTS`。有残留时退出码 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCAN_ROOTS = ['packages', 'apps'];
const SKIP_DIRS = new Set(['node_modules', 'generated', 'testing', 'out', 'dist', 'target']);
const TRANSLATION_FILE = /\.(zh-Hans|zh-Hant|ja|ko|es|fr|de|nl|pt-BR|it|ru|pl|tr|vi)\.tsx?$/;
const CJK = /[　-〿぀-ヿ㐀-䶿一-鿿가-힯＀-￯]/;

/** 源文件里每个落在代码、字符串、模板或 JSX 文本里的 CJK 字符所在的行号（从 1 起，去重）。注释与正则字面量不算。 */
export function cjkLines(source) {
  const lines = new Set();
  let line = 1;
  let i = 0;
  const n = source.length;
  // 模板字符串里 `${` 的嵌套：栈里记每层模板开始时的花括号深度。
  const templates = [];
  let braces = 0;
  let prev = ''; // 上一个有意义的代码字符，用来区分除号与正则
  const hit = (ch) => {
    if (CJK.test(ch)) lines.add(line);
  };
  const regexAllowed = () => prev === '' || '(,=:[!&|?{};+-*%~^'.includes(prev) || /\breturn$|\btypeof$|\bcase$/.test(source.slice(Math.max(0, i - 7), i).trimEnd());

  const readString = (quote, resume = false) => {
    if (!resume) i++;
    while (i < n) {
      const ch = source[i];
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '\n') line++;
      if (ch === quote) {
        i++;
        return;
      }
      if (quote === '`' && ch === '$' && source[i + 1] === '{') {
        templates.push(braces);
        braces++;
        i += 2;
        return 'interp';
      }
      hit(ch);
      i++;
    }
  };

  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '\n') {
      line++;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (ch === '/' && regexAllowed()) {
      // 正则字面量：跳到不在字符类里的下一个 `/`。
      i++;
      let inClass = false;
      while (i < n && source[i] !== '\n') {
        const c = source[i];
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        i++;
      }
      i++;
      while (i < n && /[a-z]/i.test(source[i])) i++;
      prev = '/';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      readString(ch);
      prev = 'a';
      continue;
    }
    if (ch === '{') braces++;
    if (ch === '}') {
      braces--;
      if (templates.length && braces === templates[templates.length - 1]) {
        templates.pop();
        // 回到外层模板字符串里继续读。
        i++;
        readString('`', true);
        prev = 'a';
        continue;
      }
    }
    hit(ch);
    if (!/\s/.test(ch)) prev = ch;
    i++;
  }
  return [...lines].sort((a, b) => a - b);
}

/** 去掉豁免后剩下的行：`[{ line, text }]`。 */
export function findings(source) {
  const rows = source.split('\n');
  if (rows.slice(0, 20).some((r) => r.includes('i18n-ignore-file'))) return [];
  const ignored = new Set();
  let block = false;
  rows.forEach((r, idx) => {
    if (r.includes('i18n-ignore-start')) block = true;
    if (block || r.includes('i18n-ignore')) ignored.add(idx + 1);
    if (/i18n-ignore(?!-(start|end|file))/.test(r)) ignored.add(idx + 2);
    if (r.includes('i18n-ignore-end')) block = false;
  });
  return cjkLines(source)
    .filter((l) => !ignored.has(l))
    .map((l) => ({ line: l, text: rows[l - 1].trim() }));
}

export function isScannedFile(file) {
  const base = path.basename(file);
  if (!/\.(ts|tsx|mts|cts|js|mjs|jsx)$/.test(base)) return false;
  if (/\.test\.|\.d\.ts$/.test(base) || TRANSLATION_FILE.test(base)) return false;
  return !file.split(path.sep).some((part) => SKIP_DIRS.has(part));
}

export function* walk(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (isScannedFile(target)) yield target;
    return;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    yield* walk(path.join(target, entry.name));
  }
}

/** 扫一组路径，返回 `[{ file, line, text }]`。`apps/*` 与 `packages/*` 只看各自的 `src/`。 */
export function scan(targets, root = process.cwd()) {
  const out = [];
  for (const target of targets) {
    const abs = path.resolve(root, target);
    const dirs =
      SCAN_ROOTS.includes(target) && fs.statSync(abs).isDirectory()
        ? fs.readdirSync(abs).map((d) => path.join(abs, d, 'src')).filter((d) => fs.existsSync(d))
        : [abs];
    for (const dir of dirs) {
      for (const file of walk(dir)) {
        for (const f of findings(fs.readFileSync(file, 'utf8'))) out.push({ file: path.relative(root, file), ...f });
      }
    }
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const targets = process.argv.slice(2);
  const found = scan(targets.length ? targets : SCAN_ROOTS);
  for (const f of found) console.log(`${f.file}:${f.line}: ${f.text}`);
  const files = new Set(found.map((f) => f.file)).size;
  console.error(found.length ? `${found.length} lines in ${files} files still carry untranslated CJK text.` : 'No untranslated CJK text.');
  process.exitCode = found.length ? 1 : 0;
}
