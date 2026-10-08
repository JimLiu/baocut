import { describe, expect, it } from 'vitest';
import { advanceCut, closeStreamingTail, revealStep, safeCut, splitBlocks } from './agent-stream.ts';

describe('revealStep', () => {
  it('与积压成正比，下限 1、上限 backlog', () => {
    expect(revealStep({ backlog: 300, elapsedMs: 16 })).toBe(32);
    expect(revealStep({ backlog: 30, elapsedMs: 16 })).toBe(4);
    expect(revealStep({ backlog: 3, elapsedMs: 1 })).toBe(1);
    expect(revealStep({ backlog: 0, elapsedMs: 16 })).toBe(0);
    expect(revealStep({ backlog: 5, elapsedMs: 0 })).toBe(1);
  });

  it('elapsed 不短于 horizon 时全部放出；先夹到 250ms', () => {
    expect(revealStep({ backlog: 120, elapsedMs: 150 })).toBe(120);
    expect(revealStep({ backlog: 120, elapsedMs: 5000 })).toBe(120);
    expect(revealStep({ backlog: 1000, elapsedMs: 5000, horizonMs: 500 })).toBe(500);
    expect(revealStep({ backlog: 100, elapsedMs: 50, horizonMs: 100 })).toBe(50);
  });
});

describe('safeCut / advanceCut', () => {
  it('切点拉回字素簇起点', () => {
    const s = 'a👍🏽b';
    expect(safeCut(s, 2)).toBe(1);
    expect(safeCut(s, 3)).toBe(1);
    expect(safeCut(s, 5)).toBe(5);
    expect(safeCut('中文', 1)).toBe(1);
    expect(safeCut('abc', 0)).toBe(0);
    expect(safeCut('abc', 99)).toBe(3);
  });

  it('没有 Intl.Segmenter 时原样返回', () => {
    const intl = Intl as { Segmenter?: unknown };
    const saved = intl.Segmenter;
    try {
      intl.Segmenter = undefined;
      expect(safeCut('a👍🏽b', 2)).toBe(2);
    } finally {
      intl.Segmenter = saved;
    }
    expect(safeCut('a👍🏽b', 2)).toBe(1);
  });

  it('落在簇中间也至少前进一整个簇', () => {
    const s = 'a👍🏽b';
    expect(advanceCut(s, 1, 1)).toBe(5);
    expect(advanceCut(s, 0, 1)).toBe(1);
    expect(advanceCut(s, 5, 10)).toBe(6);
    expect(advanceCut(s, 6, 3)).toBe(6);
  });
});

describe('splitBlocks', () => {
  it('空行分块，块尾空行不算', () => {
    expect(splitBlocks('第一段\n\n第二段\n\n')).toEqual(['第一段', '第二段']);
    expect(splitBlocks('# 标题\n正文')).toEqual(['# 标题\n正文']);
    expect(splitBlocks('')).toEqual([]);
  });

  it('围栏代码块里的空行不拆', () => {
    const md = '说明\n\n```sh\necho a\n\necho b\n```\n\n结尾';
    expect(splitBlocks(md)).toEqual(['说明', '```sh\necho a\n\necho b\n```', '结尾']);
    // 没闭合的围栏：后面全归它。
    expect(splitBlocks('```\na\n\nb')).toEqual(['```\na\n\nb']);
  });

  it('列表内部的空行不拆', () => {
    const md = '- 第一项\n\n- 第二项\n\n  续行\n\n之后的段落';
    expect(splitBlocks(md)).toEqual(['- 第一项\n\n- 第二项\n\n  续行', '之后的段落']);
    expect(splitBlocks('1. 一\n\n2. 二')).toEqual(['1. 一\n\n2. 二']);
  });
});

describe('closeStreamingTail', () => {
  it('补上没闭合的加粗、斜体、删除线与行内代码', () => {
    expect(closeStreamingTail('正在 **加')).toBe('正在 **加**');
    expect(closeStreamingTail('*斜')).toBe('*斜*');
    expect(closeStreamingTail('~~删')).toBe('~~删~~');
    expect(closeStreamingTail('运行 `bcut in')).toBe('运行 `bcut in`');
    expect(closeStreamingTail('**先跑 `bcut')).toBe('**先跑 `bcut`**');
    // 收尾标记写到一半：补成完整的。
    expect(closeStreamingTail('**加粗*')).toBe('**加粗**');
  });

  it('末尾孤零零的标记去掉', () => {
    expect(closeStreamingTail('接着 **')).toBe('接着 ');
    expect(closeStreamingTail('接着 *')).toBe('接着 ');
    expect(closeStreamingTail('接着 ~')).toBe('接着 ');
    expect(closeStreamingTail('接着 _')).toBe('接着 ');
    expect(closeStreamingTail('接着 `')).toBe('接着 ');
    expect(closeStreamingTail('snake_case')).toBe('snake_case');
  });

  it('已配对的不重复补', () => {
    expect(closeStreamingTail('一段 **加粗** 和 `代码`')).toBe('一段 **加粗** 和 `代码`');
    expect(closeStreamingTail('**加粗**')).toBe('**加粗**');
    expect(closeStreamingTail('2 * 3 = 6')).toBe('2 * 3 = 6');
    expect(closeStreamingTail('* 列表项\n* 第二项')).toBe('* 列表项\n* 第二项');
    expect(closeStreamingTail('`a*b` 之后')).toBe('`a*b` 之后');
  });

  it('前面已完成的段落不动，只补最后一段', () => {
    expect(closeStreamingTail('上一段 **没闭合\n\n这一段 **加')).toBe('上一段 **没闭合\n\n这一段 **加**');
    expect(closeStreamingTail('上一段 [链接\n\n这一段')).toBe('上一段 [链接\n\n这一段');
  });

  it('在没闭合的围栏代码块里什么都不做，代码块里的 ** 不动', () => {
    const open = '看这段：\n\n```js\nconst a = "**";\nconst b = `x';
    expect(closeStreamingTail(open)).toBe(open);
    const tilde = '~~~\n**x\n';
    expect(closeStreamingTail(tilde)).toBe(tilde);
    const closed = '```\n**x\n```\n';
    expect(closeStreamingTail(closed)).toBe(closed);
    // 围栏闭合以后的新段落照常补。
    expect(closeStreamingTail('```\n**x\n```\n然后 **加')).toBe('```\n**x\n```\n然后 **加**');
  });

  it('链接只露出文字，没写完的图片整个隐藏', () => {
    expect(closeStreamingTail('见 [文档')).toBe('见 文档');
    expect(closeStreamingTail('见 [文档]')).toBe('见 文档');
    expect(closeStreamingTail('见 [文档](https://exa')).toBe('见 文档');
    expect(closeStreamingTail('见 [文档](https://example.test/a)')).toBe('见 [文档](https://example.test/a)');
    expect(closeStreamingTail('图 ![封面](cov')).toBe('图 ');
    expect(closeStreamingTail('图 ![封')).toBe('图 ');
    expect(closeStreamingTail('图 ![封面](cover.png)')).toBe('图 ![封面](cover.png)');
    expect(closeStreamingTail('`a[0` 后')).toBe('`a[0` 后');
  });
});
