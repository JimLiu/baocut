//! MLX 运行时的公共部分：Metal 设备探测、缓存上限、缓存清理守卫、权重读取与内存快照。

use std::collections::HashMap;
use std::ffi::{c_char, c_int, c_void};
use std::path::Path;

use anyhow::{Context, Result, bail};
use mlx_rs::Array;
use mlx_rs::ops::indexing::IndexOp;

const MAX_CACHE_BYTES: usize = 2 << 30;
const PHYSICAL_MEMORY_CACHE_DIVISOR: usize = 8;

#[cfg(test)]
pub(crate) static MLX_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

unsafe extern "C" {
    fn sysctlbyname(
        name: *const c_char,
        old_value: *mut c_void,
        old_length: *mut usize,
        new_value: *mut c_void,
        new_length: usize,
    ) -> c_int;
}

#[link(name = "Metal", kind = "framework")]
unsafe extern "C" {
    fn MTLCreateSystemDefaultDevice() -> *mut c_void;
}

#[link(name = "objc")]
unsafe extern "C" {
    fn objc_release(object: *mut c_void);
}

/// 进 MLX 之前先确认系统默认 Metal 设备存在。
///
/// 沙箱里 `MTLCreateSystemDefaultDevice()` 返回 nil，MLX 随后在 C++ 里抛 `metal::Device` 初始化异常；
/// 那个异常穿过 mlx-c 撞进 Rust 就是 `Rust cannot catch foreign exceptions`，整个进程 abort。
/// 这里先用 Metal 的 C 入口探一下，没有设备就返回普通错误。
pub fn ensure_metal_device() -> Result<()> {
    // SAFETY: 纯 C 入口，无参数；返回一个 +1 的 ObjC 对象或 nil。
    let device = unsafe { MTLCreateSystemDefaultDevice() };
    if device.is_null() {
        bail!("no Metal device available (MTLCreateSystemDefaultDevice returned nil)");
    }
    // SAFETY: `device` 非空且由上面的 create 调用持有一个引用，这里归还它。
    unsafe { objc_release(device) };
    Ok(())
}

/// 把 MLX 已释放缓冲区的缓存限制在 2 GiB 与物理内存 1/8 中的较小值。
///
/// MLX 默认按 GPU 推荐工作集设置缓存，在 16 GiB Mac 上接近 10 GiB。转录期间不断产生不同形状的临时
/// Metal 缓冲区；不设上限时，这些已释放但仍被缓存的缓冲区会把进程 footprint 推到 11 GiB 以上。
pub fn configure_memory_cache() -> Result<usize> {
    ensure_metal_device()?;
    let physical_memory = physical_memory_bytes().context("reading physical memory size")?;
    let limit = cache_limit_for_physical_memory(physical_memory);
    let mut previous_limit = 0;
    // SAFETY: `previous_limit` 是有效的可写 size_t 指针。
    let status = unsafe { mlx_sys::mlx_set_cache_limit(&mut previous_limit, limit) };
    if status != 0 {
        bail!("mlx_set_cache_limit failed (status {status})");
    }
    Ok(limit)
}

/// 立即把 MLX 已释放的 Metal 缓冲区归还给系统。
pub fn clear_memory_cache() -> Result<()> {
    // SAFETY: 没有参数；模型仍在使用的活跃缓冲区不会被释放。
    let status = unsafe { mlx_sys::mlx_clear_cache() };
    if status != 0 {
        bail!("mlx_clear_cache failed (status {status})");
    }
    Ok(())
}

/// 作用域结束（成功、失败或提前返回）时释放本轮推理留下的 MLX 临时缓存。
#[derive(Default)]
pub struct MemoryCacheGuard;

impl MemoryCacheGuard {
    pub fn new() -> Self {
        Self
    }
}

impl Drop for MemoryCacheGuard {
    fn drop(&mut self) {
        let _ = clear_memory_cache();
    }
}

/// 模型生命周期清理；放在模型结构体的最后一个字段，让权重先析构。构造前须确认 Metal 可用。
/// 与逐段的 [`MemoryCacheGuard`] 不同，卸载时还要等 GPU 完成：eval 提交的命令可能仍持有数组，
/// 否则它们会在 clear 之后回到缓存。
pub struct ModelMemoryCacheGuard;

impl Drop for ModelMemoryCacheGuard {
    fn drop(&mut self) {
        let stream = mlx_rs::Stream::task_local_or_default();
        // SAFETY: stream 在本调用期间存活；只等待该 stream 上已提交的工作。
        unsafe {
            let _ = mlx_sys::mlx_synchronize(stream.as_ptr());
        }
        let _ = clear_memory_cache();
    }
}

fn cache_limit_for_physical_memory(physical_memory: usize) -> usize {
    MAX_CACHE_BYTES.min(physical_memory / PHYSICAL_MEMORY_CACHE_DIVISOR)
}

/// 本机物理内存（字节）。
pub fn physical_memory_bytes() -> Result<usize> {
    let mut value = 0_u64;
    let mut length = size_of::<u64>();
    // SAFETY: `hw.memsize` 是以 NUL 结尾的常量；输出缓冲区与长度均有效，不传写值参数。
    let status = unsafe {
        sysctlbyname(
            c"hw.memsize".as_ptr(),
            (&mut value as *mut u64).cast(),
            &mut length,
            std::ptr::null_mut(),
            0,
        )
    };
    if status != 0 || length != size_of::<u64>() {
        bail!("sysctl hw.memsize failed (status {status}, length {length})");
    }
    usize::try_from(value).context("physical memory size overflows usize")
}

/// 读取并合并给定的 safetensors 文件（只读这些文件，不扫描目录）。键重复是错误。
pub fn load_safetensors(files: &[&Path]) -> Result<HashMap<String, Array>> {
    load_safetensors_impl(files, |_| true, WeightEvaluation::Batch)
}

/// 读取给定的 safetensors，但只保留匹配的张量。MLX 的 safetensors 读取是惰性的；
/// 在 `eval` 前丢掉未匹配数组，可避免 Qwen2.5-Omni 这类多模态快照把视觉塔、
/// 音频塔、Talker 与 LM head 一并搬进统一内存。
pub fn load_safetensors_filtered(files: &[&Path], keep: impl Fn(&str) -> bool) -> Result<HashMap<String, Array>> {
    load_safetensors_impl(files, keep, WeightEvaluation::PerTensor)
}

/// Internal streaming conversion entry point. The caller must evaluate bounded
/// groups before returning a model, rather than one graph spanning the checkpoint.
pub(crate) fn load_safetensors_filtered_deferred(files: &[&Path], keep: impl Fn(&str) -> bool) -> Result<HashMap<String, Array>> {
    load_safetensors_impl(files, keep, WeightEvaluation::Deferred)
}

enum WeightEvaluation {
    Batch,
    PerTensor,
    Deferred,
}

fn load_safetensors_impl(files: &[&Path], keep: impl Fn(&str) -> bool, evaluation: WeightEvaluation) -> Result<HashMap<String, Array>> {
    configure_memory_cache()?;
    if files.is_empty() {
        bail!("no safetensors files listed");
    }
    let mut weights = HashMap::new();
    for (index, path) in files.iter().enumerate() {
        let loaded = Array::load_safetensors(path).with_context(|| format!("loading safetensors file #{index}"))?;
        for (key, value) in loaded {
            if !keep(&key) {
                continue;
            }
            if weights.insert(key.clone(), value).is_some() {
                bail!("duplicate weight key: {key}");
            }
        }
    }
    if matches!(evaluation, WeightEvaluation::PerTensor) {
        // 不把数 GB 的 Omni 文本骨干塞进同一个 Metal command buffer。16 GiB M2
        // 上整批 eval 偶发触发 macOS GPU watchdog；逐张量物化的峰值相同，但每个
        // command buffer 都足够短，模型加载可重复。
        let mut keys = weights.keys().collect::<Vec<_>>();
        keys.sort();
        for key in keys {
            weights[key].eval()?;
        }
    } else if matches!(evaluation, WeightEvaluation::Batch) {
        mlx_rs::transforms::eval(weights.values())?;
    }
    Ok(weights)
}

/// MLX 侧内存快照（active / cache / peak，字节）。
pub fn memory_snapshot() -> (usize, usize, usize) {
    let mut active = 0_usize;
    let mut cache = 0_usize;
    let mut peak = 0_usize;
    // SAFETY: 三个指针都指向有效的 size_t；查询失败时保持 0。
    unsafe {
        let _ = mlx_sys::mlx_get_active_memory(&mut active);
        let _ = mlx_sys::mlx_get_cache_memory(&mut cache);
        let _ = mlx_sys::mlx_get_peak_memory(&mut peak);
    }
    (active, cache, peak)
}

/// `BCUT_SPEECH_TIMING=1` 时向 stderr 输出分阶段计时（benchmark/诊断用）。
pub use crate::backend::speech_timing_enabled;

/// 触发一个最小 Metal 计算，验证 MLX 运行时（v2 的 `bcut doctor` 用它；v3 的诊断入口接入前没有调用方）。
///
/// 先过 [`ensure_metal_device`]：没有设备时返回错误而不是让 MLX 把进程 abort。
pub fn metal_probe() -> Result<()> {
    ensure_metal_device()?;
    let values = Array::from_slice(&[1.0_f32, 2.0, 3.0, 4.0], &[2, 2]);
    let output = mlx_rs::ops::matmul(&values, values.t())?;
    output.eval()?;
    let item = output.index((0, 0)).try_item::<f32>()?;
    if (item - 5.0).abs() > 1e-5 {
        bail!("MLX Metal probe returned an unexpected value: {item}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use mlx_rs::builder::Builder;
    use mlx_rs::fast;
    use mlx_rs::module::Module;
    use mlx_rs::nn::{Conv1dBuilder, Conv2dBuilder, QuantizedLinearBuilder};
    use mlx_rs::ops;
    use mlx_rs::transforms;

    #[test]
    fn metal_device_probe_is_a_plain_result() {
        // 有 GPU 的机器上必须 Ok；沙箱里（没有设备）必须是普通 Err 而不是 abort。
        match ensure_metal_device() {
            Ok(()) => {}
            Err(error) => assert!(format!("{error:#}").contains("Metal"), "{error:#}"),
        }
    }

    #[test]
    fn cache_limit_is_the_smaller_of_2_gib_and_an_eighth_of_ram() {
        assert_eq!(cache_limit_for_physical_memory(16 << 30), 2 << 30);
        assert_eq!(cache_limit_for_physical_memory(8 << 30), 1 << 30);
        assert_eq!(cache_limit_for_physical_memory(64 << 30), MAX_CACHE_BYTES);
    }

    #[test]
    fn model_guard_flushes_weights_after_fields_drop() {
        let _lock = MLX_TEST_LOCK.lock().unwrap_or_else(|poison| poison.into_inner());
        if ensure_metal_device().is_err() {
            return;
        }
        configure_memory_cache().unwrap();
        clear_memory_cache().unwrap();
        struct Model {
            weights: Array,
            _cache_guard: ModelMemoryCacheGuard,
        }
        let baseline = memory_snapshot().0;
        let model = Model {
            weights: Array::ones::<f32>(&[4 * 1024 * 1024]).unwrap(),
            _cache_guard: ModelMemoryCacheGuard,
        };
        model.weights.eval().unwrap();
        assert!(memory_snapshot().0 >= baseline + 16 * 1024 * 1024);
        drop(model);
        let (active, cache, _) = memory_snapshot();
        assert!(active <= baseline + 1024 * 1024, "active={active}");
        assert_eq!(cache, 0, "unloaded weights must not remain cached");
    }

    #[test]
    fn loads_only_the_listed_files_and_rejects_duplicate_keys() {
        let _lock = MLX_TEST_LOCK.lock().unwrap_or_else(|poison| poison.into_inner());
        if ensure_metal_device().is_err() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let one = dir.path().join("one.safetensors");
        let two = dir.path().join("two.safetensors");
        let value = Array::from_slice(&[1.0_f32, 2.0], &[2]);
        Array::save_safetensors([("a", &value)], None, &one).unwrap();
        Array::save_safetensors([("a", &value)], None, &two).unwrap();
        let loaded = load_safetensors(&[one.as_path()]).unwrap();
        assert_eq!(loaded.keys().collect::<Vec<_>>(), ["a"]);
        assert!(load_safetensors(&[one.as_path(), two.as_path()]).is_err());
        assert!(load_safetensors(&[]).is_err());
    }

    #[test]
    fn filtered_loading_keeps_only_matching_keys_and_the_probe_runs() {
        let _lock = MLX_TEST_LOCK.lock().unwrap_or_else(|poison| poison.into_inner());
        if ensure_metal_device().is_err() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("weights.safetensors");
        let value = Array::from_slice(&[1.0_f32, 2.0], &[2]);
        Array::save_safetensors([("keep.weight", &value), ("drop.weight", &value)], None, &file).unwrap();
        let filtered = load_safetensors_filtered(&[file.as_path()], |key| key.starts_with("keep.")).unwrap();
        assert_eq!(filtered.keys().collect::<Vec<_>>(), ["keep.weight"]);
        let deferred = load_safetensors_filtered_deferred(&[file.as_path()], |key| key.starts_with("drop.")).unwrap();
        assert_eq!(deferred.keys().collect::<Vec<_>>(), ["drop.weight"]);
        assert!(load_safetensors_filtered(&[], |_| true).is_err());
        metal_probe().unwrap();
    }

    #[test]
    fn mlx_operator_spike_covers_required_graph() {
        let _lock = MLX_TEST_LOCK.lock().unwrap_or_else(|poison| poison.into_inner());
        if ensure_metal_device().is_err() {
            return;
        }
        let input = Array::from_slice(&[0.0_f32; 64], &[1, 1, 64]);
        let mut quantized = QuantizedLinearBuilder::new(64, 64).group_size(64).bits(4).build().unwrap();
        let linear = quantized.forward(&input).unwrap();

        let mut conv1d = Conv1dBuilder::new(1, 2, 3).padding(1).build().unwrap();
        let one_d = conv1d.forward(&Array::from_slice(&[0.0_f32; 8], &[1, 8, 1])).unwrap();
        let mut conv2d = Conv2dBuilder::new(1, 2, (3, 3)).padding((1, 1)).build().unwrap();
        let two_d = conv2d.forward(&Array::from_slice(&[0.0_f32; 16], &[1, 4, 4, 1])).unwrap();

        let gates = ops::split(&linear, 4, -1).unwrap();
        let recurrent = ops::tanh(ops::sigmoid(&gates[0]).unwrap()).unwrap();
        let query = Array::zeros::<f32>(&[1, 1, 2, 8]).unwrap();
        let attention = fast::scaled_dot_product_attention(&query, &query, &query, 8.0_f32.sqrt().recip(), None, None).unwrap();
        transforms::async_eval([&one_d, &two_d, &recurrent, &attention]).unwrap();
        transforms::eval([&one_d, &two_d, &recurrent, &attention]).unwrap();

        assert_eq!(one_d.shape(), vec![1, 8, 2]);
        assert_eq!(two_d.shape(), vec![1, 4, 4, 2]);
        assert_eq!(attention.shape(), vec![1, 1, 2, 8]);
    }
}
