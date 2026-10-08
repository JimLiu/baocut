/**
 * 测试用：Speech Worker（字幕与翻译核心）发给文本模型的请求的假答案。请求走文件契约：要改写的载体包在
 * `<BEGIN INPUT name="<kind>.src.<ext>">` 里，翻译页是 `<section>` 里一句一个 `<p id="<句子 ID>">`。
 * 翻译页按句回一个答案（带对齐分组的按组写行），别的请求（译向简报等）回一个不合格的答案，让核心走自己的降级。
 */

interface Tag {
  open: string;
  inner: string;
}

function tags(html: string, name: string): Tag[] {
  const out: Tag[] = [];
  let rest = html;
  for (;;) {
    const start = rest.indexOf(`<${name} `);
    if (start < 0) return out;
    const after = rest.slice(start);
    const openEnd = after.indexOf('>');
    const close = after.indexOf(`</${name}>`);
    out.push({ open: after.slice(0, openEnd), inner: after.slice(openEnd + 1, close) });
    rest = after.slice(close + name.length + 3);
  }
}

function attr(open: string, name: string): string | null {
  const match = new RegExp(` ${name}="([^"]*)"`).exec(open);
  return match ? match[1]!.replaceAll('&quot;', '"').replaceAll('&amp;', '&') : null;
}

/** 请求的种类（`translate`、`brief`……）；不是文件契约的请求时 null。 */
export function speechRequestKind(user: string): string | null {
  return /<BEGIN INPUT name="([a-z-]+)\.src\./.exec(user)?.[1] ?? null;
}

/** 翻译页里要翻译的句子 ID（可编辑的 `<p>`）。 */
export function requestedSentences(user: string): string[] {
  return tags(user, 'section')
    .flatMap((section) => tags(section.inner, 'p'))
    .filter((p) => attr(p.open, 'data-editable') !== 'false')
    .map((p) => attr(p.open, 'id')!);
}

/**
 * 假答案。`line(sentenceId, group)` 给出一句（带对齐分组时是第 `group` 组）的译文；不给时按目标语言写一句各不相同的话
 * （核心的质量门会退回整页都一样的短译文与语言不对的译文）。
 */
export function fakeSpeechAnswer(user: string, line?: (sentenceId: string, group: number) => string): string {
  if (speechRequestKind(user) !== 'translate') return '<article></article>';
  const chinese = /data-target="(zh|ja)/.test(user);
  let ordinal = 0;
  const text = (id: string, group: number) => {
    if (line) return line(id, group);
    ordinal++;
    return chinese ? `好的，第${ordinal}句。` : `This is line ${ordinal}.`;
  };
  let out = '<article>';
  for (const section of tags(user, 'section')) {
    out += `<section id="${attr(section.open, 'id')}">`;
    for (const p of tags(section.inner, 'p')) {
      if (attr(p.open, 'data-editable') === 'false') continue;
      const id = attr(p.open, 'id')!;
      out += `<p id="${id}">`;
      const groups = attr(p.open, 'data-align-groups');
      const words = attr(p.open, 'data-align-words');
      if (groups)
        out += groups
          .split(';')
          .map((group, i) => `<span data-src="${group.split('@')[0]}">${text(id, i)}</span>`)
          .join('');
      else if (words) out += `<span data-src="1-${words.split('[').length - 1}">${text(id, 0)}</span>`;
      else out += text(id, 0);
      out += '</p>';
    }
    out += '</section>';
  }
  return `${out}</article>`;
}
