//! 角色包：一个 zip，根上是 `model.json`，贴图在 `textures/` 下（PNG 或 WebP）。条目可以存储或 deflate；
//! 不支持加密与 zip64。整个包也可以多套一层目录（直接压缩一个文件夹的结果）。
//!
//! 贴图读进来就预乘（与 WebGL 的 `UNPACK_PREMULTIPLY_ALPHA_WEBGL` 一样），并生成 mipmap（每级边长减半，2×2 取平均），
//! 绘制时三线性采样。

use std::collections::HashMap;
use std::io::Cursor;
use std::sync::Arc;

use crate::model::Model;
use crate::{Error, ErrorKind};

/// 整个包与单个条目解压后的上限（字节）。
pub const MAX_PACKAGE_BYTES: usize = 512 << 20;
pub const MAX_ENTRY_BYTES: usize = 128 << 20;
pub const MAX_MODEL_JSON: usize = 4 << 20;
/// 贴图边长与全部贴图像素数的上限（与 LivLiv 的 `LIMITS.texture` / `LIMITS.texels` 相同）。
pub const MAX_TEXTURE_SIDE: u32 = 8192;
pub const MAX_TEXELS: u64 = 64 << 20;

/// 一级 mipmap：预乘 RGBA8，逐行。
#[derive(Clone, Debug)]
pub struct Level {
    pub w: u32,
    pub h: u32,
    pub px: Vec<u8>,
}

/// 一张贴图：第 0 级是原图，之后每级边长减半到 1×1。
#[derive(Clone, Debug)]
pub struct Texture {
    pub levels: Vec<Level>,
}

impl Texture {
    pub fn width(&self) -> u32 {
        self.levels[0].w
    }
    pub fn height(&self) -> u32 {
        self.levels[0].h
    }

    /// 由直通（未预乘）RGBA8 建贴图。
    pub fn from_rgba(w: u32, h: u32, mut px: Vec<u8>) -> Texture {
        for p in px.chunks_exact_mut(4) {
            let a = u32::from(p[3]);
            if a < 255 {
                for c in &mut p[..3] {
                    *c = ((u32::from(*c) * a + 127) / 255) as u8;
                }
            }
        }
        let mut levels = vec![Level { w, h, px }];
        while let Some(last) = levels.last()
            && (last.w > 1 || last.h > 1)
        {
            let next = downsample(last);
            levels.push(next);
        }
        Texture { levels }
    }

    /// 第 0 级 (x, y) 的预乘 RGBA；越界返回透明。
    pub fn texel(&self, x: i64, y: i64) -> [u8; 4] {
        let l = &self.levels[0];
        if x < 0 || y < 0 || x >= i64::from(l.w) || y >= i64::from(l.h) {
            return [0; 4];
        }
        let k = 4 * (y as usize * l.w as usize + x as usize);
        [l.px[k], l.px[k + 1], l.px[k + 2], l.px[k + 3]]
    }

    /// 第 0 级 (x, y) 的 alpha（0–255）；越界为 0。
    #[inline]
    pub fn alpha(&self, x: i64, y: i64) -> u8 {
        let l = &self.levels[0];
        if x < 0 || y < 0 || x >= i64::from(l.w) || y >= i64::from(l.h) {
            return 0;
        }
        l.px[4 * (y as usize * l.w as usize + x as usize) + 3]
    }
}

/// 下一级 mipmap：和 WebGL 在 Metal 上的 `generateMipmap` 一样，下一级每个格子的中心按归一化坐标映射回上一级，
/// 在那里双线性取样（边缘夹紧）。偶数边长时就是 2×2 平均；奇数边长时各格子取样点不落在整格上。
fn downsample(src: &Level) -> Level {
    let w = (src.w >> 1).max(1);
    let h = (src.h >> 1).max(1);
    // 每个轴：取样点左边的格子与右边格子的权重
    let taps = |n0: u32, n: u32| -> Vec<(usize, usize, f64)> {
        (0..n)
            .map(|i| {
                let s = ((2 * i + 1) as f64 * f64::from(n0) / f64::from(n) - 1.0) / 2.0;
                let s = s.max(0.0);
                let i0 = (s.floor() as usize).min(n0 as usize - 1);
                (i0, (i0 + 1).min(n0 as usize - 1), s - s.floor())
            })
            .collect()
    };
    let (tx, ty) = (taps(src.w, w), taps(src.h, h));
    let sw = src.w as usize;
    let mut px = vec![0u8; (w * h * 4) as usize];
    for (y, &(y0, y1, fy)) in ty.iter().enumerate() {
        for (x, &(x0, x1, fx)) in tx.iter().enumerate() {
            for c in 0..4 {
                let at = |yy: usize, xx: usize| f64::from(src.px[4 * (yy * sw + xx) + c]);
                let top = at(y0, x0) + (at(y0, x1) - at(y0, x0)) * fx;
                let bottom = at(y1, x0) + (at(y1, x1) - at(y1, x0)) * fx;
                px[4 * (y * w as usize + x) + c] = (top + (bottom - top) * fy + 0.5).floor() as u8;
            }
        }
    }
    Level { w, h, px }
}

/// 读好的角色包：清单与每个贴图路径解码后的贴图。
#[derive(Debug)]
pub struct Package {
    pub model: Model,
    pub textures: HashMap<String, Arc<Texture>>,
}

impl Package {
    /// 从 zip 字节读一个角色包。
    pub fn from_zip(bytes: &[u8]) -> Result<Package, Error> {
        let zip = Zip::open(bytes)?;
        let root = zip.root()?;
        let model_bytes = zip.read(&format!("{root}model.json"), MAX_MODEL_JSON)?;
        let mut total = model_bytes.len();
        Package::from_files(&model_bytes, |path| {
            let name = format!("{root}{path}");
            if !zip.has(&name) {
                return Ok(None);
            }
            let data = zip.read(&name, MAX_ENTRY_BYTES)?;
            total += data.len();
            if total > MAX_PACKAGE_BYTES {
                return Err(Error::too_large(format!(
                    "the package unpacks to more than {MAX_PACKAGE_BYTES} bytes"
                )));
            }
            Ok(Some(data))
        })
    }

    /// 由 model.json 与一个按包内路径取文件的函数读角色包（测试、开发工具直接读目录）。
    pub fn from_files(model_json: &[u8], file: impl FnMut(&str) -> Result<Option<Vec<u8>>, Error>) -> Result<Package, Error> {
        let mut textures = HashMap::new();
        let model = walk(model_json, file, |path, bytes| {
            textures.insert(path.to_string(), Arc::new(decode(path, bytes)?));
            Ok(())
        })?;
        Ok(Package { model, textures })
    }

    /// 只检查不解码：清单读得开、引用的贴图都在、尺寸在上限内。导入时用它，比 [`Package::from_zip`] 快得多。
    pub fn inspect(bytes: &[u8]) -> Result<Model, Error> {
        let zip = Zip::open(bytes)?;
        let root = zip.root()?;
        let model_bytes = zip.read(&format!("{root}model.json"), MAX_MODEL_JSON)?;
        let mut total = model_bytes.len();
        walk(
            &model_bytes,
            |path| {
                let name = format!("{root}{path}");
                if !zip.has(&name) {
                    return Ok(None);
                }
                let data = zip.read(&name, MAX_ENTRY_BYTES)?;
                total += data.len();
                if total > MAX_PACKAGE_BYTES {
                    return Err(Error::too_large(format!(
                        "the package unpacks to more than {MAX_PACKAGE_BYTES} bytes"
                    )));
                }
                Ok(Some(data))
            },
            |_, _| Ok(()),
        )
    }

    pub fn texture(&self, path: &str) -> &Arc<Texture> {
        &self.textures[path]
    }
}

/// 读清单，按包内路径逐个取贴图、检查尺寸，交给 `each`。
fn walk(
    model_json: &[u8],
    mut file: impl FnMut(&str) -> Result<Option<Vec<u8>>, Error>,
    mut each: impl FnMut(&str, &[u8]) -> Result<(), Error>,
) -> Result<Model, Error> {
    if model_json.len() > MAX_MODEL_JSON {
        return Err(Error::too_large(format!("model.json is larger than {MAX_MODEL_JSON} bytes")));
    }
    let model = Model::parse(model_json)?;
    let mut paths: Vec<&str> = Vec::new();
    for l in &model.layers {
        paths.push(&l.texture);
        paths.extend(l.frames.iter().flatten().map(String::as_str));
        paths.extend(l.mask.as_deref());
        paths.extend(l.talk.as_deref());
        paths.extend(l.brow_tex.as_deref());
    }
    paths.sort_unstable();
    paths.dedup();
    let mut texels = 0u64;
    for path in paths {
        let bytes = file(path)?.ok_or_else(|| Error::new(ErrorKind::MissingFile, format!("the package has no \"{path}\"")))?;
        let (w, h) = image_size(path, &bytes)?;
        if w == 0 || h == 0 || w > MAX_TEXTURE_SIDE || h > MAX_TEXTURE_SIDE {
            return Err(Error::too_large(format!(
                "\"{path}\" is {w}x{h}: at most {MAX_TEXTURE_SIDE} px a side"
            )));
        }
        texels += u64::from(w) * u64::from(h);
        if texels > MAX_TEXELS {
            return Err(Error::too_large(format!(
                "the package's images have more than {MAX_TEXELS} pixels in all"
            )));
        }
        each(path, &bytes)?;
    }
    Ok(model)
}

fn reader(bytes: &[u8]) -> image::ImageReader<Cursor<&[u8]>> {
    let format = if bytes.starts_with(b"\x89PNG") {
        Some(image::ImageFormat::Png)
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(image::ImageFormat::WebP)
    } else {
        None
    };
    let mut r = image::ImageReader::new(Cursor::new(bytes));
    if let Some(f) = format {
        r.set_format(f);
    }
    r
}

fn image_size(path: &str, bytes: &[u8]) -> Result<(u32, u32), Error> {
    let r = reader(bytes);
    if r.format().is_none() {
        return Err(Error::new(ErrorKind::Image, format!("\"{path}\" is not a PNG or WebP image")));
    }
    r.into_dimensions()
        .map_err(|e| Error::new(ErrorKind::Image, format!("\"{path}\" cannot be read: {e}")))
}

fn decode(path: &str, bytes: &[u8]) -> Result<Texture, Error> {
    let img = reader(bytes)
        .decode()
        .map_err(|e| Error::new(ErrorKind::Image, format!("\"{path}\" cannot be decoded: {e}")))?;
    let rgba = img.into_rgba8();
    let (w, h) = rgba.dimensions();
    Ok(Texture::from_rgba(w, h, rgba.into_raw()))
}

// ---------------------------------------------------------------- zip

struct Entry {
    method: u16,
    compressed: usize,
    size: usize,
    offset: usize,
}

/// zip 根上有 `avatar.json`、又找不到分层角色的 `model.json`：mesh-avatar 角色包（格式规范 §2.5）。
pub(crate) fn is_mesh_avatar(bytes: &[u8]) -> bool {
    Zip::open(bytes).is_ok_and(|z| z.has("avatar.json") && z.root().is_err())
}

struct Zip<'a> {
    bytes: &'a [u8],
    entries: HashMap<String, Entry>,
}

fn u16_at(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(at..at + 2)?.try_into().ok()?))
}

fn u32_at(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

fn not_zip(what: &str) -> Error {
    Error::new(ErrorKind::NotZip, format!("the package is not a readable zip: {what}"))
}

impl<'a> Zip<'a> {
    fn open(bytes: &'a [u8]) -> Result<Zip<'a>, Error> {
        if !bytes.starts_with(b"PK\x03\x04") {
            return Err(not_zip("it does not start with a zip entry"));
        }
        // 中央目录结尾：最后 22 字节起往前找（后面可以跟最长 65535 字节的注释）
        let lowest = bytes.len().saturating_sub(22 + 0xFFFF);
        let end = (lowest..=bytes.len().saturating_sub(22))
            .rev()
            .find(|&i| u32_at(bytes, i) == Some(0x0605_4b50))
            .ok_or_else(|| not_zip("no end of central directory"))?;
        let count = u16_at(bytes, end + 10).ok_or_else(|| not_zip("truncated"))? as usize;
        let dir = u32_at(bytes, end + 16).ok_or_else(|| not_zip("truncated"))?;
        if dir == u32::MAX || count == 0xFFFF {
            return Err(not_zip("zip64 is not supported"));
        }
        let mut at = dir as usize;
        let mut entries = HashMap::new();
        for _ in 0..count {
            if u32_at(bytes, at) != Some(0x0201_4b50) {
                return Err(not_zip("a broken central directory"));
            }
            let field = |off: usize| u16_at(bytes, at + off).ok_or_else(|| not_zip("truncated"));
            let flags = field(8)?;
            let method = field(10)?;
            let compressed = u32_at(bytes, at + 20).ok_or_else(|| not_zip("truncated"))?;
            let size = u32_at(bytes, at + 24).ok_or_else(|| not_zip("truncated"))?;
            let name_len = field(28)? as usize;
            let extra_len = field(30)? as usize;
            let comment_len = field(32)? as usize;
            let offset = u32_at(bytes, at + 42).ok_or_else(|| not_zip("truncated"))?;
            let name = bytes.get(at + 46..at + 46 + name_len).ok_or_else(|| not_zip("truncated"))?;
            if flags & 1 != 0 {
                return Err(not_zip("encrypted entries are not supported"));
            }
            if compressed == u32::MAX || size == u32::MAX || offset == u32::MAX {
                return Err(not_zip("zip64 is not supported"));
            }
            let name = String::from_utf8_lossy(name).into_owned();
            if !name.ends_with('/') {
                entries.insert(
                    name,
                    Entry {
                        method,
                        compressed: compressed as usize,
                        size: size as usize,
                        offset: offset as usize,
                    },
                );
            }
            at += 46 + name_len + extra_len + comment_len;
        }
        Ok(Zip { bytes, entries })
    }

    /// `model.json` 所在的目录：根上，或者唯一的一层目录里。
    fn root(&self) -> Result<String, Error> {
        if self.entries.contains_key("model.json") {
            return Ok(String::new());
        }
        let nested: Vec<&String> = self
            .entries
            .keys()
            .filter(|k| k.ends_with("/model.json") && k.matches('/').count() == 1 && !k.starts_with("__MACOSX/"))
            .collect();
        match nested.as_slice() {
            [one] => Ok(one.trim_end_matches("model.json").to_string()),
            _ => Err(Error::invalid("the package has no model.json at its root")),
        }
    }

    fn has(&self, name: &str) -> bool {
        self.entries.contains_key(name)
    }

    fn read(&self, name: &str, limit: usize) -> Result<Vec<u8>, Error> {
        let e = self
            .entries
            .get(name)
            .ok_or_else(|| Error::new(ErrorKind::MissingFile, format!("the package has no \"{name}\"")))?;
        if e.size > limit {
            return Err(Error::too_large(format!("\"{name}\" unpacks to more than {limit} bytes")));
        }
        let b = self.bytes;
        if u32_at(b, e.offset) != Some(0x0403_4b50) {
            return Err(not_zip("an entry's local header is broken"));
        }
        let name_len = u16_at(b, e.offset + 26).ok_or_else(|| not_zip("truncated"))? as usize;
        let extra_len = u16_at(b, e.offset + 28).ok_or_else(|| not_zip("truncated"))? as usize;
        let start = e.offset + 30 + name_len + extra_len;
        let data = b
            .get(start..start + e.compressed)
            .ok_or_else(|| not_zip("an entry runs past the end"))?;
        match e.method {
            0 => Ok(data.to_vec()),
            8 => miniz_oxide::inflate::decompress_to_vec_with_limit(data, limit.min(e.size.max(1)))
                .map_err(|_| not_zip(&format!("\"{name}\" does not inflate"))),
            m => Err(not_zip(&format!("compression method {m} is not supported"))),
        }
    }
}
