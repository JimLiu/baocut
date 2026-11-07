// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// A store-only zip writer (PNG textures are compressed already): the puppet package is model.json at the root plus
// textures/*.png.
import { crc32 } from './png.mjs';

/** files: [[name, Buffer]] in order; returns the zip's bytes */
export function zip(files) {
  const local = [], central = [];
  let off = 0;
  for (const [name, data] of files) {
    const nm = Buffer.from(name, 'utf8'), crc = crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8);
    h.writeUInt32LE(0, 10); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(nm.length, 26); h.writeUInt16LE(0, 28);
    local.push(h, nm, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10);
    c.writeUInt32LE(0, 12); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, nm);
    off += 30 + nm.length + data.length;
  }
  if (off > 0xffffffff || files.length > 0xffff) throw new Error('the package is too large for a zip without zip64');
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...local, cd, end]);
}

/** the entry names of a zip written by zip() (for checks) */
export function zipNames(buf) {
  const names = [];
  let p = 0;
  while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const size = buf.readUInt32LE(p + 18), nl = buf.readUInt16LE(p + 26), xl = buf.readUInt16LE(p + 28);
    names.push(buf.toString('utf8', p + 30, p + 30 + nl));
    p += 30 + nl + xl + size;
  }
  return names;
}
