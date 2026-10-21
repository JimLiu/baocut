use compositor::{CaptionGpuRenderer, RenderTarget};
use render_raster::{
    TextEngine,
    drawop::{AssociatedBlend, BitmapData},
    effects::material_plan::{ImageQuad, MaterialLayer, MaterialSource},
};
use serde::Deserialize;
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};
use subtitle_render::scene::{SceneCue, ScenePlan, SceneWord};
use wasm_bindgen::prelude::*;
fn err(value: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&value.to_string())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    style: serde_json::Value,
    #[serde(default)]
    presentation: caption_scene::Presentation,
    cues: Vec<Cue>,
    instance_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Cue {
    id: String,
    document_id: String,
    text: String,
    start: f64,
    end: f64,
    #[serde(default)]
    words: Vec<Word>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Word {
    id: String,
    text: String,
    start: f64,
    end: f64,
}
/// Owns one canvas and GPU device. Host fonts, frozen assets and semantic inputs
/// remain explicit. A lost device returns an error; recreate from the same inputs.
#[wasm_bindgen]
pub struct GpuCaptions {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    view_format: wgpu::TextureFormat,
    renderer: CaptionGpuRenderer,
    plan: Option<ScenePlan>,
    fonts: Vec<Vec<u8>>,
    assets: BTreeMap<String, Vec<u8>>,
    background: Option<Arc<BitmapData>>,
    failure: Arc<Mutex<Option<String>>>,
    backend: String,
    adapter: String,
}
#[wasm_bindgen]
impl GpuCaptions {
    #[wasm_bindgen(js_name=create)]
    pub async fn create(canvas: web_sys::HtmlCanvasElement, width: u32, height: u32, backend: &str) -> Result<GpuCaptions, JsValue> {
        console_error_panic_hook::set_once();
        let backends = match backend {
            "webgpu" => wgpu::Backends::BROWSER_WEBGPU,
            "webgl2" => wgpu::Backends::GL,
            _ => return Err(err("gpu-backend-invalid")),
        };
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends,
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        });
        let surface = instance.create_surface(wgpu::SurfaceTarget::Canvas(canvas.clone())).map_err(err)?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                ..Default::default()
            })
            .await
            .map_err(err)?;
        let info = adapter.get_info();
        if info.device_type == wgpu::DeviceType::Cpu {
            return Err(err("gpu-software-adapter"));
        }
        if width == 0
            || height == 0
            || width > adapter.limits().max_texture_dimension_2d
            || height > adapter.limits().max_texture_dimension_2d
        {
            return Err(err("gpu-caption-size-limit"));
        }
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("baocut.caption.browser-device"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::downlevel_webgl2_defaults()
                    .using_resolution(adapter.limits())
                    .using_alignment(adapter.limits()),
                ..Default::default()
            })
            .await
            .map_err(err)?;
        let failure = Arc::new(Mutex::new(None));
        let errors = failure.clone();
        device.on_uncaptured_error(Arc::new(move |e| {
            if let Ok(mut slot) = errors.lock() {
                *slot = Some(format!("gpu-validation: {e}"));
            }
        }));
        let lost = failure.clone();
        device.set_device_lost_callback(move |reason, message| {
            if let Ok(mut slot) = lost.lock() {
                *slot = Some(format!("gpu-device-lost: {reason:?} {message}"));
            }
        });
        canvas.set_width(width);
        canvas.set_height(height);
        let caps = surface.get_capabilities(&adapter);
        let mut config = surface
            .get_default_config(&adapter, width, height)
            .ok_or_else(|| err("gpu-surface-unsupported"))?;
        let view_format = config.format.remove_srgb_suffix();
        if caps.formats.contains(&view_format) {
            config.format = view_format;
        } else if view_format != config.format {
            config.view_formats.push(view_format);
        }
        config.desired_maximum_frame_latency = 2;
        surface.configure(&device, &config);
        let backend = format!("{:?}", info.backend).to_lowercase();
        let adapter = info.name;
        let renderer = CaptionGpuRenderer::from_device(device.clone(), queue.clone(), backend.clone(), adapter.clone());
        Ok(Self {
            surface,
            device,
            queue,
            config,
            view_format,
            renderer,
            plan: None,
            fonts: Vec::new(),
            assets: BTreeMap::new(),
            background: None,
            failure,
            backend,
            adapter,
        })
    }
    #[wasm_bindgen(getter)]
    pub fn backend(&self) -> String {
        self.backend.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn adapter(&self) -> String {
        self.adapter.clone()
    }
    #[wasm_bindgen(js_name=addFont)]
    pub fn add_font(&mut self, bytes: Vec<u8>) -> Result<(), JsValue> {
        if self.fonts.iter().map(Vec::len).sum::<usize>().saturating_add(bytes.len()) > 128 * 1024 * 1024 {
            return Err(err("gpu-font-budget"));
        }
        self.fonts.push(bytes);
        self.plan = None;
        Ok(())
    }
    #[wasm_bindgen(js_name=setAsset)]
    pub fn set_asset(&mut self, key: String, bytes: Vec<u8>) -> Result<(), JsValue> {
        let old = self.assets.get(&key).map_or(0, Vec::len);
        if self
            .assets
            .values()
            .map(Vec::len)
            .sum::<usize>()
            .saturating_sub(old)
            .saturating_add(bytes.len())
            > 256 * 1024 * 1024
        {
            return Err(err("gpu-asset-budget"));
        }
        self.assets.insert(key, bytes);
        self.plan = None;
        Ok(())
    }
    #[wasm_bindgen(js_name=setBackdrop)]
    pub fn set_backdrop(&mut self, rgba: Vec<u8>) -> Result<(), JsValue> {
        if rgba.len() as u64 != u64::from(self.config.width) * u64::from(self.config.height) * 4
            || rgba.chunks_exact(4).any(|p| p[3] != 255)
        {
            return Err(err("gpu-opaque-backdrop-required"));
        }
        self.background = Some(Arc::new(BitmapData {
            width: self.config.width,
            height: self.config.height,
            rgba: rgba.into(),
        }));
        Ok(())
    }
    pub fn load(&mut self, json: &str) -> Result<(), JsValue> {
        let input: Input = serde_json::from_str(json).map_err(err)?;
        let style = caption_scene::parse_style(&input.style).map_err(err)?;
        let text = self
            .plan
            .take()
            .map(ScenePlan::into_text_engine)
            .unwrap_or_else(|| TextEngine::with_document_fonts(&self.fonts));
        let cues = input
            .cues
            .into_iter()
            .map(|c| SceneCue {
                id: c.id,
                document_id: c.document_id,
                text: c.text,
                start: c.start,
                end: c.end,
                words: c
                    .words
                    .into_iter()
                    .map(|w| SceneWord {
                        id: w.id,
                        text: w.text,
                        start: w.start,
                        end: w.end,
                    })
                    .collect(),
            })
            .collect();
        let mut plan = ScenePlan::compile(
            style,
            input.presentation,
            cues,
            (self.config.width, self.config.height),
            text,
            input.instance_id,
        )
        .map_err(err)?;
        plan.load_resources(|r| self.assets.get(&format!("{}@{}", r.asset_ref.id, r.asset_ref.revision)).cloned())
            .map_err(err)?;
        self.plan = Some(plan);
        Ok(())
    }
    pub fn render(&mut self, seconds: f64) -> Result<String, JsValue> {
        if let Some(message) = self.failure.lock().map_err(err)?.as_ref() {
            return Err(err(message));
        }
        let background = self.background.as_ref().ok_or_else(|| err("gpu-caption-backdrop-missing"))?.clone();
        let (mut frame, _) = self
            .plan
            .as_mut()
            .ok_or_else(|| err("gpu-caption-plan-missing"))?
            .record_material_plan(seconds)
            .map_err(err)?;
        frame.layers.insert(
            0,
            MaterialLayer {
                source: MaterialSource::Image(ImageQuad {
                    bitmap: background,
                    domain: [0.0, 0.0, self.config.width as f64, self.config.height as f64],
                    uv_scale: [1.0, 1.0],
                    uv_offset: [0.0, 0.0],
                }),
                materials: Vec::new(),
                blend: AssociatedBlend::SourceOver,
            },
        );
        let output = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(output) | wgpu::CurrentSurfaceTexture::Suboptimal(output) => output,
            wgpu::CurrentSurfaceTexture::Outdated => {
                self.surface.configure(&self.device, &self.config);
                return Err(err("gpu-surface-outdated"));
            }
            wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => return Err(err("gpu-surface-unavailable")),
            wgpu::CurrentSurfaceTexture::Lost => return Err(err("gpu-surface-lost")),
            wgpu::CurrentSurfaceTexture::Validation => return Err(err("gpu-surface-validation")),
        };
        let view = output.texture.create_view(&wgpu::TextureViewDescriptor {
            format: Some(self.view_format),
            ..Default::default()
        });
        let stats = self
            .renderer
            .render(
                &frame,
                RenderTarget {
                    view: &view,
                    width: self.config.width,
                    height: self.config.height,
                    format: self.view_format,
                },
                true,
            )
            .map_err(err)?;
        self.queue.present(output);
        Ok(serde_json::json!({"submissions":stats.submissions,"materialPasses":stats.material_passes,"preparedMasks":stats.prepared_masks,"noiseFieldUploads":stats.noise_field_uploads,"residentSurfaceBytes":stats.resident_surface_bytes,"backend":self.backend}).to_string())
    }
    /// Resolves after GPU completion, not just command submission. No pixel readback.
    /// WebGL hosts must call `pollCompletion()` on subsequent event-loop turns.
    pub fn completed(&self) -> js_sys::Promise {
        let queue = self.queue.clone();
        js_sys::Promise::new(&mut move |resolve, _reject| {
            queue.on_submitted_work_done(move || {
                let _ = resolve.call0(&JsValue::NULL);
            });
        })
    }
    /// Drives wgpu-core's WebGL completion callbacks without blocking the browser.
    /// Browser WebGPU delivers its callbacks itself; this is a no-op there.
    #[wasm_bindgen(js_name=pollCompletion)]
    pub fn poll_completion(&self) -> Result<(), JsValue> {
        if self.backend == "gl" {
            self.device.poll(wgpu::PollType::Poll).map_err(err)?;
        }
        if let Some(message) = self.failure.lock().map_err(err)?.as_ref() {
            return Err(err(message));
        }
        Ok(())
    }
}
