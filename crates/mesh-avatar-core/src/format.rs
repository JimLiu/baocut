//! Load a built project directory or a stored ZIP .mavatar archive.

use crate::rig::{Eye, Rig};
use anyhow::{bail, ensure, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Cursor, Read, Seek, SeekFrom},
    path::Path,
};

const MAX_ENTRIES: usize = 200;
const MAX_SIZE: u64 = 64 * 1024 * 1024;
pub type Rect = [u32; 4];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub format: String,
    pub version: u32,
    pub name: String,
    pub author: Option<String>,
    pub license: Option<String>,
    pub thumbnail: Option<String>,
    pub source: Option<String>,
    pub studio: Option<Studio>,
    #[serde(rename = "lipSync")]
    pub lip_sync: Option<Value>,
    pub expressions: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Studio {
    pub version: String,
}

impl Manifest {
    fn parse(bytes: &[u8]) -> Result<Self> {
        let raw: Value =
            serde_json::from_slice(bytes).context("avatar.json: invalid manifest JSON")?;
        if let Some(settings) = raw.get("lipSync") {
            crate::engine::lip_sync::LipSyncSettings::parse(settings)?;
        }
        if let Some(settings) = raw.get("expressions") {
            crate::engine::expression::ExpressionSettings::parse(settings)?;
        }
        let m: Self = serde_json::from_value(raw).context("avatar.json: invalid manifest JSON")?;
        ensure!(
            m.format == "mesh-avatar" && m.version == 1,
            "avatar.json: unsupported format or version"
        );
        ensure!(
            !m.name.trim().is_empty(),
            "avatar.json.name must not be empty"
        );
        if let Some(studio) = &m.studio {
            ensure!(
                !studio.version.trim().is_empty(),
                "avatar.json.studio.version must not be empty"
            );
        }
        Ok(m)
    }

    fn default_named(name: String) -> Self {
        Self {
            format: "mesh-avatar".into(),
            version: 1,
            name,
            author: None,
            license: None,
            thumbnail: None,
            source: None,
            studio: None,
            lip_sync: None,
            expressions: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EyeCurves {
    pub x0: f64,
    pub x1: f64,
    pub top: [f64; 24],
    pub bot: [f64; 24],
}

impl EyeCurves {
    fn matches(&self, eye: &Eye) -> bool {
        self.x0 == eye.x0 && self.x1 == eye.x1 && self.top == eye.top && self.bot == eye.bot
    }
}

fn legacy_version() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayerMetadata {
    #[serde(default = "legacy_version")]
    pub version: u32,
    pub build: String,
    pub size: [u32; 2],
    pub layers: BTreeMap<String, Rect>,
    pub eyes: [EyeCurves; 2],
}

#[derive(Debug, Clone, Serialize)]
pub struct SpriteMetadata {
    pub version: u32,
    pub build: String,
    pub layers: BTreeMap<String, Rect>,
    /// JSON insertion order, used for stable sprite cross-fade draw ordering.
    #[serde(skip)]
    pub layer_order: Vec<String>,
}

impl<'de> Deserialize<'de> for SpriteMetadata {
    fn deserialize<D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<Self, D::Error> {
        struct OrderedLayers(Vec<(String, Rect)>);
        impl<'de> Deserialize<'de> for OrderedLayers {
            fn deserialize<D: serde::Deserializer<'de>>(
                deserializer: D,
            ) -> std::result::Result<Self, D::Error> {
                struct Visitor;
                impl<'de> serde::de::Visitor<'de> for Visitor {
                    type Value = OrderedLayers;
                    fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                        f.write_str("a layer rectangle map")
                    }
                    fn visit_map<M: serde::de::MapAccess<'de>>(
                        self,
                        mut map: M,
                    ) -> std::result::Result<Self::Value, M::Error> {
                        let mut entries: Vec<(String, Rect)> = Vec::new();
                        while let Some((name, rect)) = map.next_entry::<String, Rect>()? {
                            if let Some((_, value)) =
                                entries.iter_mut().find(|(key, _)| *key == name)
                            {
                                *value = rect;
                            } else {
                                entries.push((name, rect));
                            }
                        }
                        Ok(OrderedLayers(entries))
                    }
                }
                deserializer.deserialize_map(Visitor)
            }
        }
        #[derive(Deserialize)]
        struct Metadata {
            #[serde(default = "legacy_version")]
            version: u32,
            build: String,
            layers: OrderedLayers,
        }
        let value = Metadata::deserialize(deserializer)?;
        let layer_order = value
            .layers
            .0
            .iter()
            .map(|(name, _)| name.clone())
            .collect();
        Ok(Self {
            version: value.version,
            build: value.build,
            layers: value.layers.0.into_iter().collect(),
            layer_order,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlayDefinition {
    pub name: String,
    pub file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlayMetadata {
    #[serde(default = "legacy_version")]
    pub version: u32,
    pub overlays: Vec<OverlayDefinition>,
}

impl OverlayMetadata {
    fn parse(bytes: &[u8]) -> Result<Self> {
        const PATH: &str = "built/overlays/overlays.json";
        let value: Value =
            serde_json::from_slice(bytes).context("built/overlays/overlays.json: invalid JSON")?;
        ensure!(value.is_object(), "{PATH}: expected an object");
        if let Some(version) = value.get("version") {
            ensure!(
                version.as_f64() == Some(1.0),
                "{PATH}.version: unsupported version {version} (expected 1)"
            );
        }
        let entries = value
            .get("overlays")
            .and_then(Value::as_array)
            .with_context(|| format!("{PATH}.overlays: expected an array"))?;
        let safe = |name: &str| {
            !name.is_empty()
                && name
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
        };
        let mut overlays = Vec::new();
        let mut seen = BTreeSet::new();
        for (i, entry) in entries.iter().enumerate() {
            let name = entry.get("name").and_then(Value::as_str);
            let file = entry.get("file").and_then(Value::as_str);
            ensure!(
                name.is_some_and(safe)
                    && file.and_then(|s| s.strip_suffix(".png")).is_some_and(safe),
                "{PATH}.overlays[{i}]: expected {{ name, file }} with safe names"
            );
            let name = name.unwrap();
            ensure!(
                seen.insert(name.to_owned()),
                "{PATH}.overlays[{i}].name: duplicate overlay name"
            );
            overlays.push(OverlayDefinition {
                name: name.into(),
                file: file.unwrap().into(),
            });
        }
        Ok(Self {
            version: 1,
            overlays,
        })
    }
}

#[derive(Debug, Clone)]
pub struct Texture {
    pub width: u32,
    pub height: u32,
    /// Straight RGBA, retaining original red/alpha channels for CPU masks.
    pub rgba: Vec<u8>,
}

impl Texture {
    pub fn alpha(&self) -> Vec<u8> {
        self.rgba.as_chunks::<4>().0.iter().map(|p| p[3]).collect()
    }

    /// RGBA upload data matching WebGL's premultiplied-alpha texture convention.
    pub fn premultiplied_rgba(&self) -> Vec<u8> {
        let mut pixels = self.rgba.clone();
        for p in pixels.as_chunks_mut::<4>().0 {
            let alpha = u32::from(p[3]);
            for c in &mut p[..3] {
                *c = ((u32::from(*c) * alpha + 127) / 255) as u8;
            }
        }
        pixels
    }

    pub fn decode(bytes: &[u8]) -> Result<Self> {
        let mut decoder = png::Decoder::new(Cursor::new(bytes));
        decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
        decoder.set_limits(png::Limits {
            bytes: MAX_SIZE as usize,
        });
        let mut reader = decoder.read_info().context("invalid PNG header")?;
        let info = reader.info();
        let rgba_size = u64::from(info.width)
            .checked_mul(u64::from(info.height))
            .and_then(|n| n.checked_mul(4))
            .context("PNG dimensions overflow")?;
        ensure!(rgba_size <= MAX_SIZE, "decoded PNG exceeds 64 MB");
        let mut bytes = vec![0; reader.output_buffer_size()];
        let output = reader
            .next_frame(&mut bytes)
            .context("invalid PNG pixels")?;
        let bytes = &bytes[..output.buffer_size()];
        let mut rgba = Vec::with_capacity(rgba_size as usize);
        match output.color_type {
            png::ColorType::Rgba => rgba.extend_from_slice(bytes),
            png::ColorType::Rgb => {
                for p in bytes.as_chunks::<3>().0 {
                    rgba.extend([p[0], p[1], p[2], 255]);
                }
            }
            png::ColorType::Grayscale => {
                for &v in bytes {
                    rgba.extend([v, v, v, 255]);
                }
            }
            png::ColorType::GrayscaleAlpha => {
                for p in bytes.as_chunks::<2>().0 {
                    rgba.extend([p[0], p[0], p[0], p[1]]);
                }
            }
            png::ColorType::Indexed => bail!("PNG palette was not expanded"),
        }
        Ok(Self {
            width: output.width,
            height: output.height,
            rgba,
        })
    }
}

#[derive(Debug)]
pub struct AvatarPackage {
    pub manifest: Manifest,
    pub rig: Rig,
    pub layers: LayerMetadata,
    pub sprites: Option<SpriteMetadata>,
    pub overlays: Option<OverlayMetadata>,
    /// Keys relative to built/, for example base.png or sprites/mouth_a.png.
    pub textures: BTreeMap<String, Texture>,
}

fn check_entry_name(name: &str) -> Result<()> {
    let b = name.as_bytes();
    ensure!(
        !name.is_empty()
            && !name.starts_with('/')
            && !name.contains(['\\', '\0'])
            && !(b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':')
            && !name.split('/').any(|s| s == ".."),
        "unsafe asset path: {name}"
    );
    Ok(())
}

fn bounded_read(reader: impl Read) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader.take(MAX_SIZE + 1).read_to_end(&mut bytes)?;
    ensure!(bytes.len() as u64 <= MAX_SIZE, "file exceeds 64 MB");
    Ok(bytes)
}

// zip's filename map deduplicates names. Check the raw directory first so duplicate
// entries and inconsistent local headers cannot silently change the loaded avatar.
fn check_zip_directory(reader: &mut (impl Read + Seek)) -> Result<()> {
    fn read_at(reader: &mut (impl Read + Seek), offset: u64, size: usize) -> Result<Vec<u8>> {
        reader.seek(SeekFrom::Start(offset))?;
        let mut bytes = vec![0; size];
        reader.read_exact(&mut bytes).context("truncated ZIP")?;
        Ok(bytes)
    }
    let u16_at = |b: &[u8], i| u16::from_le_bytes([b[i], b[i + 1]]);
    let u32_at = |b: &[u8], i| u32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]);
    let size = reader.seek(SeekFrom::End(0))?;
    let tail_size = size.min(65557) as usize;
    ensure!(tail_size >= 22, "truncated ZIP end record");
    let tail = read_at(reader, size - tail_size as u64, tail_size)?;
    let end = (0..=tail_size - 22)
        .rev()
        .find(|&i| {
            u32_at(&tail, i) == 0x06054b50 && i + 22 + u16_at(&tail, i + 20) as usize == tail_size
        })
        .context("invalid ZIP end record")?;
    ensure!(
        u16_at(&tail, end + 4) == 0
            && u16_at(&tail, end + 6) == 0
            && u16_at(&tail, end + 8) == u16_at(&tail, end + 10),
        "multi-disk ZIP is unsupported"
    );
    let count = u16_at(&tail, end + 10) as usize;
    ensure!(
        count <= MAX_ENTRIES,
        "archive exceeds {MAX_ENTRIES} entries"
    );
    let directory = u64::from(u32_at(&tail, end + 16));
    let directory_end = directory + u64::from(u32_at(&tail, end + 12));
    ensure!(
        directory_end == size - tail_size as u64 + end as u64,
        "invalid ZIP directory size"
    );
    let mut position = directory;
    let mut seen = BTreeSet::new();
    for _ in 0..count {
        ensure!(position + 46 <= directory_end, "truncated ZIP directory");
        let header = read_at(reader, position, 46)?;
        ensure!(
            u32_at(&header, 0) == 0x02014b50,
            "invalid ZIP directory header"
        );
        let name_len = u16_at(&header, 28) as usize;
        let next = position
            + 46
            + name_len as u64
            + u64::from(u16_at(&header, 30))
            + u64::from(u16_at(&header, 32));
        ensure!(next <= directory_end, "truncated ZIP directory entry");
        let name_bytes = read_at(reader, position + 46, name_len)?;
        let name = std::str::from_utf8(&name_bytes).context("ZIP filename must be UTF-8")?;
        check_entry_name(name)?;
        ensure!(seen.insert(name.to_owned()), "duplicate ZIP entry: {name}");
        let compressed = u64::from(u32_at(&header, 20));
        let uncompressed = u64::from(u32_at(&header, 24));
        let flags = u16_at(&header, 8);
        ensure!(
            compressed <= MAX_SIZE && uncompressed <= MAX_SIZE,
            "ZIP entry {name}: exceeds 64 MB"
        );
        ensure!(
            u16_at(&header, 10) == 0 && compressed == uncompressed,
            "ZIP entry {name}: expected stored compression"
        );
        ensure!(
            flags & 1 == 0,
            "ZIP entry {name}: encryption is unsupported"
        );
        let offset = u64::from(u32_at(&header, 42));
        ensure!(offset + 30 <= directory, "invalid local ZIP offset");
        let local = read_at(reader, offset, 30)?;
        ensure!(
            u32_at(&local, 0) == 0x04034b50 && u16_at(&local, 8) == 0 && u16_at(&local, 6) == flags,
            "inconsistent local ZIP header"
        );
        let local_name_len = u16_at(&local, 26) as usize;
        let start = offset + 30 + local_name_len as u64 + u64::from(u16_at(&local, 28));
        ensure!(start + uncompressed <= directory, "truncated ZIP payload");
        ensure!(
            read_at(reader, offset + 30, local_name_len)? == name_bytes,
            "inconsistent local ZIP filename"
        );
        position = next;
    }
    ensure!(position == directory_end, "invalid ZIP entry count");
    reader.rewind()?;
    Ok(())
}

fn unpack(mut reader: impl Read + Seek) -> Result<BTreeMap<String, Vec<u8>>> {
    check_zip_directory(&mut reader)?;
    let mut zip = zip::ZipArchive::new(reader).context("invalid .mavatar ZIP")?;
    ensure!(
        zip.len() <= MAX_ENTRIES,
        "archive exceeds {MAX_ENTRIES} entries"
    );
    let mut files = BTreeMap::new();
    for i in 0..zip.len() {
        let file = zip.by_index(i).context("unreadable ZIP entry")?;
        let name = std::str::from_utf8(file.name_raw())
            .context("ZIP filename must be UTF-8")?
            .to_owned();
        check_entry_name(&name)?;
        ensure!(!files.contains_key(&name), "duplicate ZIP entry: {name}");
        ensure!(
            file.compression() == zip::CompressionMethod::Stored,
            "ZIP entry {name}: expected stored compression"
        );
        ensure!(
            file.size() <= MAX_SIZE && file.compressed_size() <= MAX_SIZE,
            "ZIP entry {name}: exceeds 64 MB"
        );
        files.insert(
            name.clone(),
            bounded_read(file).with_context(|| format!("ZIP entry {name}"))?,
        );
    }
    ensure!(
        files.contains_key("avatar.json"),
        "avatar.json: missing file in .mavatar archive"
    );
    Ok(files)
}

fn validate_rectangles(layers: &BTreeMap<String, Rect>, size: [u32; 2]) -> Result<()> {
    for (name, &[x, y, w, h]) in layers {
        ensure!(
            !name.is_empty()
                && name
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-'),
            "unsafe layer name: {name}"
        );
        ensure!(
            w > 0
                && h > 0
                && u64::from(x) + u64::from(w) <= u64::from(size[0])
                && u64::from(y) + u64::from(h) <= u64::from(size[1]),
            "layer {name}: rectangle must stay inside image"
        );
    }
    Ok(())
}

impl AvatarPackage {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        if !path.is_dir() {
            return Self::from_archive(
                fs::File::open(path).context("could not open avatar archive")?,
            );
        }
        let root = path
            .canonicalize()
            .context("could not open avatar folder")?;
        let read = |name: &str| -> Result<Option<Vec<u8>>> {
            check_entry_name(name)?;
            let resolved = match root.join(name).canonicalize() {
                Ok(path) => path,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
                Err(e) => return Err(e).with_context(|| format!("could not resolve {name}")),
            };
            ensure!(
                resolved.starts_with(&root),
                "asset escapes project folder: {name}"
            );
            Ok(Some(
                bounded_read(fs::File::open(resolved)?)
                    .with_context(|| format!("could not read {name}"))?,
            ))
        };
        let name = root
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("Avatar")
            .to_owned();
        Self::load(read, Some(name))
    }

    pub fn from_archive(reader: impl Read + Seek) -> Result<Self> {
        let files = unpack(reader)?;
        Self::load(|name| Ok(files.get(name).cloned()), None)
    }

    fn load(
        read: impl Fn(&str) -> Result<Option<Vec<u8>>>,
        folder_name: Option<String>,
    ) -> Result<Self> {
        let required = |name: &str| read(name)?.with_context(|| format!("{name}: missing file"));
        let layers: LayerMetadata = serde_json::from_slice(&required("built/layers.json")?)
            .context("built/layers.json: invalid metadata")?;
        ensure!(
            layers.version == 1 && !layers.build.trim().is_empty(),
            "built/layers.json: unsupported version or empty build"
        );
        let mut raw: Value =
            serde_json::from_slice(&required("rig.json")?).context("rig.json: invalid JSON")?;
        // Legacy folder rigs can get baked eye curves from layer metadata; archives must contain them.
        if folder_name.is_some() {
            if let Some(eyes) = raw.get_mut("eyes").and_then(Value::as_array_mut) {
                for (eye, curves) in eyes.iter_mut().zip(&layers.eyes) {
                    if let Some(eye) = eye.as_object_mut() {
                        for (key, value) in serde_json::to_value(curves)?.as_object().unwrap() {
                            eye.entry(key.clone()).or_insert_with(|| value.clone());
                        }
                    }
                }
            }
        }
        let rig = Rig::parse(&serde_json::to_vec(&raw)?)?;
        ensure!(
            layers.size == [rig.image.width, rig.image.height],
            "built/layers.json.size must match rig image dimensions"
        );
        validate_rectangles(&layers.layers, layers.size)?;
        for (curves, eye) in layers.eyes.iter().zip(&rig.eyes) {
            ensure!(
                curves.matches(eye),
                "built/layers.json eyes must match rig eye curves"
            );
        }
        for i in 0..2 {
            for part in ["ball", "low", "crease", "lash"] {
                let name = format!("eye{i}_{part}");
                ensure!(
                    layers.layers.contains_key(&name),
                    "missing required layer: {name}"
                );
            }
        }
        if rig.hand.is_some() {
            ensure!(
                layers.layers.contains_key("hand"),
                "missing required hand layer"
            );
        }
        for accessory in &rig.accessories {
            ensure!(
                layers.layers.contains_key(&accessory.name),
                "missing accessory layer: {}",
                accessory.name
            );
        }
        for cloth in &rig.cloth {
            ensure!(
                layers.layers.contains_key(&format!("cloth_{}", cloth.name)),
                "missing cloth layer: {}",
                cloth.name
            );
        }
        let manifest = match read("avatar.json")? {
            Some(bytes) => Manifest::parse(&bytes)?,
            None => Manifest::default_named(folder_name.context("avatar.json: missing manifest")?),
        };
        let sprites: Option<SpriteMetadata> = read("built/sprites/sprites.json")?
            .map(|bytes| {
                serde_json::from_slice(&bytes)
                    .context("built/sprites/sprites.json: invalid metadata")
            })
            .transpose()?;
        if let Some(sprites) = &sprites {
            ensure!(
                sprites.version == 1 && !sprites.build.trim().is_empty(),
                "sprites metadata: unsupported version or empty build"
            );
            validate_rectangles(&sprites.layers, layers.size)?;
        }
        let overlays = read("built/overlays/overlays.json")?
            .map(|bytes| OverlayMetadata::parse(&bytes))
            .transpose()?;
        let mut image_rects = BTreeMap::from([
            (
                if rig.cloth.is_empty() {
                    "base.png"
                } else {
                    "base_cloth.png"
                }
                .to_owned(),
                [0, 0, rig.image.width, rig.image.height],
            ),
            (
                "hairmask.png".to_owned(),
                [0, 0, rig.image.width, rig.image.height],
            ),
        ]);
        for (name, rect) in &layers.layers {
            image_rects.insert(format!("{name}.png"), *rect);
        }
        if let Some(sprites) = &sprites {
            for (name, rect) in &sprites.layers {
                image_rects.insert(format!("sprites/{name}.png"), *rect);
            }
        }
        if let Some(overlays) = &overlays {
            for item in &overlays.overlays {
                image_rects.insert(
                    format!("overlays/{}", item.file),
                    [0, 0, rig.image.width, rig.image.height],
                );
            }
        }
        let mut textures = BTreeMap::new();
        for (name, rect) in image_rects {
            let texture = Texture::decode(&required(&format!("built/{name}"))?)
                .with_context(|| format!("built/{name}"))?;
            ensure!(
                [texture.width, texture.height] == [rect[2], rect[3]],
                "built/{name}: PNG dimensions must match rectangle"
            );
            textures.insert(name, texture);
        }
        Ok(Self {
            manifest,
            rig,
            layers,
            sprites,
            overlays,
            textures,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn duplicate_sprite_keys_keep_first_position_and_last_rectangle() {
        let metadata: SpriteMetadata = serde_json::from_str(r#"{"build":"test","layers":{"eyes_half_0":[0,0,1,1],"eyes_closed_0":[1,1,2,2],"eyes_half_0":[2,2,3,3]}}"#).unwrap();
        assert_eq!(metadata.layer_order, ["eyes_half_0", "eyes_closed_0"]);
        assert_eq!(metadata.layers["eyes_half_0"], [2, 2, 3, 3]);
    }
    use std::{
        io::Write,
        sync::{
            atomic::{AtomicUsize, Ordering},
            OnceLock,
        },
    };

    fn png_bytes(width: u32, height: u32, color: png::ColorType, pixels: &[u8]) -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, width, height);
            encoder.set_color(color);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .write_header()
                .unwrap()
                .write_image_data(pixels)
                .unwrap();
        }
        bytes
    }

    fn fixture() -> BTreeMap<String, Vec<u8>> {
        static FILES: OnceLock<BTreeMap<String, Vec<u8>>> = OnceLock::new();
        FILES
            .get_or_init(|| {
                let mut files = BTreeMap::from([
                    (
                        "avatar.json".into(),
                        include_bytes!("../tests/fixtures/xiaoli/avatar.json").to_vec(),
                    ),
                    (
                        "rig.json".into(),
                        include_bytes!("../tests/fixtures/xiaoli/rig.json").to_vec(),
                    ),
                    (
                        "built/layers.json".into(),
                        include_bytes!("../tests/fixtures/xiaoli/built/layers.json").to_vec(),
                    ),
                    (
                        "built/sprites/sprites.json".into(),
                        include_bytes!("../tests/fixtures/xiaoli/built/sprites/sprites.json")
                            .to_vec(),
                    ),
                ]);
                let layers: LayerMetadata =
                    serde_json::from_slice(&files["built/layers.json"]).unwrap();
                let sprites: SpriteMetadata =
                    serde_json::from_slice(&files["built/sprites/sprites.json"]).unwrap();
                let mut rects = BTreeMap::from([
                    ("base".to_owned(), [0, 0, layers.size[0], layers.size[1]]),
                    (
                        "hairmask".to_owned(),
                        [0, 0, layers.size[0], layers.size[1]],
                    ),
                ]);
                rects.extend(layers.layers);
                rects.extend(
                    sprites
                        .layers
                        .into_iter()
                        .map(|(n, r)| (format!("sprites/{n}"), r)),
                );
                for (name, [_, _, w, h]) in rects {
                    // Synthetic opaque images; the loader tests do not depend on sample PNGs.
                    files.insert(
                        format!("built/{name}.png"),
                        png_bytes(
                            w,
                            h,
                            png::ColorType::Grayscale,
                            &vec![255; (w * h) as usize],
                        ),
                    );
                }
                files
            })
            .clone()
    }

    fn archive(files: &BTreeMap<String, Vec<u8>>) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in files {
            writer
                .start_file(
                    name,
                    zip::write::SimpleFileOptions::default()
                        .compression_method(zip::CompressionMethod::Stored),
                )
                .unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn load(files: &BTreeMap<String, Vec<u8>>, folder: bool) -> Result<AvatarPackage> {
        AvatarPackage::load(
            |name| Ok(files.get(name).cloned()),
            folder.then(|| "Test Avatar".to_owned()),
        )
    }

    fn edit_json(files: &mut BTreeMap<String, Vec<u8>>, name: &str, edit: impl FnOnce(&mut Value)) {
        let mut value = serde_json::from_slice(&files[name]).unwrap();
        edit(&mut value);
        files.insert(name.into(), serde_json::to_vec(&value).unwrap());
    }

    #[test]
    fn cloth_assets_are_required_in_folders_and_archives() {
        let mut files = fixture();
        edit_json(&mut files, "rig.json", |r| {
            r["cloth"] = serde_json::json!([{
                "name":"skirt", "outline":[[0,0],[20,0],[20,30],[0,30]],
                "waist":[[0,0],[20,0]], "hem":[[0,30],[20,30]]
            }])
        });
        assert!(load(&files, true).is_err());
        edit_json(&mut files, "built/layers.json", |v| {
            v["layers"]["cloth_skirt"] = serde_json::json!([0, 0, 20, 30])
        });
        files.insert(
            "built/cloth_skirt.png".into(),
            png_bytes(20, 30, png::ColorType::Grayscale, &vec![255; 600]),
        );
        assert!(load(&files, true).is_err());
        files.insert(
            "built/base_cloth.png".into(),
            files["built/base.png"].clone(),
        );
        for folder in [true, false] {
            let package = load(&files, folder).unwrap();
            let mut avatar = crate::Avatar::from_package(package).unwrap();
            let frame = avatar.tick(0.0);
            assert_eq!(frame.layers[0].texture, "base_cloth.png");
            assert!(frame.layers.iter().any(|l| l.name == "cloth_skirt"));
        }
        let packed = AvatarPackage::from_archive(Cursor::new(archive(&files))).unwrap();
        assert!(packed.textures.contains_key("base_cloth.png"));
        files.insert(
            "built/cloth_skirt.png".into(),
            png_bytes(1, 1, png::ColorType::Grayscale, &[255]),
        );
        assert!(load(&files, true).is_err());
    }

    struct TestFolder(std::path::PathBuf);
    impl TestFolder {
        fn new(files: &BTreeMap<String, Vec<u8>>) -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let path = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../target/test-fixtures")
                .join(format!(
                    "{}-{}",
                    std::process::id(),
                    NEXT.fetch_add(1, Ordering::Relaxed)
                ));
            fs::create_dir_all(&path).unwrap();
            for (name, bytes) in files {
                let file = path.join(name);
                fs::create_dir_all(file.parent().unwrap()).unwrap();
                fs::write(file, bytes).unwrap();
            }
            Self(path)
        }
    }
    impl Drop for TestFolder {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn opens_archive_and_folder_with_all_assets() {
        let files = fixture();
        let folder = TestFolder::new(&files);
        let folder_avatar = AvatarPackage::open(&folder.0).unwrap();
        let archive_path = folder.0.join("avatar.mavatar");
        fs::write(&archive_path, archive(&files)).unwrap();
        let packed = AvatarPackage::open(archive_path).unwrap();
        assert_eq!(packed.manifest.name, folder_avatar.manifest.name);
        assert_eq!(packed.textures.len(), 20);
        assert_eq!(packed.textures.len(), folder_avatar.textures.len());
        for (name, texture) in &packed.textures {
            assert_eq!(texture.rgba, folder_avatar.textures[name].rgba);
        }
    }

    #[test]
    fn overlay_metadata_accepts_legacy_and_unknown_keys_but_rejects_unsafe_lists() {
        for value in [
            serde_json::json!({"overlays":[]}),
            serde_json::json!({"version":1,"future":true,"overlays":[{"name":"glasses-1","file":"frame_2.png","future":0}]}),
        ] {
            assert_eq!(
                OverlayMetadata::parse(&serde_json::to_vec(&value).unwrap())
                    .unwrap()
                    .version,
                1
            );
        }
        for (value, expected) in [
            (
                serde_json::json!({"version":2,"overlays":[]}),
                ".version: unsupported version",
            ),
            (
                serde_json::json!({"version":null,"overlays":[]}),
                ".version: unsupported version",
            ),
            (
                serde_json::json!({"overlays":{}}),
                ".overlays: expected an array",
            ),
            (serde_json::json!({}), ".overlays: expected an array"),
            (serde_json::json!({"overlays":[null]}), "safe names"),
            (
                serde_json::json!({"overlays":[{"name":"glasses"}]}),
                "safe names",
            ),
            (
                serde_json::json!({"overlays":[{"name":"../x","file":"frame.png"}]}),
                "safe names",
            ),
            (
                serde_json::json!({"overlays":[{"name":"x","file":"../frame.png"}]}),
                "safe names",
            ),
            (
                serde_json::json!({"overlays":[{"name":"x","file":"frame.jpg"}]}),
                "safe names",
            ),
            (
                serde_json::json!({"overlays":[{"name":"x","file":"frame.png"},{"name":"x","file":"other.png"}]}),
                "duplicate overlay name",
            ),
        ] {
            let error = OverlayMetadata::parse(&serde_json::to_vec(&value).unwrap())
                .unwrap_err()
                .to_string();
            assert!(error.contains(expected), "{error}");
        }
    }

    #[test]
    fn overlays_load_from_folders_and_archives_and_require_full_size_pngs() {
        let mut files = fixture();
        assert!(load(&files, false).unwrap().overlays.is_none());
        files.insert(
            "built/overlays/overlays.json".into(),
            br#"{"overlays":[{"name":"glasses","file":"frame.png"}]}"#.to_vec(),
        );
        for folder in [false, true] {
            assert!(load(&files, folder)
                .unwrap_err()
                .to_string()
                .contains("built/overlays/frame.png: missing file"));
        }
        let [width, height] = load(&fixture(), false).unwrap().layers.size;
        let image = "built/overlays/frame.png";
        files.insert(
            image.into(),
            png_bytes(
                width,
                height,
                png::ColorType::Grayscale,
                &vec![255; (width * height) as usize],
            ),
        );
        let folder = TestFolder::new(&files);
        let unpacked = AvatarPackage::open(&folder.0).unwrap();
        let packed = AvatarPackage::from_archive(Cursor::new(archive(&files))).unwrap();
        assert_eq!(
            packed.overlays.as_ref().unwrap().overlays[0].name,
            "glasses"
        );
        assert_eq!(
            packed.textures["overlays/frame.png"].rgba,
            unpacked.textures["overlays/frame.png"].rgba
        );
        for bytes in [
            vec![1, 2, 3],
            png_bytes(1, 1, png::ColorType::Grayscale, &[255]),
        ] {
            files.insert(image.into(), bytes);
            for folder in [false, true] {
                assert!(load(&files, folder).is_err());
            }
            assert!(AvatarPackage::from_archive(Cursor::new(archive(&files))).is_err());
        }
    }

    #[test]
    fn folder_defaults_and_legacy_curves_are_not_archive_defaults() {
        let mut files = fixture();
        files.remove("avatar.json");
        edit_json(&mut files, "rig.json", |v| {
            for eye in v["eyes"].as_array_mut().unwrap() {
                for field in ["x0", "x1", "top", "bot"] {
                    eye.as_object_mut().unwrap().remove(field);
                }
            }
        });
        let avatar = load(&files, true).unwrap();
        assert_eq!(avatar.manifest.name, "Test Avatar");
        assert!(avatar.layers.eyes[0].matches(&avatar.rig.eyes[0]));
        assert!(AvatarPackage::from_archive(Cursor::new(archive(&files))).is_err());
        files.insert("avatar.json".into(), fixture()["avatar.json"].clone());
        assert!(load(&files, false).is_err());
    }

    #[test]
    fn optional_features_and_unknown_fields_remain_compatible() {
        let mut files = fixture();
        files.remove("built/sprites/sprites.json");
        edit_json(&mut files, "rig.json", |v| {
            let object = v.as_object_mut().unwrap();
            for field in ["buns", "strands", "accessories", "hand"] {
                object.remove(field);
            }
            object.insert("futureFeature".into(), serde_json::json!({"enabled": true}));
        });
        let avatar = load(&files, false).unwrap();
        assert!(avatar.sprites.is_none());
        assert!(avatar.rig.strands.is_empty());
        assert!(avatar.rig.hand.is_none());
    }

    #[test]
    fn manifest_validates_expression_settings() {
        let parse = |settings: Value| {
            let bytes = serde_json::to_vec(&serde_json::json!({
                "format":"mesh-avatar", "version":1, "name":"Example", "expressions":settings
            }))
            .unwrap();
            Manifest::parse(&bytes)
        };
        for value in [Value::Null, serde_json::json!([]), serde_json::json!(false)] {
            assert_eq!(
                parse(value).unwrap_err().to_string(),
                "expressions: expected an object"
            );
        }
        assert_eq!(
            parse(serde_json::json!({"surprise":null}))
                .unwrap_err()
                .to_string(),
            "expressions.surprise: expected an object"
        );
        for value in [
            serde_json::json!(2),
            serde_json::json!(-1),
            serde_json::json!("0.5"),
            Value::Null,
        ] {
            assert_eq!(
                parse(serde_json::json!({"surprise":{"mouthOpen":value}}))
                    .unwrap_err()
                    .to_string(),
                "expressions.surprise.mouthOpen: expected 0–1"
            );
        }
        let settings = serde_json::json!({"surprise":{"mouthOpen":0.45,"future":null},"neutral":null,"unknown":false});
        assert_eq!(parse(settings.clone()).unwrap().expressions, Some(settings));
        assert!(Manifest::default_named("Example".into())
            .expressions
            .is_none());
    }

    #[test]
    fn rejects_bad_rigs_metadata_and_images() {
        type Mutation = (&'static str, fn(&mut Value));
        let mutations: &[Mutation] = &[
            ("avatar.json", |v| v["expressions"] = Value::Null),
            ("avatar.json", |v| {
                v["expressions"] = serde_json::json!({"surprise":{"mouthOpen":2}})
            }),
            ("avatar.json", |v| v["lipSync"] = Value::Null),
            ("avatar.json", |v| {
                v["lipSync"] = serde_json::json!({"granularity":2})
            }),
            ("rig.json", |v| v["version"] = 2.into()),
            ("rig.json", |v| v["head"]["rx"] = 0.into()),
            ("rig.json", |v| v["mesh"]["baseCell"] = 0.into()),
            ("rig.json", |v| v["mesh"]["eyeCell"] = 1.5.into()),
            ("rig.json", |v| v["eyes"][0]["top"] = serde_json::json!([1])),
            ("rig.json", |v| v["view"]["padSide"] = (-0.5).into()),
            ("built/layers.json", |v| v["version"] = 2.into()),
            ("built/layers.json", |v| v["size"][0] = 1.into()),
            ("built/layers.json", |v| v["eyes"][0]["top"][0] = 0.into()),
            ("built/layers.json", |v| {
                v["layers"].as_object_mut().unwrap().remove("eye0_ball");
            }),
            ("built/sprites/sprites.json", |v| {
                v["layers"]["../escape"] = serde_json::json!([0, 0, 1, 1])
            }),
        ];
        for &(name, edit) in mutations {
            let mut files = fixture();
            edit_json(&mut files, name, edit);
            assert!(load(&files, true).is_err(), "accepted invalid {name}");
        }
        for name in [
            "built/base.png",
            "built/hairmask.png",
            "built/sprites/mouth_a.png",
        ] {
            let mut files = fixture();
            files.remove(name);
            assert!(load(&files, true).is_err(), "accepted missing {name}");
            files.insert(name.into(), vec![1, 2, 3]);
            assert!(load(&files, true).is_err(), "accepted corrupt {name}");
            files.insert(
                name.into(),
                png_bytes(1, 1, png::ColorType::Grayscale, &[255]),
            );
            assert!(
                load(&files, true).is_err(),
                "accepted wrong dimensions for {name}"
            );
        }
    }

    #[test]
    fn rejects_unsafe_archive_entries_and_inconsistent_headers() {
        for name in ["../evil", "/evil", "C:evil", "built\\evil"] {
            let files = BTreeMap::from([(name.to_owned(), vec![1])]);
            assert!(unpack(Cursor::new(archive(&files))).is_err());
        }
        let mut data = archive(&BTreeMap::from([
            ("one".into(), vec![1]),
            ("two".into(), vec![2]),
        ]));
        // Rewrite both occurrences of a same-length filename to create a duplicate.
        for i in 0..data.len() - 2 {
            if &data[i..i + 3] == b"two" {
                data[i..i + 3].copy_from_slice(b"one");
            }
        }
        assert!(unpack(Cursor::new(data))
            .unwrap_err()
            .to_string()
            .contains("duplicate"));
        let good = archive(&BTreeMap::from([("one".into(), vec![1])]));
        let mut bad = good.clone();
        bad[30] = b'x';
        assert!(unpack(Cursor::new(bad)).is_err());
        assert!(unpack(Cursor::new(&good[..good.len() - 1])).is_err());
        let mut too_many = good;
        let end = too_many.len() - 22;
        too_many[end + 8..end + 12].copy_from_slice(&[201, 0, 201, 0]);
        assert!(unpack(Cursor::new(too_many))
            .unwrap_err()
            .to_string()
            .contains("entries"));
    }

    #[test]
    fn decodes_png_channels_and_premultiplies_for_upload() {
        for (color, pixels, expected) in [
            (
                png::ColorType::Grayscale,
                vec![100],
                vec![100, 100, 100, 255],
            ),
            (
                png::ColorType::GrayscaleAlpha,
                vec![100, 128],
                vec![100, 100, 100, 128],
            ),
            (png::ColorType::Rgb, vec![20, 40, 60], vec![20, 40, 60, 255]),
            (
                png::ColorType::Rgba,
                vec![20, 40, 60, 128],
                vec![20, 40, 60, 128],
            ),
        ] {
            let texture = Texture::decode(&png_bytes(1, 1, color, &pixels)).unwrap();
            assert_eq!(texture.rgba, expected);
            assert_eq!(texture.alpha(), [expected[3]]);
        }
        let texture =
            Texture::decode(&png_bytes(1, 1, png::ColorType::Rgba, &[20, 40, 60, 128])).unwrap();
        assert_eq!(texture.premultiplied_rgba(), [10, 20, 30, 128]);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_folder_symlinks_outside_project() {
        let folder = TestFolder::new(&fixture());
        let outside = TestFolder::new(&BTreeMap::from([("base.png".into(), vec![1])]));
        fs::remove_file(folder.0.join("built/base.png")).unwrap();
        std::os::unix::fs::symlink(
            outside.0.canonicalize().unwrap().join("base.png"),
            folder.0.join("built/base.png"),
        )
        .unwrap();
        let error = AvatarPackage::open(&folder.0).unwrap_err();
        assert!(error.to_string().contains("escapes project"));
    }
}
