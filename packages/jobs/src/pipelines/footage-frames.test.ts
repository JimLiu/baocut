import { describe, expect, it } from 'vitest';
import { PngSplitter, chooseFrameRate, filterPath, parseFrameRate } from './footage-frames.ts';

/** 一个最小的 PNG 形状（只看 chunk 的边界，不解码）。 */
function png(payload: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    return Buffer.concat([head, data, Buffer.alloc(4)]);
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', Buffer.alloc(13, 1)),
    chunk('IDAT', Buffer.alloc(payload, 2)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('PNG 流', () => {
  it('一整块里的几帧', () => {
    const a = png(10);
    const b = png(300);
    const splitter = new PngSplitter();
    expect(splitter.push(Buffer.concat([a, b]))).toEqual([a, b]);
    expect(splitter.pending).toBe(0);
  });

  it.each([1, 3, 7, 16, 64])('任意切块（%i 字节一块）切出来的帧都完整', (size) => {
    const frames = [png(5), png(1000), png(0), png(77)];
    const stream = Buffer.concat(frames);
    const splitter = new PngSplitter();
    const out: Buffer[] = [];
    for (let i = 0; i < stream.length; i += size) out.push(...splitter.push(stream.subarray(i, i + size)));
    expect(out).toEqual(frames);
    expect(splitter.pending).toBe(0);
  });

  it('IDAT 的数据里出现 IEND 字样不算结束', () => {
    const data = Buffer.from('xxIENDxx');
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write('IDAT', 4, 'latin1');
    const tricky = Buffer.concat([png(0).subarray(0, 33), head, data, Buffer.alloc(4), png(0).subarray(-12)]);
    expect(new PngSplitter().push(tricky)).toEqual([tricky]);
  });

  it('流断在半帧时看得出来', () => {
    const splitter = new PngSplitter();
    const frame = png(20);
    expect(splitter.push(frame.subarray(0, 40))).toEqual([]);
    expect(splitter.pending).toBe(40);
  });

  it('不是 PNG 时抛错，不把垃圾当成帧', () => {
    const bad = png(4);
    bad[0] = 0;
    expect(() => new PngSplitter().push(bad)).toThrow();
  });
});

describe('帧率', () => {
  it.each([
    ['30/1', { num: 30, den: 1 }],
    ['30000/1001', { num: 30000, den: 1001 }],
    ['25', { num: 25, den: 1 }],
  ])('%s', (text, want) => {
    expect(parseFrameRate(text)).toEqual(want);
  });

  it.each(['0/0', '', 'n/a', '90000/1', '1/2'])('认不出或离谱的 %j', (text) => {
    expect(parseFrameRate(text)).toBeNull();
  });
});

describe('处理用的帧率', () => {
  it('恒定帧率照用 r_frame_rate', () => {
    expect(chooseFrameRate('30000/1001', '30000/1001')).toEqual({ num: 30000, den: 1001 });
  });

  it('可变帧率：r_frame_rate 远高于平均帧率时用平均帧率，不重复出帧', () => {
    expect(chooseFrameRate('120/1', '35/2')).toEqual({ num: 35, den: 2 });
  });

  it('r_frame_rate 认不出（容器时基）时用平均帧率，不把 60 fps 丢成 30', () => {
    expect(chooseFrameRate('90000/1', '60/1')).toEqual({ num: 60, den: 1 });
  });

  it('差得不多时不换；都认不出时才是 30', () => {
    expect(chooseFrameRate('30/1', '25/1')).toEqual({ num: 30, den: 1 });
    expect(chooseFrameRate('30/1', null)).toEqual({ num: 30, den: 1 });
    expect(chooseFrameRate('0/0', '0/0')).toEqual({ num: 30, den: 1 });
  });
});

describe('滤镜参数里的路径', () => {
  it('Windows 盘符与反斜杠', () => {
    expect(filterPath('C:\\Users\\me\\a.cube')).toBe("'C\\:/Users/me/a.cube'");
  });

  it('POSIX 路径里的空格原样，单引号转义', () => {
    expect(filterPath("/tmp/my clip's/a.trf")).toBe("'/tmp/my clip\\'\\''s/a.trf'");
  });
});
