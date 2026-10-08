/* GIF 帧时长与边界检查。产品设计 §3.3；不解压像素，供解码器和下载变速共用。 */
(function () {
  const MAX_BYTES = 64 * 1024 * 1024,
    MAX_FRAMES = 256,
    MAX_PIXELS = 64 * 1024 * 1024;
  function parse(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length > MAX_BYTES) throw new Error('GIF 超过 64 MiB，无法分帧。');
    let offset = 0;
    const requireBytes = (n) => {
      if (offset + n > bytes.length) throw new Error('GIF 数据不完整。');
    };
    const take = () => {
      requireBytes(1);
      return bytes[offset++];
    };
    const skip = (n) => {
      requireBytes(n);
      offset += n;
    };
    const word = (at) => bytes[at] | (bytes[at + 1] << 8);
    requireBytes(13);
    if (!['GIF87a', 'GIF89a'].includes(String.fromCharCode(...bytes.slice(0, 6)))) throw new Error('不是有效的 GIF 文件。');
    const width = word(6),
      height = word(8);
    if (!width || !height || width * height > MAX_PIXELS) throw new Error('GIF 画面过大或尺寸无效。');
    offset = 13;
    const table = (flags) => {
      if (flags & 128) skip(3 * 2 ** ((flags & 7) + 1));
    };
    const blocks = () => {
      let length;
      while ((length = take()) !== 0) skip(length);
    };
    table(bytes[10]);
    const frames = [];
    let delayOffset = null;
    while (offset < bytes.length) {
      const tag = take();
      if (tag === 0x3b) {
        if (!frames.length) throw new Error('GIF 没有可显示的帧。');
        return { width, height, frames };
      }
      if (tag === 0x21) {
        const type = take();
        if (type === 0xf9) {
          requireBytes(6);
          if (bytes[offset] !== 4 || bytes[offset + 5] !== 0) throw new Error('GIF 帧控制信息无效。');
          delayOffset = offset + 2;
        } else if (type === 1) delayOffset = null;
        blocks();
      } else if (tag === 0x2c) {
        const imageOffset = offset - 1;
        requireBytes(9);
        const flags = bytes[offset + 8];
        skip(9);
        table(flags);
        skip(1);
        blocks();
        const delay = delayOffset == null ? 0 : word(delayOffset);
        frames.push({ imageOffset, delayOffset, duration: delay > 1 ? delay * 10 : 100 });
        delayOffset = null;
        if (frames.length > MAX_FRAMES || width * height * frames.length > MAX_PIXELS)
          throw new Error('GIF 超过 256 帧或累计像素上限，无法分帧。');
      } else throw new Error('GIF 数据块无效。');
    }
    throw new Error('GIF 数据不完整。');
  }
  function retime(input, speed) {
    if (!Number.isFinite(speed) || speed <= 0) throw new Error('播放速度无效。');
    const bytes = Uint8Array.from(input instanceof Uint8Array ? input : new Uint8Array(input)),
      data = parse(bytes),
      output = [];
    let offset = 0;
    bytes[4] = 57;
    for (const frame of data.frames) {
      const delay = Math.min(65535, Math.max(2, Math.round(frame.duration / speed / 10)));
      if (frame.delayOffset == null) {
        output.push(bytes.slice(offset, frame.imageOffset), Uint8Array.of(0x21, 0xf9, 4, 0, delay & 255, delay >> 8, 0, 0));
        offset = frame.imageOffset;
      } else {
        bytes[frame.delayOffset] = delay & 255;
        bytes[frame.delayOffset + 1] = delay >> 8;
      }
    }
    output.push(bytes.slice(offset));
    const merged = new Uint8Array(output.reduce((n, b) => n + b.length, 0));
    let cursor = 0;
    for (const part of output) {
      merged.set(part, cursor);
      cursor += part.length;
    }
    return merged;
  }
  window.BC_MEDIA_GIF = { parse, retime, MAX_BYTES, MAX_FRAMES, MAX_PIXELS };
})();
