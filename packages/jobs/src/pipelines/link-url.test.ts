import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileLinkSources } from './link-sources.ts';
import { checkLink, checkResolvedHost, isPrivateAddress, redactUrl, redactUrlsInText } from './link-url.ts';

/** 从链接导入的链接检查、脱敏与原始链接的暂存（架构设计 §7.9）。 */

describe('链接检查', () => {
  it('只接受公网的 http(s) 链接，不接受以 - 开头、带凭据与本地的', () => {
    expect(checkLink('  https://Video.Example.com./watch?v=abc&utm_source=x#t=1 ')).toEqual({
      raw: 'https://Video.Example.com./watch?v=abc&utm_source=x#t=1',
      canonical: 'https://video.example.com./watch?v=abc',
      host: 'video.example.com',
    });
    const unsupported = [
      '-https://video.example.com/watch',
      '--exec=rm -rf /',
      'file:///etc/passwd',
      'ftp://video.example.com/a',
      'javascript:alert(1)',
      'https://user:pass@video.example.com/a',
      'not a url',
    ];
    for (const link of unsupported) {
      expect(() => checkLink(link), link).toThrow(
        expect.objectContaining({ code: 'invalid-request', details: { code: 'LINK_UNSUPPORTED' } }),
      );
    }
    const local = [
      'http://localhost:8080/a',
      'http://127.0.0.1/a',
      'http://0.0.0.0/a',
      'http://[::1]/a',
      'http://[::ffff:127.0.0.1]/a',
      'http://169.254.169.254/latest/meta-data',
      'http://10.1.2.3/a',
      'http://172.16.0.1/a',
      'http://192.168.1.1/a',
      'http://100.64.0.1/a',
      'http://[fd00::1]/a',
      'http://[fe80::1]/a',
      'http://printer.local/a',
      'http://app.localhost/a',
      'http://intranet/a',
      'http://2130706433/a',
    ];
    for (const link of local) {
      expect(() => checkLink(link), link).toThrow(expect.objectContaining({ details: { code: 'LINK_PRIVATE_ADDRESS' } }));
    }
  });

  it('脱敏：去掉凭据、片段与跟踪、签名参数，只留标识内容的参数并排序', () => {
    expect(redactUrl('https://video.example.com/watch?token=secret&v=abc&list=PL1&utm_campaign=x#frag')).toBe(
      'https://video.example.com/watch?list=PL1&v=abc',
    );
    expect(redactUrl('https://cdn.example.com/a/b.mp4?Signature=xyz&Expires=1')).toBe('https://cdn.example.com/a/b.mp4');
    expect(redactUrlsInText('ERROR: fetching https://cdn.example.com/x?sig=secret failed')).toBe(
      'ERROR: fetching https://cdn.example.com/x failed',
    );
  });

  it('解析出内网地址时拒绝；解析不了是网络错误；字面 IP 不再解析', async () => {
    const lookup = async (host: string) => (host === 'evil.example.com' ? ['93.184.216.34', '10.0.0.5'] : ['93.184.216.34']);
    await expect(checkResolvedHost('video.example.com', lookup)).resolves.toBeUndefined();
    await expect(checkResolvedHost('evil.example.com', lookup)).rejects.toMatchObject({ details: { code: 'LINK_PRIVATE_ADDRESS' } });
    await expect(
      checkResolvedHost('down.example.com', async () => {
        throw new Error('ENOTFOUND');
      }),
    ).rejects.toMatchObject({ details: { code: 'LINK_NETWORK_ERROR' } });
    expect(isPrivateAddress('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateAddress('64:ff9b::7f00:1')).toBe(true);
    expect(isPrivateAddress('2606:4700::1')).toBe(false);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
  });
});

describe('原始链接的暂存', () => {
  it('0600 文件；删除最后一条时文件也删掉；prune 只留指定的', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-link-sources-'));
    try {
      const file = path.join(dir, 'store', 'link-sources.json');
      const sources = new FileLinkSources(file);
      await sources.put('sha256:a', 'https://video.example.com/a?token=1');
      await sources.put('sha256:b', 'https://video.example.com/b?token=2');
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
      expect(await sources.get('sha256:a')).toBe('https://video.example.com/a?token=1');
      await sources.prune(new Set(['sha256:b']));
      expect(await sources.get('sha256:a')).toBeNull();
      await sources.delete('sha256:b');
      await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
