/**
 * 「总是允许」记下的规则：命令名，加上像子命令的第二个词（`npm install`、`git status`）。
 * 带路径或参数的部分不进规则，免得一条规则只认一次性的参数。
 *
 * - 包在 shell 里的命令（Codex 常发 `/bin/zsh -lc 'npm test'`、`bash -lc "git status"`）取里面真正执行的那条。
 * - 开头的 `cd <目录> &&` 跳过：它只换工作目录。
 * - 剩下的仍是多条命令（`&&`、`||`、`;`、`|`、`&`、换行）、带重定向或命令替换（`>`、`<`、`` ` ``、`$(`）、
 *   或以 `VAR=...` 开头时给 null，不提供「总是允许」：规则只认一条命令，`npm install && rm -rf ~` 不能被 `npm install` 放行。
 */
export function commandRule(command: string): string | null {
  let words = parseSimpleCommand(command);
  for (let depth = 0; words?.length; depth++) {
    const wrapped = shellScript(words);
    if (wrapped === null) break;
    // 套了太多层、或 `-c` 后面没有脚本：认不出真正执行的是什么。
    if (wrapped === 'invalid' || depth >= 3) return null;
    words = parseSimpleCommand(wrapped.script);
  }
  const head = words?.[0];
  if (!words || !head) return null;
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(head)) return null;
  const name = head.split('/').pop()!;
  if (!name) return null;
  const sub = words[1];
  return sub && /^[a-z][\w-]*$/.test(sub) ? `${name} ${sub}` : name;
}

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);

/**
 * `<shell> [选项] -c '<脚本>'` 里的脚本（`-lc`、`-l -c`、`--login -c`、`-o pipefail -c` 都算）。
 * 不是 shell、或在第一个非选项的词（脚本文件）之前没有 `-c`：null，按普通命令处理。`-c` 后面没有脚本：`invalid`。
 */
function shellScript(words: string[]): { script: string } | 'invalid' | null {
  const name = words[0]!.split('/').pop()!;
  if (!SHELLS.has(name)) return null;
  for (let i = 1; i < words.length; i++) {
    const word = words[i]!;
    if (/^-[A-Za-z]+$/.test(word) && word.includes('c')) return i + 1 < words.length ? { script: words[i + 1]! } : 'invalid';
    if (/^[-+]o$/.test(word)) i++;
    else if (!/^(-[A-Za-z]+|--[\w-]+)$/.test(word)) return null;
  }
  return null;
}

type Token = { op: string } | { word: string };

/**
 * 把一行 shell 拆成一条简单命令的词：认单引号、双引号与反斜杠；去掉开头的 `cd <目录> &&`。
 * 还剩控制符、重定向或命令替换时为 null（见 `commandRule`）。
 */
function parseSimpleCommand(input: string): string[] | null {
  const tokens = tokenize(input);
  if (!tokens) return null;
  let start = 0;
  while (isWord(tokens[start], 'cd') && 'word' in (tokens[start + 1] ?? {}) && isOp(tokens[start + 2], '&&')) start += 3;
  const words: string[] = [];
  for (const token of tokens.slice(start)) {
    if ('op' in token) return null;
    words.push(token.word);
  }
  return words;
}

function isWord(token: Token | undefined, word: string): boolean {
  return !!token && 'word' in token && token.word === word;
}

function isOp(token: Token | undefined, op: string): boolean {
  return !!token && 'op' in token && token.op === op;
}

/** null：引号没配对，或有命令替换（不去猜它展开成什么）。 */
function tokenize(input: string): Token[] | null {
  const tokens: Token[] = [];
  let word = '';
  let inWord = false;
  const flush = () => {
    if (inWord) tokens.push({ word });
    word = '';
    inWord = false;
  };
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (c === "'") {
      const end = input.indexOf("'", i + 1);
      if (end < 0) return null;
      word += input.slice(i + 1, end);
      inWord = true;
      i = end;
    } else if (c === '"') {
      let j = i + 1;
      for (; j < input.length && input[j] !== '"'; j++) {
        if (input[j] === '`' || (input[j] === '$' && input[j + 1] === '(')) return null;
        if (input[j] === '\\' && j + 1 < input.length) {
          j++;
          if (!'"\\$`\n'.includes(input[j]!)) word += '\\';
        }
        word += input[j];
      }
      if (j >= input.length) return null;
      inWord = true;
      i = j;
    } else if (c === '\\') {
      if (i + 1 < input.length) word += input[++i];
      inWord = true;
    } else if (c === '`' || (c === '$' && input[i + 1] === '(')) {
      return null;
    } else if (c === ' ' || c === '\t') {
      flush();
    } else if ('&|;<>()\n'.includes(c)) {
      flush();
      const two = input.slice(i, i + 2);
      const op = ['&&', '||', '>>', '<<'].includes(two) ? two : c;
      tokens.push({ op });
      i += op.length - 1;
    } else {
      word += c;
      inWord = true;
    }
  }
  flush();
  return tokens;
}
