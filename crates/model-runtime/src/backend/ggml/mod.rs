//! whisper.cpp（ggml）跨平台 Whisper 后端，从 v2 `bcut-speech` 的 `ggml_backend` 原样移植。
//!
//! 与 `candle` 并列：candle 承担 Qwen3 / MOSS / VAD / 对齐器，这里只
//! 承担 Whisper。ggml 的 CPU 内核全平台可用；GPU 按 feature 编进 ggml 的后端：
//! `whisper-ggml-cuda` 编 CUDA 后端（NVIDIA，构建要 CUDA Toolkit），
//! `whisper-ggml-vulkan` 编 Vulkan 后端（AMD / Intel / NVIDIA 显卡与核显，运行期
//! 只依赖显卡驱动自带的 Vulkan 运行时）。两个可以同时编进来。CUDA 与 Vulkan 都还
//! 没有在实机上跑过（未实测）。`whisper-ggml-metal` 编 macOS Metal 后端，已用 AMD Radeon Pro 5500M
//! 与 Whisper large-v3 Turbo q8_0 实测；Intel Worker 禁用 ggml 的并发 Metal 调度以避免独显上的计算错误。
//!
//! 设备选择：`BAOCUT_GPU=off` 强制 CPU；否则取 ggml 枚举到的第一个 GPU 设备（与
//! whisper.cpp 的 `gpu_device = 0` 是同一台），前提是 ggml 能在它上面算 Whisper 的
//! 核心算子（[`GgmlDevice::runs_whisper`]；Vulkan 不核对）。算不了的 GPU 当作没有：whisper.cpp 照样
//! 把权重放进显存，每次计算再整份拷回 CPU 去算，比纯 CPU 还慢（Radeon Pro 560X
//! 这类只支持到 Metal 2 的显卡实测慢一倍，issue #109）。没有可用的 GPU 就 CPU 并打印
//! 一次可见的回退提示（与 candle CUDA 的回退提示同形——没有任何报错、只是慢一个
//! 数量级的静默退化最难定位）。ggml 的 registry 先登记 CUDA、后登记 Vulkan，所以
//! 两个都编进来时 NVIDIA 机器上选到的是 CUDA；没有 NVIDIA 驱动时 CUDA 后端报 0 个
//! 设备（只打日志、不中止进程），选到的是 Vulkan。
//!
//! v3 的边界：模型包的 `asr` 组件（family `whisper-ggml`）列出一个 `.bin`（单文件 GGML 权重，词表内嵌，没有 `tokenizer`
//! 组件）；切段的 Silero VAD 与可选的强制对齐器是 candle 的（[`super::candle`]），所以 `whisper-ggml` 连带 `backend-candle`。
//! `worker.hello` 报 `devices`：用得上 GPU 时 `[<所选 GPU 的设备名>, "cpu"]`（`cuda`、`vulkan` 或 `metal`，见
//! [`GgmlDevice::protocol_label`]），否则 `["cpu"]`；模型包的 `device` 是 `cpu` 时一律跑 CPU。

pub mod whisper;

pub use whisper::WhisperGgml;

use std::ffi::CStr;
use std::sync::Once;

use serde_json::json;

use super::candle::{self, DiarizerSlot, ForcedAligner, SileroVad};
use super::{Backend, LoadedModel, ModelPhase, PhaseCallback, RunMode};
use crate::bundle::{FAMILY_WHISPER_GGML, VerifiedBundle};
use crate::protocol::{BackendStatus, ErrorBody, MemorySnapshot, codes, transcription_not_wired};
use crate::speech::{ForcedAlignment, SpeakerDiarization};

pub use crate::gpu_env::{GPU_ENV, gpu_disabled_by_env};

/// ggml 认的设备名（协议的设备标签）。
pub const DEVICE_CPU: &str = "cpu";
pub const DEVICE_CUDA: &str = "cuda";
pub const DEVICE_VULKAN: &str = "vulkan";
pub const DEVICE_METAL: &str = "metal";

/// ggml 看到的一个计算设备。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GgmlDevice {
    /// 后端注册名（`CPU` / `Vulkan` / `CUDA` …），来自 ggml 的 backend registry。
    pub backend: String,
    /// 设备描述（显卡型号或 CPU 名）。
    pub description: String,
    /// 是否 GPU（独显或核显）。
    pub is_gpu: bool,
    /// ggml 能否在这台设备上算 Whisper 的核心算子（[`runs_whisper_ops`]）。CPU 恒为 true；Metal 只在 Metal 3 家族的
    /// 显卡上做矩阵乘、归一化与 softmax，只支持到 Metal 2 的显卡（如 Polaris 一代的 Radeon Pro 560X）为 false；
    /// Vulkan 不核对（[`probes_whisper_ops`]），恒为 true。
    pub runs_whisper: bool,
}

impl GgmlDevice {
    fn cpu_fallback() -> Self {
        Self {
            backend: "CPU".to_owned(),
            description: "cpu".to_owned(),
            is_gpu: false,
            runs_whisper: true,
        }
    }

    /// 日志与诊断用的短标签：`ggml-cuda` / `ggml-vulkan` / `ggml-cpu`。
    pub fn label(&self) -> String {
        format!("ggml-{}", self.backend.to_ascii_lowercase())
    }

    /// 协议的设备标签，按后端注册名映射：`CUDA` 是 `cuda`，`Vulkan` 是 `vulkan`；别的 GPU 后端（HIP 构建注册为 `ROCm`、
    /// SYCL 等，BaoCut 的构建都不编）取小写的注册名；不是 GPU 的（CPU，以及 macOS 上类型为加速器的 BLAS）一律 `cpu`。
    pub fn protocol_label(&self) -> String {
        if !self.is_gpu {
            return DEVICE_CPU.to_owned();
        }
        match self.backend.as_str() {
            "CUDA" => DEVICE_CUDA.to_owned(),
            "Vulkan" => DEVICE_VULKAN.to_owned(),
            "Metal" => DEVICE_METAL.to_owned(),
            other => other.to_ascii_lowercase(),
        }
    }
}

/// 把 exe 同目录下的 ggml 动态后端（`ggml-vulkan.dll` 之类）登记进 registry。
///
/// 静态链接的后端本来就在 registry 里，这一步对它们是空操作；只有以
/// `GGML_BACKEND_DL=ON` 构建、后端以独立动态库随包发行时才真的加载。缺文件不报错。
pub fn load_sidecar_backends() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let Some(dir) = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.canonicalize().ok().or(Some(exe)))
            .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
        else {
            return;
        };
        let Ok(path) = std::ffi::CString::new(dir.to_string_lossy().as_bytes()) else {
            return;
        };
        // SAFETY: 传入的是有效的 NUL 结尾字符串；ggml 只在目录里找 ggml-*.{dll,so,dylib}。
        unsafe { whisper_rs::whisper_rs_sys::ggml_backend_load_all_from_path(path.as_ptr()) };
    });
}

/// 枚举 ggml 当前 registry 里的全部设备（GPU 在前，与 ggml 内部顺序一致）。
pub fn devices() -> Vec<GgmlDevice> {
    use whisper_rs::whisper_rs_sys as sys;
    load_sidecar_backends();
    let mut out = Vec::new();
    // SAFETY: 只读查询 registry；返回的 C 字符串由 ggml 持有、生命周期与进程相同。
    unsafe {
        let count = sys::ggml_backend_dev_count();
        for index in 0..count {
            let device = sys::ggml_backend_dev_get(index);
            if device.is_null() {
                continue;
            }
            let kind = sys::ggml_backend_dev_type(device);
            let is_gpu = kind == sys::ggml_backend_dev_type_GGML_BACKEND_DEVICE_TYPE_GPU
                || kind == sys::ggml_backend_dev_type_GGML_BACKEND_DEVICE_TYPE_IGPU;
            let reg = sys::ggml_backend_dev_backend_reg(device);
            let backend = if reg.is_null() {
                String::new()
            } else {
                c_string(sys::ggml_backend_reg_name(reg))
            };
            let runs_whisper = !is_gpu || !probes_whisper_ops(&backend) || runs_whisper_ops(device);
            out.push(GgmlDevice {
                backend,
                description: c_string(sys::ggml_backend_dev_description(device)),
                is_gpu,
                runs_whisper,
            });
        }
    }
    out
}

/// 哪些 GPU 后端在枚举时核对 Whisper 的算子：Metal 与 CUDA 的 `supports_op` 只读注册时就备好的设备属性。Vulkan 的
/// `supports_op` 第一次调用就创建逻辑设备、登记着色器，会把这笔开销挪进 `worker.hello`（Windows 的握手期限 5 秒），
/// 不核对，沿用第一个 GPU。
fn probes_whisper_ops(backend: &str) -> bool {
    backend != "Vulkan"
}

/// 问 ggml 这台设备能不能自己算 Whisper 的核心算子：编码器形状（`n_state` 1280 × 1500 帧）的矩阵乘、层归一化与 softmax。
/// 矩阵乘的权重取登记的模型包用到的类型：Q8_0（large-v3 Turbo）、Q5_0（large-v3），以及 F16（注意力的 K / V）；
/// 登记别的量化时加进来。占位张量不分配内存；Metal 与 CUDA 的 `supports_op` 只看设备属性与张量的类型、形状，不碰显存、
/// 不编译内核（[`probes_whisper_ops`]）。
///
/// # Safety
///
/// `device` 是 ggml registry 里的设备。
unsafe fn runs_whisper_ops(device: whisper_rs::whisper_rs_sys::ggml_backend_dev_t) -> bool {
    use whisper_rs::whisper_rs_sys as sys;
    const STATE: i64 = 1280;
    const FRAMES: i64 = 1500;
    let weights = [
        sys::ggml_type_GGML_TYPE_Q8_0,
        sys::ggml_type_GGML_TYPE_Q5_0,
        sys::ggml_type_GGML_TYPE_F16,
    ];
    // SAFETY: no_alloc 的上下文只放张量头（9 个，留足余量），用完即释放；张量指针不出这个函数。
    unsafe {
        let ctx = sys::ggml_init(sys::ggml_init_params {
            mem_size: 16 * sys::ggml_tensor_overhead(),
            mem_buffer: std::ptr::null_mut(),
            no_alloc: true,
        });
        if ctx.is_null() {
            return false;
        }
        let activations = sys::ggml_new_tensor_2d(ctx, sys::ggml_type_GGML_TYPE_F32, STATE, FRAMES);
        let mut ops = vec![sys::ggml_norm(ctx, activations, 1e-5), sys::ggml_soft_max(ctx, activations)];
        for weight in weights {
            ops.push(sys::ggml_mul_mat(
                ctx,
                sys::ggml_new_tensor_2d(ctx, weight, STATE, STATE),
                activations,
            ));
        }
        let supported = ops.iter().all(|op| sys::ggml_backend_dev_supports_op(device, *op));
        sys::ggml_free(ctx);
        supported
    }
}

unsafe fn c_string(ptr: *const std::os::raw::c_char) -> String {
    if ptr.is_null() {
        String::new()
    } else {
        // SAFETY: 调用方保证 ptr 指向 NUL 结尾字符串。
        unsafe { CStr::from_ptr(ptr) }.to_string_lossy().into_owned()
    }
}

/// 纯函数版的设备选择：给定枚举结果与开关，得出实际用哪台。只看第一个 GPU（whisper.cpp 用的那台）：它算不了 Whisper 的
/// 核心算子时用 CPU，不另挑后面的 GPU。
pub fn choose_device(devices: &[GgmlDevice], gpu_disabled: bool) -> GgmlDevice {
    if !gpu_disabled
        && let Some(gpu) = devices.iter().find(|d| d.is_gpu)
        && gpu.runs_whisper
    {
        return gpu.clone();
    }
    devices.iter().find(|d| !d.is_gpu).cloned().unwrap_or_else(GgmlDevice::cpu_fallback)
}

/// 编进本二进制的 ggml GPU 后端（协议设备名），CUDA 在前（与 ggml registry 的登记顺序一致）。
pub fn gpu_backends_built() -> &'static [&'static str] {
    const BUILT: &[&str] = &[
        #[cfg(feature = "whisper-ggml-cuda")]
        DEVICE_CUDA,
        #[cfg(feature = "whisper-ggml-vulkan")]
        DEVICE_VULKAN,
        #[cfg(all(feature = "whisper-ggml-metal", target_os = "macos"))]
        DEVICE_METAL,
    ];
    BUILT
}

/// 本次运行 Whisper 会用的设备。编进了 GPU 后端却用不上 GPU 时打印一次告警：没枚举到 GPU 时点名编进来的后端，
/// 枚举到的 GPU 算不了 Whisper 时点名那台 GPU。
pub fn default_device() -> GgmlDevice {
    if gpu_disabled_by_env() {
        return GgmlDevice::cpu_fallback();
    }
    let devices = devices();
    let device = choose_device(&devices, false);
    let built = gpu_backends_built();
    if !built.is_empty() && !device.is_gpu {
        static WARNED: Once = Once::new();
        WARNED.call_once(|| match devices.iter().find(|d| d.is_gpu) {
            Some(gpu) => eprintln!("{}", unsupported_gpu_warning(gpu)),
            None => eprintln!("{}", no_gpu_warning(built)),
        });
    }
    device
}

/// 枚举到的 GPU 算不了 Whisper 的核心算子时的提示：点名那台 GPU；Metal 另说明要 Metal 3 家族的显卡。
fn unsupported_gpu_warning(gpu: &GgmlDevice) -> String {
    let requirement = match gpu.protocol_label().as_str() {
        DEVICE_METAL => " (ggml's Metal backend needs a Metal 3 GPU for them)",
        _ => "",
    };
    format!(
        "[model-worker] ggml cannot run Whisper's matrix multiplication, normalization and softmax on the {} GPU \"{}\"{requirement}, Whisper runs on the CPU",
        gpu.backend, gpu.description
    )
}

/// 编进了 GPU 后端却没有可用 GPU 时的提示：点名编进来的后端，各带一句常见原因。
fn no_gpu_warning(built: &[&str]) -> String {
    let (names, reasons): (Vec<&str>, Vec<&str>) = built
        .iter()
        .map(|backend| match *backend {
            DEVICE_CUDA => ("CUDA", "CUDA: no NVIDIA GPU or driver was found"),
            DEVICE_VULKAN => ("Vulkan", "Vulkan: the driver has no Vulkan runtime or no device was enumerated"),
            DEVICE_METAL => ("Metal", "Metal: no compatible GPU was enumerated"),
            other => (other, other),
        })
        .unzip();
    format!(
        "[model-worker] no {} GPU is available ({}), Whisper falls back to the CPU",
        names.join(" or "),
        reasons.join("; ")
    )
}

/// 诊断用的运行时快照。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WhisperRuntime {
    /// `ggml-cuda` / `ggml-vulkan` / `ggml-cpu` …：本次实际会用的后端。
    pub backend: String,
    /// 设备描述。
    pub device: String,
    /// 编进了哪些 GPU 后端（`cuda`、`vulkan`；见 [`gpu_backends_built`]）。
    pub gpu_backends_built: &'static [&'static str],
    /// 是否枚举到了至少一台 GPU（不受 `BAOCUT_GPU` 影响）。
    pub gpu_available: bool,
    /// 第一个 GPU 能否算 Whisper 的核心算子（[`GgmlDevice::runs_whisper`]；没有 GPU 时为 false，不受 `BAOCUT_GPU` 影响）。
    pub gpu_runs_whisper: bool,
    /// `BAOCUT_GPU` 是否显式关闭了 GPU。
    pub gpu_disabled: bool,
}

pub fn runtime_probe() -> WhisperRuntime {
    let devices = devices();
    let disabled = gpu_disabled_by_env();
    let chosen = choose_device(&devices, disabled);
    let first_gpu = devices.iter().find(|d| d.is_gpu);
    WhisperRuntime {
        backend: chosen.label(),
        device: chosen.description,
        gpu_backends_built: gpu_backends_built(),
        gpu_available: first_gpu.is_some(),
        gpu_runs_whisper: first_gpu.is_some_and(|d| d.runs_whisper),
        gpu_disabled: disabled,
    }
}

/// 编译期后端标识（不做任何枚举）：`ggml-cuda+vulkan`、`ggml-cuda`、`ggml-vulkan`、`ggml-metal` 或 `ggml-cpu`。
pub const fn built_backend() -> &'static str {
    match (cfg!(feature = "whisper-ggml-cuda"), cfg!(feature = "whisper-ggml-vulkan")) {
        (true, true) => "ggml-cuda+vulkan",
        (true, false) => "ggml-cuda",
        (false, true) => "ggml-vulkan",
        (false, false) if cfg!(all(feature = "whisper-ggml-metal", target_os = "macos")) => "ggml-metal",
        (false, false) => "ggml-cpu",
    }
}

pub struct GgmlBackend;

impl Backend for GgmlBackend {
    fn id(&self) -> &'static str {
        "ggml"
    }

    fn status(&self) -> BackendStatus {
        let device = default_device();
        let devices = if device.is_gpu {
            vec![device.protocol_label(), DEVICE_CPU.into()]
        } else {
            vec![DEVICE_CPU.into()]
        };
        BackendStatus {
            id: "ggml",
            available: true,
            reason: None,
            devices,
        }
    }

    fn load(&self, bundle: &VerifiedBundle, phase: &mut PhaseCallback<'_>) -> Result<Box<dyn LoadedModel>, ErrorBody> {
        let device = check_device(bundle)?;
        let (Some(asr_files), Some(vad_files)) = (&bundle.asr, &bundle.vad) else {
            // backend::load 已经检查过；这里只为类型。
            return Err(ErrorBody::new(codes::MODEL_UNSUPPORTED, "the bundle needs asr and vad components"));
        };
        if asr_files.family != FAMILY_WHISPER_GGML {
            return Err(transcription_not_wired(Some(&asr_files.family)));
        }

        // 先按清单取齐文件：缺文件是 MODEL_NOT_INSTALLED，不必先加载上 GB 的权重。
        let weights = asr_files.require_extension_in("", "bin")?[0].to_path_buf();
        let vad_weights = vad_files.require_extension("safetensors")?;
        // 对齐器是可选组件（与别的识别模型包共用同一只）：带了才加载，缺文件同样报 MODEL_NOT_INSTALLED。
        candle::check_aligner_files(bundle)?;
        // 说话人区分同样可选（candle 的 Pyannote 与 WeSpeaker）：只核对文件，任务里要用时才加载。
        let diarizer = DiarizerSlot::new(bundle, &candle::default_device())?;

        phase(ModelPhase::LoadingWeights, Some("vad"));
        let vad = SileroVad::load(&vad_weights).map_err(|error| candle::load_failed("vad", &error))?;
        phase(ModelPhase::LoadingWeights, Some("asr"));
        let asr = WhisperGgml::load_on(&weights, Some(device)).map_err(|error| candle::load_failed("asr", &error))?;
        let aligner = match &bundle.aligner {
            Some(aligner_files) => {
                phase(ModelPhase::LoadingWeights, Some("aligner"));
                Some(
                    ForcedAligner::load(aligner_files, &candle::default_device())
                        .map_err(|error| candle::load_failed("aligner", &error))?,
                )
            }
            None => None,
        };
        Ok(Box::new(GgmlModel {
            vad,
            asr,
            aligner,
            diarizer,
            resident_bytes: candle::process_resident_bytes(),
        }))
    }
}

/// 模型包的设备：`cpu` 总能跑（不碰 GPU）；`cuda` / `vulkan` / `metal` 要求本进程选中的 GPU（`worker.hello` 报的首选设备）正是它——
/// 编进了对应的后端、枚举到了设备、设备算得了 Whisper 的核心算子、`BAOCUT_GPU` 没关。同时编进 CUDA 与 Vulkan、选中 CUDA 的进程
/// 同样不收 `vulkan`。
fn check_device(bundle: &VerifiedBundle) -> Result<GgmlDevice, ErrorBody> {
    let unsupported = |message: String| {
        ErrorBody::new(codes::MODEL_UNSUPPORTED, message)
            .with_details(json!({ "backend": "ggml", "device": bundle.device, "reason": "unsupported-device" }))
    };
    match bundle.device.as_str() {
        DEVICE_CPU => Ok(GgmlDevice::cpu_fallback()),
        requested @ (DEVICE_CUDA | DEVICE_VULKAN | DEVICE_METAL) => {
            let device = default_device();
            let label = device.protocol_label();
            if device.is_gpu && label == requested {
                Ok(device)
            } else if device.is_gpu {
                Err(unsupported(format!(
                    "this worker runs Whisper on the {label} device, not {requested}"
                )))
            } else {
                Err(unsupported(format!("no {requested} device is available")))
            }
        }
        _ => Err(unsupported(
            "the ggml backend runs on the cpu, cuda, vulkan or metal device".to_owned(),
        )),
    }
}

/// 加载好的 VAD（candle）+ Whisper（whisper.cpp）+ 可选的强制对齐器（candle）+ 按需加载的说话人区分（candle）。
pub struct GgmlModel {
    vad: SileroVad,
    asr: WhisperGgml,
    aligner: Option<ForcedAligner>,
    diarizer: DiarizerSlot,
    resident_bytes: Option<u64>,
}

impl LoadedModel for GgmlModel {
    fn run_mode(&mut self) -> RunMode<'_> {
        RunMode::Pipeline {
            vad: &mut self.vad,
            recognizer: &mut self.asr,
        }
    }

    /// 与 candle 同：整个 Worker 进程的常驻内存；CUDA / Vulkan 的显存不在其中。
    fn memory(&self) -> Option<MemorySnapshot> {
        candle::memory()
    }

    /// whisper.cpp 没有单独的预热（v2 同样不预热）。
    fn warmup_ms(&self) -> u64 {
        0
    }

    fn resident_bytes(&self) -> Option<u64> {
        self.resident_bytes
    }

    fn aligner(&mut self) -> Option<&mut dyn ForcedAlignment> {
        self.aligner.as_mut().map(|aligner| aligner as &mut dyn ForcedAlignment)
    }

    fn has_diarizer(&self) -> bool {
        self.diarizer.available()
    }

    fn diarizer(&mut self) -> Option<&mut dyn SpeakerDiarization> {
        self.diarizer.get()
    }

    fn finish_job(&mut self) {
        self.diarizer.release();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gpu(backend: &str, name: &str) -> GgmlDevice {
        GgmlDevice {
            backend: backend.into(),
            description: name.into(),
            is_gpu: true,
            runs_whisper: true,
        }
    }

    /// ggml 枚举得到、却算不了 Whisper 核心算子的 GPU（如只有 Metal 2 的 Polaris 显卡）。
    fn weak_gpu(backend: &str, name: &str) -> GgmlDevice {
        GgmlDevice {
            runs_whisper: false,
            ..gpu(backend, name)
        }
    }

    fn cpu() -> GgmlDevice {
        GgmlDevice {
            backend: "CPU".into(),
            description: "Apple M2".into(),
            is_gpu: false,
            runs_whisper: true,
        }
    }

    #[test]
    fn prefers_first_gpu_unless_disabled() {
        let devices = vec![gpu("Vulkan", "AMD Radeon RX 7800 XT"), gpu("Vulkan", "Intel Arc"), cpu()];
        assert_eq!(choose_device(&devices, false), devices[0]);
        assert_eq!(choose_device(&devices, true), devices[2]);
        assert_eq!(choose_device(&devices, false).label(), "ggml-vulkan");
        assert_eq!(choose_device(&devices, true).label(), "ggml-cpu");
        assert_eq!(choose_device(&devices, false).protocol_label(), DEVICE_VULKAN);
        assert_eq!(choose_device(&devices, true).protocol_label(), DEVICE_CPU);
    }

    /// CUDA 与 Vulkan 都编进来时（ggml 先登记 CUDA），NVIDIA 机器上的枚举结果是 CUDA 的设备在前、同一张卡的 Vulkan 设备在后：
    /// 选 CUDA，协议标签是 `cuda`。
    #[test]
    fn prefers_cuda_over_vulkan_when_both_are_enumerated() {
        let devices = vec![
            gpu("CUDA", "NVIDIA GeForce RTX 4070"),
            gpu("Vulkan", "NVIDIA GeForce RTX 4070"),
            cpu(),
        ];
        let chosen = choose_device(&devices, false);
        assert_eq!(chosen, devices[0]);
        assert_eq!(chosen.label(), "ggml-cuda");
        assert_eq!(chosen.protocol_label(), DEVICE_CUDA);
        assert_eq!(choose_device(&devices, true).protocol_label(), DEVICE_CPU);
    }

    /// 没有 NVIDIA 驱动时 CUDA 后端报 0 个设备，只剩 Vulkan 的：标 `vulkan`。
    #[test]
    fn labels_a_vulkan_only_gpu_as_vulkan() {
        let devices = vec![gpu("Vulkan", "Intel(R) Arc(TM) Graphics"), cpu()];
        let chosen = choose_device(&devices, false);
        assert_eq!(chosen.label(), "ggml-vulkan");
        assert_eq!(chosen.protocol_label(), DEVICE_VULKAN);
    }

    /// 第一个 GPU 算不了 Whisper 的核心算子时用 CPU：ggml 会把它的权重放进显存再拷回 CPU 去算，比纯 CPU 慢（issue #109）。
    /// 也不改用后面的 GPU——whisper.cpp 只用第一个。
    #[test]
    fn skips_a_gpu_that_cannot_run_whisper() {
        let devices = vec![weak_gpu("Metal", "AMD Radeon Pro 560X"), cpu()];
        let chosen = choose_device(&devices, false);
        assert_eq!(chosen, devices[1]);
        assert_eq!(chosen.protocol_label(), DEVICE_CPU);

        let devices = vec![weak_gpu("CUDA", "NVIDIA GeForce GTX 750"), gpu("Vulkan", "Intel UHD 630"), cpu()];
        assert_eq!(choose_device(&devices, false), devices[2]);
    }

    /// 只有 Vulkan 不在枚举时核对算子：它的 `supports_op` 会初始化逻辑设备。
    #[test]
    fn only_vulkan_skips_the_op_probe() {
        assert!(probes_whisper_ops("Metal"));
        assert!(probes_whisper_ops("CUDA"));
        assert!(!probes_whisper_ops("Vulkan"));
    }

    #[test]
    fn unsupported_gpu_warning_names_the_gpu() {
        let metal = unsupported_gpu_warning(&weak_gpu("Metal", "AMD Radeon Pro 560X"));
        assert!(metal.contains("Metal GPU \"AMD Radeon Pro 560X\""), "{metal}");
        assert!(metal.contains("Metal 3"), "{metal}");
        assert!(metal.contains("runs on the CPU"), "{metal}");
        let cuda = unsupported_gpu_warning(&weak_gpu("CUDA", "NVIDIA GeForce GTX 750"));
        assert!(cuda.contains("CUDA GPU \"NVIDIA GeForce GTX 750\""), "{cuda}");
        assert!(!cuda.contains("Metal"), "{cuda}");
    }

    /// 协议标签只看是不是 GPU 与后端注册名：别的 GPU 后端取小写注册名；不是 GPU 的设备（含 BLAS 这类加速器）都是 `cpu`。
    #[test]
    fn protocol_label_maps_backend_names() {
        assert_eq!(gpu("Metal", "AMD Radeon Pro 5500M").protocol_label(), DEVICE_METAL);
        assert_eq!(gpu("ROCm", "AMD Radeon").protocol_label(), "rocm");
        assert_eq!(gpu("SYCL", "Intel Arc").protocol_label(), "sycl");
        let blas = GgmlDevice {
            backend: "BLAS".into(),
            description: "Accelerate".into(),
            is_gpu: false,
            runs_whisper: true,
        };
        assert_eq!(blas.protocol_label(), DEVICE_CPU);
        assert_eq!(cpu().protocol_label(), DEVICE_CPU);
    }

    #[test]
    fn no_gpu_warning_names_the_built_backends() {
        let both = no_gpu_warning(&[DEVICE_CUDA, DEVICE_VULKAN]);
        assert!(both.contains("no CUDA or Vulkan GPU"), "{both}");
        assert!(both.contains("NVIDIA"), "{both}");
        let vulkan = no_gpu_warning(&[DEVICE_VULKAN]);
        assert!(vulkan.contains("no Vulkan GPU"), "{vulkan}");
        assert!(!vulkan.contains("CUDA"), "{vulkan}");
        let metal = no_gpu_warning(&[DEVICE_METAL]);
        assert!(metal.contains("no Metal GPU"), "{metal}");
    }

    #[test]
    fn built_backends_follow_the_features() {
        assert_eq!(gpu_backends_built().contains(&DEVICE_CUDA), cfg!(feature = "whisper-ggml-cuda"));
        assert_eq!(gpu_backends_built().contains(&DEVICE_VULKAN), cfg!(feature = "whisper-ggml-vulkan"));
        assert_eq!(
            gpu_backends_built().contains(&DEVICE_METAL),
            cfg!(all(feature = "whisper-ggml-metal", target_os = "macos"))
        );
        if gpu_backends_built().is_empty() {
            assert_eq!(built_backend(), "ggml-cpu");
        } else if gpu_backends_built() == [DEVICE_METAL] {
            assert_eq!(built_backend(), "ggml-metal");
        }
    }

    #[test]
    fn falls_back_to_cpu_without_any_device() {
        let chosen = choose_device(&[], false);
        assert!(!chosen.is_gpu);
        assert_eq!(chosen.label(), "ggml-cpu");
    }

    #[test]
    fn registry_enumeration_reports_a_cpu_device() {
        // 真实 registry：静态链接的 CPU 后端总在；GPU 视机器而定。
        let devices = devices();
        assert!(devices.iter().any(|d| !d.is_gpu), "{devices:?}");
        assert!(devices.iter().filter(|d| !d.is_gpu).all(|d| d.runs_whisper), "{devices:?}");
        let probe = runtime_probe();
        assert!(probe.backend.starts_with("ggml-"));
        assert_eq!(probe.gpu_backends_built, gpu_backends_built());
        assert!(probe.gpu_available || !probe.gpu_runs_whisper, "{probe:?}");
    }

    /// 真实的算子探测：Apple Silicon 都是 Metal 3（Apple7 起）家族，Metal 设备必须算得了 Whisper。
    #[cfg(all(feature = "whisper-ggml-metal", target_os = "macos", target_arch = "aarch64"))]
    #[test]
    fn apple_silicon_metal_runs_whisper() {
        let devices = devices();
        let metal = devices.iter().find(|d| d.is_gpu && d.protocol_label() == DEVICE_METAL);
        let metal = metal.unwrap_or_else(|| panic!("no Metal GPU in {devices:?}"));
        assert!(metal.runs_whisper, "{metal:?}");
    }

    #[test]
    fn status_lists_the_cpu_last() {
        let status = GgmlBackend.status();
        assert!(status.available);
        assert_eq!(status.devices.last().map(String::as_str), Some(DEVICE_CPU));
        if gpu_backends_built().is_empty() {
            assert_eq!(status.devices, [DEVICE_CPU]);
        } else if status.devices.len() > 1 {
            // 首选设备只能是编进来的 GPU 后端之一。
            assert_eq!(status.devices.len(), 2, "{:?}", status.devices);
            assert!(gpu_backends_built().contains(&status.devices[0].as_str()), "{:?}", status.devices);
        }
    }
}
