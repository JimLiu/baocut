//! 光标图片存成 PNG（RGBA、8 位）。光标最大不过几百像素见方，用不压缩的 deflate 块（PNG 规范 ISO/IEC 15948 与
//! zlib 的 RFC 1950/1951 都允许），不为几 KB 的图片引入编码库或 WIC。

/// RGBA 像素（`width × height × 4` 字节）编码成 PNG。
pub fn encode_rgba(width: u32, height: u32, rgba: &[u8]) -> Vec<u8> {
    assert_eq!(rgba.len(), width as usize * height as usize * 4, "pixel buffer size");
    let mut raw = Vec::with_capacity(rgba.len() + height as usize);
    for row in rgba.chunks_exact(width as usize * 4) {
        raw.push(0); // 过滤方式 None
        raw.extend_from_slice(row);
    }
    let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut header = Vec::with_capacity(13);
    header.extend_from_slice(&width.to_be_bytes());
    header.extend_from_slice(&height.to_be_bytes());
    header.extend_from_slice(&[8, 6, 0, 0, 0]); // 8 位、RGBA、deflate、标准过滤、不交错
    chunk(&mut out, b"IHDR", &header);
    chunk(&mut out, b"IDAT", &zlib_stored(&raw));
    chunk(&mut out, b"IEND", &[]);
    out
}

fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(kind);
    out.extend_from_slice(data);
    let mut crc = Crc::new();
    crc.update(kind);
    crc.update(data);
    out.extend_from_slice(&crc.finish().to_be_bytes());
}

/// zlib 流：头两字节，不压缩的 deflate 块（每块至多 65535 字节），Adler-32 结尾。
fn zlib_stored(data: &[u8]) -> Vec<u8> {
    let mut out = vec![0x78, 0x01];
    let mut blocks = data.chunks(65_535).peekable();
    if blocks.peek().is_none() {
        out.extend_from_slice(&[1, 0, 0, 0xff, 0xff]);
    }
    while let Some(block) = blocks.next() {
        out.push(u8::from(blocks.peek().is_none()));
        let len = block.len() as u16;
        out.extend_from_slice(&len.to_le_bytes());
        out.extend_from_slice(&(!len).to_le_bytes());
        out.extend_from_slice(block);
    }
    out.extend_from_slice(&adler32(data).to_be_bytes());
    out
}

fn adler32(data: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for chunk in data.chunks(5552) {
        for byte in chunk {
            a += u32::from(*byte);
            b += a;
        }
        a %= 65_521;
        b %= 65_521;
    }
    (b << 16) | a
}

struct Crc(u32);

impl Crc {
    fn new() -> Self {
        Self(0xffff_ffff)
    }

    fn update(&mut self, data: &[u8]) {
        for byte in data {
            let mut c = (self.0 ^ u32::from(*byte)) & 0xff;
            for _ in 0..8 {
                c = if c & 1 != 0 { 0xedb8_8320 ^ (c >> 1) } else { c >> 1 };
            }
            self.0 = c ^ (self.0 >> 8);
        }
    }

    fn finish(self) -> u32 {
        self.0 ^ 0xffff_ffff
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checksums_match_the_reference_values() {
        let mut crc = Crc::new();
        crc.update(b"IEND");
        assert_eq!(crc.finish(), 0xae42_6082);
        let mut crc = Crc::new();
        crc.update(b"123456789");
        assert_eq!(crc.finish(), 0xcbf4_3926);
        assert_eq!(adler32(b"Wikipedia"), 0x11e6_0398);
    }

    #[test]
    fn png_layout() {
        let png = encode_rgba(2, 1, &[255, 0, 0, 255, 0, 0, 255, 128]);
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        assert_eq!(&png[12..16], b"IHDR");
        assert_eq!(&png[16..24], &[0, 0, 0, 2, 0, 0, 0, 1]);
        assert_eq!(&png[png.len() - 12..], &[0, 0, 0, 0, b'I', b'E', b'N', b'D', 0xae, 0x42, 0x60, 0x82]);
        // IDAT：一行（过滤字节 + 8 字节像素）装在一个不压缩的块里。
        let idat = 8 + 25;
        assert_eq!(&png[idat + 4..idat + 8], b"IDAT");
        let len = u32::from_be_bytes(png[idat..idat + 4].try_into().unwrap()) as usize;
        let data = &png[idat + 8..idat + 8 + len];
        assert_eq!(&data[..7], &[0x78, 0x01, 1, 9, 0, 0xf6, 0xff]);
        assert_eq!(&data[7..16], &[0, 255, 0, 0, 255, 0, 0, 255, 128]);
    }

    #[test]
    fn large_images_split_into_blocks() {
        let rgba = vec![7u8; 200 * 100 * 4];
        let stored = zlib_stored(&vec![0u8; 70_000]);
        // 两个块：65535 + 4465，各 5 字节块头。
        assert_eq!(stored.len(), 2 + 5 + 65_535 + 5 + 4_465 + 4);
        assert_eq!(stored[2], 0);
        assert_eq!(stored[2 + 5 + 65_535], 1);
        let png = encode_rgba(200, 100, &rgba);
        assert!(png.len() > rgba.len());
    }
}
