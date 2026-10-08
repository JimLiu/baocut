import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PipelineStepError } from './pipeline.ts';
import { ensureSaveDirectory, ensureSaveDirectoryForStep, readableStem, writableDirectoryProblem } from './save-location.ts';

/** 保存位置（架构设计 §7.9）：建好目录、确认能写，与可读的文件名。 */

describe('保存位置的目录', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-save-'));
  });
  afterEach(async () => {
    await fs.chmod(dir, 0o700).catch(() => {});
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('不存在时逐级创建', async () => {
    const target = path.join(dir, 'a', 'b');
    expect(await writableDirectoryProblem(target)).toBeNull();
    expect((await fs.stat(target)).isDirectory()).toBe(true);
  });

  it('是文件、或在文件下面：提交时 conflict，执行时是步骤错误，都带 OUTPUT_DESTINATION_UNAVAILABLE', async () => {
    const file = path.join(dir, 'file');
    await fs.writeFile(file, 'x');
    for (const target of [file, path.join(file, 'sub')]) {
      await expect(ensureSaveDirectory(target)).rejects.toMatchObject({
        code: 'conflict',
        details: { code: 'OUTPUT_DESTINATION_UNAVAILABLE', dir: target },
      });
      const error = await ensureSaveDirectoryForStep(target).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PipelineStepError);
      expect(error).toMatchObject({ code: 'OUTPUT_DESTINATION_UNAVAILABLE' });
    }
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('没有写权限：拒绝', async () => {
    const locked = path.join(dir, 'locked');
    await fs.mkdir(locked);
    await fs.chmod(locked, 0o500);
    try {
      expect(await writableDirectoryProblem(locked)).toBe('EACCES');
    } finally {
      await fs.chmod(locked, 0o700);
    }
  });
});

describe('可读的文件名', () => {
  it('取开头一段、空白合成一个空格；空文字用兜底的名字', () => {
    expect(readableStem('  你好\n\t世界  ', 'speech')).toBe('你好 世界');
    expect(readableStem('   ', 'speech')).toBe('speech');
    expect([...readableStem('字'.repeat(100), 'x')]).toHaveLength(40);
  });

  it('按下载文件名的规则去掉路径分隔符与保留字符', () => {
    const stem = readableStem('a/b\\c:d*e?f"g<h>i|j', 'x');
    expect(stem).not.toMatch(/[/\\:*?"<>|]/);
  });
});
