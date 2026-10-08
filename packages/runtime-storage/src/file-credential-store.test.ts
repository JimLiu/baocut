import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileCredentialStore } from './file-credential-store.ts';

describe('FileCredentialStore', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-credentials-'));
    file = path.join(dir, 'store', 'model-credentials.json');
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('四种操作；写入是 0600、临时文件加改名；重开后还在', async () => {
    const store = new FileCredentialStore(file);
    expect(await store.get('provider:openai')).toBeNull();
    expect(await store.has('provider:openai')).toBe(false);
    await expect(fs.stat(file)).rejects.toThrow();
    await store.set('provider:openai', 'sk-a');
    await store.set('node:node_1', 'c_x.secret');
    expect(await store.get('provider:openai')).toBe('sk-a');
    expect(await store.has('node:node_1')).toBe(true);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect(await fs.readdir(path.dirname(file))).toEqual(['model-credentials.json']);
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({
      formatVersion: 2,
      credentials: { 'node:node_1': 'c_x.secret', 'provider:openai': 'sk-a' },
    });
    await store.delete('provider:openai');
    await store.delete('provider:never-set');
    const reopened = new FileCredentialStore(file);
    expect(await reopened.get('provider:openai')).toBeNull();
    expect(await reopened.get('node:node_1')).toBe('c_x.secret');
  });

  it('权限被放宽过的文件，写入后收紧到 0600', async () => {
    const store = new FileCredentialStore(file);
    await store.set('provider:openai', 'sk-a');
    await fs.chmod(file, 0o644);
    await store.set('provider:google', 'g');
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  });

  it('第 1 版的文件（键是 providerId）原样读出', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ formatVersion: 1, credentials: { openai: 'sk-old', 'custom:box': 'box', empty: '' } }));
    const store = new FileCredentialStore(file);
    expect(await store.get('provider:openai')).toBe('sk-old');
    expect(await store.get('provider:custom:box')).toBe('box');
    expect(await store.has('provider:empty')).toBe(false);
    expect((await store.keys()).sort()).toEqual(['provider:custom:box', 'provider:openai']);
  });

  it('并发写入串行，最后的状态完整', async () => {
    const store = new FileCredentialStore(file);
    await Promise.all(['a', 'b', 'c', 'd', 'e'].map((x) => store.set(`node:${x}`, `t-${x}`)));
    expect((await new FileCredentialStore(file).keys()).sort()).toEqual(['node:a', 'node:b', 'node:c', 'node:d', 'node:e']);
  });

  it('文件损坏时从空开始；不合规的 key 与空密钥是调用方的错误', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{ not json');
    const store = new FileCredentialStore(file);
    expect(await store.get('provider:openai')).toBeNull();
    expect(() => store.get('openai')).toThrow(TypeError);
    expect(() => store.set('provider:x y', 's')).toThrow(TypeError);
    expect(() => store.set('provider:x', '')).toThrow(TypeError);
  });

  it('写不进文件时内存与文件都不变，错误里没有密钥', async () => {
    const store = new FileCredentialStore(file);
    await store.set('provider:openai', 'sk-a');
    await fs.chmod(path.dirname(file), 0o500);
    try {
      const failure = await store.set('provider:google', 'sk-should-not-leak').catch((e: unknown) => e);
      expect(failure).toMatchObject({ name: 'CredentialStoreError', code: 'internal' });
      expect(String((failure as Error).message)).not.toContain('sk-should-not-leak');
      expect(await store.has('provider:google')).toBe(false);
    } finally {
      await fs.chmod(path.dirname(file), 0o700);
    }
  });

  it('removeIfEmpty 只在没有密钥时删除文件', async () => {
    const store = new FileCredentialStore(file);
    await store.set('provider:openai', 'sk-a');
    expect(await store.removeIfEmpty()).toBe(false);
    await store.delete('provider:openai');
    expect(await store.removeIfEmpty()).toBe(true);
    await expect(fs.stat(file)).rejects.toThrow();
  });
});
