// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DocumentContent } from './document-preview.tsx';

const render = (text: string) => renderToStaticMarkup(createElement(DocumentContent, { mode: 'markdown', fileName: 'answer.md', text, source: false }));

describe('Markdown 文章里的链接', () => {
  it('视频某一刻的出处画成可点的时间码，别的链接只显示文字', () => {
    const html = render('价格在 [12:05](/videos/vid1?t=725.4) 讲过，详见 [官网](https://example.com)。');
    expect(html).toContain('bc-amd-time');
    expect(html).toContain('12:05');
    expect(html).not.toContain('href="https://example.com"');
    expect(html).toContain('<span>官网</span>');
  });
});
