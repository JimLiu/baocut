import { describe, expect, it } from 'vitest';
import { mergeLayeredCss, parseLayeredCss } from './s2-styles-merge.ts';

const merge = (...sheets: string[]) =>
  mergeLayeredCss(
    sheets.map((css) => parseLayeredCss(css)!),
    '',
  );

describe('S2 样式去重合并', () => {
  it('同一层里重复的规则只留最后一次，其余规则的先后不变', () => {
    expect(merge('@layer a{.x{color:red}}', '@layer a{.y{color:blue}}', '@layer a{.x{color:red}}')).toBe(
      '@layer a;@layer a{.y{color:blue}.x{color:red}}',
    );
  });

  it('层的先后按名字第一次出现（声明语句、规则块、嵌套块），点号路径展开嵌套', () => {
    expect(merge('@layer b{.p{top:0}}', '@layer a;@layer b{@layer c{.q{top:1px}}}', '@layer a{.r{top:2px}}')).toBe(
      '@layer b,a,b.c;@layer b{.p{top:0}}@layer a{.r{top:2px}}@layer b.c{.q{top:1px}}',
    );
  });

  it('不同层里文字相同的规则各自保留；不在层里的放最后，保持先后', () => {
    expect(merge('.u{color:red}@layer a{.x{color:red}}', '@layer b{.x{color:red}}.v{color:blue}.u{color:red}')).toBe(
      '@layer a,b;@layer a{.x{color:red}}@layer b{.x{color:red}}.v{color:blue}.u{color:red}',
    );
  });

  it('@media 等整块算一条；顶层注释（source map）丢掉；字符串与转义里的括号不算', () => {
    const css = '@layer a{@media (min-width:1px){.x{top:0}}}\n/*# sourceMappingURL=data:x */\n.a\\{b{content:"}{;"}';
    expect(parseLayeredCss(css)).toEqual({
      layers: ['a'],
      items: [
        { layer: 'a', text: '@media (min-width:1px){.x{top:0}}' },
        { layer: null, text: '.a\\{b{content:"}{;"}' },
      ],
    });
  });

  it('拆不准的写法返回 null：匿名层、@import、条件规则里的 @layer、括号不配对', () => {
    expect(parseLayeredCss('@layer{.x{top:0}}')).toBeNull();
    expect(parseLayeredCss('@import "a.css";.x{top:0}')).toBeNull();
    expect(parseLayeredCss('@media print{@layer a{.x{top:0}}}')).toBeNull();
    expect(parseLayeredCss('.x{top:0')).toBeNull();
  });
});
