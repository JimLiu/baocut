import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { describe, expect, it } from 'vitest';
import { remarkPlugins } from './remark-plugins.ts';

const render = (src: string) => renderToStaticMarkup(createElement(Markdown, { remarkPlugins }, src));

describe('remarkPlugins', () => {
  it('中文标点紧挨 ** 时仍按粗体解析', () => {
    expect(render('建议普通话旁白。**确定后继续配音。**接着剪辑')).toBe('<p>建议普通话旁白。<strong>确定后继续配音。</strong>接着剪辑</p>');
    expect(render('选题定为：**《报告一键生成，审核还得人工》**，围绕')).toBe(
      '<p>选题定为：<strong>《报告一键生成，审核还得人工》</strong>，围绕</p>',
    );
  });

  it('中文标点紧挨 ~~ 时仍按删除线解析', () => {
    expect(render('原定周一。~~改到周三。~~后来取消')).toBe('<p>原定周一。<del>改到周三。</del>后来取消</p>');
  });

  it('保留 GFM', () => {
    expect(render('| a |\n| - |\n| b |')).toContain('<table>');
    expect(render('~~删~~')).toBe('<p><del>删</del></p>');
  });
});
