//! 媒体层的画面：每个视频实例一条顺序解码流，图片解一次（SVG 与 GIF 图片由帧光栅从素材字节自己解，见 `asset_bytes`；
//! 这里的 SVG 分支只接媒体类型没记成 SVG、文件却是 `.svg` 的素材）；解出来的非预乘 RGBA
//! 换成预乘的画面交给帧光栅。视频帧的像素从解码器换过来（不复制），解码器还在同一帧时原样再用；探测说素材不带透明时
//! alpha 全是 255、本来就是预乘的，不逐像素预乘。Lottie 贴纸要的素材字节按冻结的位置读；声波要的素材频谱从冻结的声音文件算，每个素材版本
//! 算一次（[`frame_render::spectrum::analyze_file`]）。
//! 一段时间没用到的解码流关掉（子进程不攒着），再用到时从目标前的关键帧重开。

use std::collections::HashMap;

use frame_render::support::{UnsupportedItem, kind_name};
use frame_render::{LayerMedia, RenderError, premultiplied};
use media_core::Tools;
use media_core::decode::{VideoDecoder, decode_still};
use media_core::probe::probe_picture;
use render_graph::{LayerKind, VisualLayer};
use tiny_skia::{IntSize, Pixmap};
use video_model::VersionRef;

use crate::input::Input;
use crate::preflight::AssetPicture;

/// 解码流闲置这么多输出帧之后关掉。
const IDLE_FRAMES: u64 = 90;

enum Media {
    Video {
        decoder: Box<VideoDecoder>,
        /// 当前帧（预乘）。像素是从解码器换出来的，不复制。
        pixmap: Option<Pixmap>,
        /// `pixmap` 是解码器的哪一帧（[`VideoDecoder::advance`] 的代号）。
        generation: u64,
        /// 素材可能带透明：要逐像素预乘；不带时解出来的 alpha 都是 255，预乘不改任何值，跳过。
        alpha: bool,
    },
    Still(Pixmap),
}

pub struct Sources<'a> {
    input: &'a Input,
    tools: Tools,
    pictures: HashMap<(String, String), AssetPicture>,
    skip: bool,
    media: HashMap<String, Media>,
    last_used: HashMap<String, u64>,
    frame: u64,
    skipped: Vec<UnsupportedItem>,
    /// `素材ID@版本` → 素材频谱；算不出来（没有冻结的位置、没有声音）时是 `None`，声波按占位画并报提示。
    spectra: HashMap<String, Option<Vec<u8>>>,
}

impl<'a> Sources<'a> {
    pub fn new(input: &'a Input, tools: Tools, pictures: HashMap<(String, String), AssetPicture>, skip: bool) -> Sources<'a> {
        Sources {
            input,
            tools,
            pictures,
            skip,
            media: HashMap::new(),
            last_used: HashMap::new(),
            frame: 0,
            skipped: Vec::new(),
            spectra: HashMap::new(),
        }
    }

    /// 开始第 `k` 个输出帧：关掉闲置的解码流。
    pub fn begin_frame(&mut self, k: u64) {
        self.frame = k;
        let idle: Vec<String> = self
            .last_used
            .iter()
            .filter(|(_, used)| k.saturating_sub(**used) > IDLE_FRAMES)
            .map(|(id, _)| id.clone())
            .collect();
        for id in idle {
            if let Some(Media::Video { decoder, .. }) = self.media.get_mut(&id) {
                decoder.close();
            }
            self.last_used.remove(&id);
        }
    }

    /// 解码流重开的总次数（倒退、远跳与闲置关掉后再用到；顺序导出里没有这些时是 0）。
    pub fn restarts(&self) -> u32 {
        self.media
            .values()
            .map(|m| match m {
                Media::Video { decoder, .. } => decoder.restarts(),
                Media::Still(_) => 0,
            })
            .sum()
    }

    /// 跳过模式下，执行时才发现解不出来的素材。
    pub fn skipped(&self) -> &[UnsupportedItem] {
        &self.skipped
    }

    /// 停掉所有解码进程。
    pub fn close(&mut self) {
        for media in self.media.values_mut() {
            if let Media::Video { decoder, .. } = media {
                decoder.close();
            }
        }
    }

    fn picture_info(&mut self, layer: &VisualLayer) -> Result<Option<AssetPicture>, RenderError> {
        let Some(asset) = &layer.asset else {
            return Err(RenderError::new(
                "EXPORT_RENDER_FAILED",
                format!("媒体层 {} 没有素材", layer.item_id),
            ));
        };
        let key = (asset.id.clone(), asset.revision.clone());
        if let Some(info) = self.pictures.get(&key) {
            return Ok(Some(info.clone()));
        }
        // 预检没见过的素材（不该发生）：现在探测，解不出来时按选项跳过或报错。
        let problem = match self.input.asset(&asset.id, &asset.revision) {
            None => format!("素材 {} 没有冻结的位置", asset.id),
            Some(entry) => match probe_picture(&self.tools, &entry.path) {
                Ok(Some(info)) => {
                    let picture = AssetPicture {
                        path: entry.path.clone(),
                        width: info.width,
                        height: info.height,
                        svg: false,
                        alpha: info.alpha,
                    };
                    self.pictures.insert(key, picture.clone());
                    return Ok(Some(picture));
                }
                Ok(None) => "素材里没有画面".to_string(),
                Err(e) => e.message,
            },
        };
        let item = UnsupportedItem {
            item_id: layer.item_id.clone(),
            scope: "asset",
            layer_kind: kind_name(layer.kind),
            effect_id: None,
            transition_id: None,
            kind: Some(asset.id.clone()),
            reason: "asset-undecodable".into(),
            message: problem,
        };
        if !self.skip {
            return Err(RenderError {
                code: "EXPORT_UNSUPPORTED_CONTENT".into(),
                message: item.message.clone(),
                items: vec![item],
            });
        }
        if !self.skipped.iter().any(|s| s.item_id == item.item_id) {
            self.skipped.push(item);
        }
        Ok(None)
    }
}

fn decode_error(e: media_core::MediaError) -> RenderError {
    RenderError::new(e.code, e.message)
}

/// 非预乘的 RGBA 就地换成预乘的。
fn premultiply(data: &mut [u8]) {
    for px in data.chunks_exact_mut(4) {
        let a = px[3] as u32;
        if a < 255 {
            for c in &mut px[..3] {
                *c = ((*c as u32 * a + 127) / 255) as u8;
            }
        }
    }
}

impl LayerMedia for Sources<'_> {
    fn picture(&mut self, layer: &VisualLayer) -> Result<Option<&Pixmap>, RenderError> {
        let id = layer.item_id.clone();
        if !self.media.contains_key(&id) {
            let Some(info) = self.picture_info(layer)? else {
                return Ok(None);
            };
            let media = if layer.kind == LayerKind::Image && info.svg {
                let bytes =
                    std::fs::read(&info.path).map_err(|e| RenderError::new("EXPORT_DECODE_FAILED", format!("SVG 图片读不到：{e}")))?;
                let long_edge = crate::preflight::svg_long_edge(self.input);
                Media::Still(
                    frame_render::decode_svg(&bytes, long_edge)
                        .map_err(|e| RenderError::new("EXPORT_DECODE_FAILED", format!("SVG 图片解不开：{e:#}")))?,
                )
            } else if layer.kind == LayerKind::Image {
                let picture = decode_still(&self.tools, &info.path, info.width, info.height).map_err(decode_error)?;
                Media::Still(
                    premultiplied(picture.width, picture.height, picture.data)
                        .ok_or_else(|| RenderError::new("EXPORT_DECODE_FAILED", "图片的尺寸不对"))?,
                )
            } else {
                let asset = layer.asset.as_ref().expect("上面查过");
                let origin = self.input.pts_origin(&asset.id, &asset.revision);
                Media::Video {
                    decoder: Box::new(VideoDecoder::new(&self.tools, &info.path, origin, info.width, info.height)),
                    pixmap: None,
                    generation: 0,
                    alpha: info.alpha,
                }
            };
            self.media.insert(id.clone(), media);
        }
        self.last_used.insert(id.clone(), self.frame);
        match self.media.get_mut(&id).expect("上面放进去了") {
            Media::Still(pixmap) => Ok(Some(pixmap)),
            Media::Video {
                decoder,
                pixmap,
                generation,
                alpha,
            } => {
                let seconds = layer.source_seconds.unwrap_or(0.0).max(0.0);
                let current = decoder.advance(seconds).map_err(decode_error)?;
                if pixmap.is_none() || *generation != current {
                    // 换上新的一帧：上一帧的缓冲还给解码器，新一帧的像素直接做成画面。
                    let spare = pixmap.take().map(Pixmap::take).unwrap_or_default();
                    let mut picture = decoder.swap_current(spare).expect("advance 成功就有当前帧");
                    if *alpha {
                        premultiply(&mut picture.data);
                    }
                    let size = IntSize::from_wh(picture.width, picture.height)
                        .ok_or_else(|| RenderError::new("EXPORT_DECODE_FAILED", "画面的尺寸不对"))?;
                    *pixmap = Some(
                        Pixmap::from_vec(picture.data, size).ok_or_else(|| RenderError::new("EXPORT_DECODE_FAILED", "画面的尺寸不对"))?,
                    );
                    *generation = current;
                }
                Ok(pixmap.as_ref())
            }
        }
    }

    fn asset_bytes(&mut self, asset: &VersionRef) -> Option<Vec<u8>> {
        let entry = self.input.asset(&asset.id, &asset.revision)?;
        std::fs::read(&entry.path).ok()
    }

    fn audio_spectrum(&mut self, asset: &VersionRef) -> Option<Vec<u8>> {
        let key = frame_render::spectrum::asset_key(asset);
        if let Some(cached) = self.spectra.get(&key) {
            return cached.clone();
        }
        let spectrum = self
            .input
            .asset(&asset.id, &asset.revision)
            .and_then(|entry| frame_render::spectrum::analyze_file(&entry.path, &self.tools.ffmpeg).ok());
        self.spectra.insert(key, spectrum.clone());
        spectrum
    }
}
