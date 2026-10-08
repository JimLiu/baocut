//! Qwen-Image-2.1 的 MLX 引擎：加载（只核对清单、读分词表与调度器配置，不读权重）与一次生成的三段编排。
//!
//! MLX 是进程级单例，生成唯一动到的进程级状态是缓存上限，由 [`CacheLimit`] 进门设、出门还原；引擎析构后活跃内存回落到
//! [`UNLOADED_ACTIVE_MAX`] 以下（真跑测试核对）。与 v2 不同：权重文件经 [`VerifiedFiles`] 按清单取出；开发自检用的
//! 混搭精度选项（另给文本编码器 / DiT 目录）没有移植。

use std::path::PathBuf;
use std::time::Instant;

use anyhow::{Result, anyhow};
use mlx_rs::{Array, Dtype, memory, ops, random};

use super::dit::{Dit, Overflow, Precision};
use super::prompt::Prompter;
use super::scheduler::SchedulerConfig;
use super::{text_encoder, vae};
use crate::backend::mlx::runtime::{clear_memory_cache, ensure_metal_device, memory_snapshot};
use crate::bundle::{FAMILY_QWEN_IMAGE, VerifiedFiles};
use crate::image::{Cancelled, ImageEngine, ImageProgress, ImageRequest, RawImage};
use crate::protocol::{ErrorBody, codes};

/// DiT 阶段（含文本编码）的 MLX 空闲缓冲上限。footprint = 活跃 + 缓存，运行时缺省（物理内存 / 8，16 GB 机器上 2 GB）
/// 会让 footprint 比活跃内存高出整整 2 GB；每层权重与激活的尺寸逐层重复，256 MB 足够让分配器复用。
pub const DIT_CACHE_LIMIT: usize = 256 << 20;

/// VAE 阶段不留空闲缓冲：各块、各条带的张量尺寸都不同，缓存几乎复用不上，只会把 footprint 顶高（v2 实测 512²
/// 0.99 → 0.71 GB，解码耗时不变）。DiT 不用 0：它每步会慢约 5%，而 footprint 峰值并不在 DiT 阶段。
pub const VAE_CACHE_LIMIT: usize = 0;

#[cfg(test)]
/// 引擎析构之后 MLX 活跃内存的上限：三段权重、条件与 latent 都已析构，只剩 MLX 自己的小常驻；门槛留到 64 MB 容抖动。
pub const UNLOADED_ACTIVE_MAX: usize = 64 << 20;

/// 缓存上限的 RAII：进门记下进程当前上限并换成本阶段的，出门（正常返回、`?` 提前返回、panic 展开都算）先等 GPU
/// 做完已提交的工作，再还原原上限、清空缓存。还原是必须的：同一 Worker 之后的任务不能继承 VAE 阶段的 0。
pub struct CacheLimit {
    previous: usize,
}

impl CacheLimit {
    pub fn enter(limit: usize) -> Self {
        let previous = memory::set_cache_limit(limit);
        Self { previous }
    }

    /// 换阶段：设新上限并把旧阶段留下的空闲缓冲还给系统。
    pub fn phase(&self, limit: usize) -> Result<()> {
        memory::set_cache_limit(limit);
        clear_memory_cache()
    }

    /// 进门前的上限（出门时还原成它）。
    #[cfg(test)]
    pub fn previous(&self) -> usize {
        self.previous
    }
}

impl Drop for CacheLimit {
    fn drop(&mut self) {
        synchronize();
        memory::set_cache_limit(self.previous);
        let _ = clear_memory_cache();
    }
}

/// 等缺省 stream 上已提交的工作做完：eval 提交的命令可能仍持有数组，不等的话它们会在 clear 之后才回到缓存。
fn synchronize() {
    let stream = mlx_rs::Stream::task_local_or_default();
    // SAFETY: stream 在本调用期间存活；只等待该 stream 上已提交的工作。
    unsafe {
        let _ = mlx_sys::mlx_synchronize(stream.as_ptr());
    }
}

/// 进程当前与生命周期最大的 phys_footprint（活动监视器里「内存」一栏的口径，含 Metal 缓冲）。
pub fn footprint() -> (u64, u64) {
    // SAFETY: rusage_info_v4 是纯数据结构，零初始化合法；proc_pid_rusage 按 flavor 写满它。
    unsafe {
        let mut info: libc::rusage_info_v4 = std::mem::zeroed();
        let rc = libc::proc_pid_rusage(
            libc::getpid(),
            libc::RUSAGE_INFO_V4,
            (&mut info as *mut libc::rusage_info_v4).cast(),
        );
        if rc != 0 {
            return (0, 0);
        }
        (info.ri_phys_footprint, info.ri_lifetime_max_phys_footprint)
    }
}

/// 新阶段开始：MLX 峰值从这里重新计，[`mem`] 报的 peak 就是本阶段的。
fn phase_start() {
    memory::reset_peak_memory();
}

/// 计时开关打开时打一行内存快照。
fn mem(tag: &str) {
    if !super::timing() {
        return;
    }
    let (active, cache, peak) = memory_snapshot();
    let (fp, fp_max) = footprint();
    let gb = |v: u64| v as f64 / 1e9;
    eprintln!(
        "[mem] {tag}: active {:.2} GB, cache {:.2} GB, 阶段峰值 {:.2} GB｜footprint {:.2} GB，进程最大 {:.2} GB",
        gb(active as u64),
        gb(cache as u64),
        gb(peak as u64),
        gb(fp),
        gb(fp_max)
    );
}

/// `[1,H,W,4]`、范围 [-1,1] 的 VAE 输出 → 8 位 RGBA。
fn to_rgba(x: &Array) -> Result<RawImage> {
    if x.ndim() != 4 || x.dim(3) != 4 {
        return Err(anyhow!("VAE 输出形状不是 [1,H,W,4]：{:?}", x.shape()));
    }
    let (h, w) = (x.dim(1) as u32, x.dim(2) as u32);
    let y = x
        .as_dtype(Dtype::Float32)?
        .add(&Array::from_f32(1.0))?
        .multiply(&Array::from_f32(127.5))?;
    let y = ops::clip(&y, (0.0f32, 255.0f32))?.round(None)?;
    y.eval()?;
    let pixels: Vec<u8> = y.as_slice::<f32>().iter().map(|&v| v as u8).collect();
    Ok(RawImage {
        width: w,
        height: h,
        pixels,
    })
}

/// 生产配置（v2 `QwenOptions` 的缺省值；开发自检的对照项没有移植）。
#[derive(Debug, Clone)]
struct Options {
    /// `None` = auto：按本机实测在 f16 / bf16 里选（[`Precision::probe`]，每只引擎量一次）。
    dit_dtype: Option<Dtype>,
    /// 量化层整层解量化后按 dense 乘。缺省关。
    dit_dequant: bool,
    /// DiT 每层按多少个图像 token 分块算。
    dit_chunk: usize,
    /// 往返 PSNR 与 f32 一致，比 bf16 快（M2 没有原生 bf16 运算）；f16 解码出现非有限值时自动改 bf16 重解。
    vae_dtype: Dtype,
    /// VAE 尾段每条带的行数，`None` 自动选。
    vae_tail_rows: Option<usize>,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            dit_dtype: None,
            dit_dequant: false,
            dit_chunk: 1024,
            vae_dtype: Dtype::Float16,
            vae_tail_rows: None,
        }
    }
}

/// 按清单取出的文件。
struct Files {
    text_encoder: Vec<PathBuf>,
    transformer: Vec<PathBuf>,
    vae: Vec<PathBuf>,
    vae_config: PathBuf,
}

/// Qwen-Image-2.1 引擎。加载时不读权重：三段权重在每次生成里按阶段打开、用完即丢。
pub struct QwenImage {
    options: Options,
    files: Files,
    prompter: Prompter,
    scheduler: SchedulerConfig,
    /// auto 精度的探测结果；同一只引擎只量一次。
    picked: Option<Dtype>,
}

fn check(cancel: &dyn Fn() -> bool) -> Result<()> {
    if cancel() {
        return Err(Cancelled.into());
    }
    Ok(())
}

fn owned(files: Vec<&std::path::Path>) -> Vec<PathBuf> {
    files.into_iter().map(PathBuf::from).collect()
}

impl QwenImage {
    /// 先核对清单（缺文件是 `MODEL_NOT_INSTALLED`），再确认 Metal 设备，最后读分词表与调度器配置。
    pub fn load(files: &VerifiedFiles) -> Result<Self> {
        let tokenizer = files.require("processor/tokenizer.json")?.to_path_buf();
        let scheduler = files.require("scheduler/scheduler_config.json")?.to_path_buf();
        let files = Files {
            text_encoder: owned(files.require_extension_in("text_encoder", "safetensors")?),
            transformer: owned(files.require_extension_in("transformer", "safetensors")?),
            vae: owned(files.require_extension_in("vae", "safetensors")?),
            vae_config: files.require("vae/config.json")?.to_path_buf(),
        };
        ensure_metal_device()?;
        let corrupt = |what: &str, e: anyhow::Error| {
            ErrorBody::new(codes::MODEL_NOT_INSTALLED, format!("{what} 读不出来：{e:#}"))
                .with_details(serde_json::json!({ "component": "image", "reason": "unreadable" }))
        };
        let prompter = Prompter::load(&tokenizer).map_err(|e| corrupt("processor/tokenizer.json", e))?;
        let scheduler = SchedulerConfig::load(&scheduler).map_err(|e| corrupt("scheduler/scheduler_config.json", e))?;
        Ok(Self {
            options: Options::default(),
            files,
            prompter,
            scheduler,
            picked: None,
        })
    }

    fn compute_dtype(&mut self) -> Result<Dtype> {
        if let Some(d) = self.options.dit_dtype.or(self.picked) {
            return Ok(d);
        }
        let t = Instant::now();
        let p = Precision::probe()?;
        let d = p.pick();
        trace!(
            "[dit] 精度探测 {:.2}s：4-bit 矩阵乘 f16 {:.1} ms、bf16 {:.1} ms → {d:?}",
            t.elapsed().as_secs_f64(),
            p.f16_ms,
            p.bf16_ms
        );
        clear_memory_cache()?;
        self.picked = Some(d);
        Ok(d)
    }

    fn run(&mut self, request: &ImageRequest, progress: &mut dyn FnMut(ImageProgress), cancel: &dyn Fn() -> bool) -> Result<RawImage> {
        let total = Instant::now();
        let (w, h, steps) = (request.width as usize, request.height as usize, request.steps as usize);
        let (gh, gw) = (h / 16, w / 16);
        let guard = CacheLimit::enter(DIT_CACHE_LIMIT);
        check(cancel)?;
        let compute = self.compute_dtype()?;

        // 1. 文本编码
        progress(ImageProgress::EncodingPrompt);
        let t0 = Instant::now();
        phase_start();
        let ids = self.prompter.t2i_ids(&request.prompt);
        let cond = text_encoder::encode_streaming(&self.files.text_encoder, &ids, self.prompter.drop_idx())?;
        clear_memory_cache()?;
        trace!(
            "[text] {} tokens（丢弃系统前缀 {}）→ {:?}，{:.1}s",
            ids.len(),
            self.prompter.drop_idx(),
            cond.shape(),
            t0.elapsed().as_secs_f64()
        );
        mem("after text");
        check(cancel)?;

        // 2. DiT 去噪
        phase_start();
        let sigmas = self.scheduler.sigmas(steps, gh * gw);
        let prec = Precision {
            compute,
            dequant: self.options.dit_dequant,
        };
        let latents = match self.denoise(&cond, &sigmas, prec, request, progress, cancel) {
            // f16 只有 5 位指数；万一溢出就用与参考管线相同的 bf16 从头重跑（同一 seed）。
            Err(e) if e.downcast_ref::<Overflow>().is_some() => {
                trace!("[dit] {e}，改用 bf16 重跑");
                clear_memory_cache()?;
                let prec = Precision {
                    compute: Dtype::Bfloat16,
                    ..prec
                };
                self.denoise(&cond, &sigmas, prec, request, progress, cancel)?
            }
            r => r?,
        };
        drop(cond);
        check(cancel)?;
        guard.phase(VAE_CACHE_LIMIT)?;

        // 3. VAE 解码
        progress(ImageProgress::Decoding);
        let t2 = Instant::now();
        phase_start();
        let lat = latents.reshape(&[1, gh as i32, gw as i32, vae::Z_DIM])?;
        drop(latents);
        let tail_rows = self.options.vae_tail_rows;
        let decode = |dtype| -> Result<RawImage> {
            let dec = vae::Decoder::load(&self.files.vae, &self.files.vae_config, dtype)?;
            to_rgba(&dec.decode_normalized(&lat, tail_rows)?)
        };
        let vae_dtype = self.options.vae_dtype;
        let image = match decode(vae_dtype) {
            // f16 只有 5 位指数；万一上溢就用与 f32 同指数范围的 bf16 重解。
            Err(e) if vae_dtype == Dtype::Float16 => {
                trace!("[vae] {e:#}，改用 bf16 重解");
                clear_memory_cache()?;
                decode(Dtype::Bfloat16)?
            }
            r => r?,
        };
        trace!("[vae] 解码 {:.1}s", t2.elapsed().as_secs_f64());
        mem("vae done");
        drop(lat);
        drop(guard);
        trace!(
            "{w}x{h} {steps} steps seed {}（总计 {:.1}s）",
            request.seed,
            total.elapsed().as_secs_f64()
        );
        Ok(image)
    }

    fn denoise(
        &self,
        cond: &Array,
        sigmas: &[f64],
        prec: Precision,
        request: &ImageRequest,
        progress: &mut dyn FnMut(ImageProgress),
        cancel: &dyn Fn() -> bool,
    ) -> Result<Array> {
        let (gh, gw) = (request.height as usize / 16, request.width as usize / 16);
        let t1 = Instant::now();
        let dit = Dit::load(&self.files.transformer, prec)?;
        trace!(
            "[dit] 加载 {:.1}s（{:?}{}）",
            t1.elapsed().as_secs_f64(),
            prec.compute,
            if prec.dequant { "，整层解量化" } else { "" }
        );
        mem("dit loaded");
        let mut cache = dit.prepare_text(cond, gh, gw)?;
        let key = random::key(request.seed)?;
        let mut x = random::normal::<f32>(&[1, (gh * gw) as i32, vae::Z_DIM], None, None, &key)?;
        let total = request.steps;
        progress(ImageProgress::Denoising { done: 0, total });
        for i in 0..total as usize {
            check(cancel)?;
            let ts = Instant::now();
            let v = dit.step(&mut cache, &x, sigmas[i], gh, gw, self.options.dit_chunk)?;
            let dt = (sigmas[i + 1] - sigmas[i]) as f32;
            x = x.add(&v.multiply(&Array::from_f32(dt))?)?;
            x.eval()?;
            trace!(
                "[dit] step {}/{total} sigma {:.4} {:.2}s",
                i + 1,
                sigmas[i],
                ts.elapsed().as_secs_f64()
            );
            progress(ImageProgress::Denoising { done: i as u32 + 1, total });
        }
        mem("dit done");
        Ok(x)
    }
}

impl ImageEngine for QwenImage {
    fn family(&self) -> &'static str {
        FAMILY_QWEN_IMAGE
    }

    fn default_steps(&self) -> u32 {
        super::DEFAULT_STEPS
    }

    fn check_size(&self, width: u32, height: u32) -> Result<(), ErrorBody> {
        super::check_size(width, height)
    }

    fn generate(&mut self, request: &ImageRequest, progress: &mut dyn FnMut(ImageProgress), cancel: &dyn Fn() -> bool) -> Result<RawImage> {
        super::check_size(request.width, request.height)?;
        if request.steps == 0 {
            return Err(ErrorBody::invalid_params("steps 至少 1").into());
        }
        let image = self.run(request, progress, cancel)?;
        if (image.width, image.height) != (request.width, request.height) {
            return Err(anyhow!(
                "解码尺寸 {}x{} 与请求 {}x{} 不符",
                image.width,
                image.height,
                request.width,
                request.height
            ));
        }
        Ok(image)
    }
}

impl Drop for QwenImage {
    fn drop(&mut self) {
        synchronize();
        let _ = clear_memory_cache();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::mlx::runtime::MLX_TEST_LOCK;
    use crate::bundle::{FileEntry, ModelFiles};

    fn lock() -> std::sync::MutexGuard<'static, ()> {
        MLX_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    #[test]
    fn cache_limit_guard_restores_the_previous_limit_even_on_panic() {
        let _lock = lock();
        if ensure_metal_device().is_err() {
            return;
        }
        let base = memory::set_cache_limit(123 << 20);
        {
            let g = CacheLimit::enter(DIT_CACHE_LIMIT);
            assert_eq!(g.previous(), 123 << 20);
            g.phase(VAE_CACHE_LIMIT).unwrap();
        }
        assert_eq!(memory::set_cache_limit(123 << 20), 123 << 20);
        let r = std::panic::catch_unwind(|| {
            let _g = CacheLimit::enter(0);
            panic!("boom");
        });
        assert!(r.is_err());
        assert_eq!(memory::set_cache_limit(base), 123 << 20);
    }

    #[test]
    fn load_reports_files_missing_from_the_manifest_as_not_installed() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("processor")).unwrap();
        std::fs::write(dir.path().join("processor/tokenizer.json"), b"{}").unwrap();
        let files = ModelFiles {
            family: FAMILY_QWEN_IMAGE.into(),
            revision: "r".into(),
            dir: dir.path().to_string_lossy().into_owned(),
            files: vec![FileEntry {
                path: "processor/tokenizer.json".into(),
                sha256: "0".repeat(64),
                byte_length: 2,
            }],
        }
        .verify("image")
        .unwrap();
        let error = match QwenImage::load(&files) {
            Ok(_) => panic!("不该加载成功"),
            Err(error) => error.downcast_ref::<ErrorBody>().expect("ErrorBody").clone(),
        };
        assert_eq!(error.code, codes::MODEL_NOT_INSTALLED);
        assert!(error.message.contains("scheduler/scheduler_config.json"), "{}", error.message);
    }

    /// 按 `.bcut-manifest.json` 拼 `image` 组件（只读；不写安装记录）。
    fn installed(root: &std::path::Path) -> VerifiedFiles {
        let dir = root.join("mlx-community/Qwen-Image-2.1-MLX-4bit");
        let manifest: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.join(".bcut-manifest.json")).expect("read .bcut-manifest.json")).unwrap();
        let files = manifest["files"]
            .as_array()
            .unwrap()
            .iter()
            .map(|file| FileEntry {
                path: file["path"].as_str().unwrap().into(),
                sha256: file["sha256"].as_str().unwrap_or_default().into(),
                byte_length: file["size"].as_u64().unwrap(),
            })
            .collect();
        ModelFiles {
            family: FAMILY_QWEN_IMAGE.into(),
            revision: manifest["revision"].as_str().unwrap().into(),
            dir: dir.to_string_lossy().into_owned(),
            files,
        }
        .verify("image")
        .unwrap()
    }

    /// 真跑（要装好的权重，约 1 分钟）：256² 2 步生成一张，核对尺寸、阶段、缓存上限已还原、引擎析构后活跃内存回落。
    ///
    /// ```sh
    /// BAOCUT_TEST_MODELS_DIR=/path/to/models cargo test -p model-runtime --lib -- --ignored \
    ///   engine_releases_memory_and_restores_the_cache_limit --test-threads=1 --nocapture
    /// ```
    #[test]
    #[ignore = "需要 BAOCUT_TEST_MODELS_DIR 下装好的 Qwen-Image-2.1 与 Metal"]
    fn engine_releases_memory_and_restores_the_cache_limit() {
        let _lock = lock();
        let root = std::env::var("BAOCUT_TEST_MODELS_DIR").expect("BAOCUT_TEST_MODELS_DIR");
        let files = installed(std::path::Path::new(&root));
        // 量峰值时可以换尺寸：`BAOCUT_TEST_IMAGE_EDGE=1024`（正方形，2 步；峰值与步数无关）。
        let edge: u32 = std::env::var("BAOCUT_TEST_IMAGE_EDGE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(256);
        let before = memory::set_cache_limit(77 << 20);
        let mut engine = QwenImage::load(&files).unwrap();
        let request = ImageRequest {
            prompt: "a red apple on a wooden table".into(),
            width: edge,
            height: edge,
            steps: 2,
            seed: 7,
        };
        let mut phases = Vec::new();
        let image = engine.generate(&request, &mut |p| phases.push(p), &|| false).unwrap();
        assert_eq!((image.width, image.height), (edge, edge));
        assert_eq!(image.pixels.len(), (edge * edge * 4) as usize);
        assert_eq!(phases.first(), Some(&ImageProgress::EncodingPrompt));
        assert_eq!(phases.last(), Some(&ImageProgress::Decoding));
        assert!(phases.contains(&ImageProgress::Denoising { done: 0, total: 2 }));
        assert!(phases.contains(&ImageProgress::Denoising { done: 2, total: 2 }));
        drop(engine);
        let (active, cache, peak) = memory_snapshot();
        let (_, footprint_max) = footprint();
        eprintln!("析构后 MLX active {active} B、cache {cache} B、峰值 {peak} B；进程 footprint 最大 {footprint_max} B");
        assert!(active < UNLOADED_ACTIVE_MAX, "析构后活跃内存 {active} B");
        assert_eq!(cache, 0, "析构后缓存应已清空");
        assert_eq!(memory::set_cache_limit(before), 77 << 20, "缓存上限没还原");
    }
}
