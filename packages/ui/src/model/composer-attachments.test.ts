import { describe, expect, it } from 'vitest';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_MESSAGE } from '@baocut/protocol';
import { admitImages, checkImage, rejectionMessage } from './composer-attachments.ts';

const png = (size = 1024, name = 'a') => ({ name, type: 'image/png', size });

describe('附图校验', () => {
  it('只收 png / jpeg / gif / webp', () => {
    expect(checkImage({ type: 'image/png', size: 1 })).toBeNull();
    expect(checkImage({ type: 'image/jpeg', size: 1 })).toBeNull();
    expect(checkImage({ type: 'image/gif', size: 1 })).toBeNull();
    expect(checkImage({ type: 'image/webp', size: 1 })).toBeNull();
    expect(checkImage({ type: 'image/svg+xml', size: 1 })).toBe('type');
    expect(checkImage({ type: 'image/heic', size: 1 })).toBe('type');
    expect(checkImage({ type: '', size: 1 })).toBe('type');
  });

  it('单张正好 20 MiB 可以，多一个字节不行；空文件不行', () => {
    expect(checkImage(png(MAX_ATTACHMENT_BYTES))).toBeNull();
    expect(checkImage(png(MAX_ATTACHMENT_BYTES + 1))).toBe('size');
    expect(checkImage(png(0))).toBe('size');
  });

  it('一条消息正好 8 张可以，第 9 张退回', () => {
    const eight = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE }, (_, i) => png(10, `p${i}`));
    expect(admitImages(0, eight)).toEqual({ accepted: eight, rejected: null });
    const { accepted, rejected } = admitImages(6, [png(1, 'x'), png(1, 'y'), png(1, 'z')]);
    expect(accepted.map((f) => f.name)).toEqual(['x', 'y']);
    expect(rejected).toBe('count');
    expect(admitImages(MAX_ATTACHMENTS_PER_MESSAGE, [png(1)])).toEqual({ accepted: [], rejected: 'count' });
  });

  it('不合格的不占名额，合格的照收；提示第一条原因', () => {
    const result = admitImages(0, [png(MAX_ATTACHMENT_BYTES + 1, 'big'), { name: 'svg', type: 'image/svg+xml', size: 5 }, png(5, 'ok')]);
    expect(result.accepted.map((f) => f.name)).toEqual(['ok']);
    expect(result.rejected).toBe('size');
  });

  it('提示文案照原型', () => {
    expect(rejectionMessage('size')).toBe('请选择不超过 20 MiB 的图片');
    expect(rejectionMessage('count')).toBe('最多附上 8 张图片');
  });
});
