//! LiteRT-LM C API（v0.18.0 的 `embedding_engine.h`）上的嵌入引擎。
//!
//! 动态库来自模型包的 `litertlm-runtime` 组件，运行期用 `libloading` 打开：构建不链接它，没装组件的机器照样能跑别的能力。
//! 打开过的库在进程里一直留着（引擎析构后 C 库里仍可能有线程本地状态与后台线程，卸载它不安全），同一路径只打开一次。
//!
//! 引擎、设置、选项与输入都是 C 侧分配的句柄，这里各用一个 RAII 包装，析构时调对应的 `*_delete`。C API 的错误是线程本地的
//! 「最后一个错误」，只在调用返回 NULL 之后读才有意义，所以每次失败都立刻读。

use std::ffi::{CStr, CString, c_char, c_int, c_void};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;

use libloading::Library;
use serde_json::json;

use super::{EmbedOptions, EmbeddingEngine, MAX_INPUT_TOKENS, input_too_long};
use crate::backend::{LoadedEmbedding, ModelPhase, PhaseCallback};
use crate::bundle::VerifiedBundle;
use crate::protocol::{ErrorBody, codes};

// ---- C API 的常量（`engine.h` / `embedding_engine.h` / `error_reporter.h`）------------------------

const INPUT_DATA_TYPE_TEXT: c_int = 0;
const INPUT_DATA_TYPE_IMAGE: c_int = 1;
const OVERFLOW_STRATEGY_ERROR: c_int = 2;
const LOG_SEVERITY_WARNING: c_int = 3;
const STATUS_INVALID_ARGUMENT: c_int = 3;
const STATUS_RESOURCE_EXHAUSTED: c_int = 8;
const STATUS_OUT_OF_RANGE: c_int = 11;

type Handle = *mut c_void;

/// 解析出来的 C 函数。库本身随它一起泄漏到进程结束。
struct Api {
    _library: Library,
    set_min_log_level: unsafe extern "C" fn(c_int),
    get_last_error_message: unsafe extern "C" fn() -> *const c_char,
    get_last_error_code: unsafe extern "C" fn() -> c_int,
    clear_last_error: unsafe extern "C" fn(),
    input_data_create: unsafe extern "C" fn(c_int, *const c_void, usize) -> Handle,
    input_data_delete: unsafe extern "C" fn(Handle),
    settings_create: unsafe extern "C" fn(*const c_char, *const c_char, *const c_char, *const c_char) -> Handle,
    settings_delete: unsafe extern "C" fn(Handle),
    settings_set_num_threads: unsafe extern "C" fn(Handle, c_int),
    settings_set_cache_dir: unsafe extern "C" fn(Handle, *const c_char),
    settings_set_max_input_length: unsafe extern "C" fn(Handle, c_int),
    settings_set_vision_tokens_per_image: unsafe extern "C" fn(Handle, c_int),
    options_create: unsafe extern "C" fn() -> Handle,
    options_delete: unsafe extern "C" fn(Handle),
    options_set_normalize: unsafe extern "C" fn(Handle, bool),
    options_get_normalize: unsafe extern "C" fn(Handle) -> bool,
    options_set_insert_special_tokens: unsafe extern "C" fn(Handle, bool),
    options_get_insert_special_tokens: unsafe extern "C" fn(Handle) -> bool,
    options_set_input_overflow_strategy: unsafe extern "C" fn(Handle, c_int),
    options_set_output_size: unsafe extern "C" fn(Handle, c_int),
    response_delete: unsafe extern "C" fn(Handle),
    response_get_size: unsafe extern "C" fn(Handle) -> usize,
    response_get_values: unsafe extern "C" fn(Handle) -> *const f32,
    responses_delete: unsafe extern "C" fn(Handle),
    responses_get_size: unsafe extern "C" fn(Handle) -> usize,
    responses_get_at: unsafe extern "C" fn(Handle, usize) -> Handle,
    engine_create: unsafe extern "C" fn(Handle) -> Handle,
    engine_delete: unsafe extern "C" fn(Handle),
    compute_embedding: unsafe extern "C" fn(Handle, *const Handle, usize, Handle) -> Handle,
    compute_embedding_batch: unsafe extern "C" fn(Handle, *const *const Handle, *const usize, usize, Handle) -> Handle,
}

/// 已打开的库：按路径缓存，进程内不卸载。
static LIBRARIES: Mutex<Vec<(PathBuf, &'static Api)>> = Mutex::new(Vec::new());

fn open_api(path: &Path) -> Result<&'static Api, ErrorBody> {
    let mut opened = LIBRARIES.lock().unwrap_or_else(|poison| poison.into_inner());
    if let Some((_, api)) = opened.iter().find(|(known, _)| known == path) {
        return Ok(api);
    }
    let unsupported = |reason: &str, detail: String| {
        ErrorBody::new(
            codes::MODEL_UNSUPPORTED,
            format!("cannot use the LiteRT-LM runtime library: {detail}"),
        )
        .with_details(json!({ "component": "litertlm-runtime", "reason": reason }))
    };
    // SAFETY: 打开模型包里登记过（安装时核对过 sha256）的 LiteRT-LM 动态库；它的初始化代码只注册内部的全局表。
    let library =
        unsafe { Library::new(path) }.map_err(|error| unsupported("library-load-failed", strip_path(&error.to_string(), path)))?;
    macro_rules! symbol {
        ($name:literal) => {
            lookup(&library, $name).ok_or_else(|| {
                unsupported(
                    "symbol-missing",
                    format!("missing symbol {}", String::from_utf8_lossy(&$name[..$name.len() - 1])),
                )
            })?
        };
    }
    let api = Api {
        set_min_log_level: symbol!(b"litert_lm_set_min_log_level\0"),
        get_last_error_message: symbol!(b"litert_lm_get_last_error_message\0"),
        get_last_error_code: symbol!(b"litert_lm_get_last_error_code\0"),
        clear_last_error: symbol!(b"litert_lm_clear_last_error\0"),
        input_data_create: symbol!(b"litert_lm_input_data_create\0"),
        input_data_delete: symbol!(b"litert_lm_input_data_delete\0"),
        settings_create: symbol!(b"litert_lm_embedding_engine_settings_create\0"),
        settings_delete: symbol!(b"litert_lm_embedding_engine_settings_delete\0"),
        settings_set_num_threads: symbol!(b"litert_lm_embedding_engine_settings_set_num_threads\0"),
        settings_set_cache_dir: symbol!(b"litert_lm_embedding_engine_settings_set_cache_dir\0"),
        settings_set_max_input_length: symbol!(b"litert_lm_embedding_engine_settings_set_max_input_length\0"),
        settings_set_vision_tokens_per_image: symbol!(b"litert_lm_embedding_engine_settings_set_vision_tokens_per_image\0"),
        options_create: symbol!(b"litert_lm_embedding_options_create\0"),
        options_delete: symbol!(b"litert_lm_embedding_options_delete\0"),
        options_set_normalize: symbol!(b"litert_lm_embedding_options_set_normalize\0"),
        options_get_normalize: symbol!(b"litert_lm_embedding_options_get_normalize\0"),
        options_set_insert_special_tokens: symbol!(b"litert_lm_embedding_options_set_insert_special_tokens\0"),
        options_get_insert_special_tokens: symbol!(b"litert_lm_embedding_options_get_insert_special_tokens\0"),
        options_set_input_overflow_strategy: symbol!(b"litert_lm_embedding_options_set_input_overflow_strategy\0"),
        options_set_output_size: symbol!(b"litert_lm_embedding_options_set_output_size\0"),
        response_delete: symbol!(b"litert_lm_embedding_response_delete\0"),
        response_get_size: symbol!(b"litert_lm_embedding_response_get_size\0"),
        response_get_values: symbol!(b"litert_lm_embedding_response_get_values\0"),
        responses_delete: symbol!(b"litert_lm_embedding_responses_delete\0"),
        responses_get_size: symbol!(b"litert_lm_embedding_responses_get_size\0"),
        responses_get_at: symbol!(b"litert_lm_embedding_responses_get_at\0"),
        engine_create: symbol!(b"litert_lm_embedding_engine_create\0"),
        engine_delete: symbol!(b"litert_lm_embedding_engine_delete\0"),
        compute_embedding: symbol!(b"litert_lm_embedding_engine_compute_embedding\0"),
        compute_embedding_batch: symbol!(b"litert_lm_embedding_engine_compute_embedding_batch\0"),
        _library: library,
    };
    let api: &'static Api = Box::leak(Box::new(api));
    // 只要警告以上：LiteRT 的 INFO 日志很密。日志走 stderr，不碰协议的 stdout。
    // SAFETY: 无前置条件的全局设置。
    unsafe { (api.set_min_log_level)(LOG_SEVERITY_WARNING) };
    opened.push((path.to_path_buf(), api));
    Ok(api)
}

/// 按名字取一个函数指针（复制出来；库本身随 [`Api`] 泄漏，指针一直有效）。
fn lookup<T: Copy>(library: &Library, name: &[u8]) -> Option<T> {
    // SAFETY: 调用方给的 `T` 逐个照抄 v0.18.0 头文件里的签名；句柄一律按不透明指针传。
    unsafe { library.get::<T>(name) }.ok().map(|symbol| *symbol)
}

/// C API 最后一个错误（线程本地）：状态码与消息。只在调用失败后立即读。
struct LastError {
    code: c_int,
    message: String,
}

impl Api {
    fn take_last_error(&self) -> LastError {
        // SAFETY: 两个读取函数都无前置条件；消息指针在下一次 C API 调用前有效，这里立刻复制。
        let (code, message) = unsafe {
            let code = (self.get_last_error_code)();
            let pointer = (self.get_last_error_message)();
            let message = if pointer.is_null() {
                String::new()
            } else {
                CStr::from_ptr(pointer).to_string_lossy().into_owned()
            };
            (self.clear_last_error)();
            (code, message)
        };
        LastError { code, message }
    }
}

// ---- RAII 句柄 ---------------------------------------------------------------------------------

struct Owned {
    handle: Handle,
    delete: unsafe extern "C" fn(Handle),
}

impl Owned {
    fn new(handle: Handle, delete: unsafe extern "C" fn(Handle)) -> Option<Self> {
        (!handle.is_null()).then_some(Self { handle, delete })
    }
}

impl Drop for Owned {
    fn drop(&mut self) {
        // SAFETY: `handle` 是对应 `*_create` 返回的非空句柄，只在这里释放一次。
        unsafe { (self.delete)(self.handle) };
    }
}

// ---- 引擎 --------------------------------------------------------------------------------------

/// 一只加载好的 LiteRT-LM 嵌入引擎。
pub struct LiteRtEmbedding {
    api: &'static Api,
    // 声明次序即析构次序：引擎先于设置释放。
    engine: Owned,
    _settings: Owned,
    device: String,
    /// 加载时打开了图像编码器（`ModelBundle.vision`）。
    vision: bool,
    /// 模型与库的本机路径：报错前从 C 侧消息里抹掉。
    private_paths: Vec<String>,
}

pub fn load(bundle: &VerifiedBundle, phase: &mut PhaseCallback<'_>) -> Result<LoadedEmbedding, ErrorBody> {
    let started = Instant::now();
    let model = bundle
        .component("embedding")?
        .require_extension("litertlm")?
        .first()
        .map(|path| path.to_path_buf())
        .ok_or_else(|| ErrorBody::new(codes::MODEL_NOT_INSTALLED, "the embedding component has no .litertlm file"))?;
    let runtime = bundle.component("litertlm-runtime")?;
    let library = runtime
        .require_extension(LIBRARY_EXTENSION)?
        .first()
        .map(|path| path.to_path_buf())
        .ok_or_else(|| ErrorBody::new(codes::MODEL_NOT_INSTALLED, "the litertlm-runtime component has no library"))?;
    phase(ModelPhase::LoadingWeights, Some("embedding"));
    let api = open_api(&library)?;
    // 只认 cpu 与 gpu；GPU 只在 Runtime 显式要求时用（自检的开关），默认 CPU。
    let device = if bundle.device == "gpu" { "gpu" } else { "cpu" };
    let cache_dir = bundle
        .cache_dir
        .clone()
        .unwrap_or_else(|| std::env::temp_dir().join("baocut-litertlm-cache"));
    let _ = std::fs::create_dir_all(&cache_dir);
    let private_paths = vec![
        model.parent().map(|dir| dir.to_string_lossy().into_owned()).unwrap_or_default(),
        library.parent().map(|dir| dir.to_string_lossy().into_owned()).unwrap_or_default(),
        cache_dir.to_string_lossy().into_owned(),
    ];
    let c_string = |value: &str| CString::new(value).map_err(|_| ErrorBody::invalid_params("paths must not contain NUL bytes"));
    let model_c = c_string(&model.to_string_lossy())?;
    let device_c = c_string(device)?;
    let cache_c = c_string(&cache_dir.to_string_lossy())?;
    // 图像编码器只在要求时打开（多占约 1 GB），且只跑 CPU：与 G0 评测同一条路径。音频后端不用。
    let vision_c = c_string("cpu")?;
    let vision = if bundle.vision.is_some() {
        vision_c.as_ptr()
    } else {
        std::ptr::null()
    };
    // SAFETY: 字符串都以 NUL 结尾且活过调用；vision 后端没要求时与 audio 后端一样传 NULL。
    let settings = unsafe { (api.settings_create)(model_c.as_ptr(), device_c.as_ptr(), vision, std::ptr::null()) };
    let Some(settings) = Owned::new(settings, api.settings_delete) else {
        return Err(failure(
            api,
            &private_paths,
            "cannot create the engine settings",
            codes::MODEL_UNSUPPORTED,
        ));
    };
    // SAFETY: `settings` 非空且活着；C 侧复制字符串。
    unsafe {
        (api.settings_set_num_threads)(settings.handle, bundle.threads.clamp(1, 64) as c_int);
        (api.settings_set_cache_dir)(settings.handle, cache_c.as_ptr());
        (api.settings_set_max_input_length)(settings.handle, MAX_INPUT_TOKENS as c_int);
        if let Some(tokens) = bundle.vision.and_then(|vision| vision.tokens_per_image) {
            (api.settings_set_vision_tokens_per_image)(settings.handle, tokens as c_int);
        }
    }
    phase(ModelPhase::Compiling, Some("embedding"));
    // SAFETY: `settings` 非空且活过引擎的创建。
    let engine = unsafe { (api.engine_create)(settings.handle) };
    let Some(engine) = Owned::new(engine, api.engine_delete) else {
        let mut error = failure(api, &private_paths, "cannot create the embedding engine", codes::MODEL_UNSUPPORTED);
        if error.details.as_ref().and_then(|details| details["status"].as_i64()) == Some(STATUS_RESOURCE_EXHAUSTED as i64) {
            error.code = codes::MODEL_RESOURCE.into();
        }
        return Err(error);
    };
    let mut loaded = LiteRtEmbedding {
        api,
        engine,
        _settings: settings,
        device: device.to_owned(),
        vision: bundle.vision.is_some(),
        private_paths,
    };
    log_default_options(api);
    // 预热：第一次计算会编译与分配，顺带核对引擎真能给出 768 维。
    phase(ModelPhase::WarmingUp, Some("embedding"));
    let warm = loaded.embed(
        &["warm up".to_owned()],
        EmbedOptions {
            output_size: 768,
            insert_special_tokens: true,
        },
    )?;
    if warm.first().map(Vec::len) != Some(768) {
        return Err(
            ErrorBody::new(codes::MODEL_UNSUPPORTED, "the embedding model does not produce 768 dimensions")
                .with_details(json!({ "component": "embedding", "reason": "unexpected-output-size" })),
        );
    }
    Ok(LoadedEmbedding {
        engine: Box::new(loaded),
        load_ms: started.elapsed().as_millis() as u64,
        resident_bytes: None,
        memory: || None,
    })
}

#[cfg(target_os = "macos")]
const LIBRARY_EXTENSION: &str = "dylib";
#[cfg(target_os = "windows")]
const LIBRARY_EXTENSION: &str = "dll";
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
const LIBRARY_EXTENSION: &str = "so";

/// 记下全新选项的默认值（诊断用，stderr）。
fn log_default_options(api: &'static Api) {
    // SAFETY: 新建、读取、释放一组选项，无别的前置条件。
    unsafe {
        let options = (api.options_create)();
        if options.is_null() {
            return;
        }
        let options = Owned::new(options, api.options_delete);
        if let Some(options) = options {
            eprintln!(
                "[model-worker] litert-lm embedding defaults: normalize={} insert_special_tokens={}",
                (api.options_get_normalize)(options.handle),
                (api.options_get_insert_special_tokens)(options.handle)
            );
        }
    }
}

/// C 调用失败：读最后一个错误，抹掉本机路径，按状态码给错误码。
fn failure(api: &'static Api, private_paths: &[String], what: &str, fallback: &str) -> ErrorBody {
    let last = api.take_last_error();
    let message = scrub(&last.message, private_paths);
    let code = if last.code == STATUS_RESOURCE_EXHAUSTED {
        codes::MODEL_RESOURCE
    } else {
        fallback
    };
    ErrorBody::new(
        code,
        if message.is_empty() {
            what.to_owned()
        } else {
            format!("{what}: {message}")
        },
    )
    .with_details(json!({ "status": last.code }))
}

fn scrub(message: &str, private_paths: &[String]) -> String {
    let mut message = message.to_owned();
    for path in private_paths.iter().filter(|path| !path.is_empty()) {
        message = message.replace(path.as_str(), "<model>");
    }
    message
}

fn strip_path(message: &str, path: &Path) -> String {
    let mut message = message.replace(&*path.to_string_lossy(), "<library>");
    if let Some(dir) = path.parent() {
        message = message.replace(&*dir.to_string_lossy(), "<dir>");
    }
    message
}

/// 一组嵌入选项（RAII）。
fn options(api: &'static Api, options: EmbedOptions) -> Result<Owned, ErrorBody> {
    // SAFETY: 无前置条件。
    let handle = unsafe { (api.options_create)() };
    let owned =
        Owned::new(handle, api.options_delete).ok_or_else(|| ErrorBody::new(codes::INFERENCE_FAILED, "cannot create embedding options"))?;
    // SAFETY: `owned` 非空且活着。
    unsafe {
        (api.options_set_normalize)(owned.handle, true);
        (api.options_set_insert_special_tokens)(owned.handle, options.insert_special_tokens);
        (api.options_set_input_overflow_strategy)(owned.handle, OVERFLOW_STRATEGY_ERROR);
        (api.options_set_output_size)(owned.handle, options.output_size as c_int);
    }
    Ok(owned)
}

/// 输入超长的状态码：溢出策略 Error 下 LiteRT-LM 报 InvalidArgument 或 OutOfRange。
fn is_overflow(status: c_int) -> bool {
    status == STATUS_INVALID_ARGUMENT || status == STATUS_OUT_OF_RANGE
}

impl LiteRtEmbedding {
    fn text_input(&self, text: &str) -> Result<Owned, ErrorBody> {
        // SAFETY: 文本指针与长度来自同一个 `&str`；C 侧复制数据。
        let handle = unsafe { (self.api.input_data_create)(INPUT_DATA_TYPE_TEXT, text.as_ptr().cast(), text.len()) };
        Owned::new(handle, self.api.input_data_delete).ok_or_else(|| {
            failure(
                self.api,
                &self.private_paths,
                "cannot create the text input",
                codes::INFERENCE_FAILED,
            )
        })
    }

    fn image_input(&self, bytes: &[u8]) -> Result<Owned, ErrorBody> {
        // SAFETY: 指针与长度来自同一个切片；C 侧复制数据，解码在计算时做。
        let handle = unsafe { (self.api.input_data_create)(INPUT_DATA_TYPE_IMAGE, bytes.as_ptr().cast(), bytes.len()) };
        Owned::new(handle, self.api.input_data_delete).ok_or_else(|| {
            failure(
                self.api,
                &self.private_paths,
                "cannot create the image input",
                codes::INFERENCE_FAILED,
            )
        })
    }

    /// 读一个响应的向量（复制出来）。
    ///
    /// SAFETY: `response` 是活着的非空响应句柄。
    unsafe fn read_response(&self, response: Handle) -> Vec<f32> {
        unsafe {
            let size = (self.api.response_get_size)(response);
            let values = (self.api.response_get_values)(response);
            if values.is_null() || size == 0 {
                return Vec::new();
            }
            std::slice::from_raw_parts(values, size).to_vec()
        }
    }

    /// 一条文本单独算：批量失败时用来找出哪一条超长。
    fn embed_one(&self, text: &str, options: &Owned) -> Result<Vec<f32>, (c_int, ErrorBody)> {
        let input = self.text_input(text).map_err(|error| (0, error))?;
        let inputs = [input.handle];
        // SAFETY: 引擎、输入、选项都非空且活过调用。
        let response = unsafe { (self.api.compute_embedding)(self.engine.handle, inputs.as_ptr(), 1, options.handle) };
        match Owned::new(response, self.api.response_delete) {
            // SAFETY: 响应非空、活着。
            Some(response) => Ok(unsafe { self.read_response(response.handle) }),
            None => {
                let error = failure(self.api, &self.private_paths, "embedding failed", codes::INFERENCE_FAILED);
                let status = error.details.as_ref().and_then(|details| details["status"].as_i64()).unwrap_or(0) as c_int;
                Err((status, error))
            }
        }
    }
}

impl EmbeddingEngine for LiteRtEmbedding {
    fn embed(&mut self, texts: &[String], embed_options: EmbedOptions) -> Result<Vec<Vec<f32>>, ErrorBody> {
        let options = options(self.api, embed_options)?;
        if texts.len() == 1 {
            return self
                .embed_one(&texts[0], &options)
                .map(|vector| vec![vector])
                .map_err(|(status, error)| {
                    if is_overflow(status) {
                        input_too_long(0, "the text is longer than the model input limit")
                    } else {
                        error
                    }
                });
        }
        let inputs = texts.iter().map(|text| self.text_input(text)).collect::<Result<Vec<_>, _>>()?;
        // 每个批次项是「一条文本」：一个输入指针的数组。
        let rows: Vec<[Handle; 1]> = inputs.iter().map(|input| [input.handle]).collect();
        let row_pointers: Vec<*const Handle> = rows.iter().map(|row| row.as_ptr()).collect();
        let counts = vec![1usize; texts.len()];
        // SAFETY: 引擎、选项、全部输入都活过调用；三个数组长度一致。
        let responses = unsafe {
            (self.api.compute_embedding_batch)(
                self.engine.handle,
                row_pointers.as_ptr(),
                counts.as_ptr(),
                texts.len(),
                options.handle,
            )
        };
        match Owned::new(responses, self.api.responses_delete) {
            Some(responses) => {
                // SAFETY: `responses` 非空且活着；`get_at` 借出的响应归它所有，不单独释放。
                let vectors = unsafe {
                    let count = (self.api.responses_get_size)(responses.handle);
                    (0..count)
                        .map(|index| {
                            let response = (self.api.responses_get_at)(responses.handle, index);
                            if response.is_null() {
                                Vec::new()
                            } else {
                                self.read_response(response)
                            }
                        })
                        .collect::<Vec<_>>()
                };
                Ok(vectors)
            }
            None => {
                let batch_error = failure(self.api, &self.private_paths, "batch embedding failed", codes::INFERENCE_FAILED);
                let status = batch_error
                    .details
                    .as_ref()
                    .and_then(|details| details["status"].as_i64())
                    .unwrap_or(0) as c_int;
                if !is_overflow(status) {
                    return Err(batch_error);
                }
                // 批量超长：逐条重算，找出第一条超长的。都成功就用逐条的结果。
                let mut vectors = Vec::with_capacity(texts.len());
                for (index, text) in texts.iter().enumerate() {
                    match self.embed_one(text, &options) {
                        Ok(vector) => vectors.push(vector),
                        Err((status, _)) if is_overflow(status) => {
                            return Err(input_too_long(index, "the text is longer than the model input limit"));
                        }
                        Err((_, error)) => return Err(error),
                    }
                }
                Ok(vectors)
            }
        }
    }

    fn embed_images(&mut self, images: &[Vec<u8>], embed_options: EmbedOptions) -> Result<Vec<Vec<f32>>, ErrorBody> {
        if !self.vision {
            return Err(super::vision_not_loaded());
        }
        let options = options(self.api, embed_options)?;
        // 逐张算：一张图就是一个只含图像的输入（不加前缀，与 G0 评测相同）。批很小，逐张算与批量没有可测的差别。
        let mut vectors = Vec::with_capacity(images.len());
        for (index, bytes) in images.iter().enumerate() {
            let input = self.image_input(bytes)?;
            let inputs = [input.handle];
            // SAFETY: 引擎、输入、选项都非空且活过调用。
            let response = unsafe { (self.api.compute_embedding)(self.engine.handle, inputs.as_ptr(), 1, options.handle) };
            match Owned::new(response, self.api.response_delete) {
                // SAFETY: 响应非空、活着。
                Some(response) => vectors.push(unsafe { self.read_response(response.handle) }),
                None => {
                    // 解不开的图（坏文件、不认识的格式）是这张图的问题，不是模型故障。
                    let mut error = failure(self.api, &self.private_paths, "image embedding failed", codes::INFERENCE_FAILED);
                    let status = error.details.as_ref().and_then(|details| details["status"].as_i64()).unwrap_or(0) as c_int;
                    if status == STATUS_INVALID_ARGUMENT {
                        error.code = codes::INPUT_UNREADABLE.into();
                    }
                    error.details = Some(json!({ "index": index, "status": status }));
                    return Err(error);
                }
            }
        }
        Ok(vectors)
    }

    fn device(&self) -> &str {
        &self.device
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrubs_local_paths_from_messages() {
        let paths = vec!["/Users/a/models/x".to_owned(), String::new()];
        assert_eq!(
            scrub("failed to open /Users/a/models/x/m.litertlm", &paths),
            "failed to open <model>/m.litertlm"
        );
        let library = Path::new("/opt/tools/litertlm/0.18.0/libCLiteRTLM_mac.dylib");
        assert_eq!(
            strip_path("dlopen(/opt/tools/litertlm/0.18.0/libCLiteRTLM_mac.dylib): no such file", library),
            "dlopen(<library>): no such file"
        );
    }

    #[test]
    fn overflow_statuses() {
        assert!(is_overflow(STATUS_INVALID_ARGUMENT));
        assert!(is_overflow(STATUS_OUT_OF_RANGE));
        assert!(!is_overflow(STATUS_RESOURCE_EXHAUSTED));
        assert!(!is_overflow(0));
    }

    #[test]
    fn a_missing_library_is_unsupported_without_its_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("libmissing.dylib");
        let error = match open_api(&path) {
            Ok(_) => panic!("a missing library cannot open"),
            Err(error) => error,
        };
        assert_eq!(error.code, codes::MODEL_UNSUPPORTED);
        assert!(!error.message.contains(&*dir.path().to_string_lossy()), "{}", error.message);
    }
}
