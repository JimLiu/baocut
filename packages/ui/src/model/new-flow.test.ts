import { describe, expect, it } from 'vitest';
import { chainOf, directExt, hostOf, into, linkFacts, mediaKindOf, needsTranscribe, targetLanguage, urlValid } from './new-flow.ts';

describe('素材', () => {
  it('按扩展名分视频、音频与别的', () => {
    expect(mediaKindOf('/a/b/访谈.MP4')).toBe('video');
    expect(mediaKindOf('C:\\rec\\播客.m4a')).toBe('audio');
    expect(mediaKindOf('notes.pdf')).toBe('other');
  });
});

describe('链接', () => {
  it('地址要有协议和点', () => {
    expect(urlValid('https://www.youtube.com/watch?v=1')).toBe(true);
    expect(urlValid('http://a.b')).toBe(true);
    expect(urlValid('ftp://a.b/c')).toBe(false);
    expect(urlValid('www.youtube.com')).toBe(false);
    expect(urlValid('https://localhost')).toBe(false);
  });

  it('主机名去掉 www 与端口', () => {
    expect(hostOf('https://www.Bilibili.com:443/video/BV1')).toBe('bilibili.com');
    expect(hostOf('not a url')).toBe('');
  });

  it('直链认扩展名，页面地址不认', () => {
    expect(directExt('https://cdn.x.com/media/clip.mp4?sig=1')).toBe('mp4');
    expect(directExt('https://cdn.x.com/a/podcast.MP3')).toBe('mp3');
    expect(directExt('https://x.com/page.html')).toBe('');
    expect(directExt('https://youtube.com/watch?v=abc')).toBe('');
  });

  it('卡片上只写地址本身看得出来的', () => {
    expect(linkFacts('https://youtu.be/abc')).toEqual({ site: 'YouTube', direct: false, host: 'youtu.be', title: 'YouTube 视频链接' });
    expect(linkFacts('https://www.bilibili.com/video/BV1').title).toBe('哔哩哔哩 视频链接');
    expect(linkFacts('https://example.org/watch/1').site).toBe('example.org');
    expect(linkFacts('https://cdn.x.com/%E8%AE%BF%E8%B0%88.mp4')).toMatchObject({ site: '直链', direct: true, title: '访谈.mp4' });
  });
});

describe('目标语言', () => {
  it('翻译成：拉丁字母前空一格', () => {
    expect(into('English')).toBe('翻译成 English');
    expect(into('日本語')).toBe('翻译成日本語');
    expect(targetLanguage('xx').code).toBe('en');
  });
});

describe('链接导入的跟进', () => {
  it('音频转视频字幕关掉时不转录，剪口播与空白不转录', () => {
    expect(needsTranscribe('a2v', false)).toBe(false);
    expect(needsTranscribe('a2v', true)).toBe(true);
    expect(needsTranscribe('trans', false)).toBe(true);
    expect(needsTranscribe('clean', true)).toBe(false);
    expect(needsTranscribe('blank', true)).toBe(false);
  });

  it('后续链只有翻译', () => {
    expect(chainOf('trans', targetLanguage('ja'))).toEqual({ title: '翻译成日本語', doneToast: '翻译完成 · 日语字幕已放到画面上' });
    expect(chainOf('sub', targetLanguage('ja'))).toBeNull();
  });
});
