//! 本地文本嵌入（`embed.run`，Model Worker 协议规范 §2.5.6）：请求与结果、引擎 trait、向量打包与一次批量嵌入的编排。
//!
//! 模型是 EmbeddingGemma 2 的 `.litertlm` 包（`embedding` 组件，family `embeddinggemma2-litert`），推理走 LiteRT-LM 的
//! C API：动态库是模型包的 `litertlm-runtime` 组件，Worker 运行期 `dlopen`（[`litert`]，`backend-litert` feature），
//! 不在构建时链接。
//!
//! Worker 只做「文本 → 引擎输出的向量」：任务前缀（`task: search result | query: …`）、截断到 512 维与再归一化都在
//! Runtime 做，Worker 不改写文本也不裁维度。引擎按请求的 `outputSize` 输出、开着 `normalize`，输入超过
//! `maxInputLength` 时报错（溢出策略 Error），不截断也不分块平均：超长由 Runtime 决定怎么切。
//!
//! 一次请求至多 [`MAX_BATCH`] 条文本，在推理线程上同步算完；中途不能取消（批很小，Runtime 取消时丢弃结果即可）。
//!
//! 多模态包还能嵌入图像（检索规格 §6.2 的关键帧）：`model.load` 带了 `vision` 时打开图像编码器，`embed.run` 改给 `images`
//! （JPEG / PNG 文件的绝对路径，一次至多 [`MAX_IMAGE_BATCH`] 张）。图像不加任务前缀，Worker 读文件原样交给引擎解码。

#[cfg(feature = "backend-litert")]
pub mod litert;

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::backend::{LoadedEmbedding, PhaseCallback};
use crate::bundle::{FAMILY_EMBEDDINGGEMMA2_LITERT, VerifiedBundle};
use crate::protocol::{ErrorBody, codes};

/// 后端 id（`model.load` 的 `bundle.backend`）。
pub const BACKEND_ID: &str = "litert-lm";
/// 本构建认识的嵌入模型 family（`components.embedding.family`）。
pub const EMBEDDING_FAMILIES: [&str; 1] = [FAMILY_EMBEDDINGGEMMA2_LITERT];
/// 一次 `embed.run` 至多这么多条文本。
pub const MAX_BATCH: usize = 16;
/// 引擎接受的输出维度（EmbeddingGemma 2 的 Matryoshka 尺寸）。
pub const OUTPUT_SIZES: [u32; 4] = [128, 256, 512, 768];
/// 引擎的最大输入长度（token）。超过时整条报 `INPUT_TOO_LONG`。
pub const MAX_INPUT_TOKENS: u32 = 2048;
/// 单条文本的字节上限：远大于 [`MAX_INPUT_TOKENS`] 个 token 能占的字节，只挡住明显错误的请求。
pub const MAX_TEXT_BYTES: usize = 256 * 1024;
/// 一次 `embed.run` 至多这么多张图（CPU 上一张约 1 秒，批小一点 Runtime 取消得快）。
pub const MAX_IMAGE_BATCH: usize = 4;
/// 单张图的字节上限：关键帧是 512 px 的 JPEG，远小于它。
pub const MAX_IMAGE_BYTES: u64 = 16 * 1024 * 1024;

/// `embed.run` 的参数。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EmbedRunParams {
    /// 调用方给的请求 id：`worker.status` 的 `job.jobId` 报它。
    pub request_id: String,
    /// 已经加好任务前缀的文本，1..=[`MAX_BATCH`] 条。与 `images` 二选一。
    #[serde(default)]
    pub texts: Vec<String>,
    /// 图像文件（JPEG / PNG）的绝对路径，1..=[`MAX_IMAGE_BATCH`] 张。与 `texts` 二选一；要求加载时打开了图像编码器。
    #[serde(default)]
    pub images: Vec<String>,
    /// 引擎输出的维度，[`OUTPUT_SIZES`] 之一。
    pub output_size: u32,
    /// 让分词器加上 BOS/EOS 等特殊 token。
    pub insert_special_tokens: bool,
}

impl EmbedRunParams {
    pub fn validate(&self) -> Result<(), ErrorBody> {
        if self.request_id.is_empty() {
            return Err(ErrorBody::invalid_params("requestId must not be empty"));
        }
        match (self.texts.is_empty(), self.images.is_empty()) {
            (false, false) => return Err(ErrorBody::invalid_params("give either texts or images, not both")),
            (true, true) => return Err(ErrorBody::invalid_params(format!("texts must hold 1 to {MAX_BATCH} entries"))),
            (true, false) => {
                if self.images.len() > MAX_IMAGE_BATCH {
                    return Err(ErrorBody::invalid_params(format!(
                        "images must hold 1 to {MAX_IMAGE_BATCH} entries"
                    )));
                }
                if let Some(index) = self.images.iter().position(|path| !std::path::Path::new(path).is_absolute()) {
                    return Err(ErrorBody::invalid_params("image paths must be absolute").with_details(json!({ "index": index })));
                }
            }
            (false, true) => {}
        }
        if self.texts.len() > MAX_BATCH {
            return Err(ErrorBody::invalid_params(format!("texts must hold 1 to {MAX_BATCH} entries")));
        }
        if let Some(index) = self.texts.iter().position(|text| text.trim().is_empty()) {
            return Err(ErrorBody::invalid_params("texts must not be blank").with_details(json!({ "index": index })));
        }
        if let Some(index) = self.texts.iter().position(|text| text.len() > MAX_TEXT_BYTES) {
            return Err(input_too_long(index, "the text exceeds the byte limit"));
        }
        if !OUTPUT_SIZES.contains(&self.output_size) {
            return Err(ErrorBody::invalid_params(format!("outputSize must be one of {OUTPUT_SIZES:?}")));
        }
        Ok(())
    }
}

/// `embed.run` 的结果：每条文本一个向量，little-endian `f32` 的 base64，次序同 `texts`。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbedRunResult {
    pub vectors: Vec<String>,
    pub dims: u32,
    pub device: String,
    pub elapsed_ms: u64,
}

/// 一次嵌入的选项。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EmbedOptions {
    pub output_size: u32,
    pub insert_special_tokens: bool,
}

/// 加载好的嵌入引擎。与别的引擎一样只能在加载它的线程上使用。
pub trait EmbeddingEngine {
    /// 每条文本一个向量，次序同 `texts`，每个长度都是 `options.output_size`。超长的文本是 `INPUT_TOO_LONG`（带 `index`）。
    fn embed(&mut self, texts: &[String], options: EmbedOptions) -> Result<Vec<Vec<f32>>, ErrorBody>;

    /// 每张图（编码后的 JPEG / PNG 字节）一个向量，次序同 `images`。没打开图像编码器时是 `MODEL_UNSUPPORTED`。
    fn embed_images(&mut self, images: &[Vec<u8>], options: EmbedOptions) -> Result<Vec<Vec<f32>>, ErrorBody> {
        let _ = (images, options);
        Err(vision_not_loaded())
    }

    /// 实际跑在哪个设备上（`cpu` / `gpu`）。
    fn device(&self) -> &str;
}

/// 这个构建能加载的嵌入 family：`worker.hello` 的 `embeddingCapabilities.families`。
pub fn available_families() -> Vec<&'static str> {
    if cfg!(feature = "backend-litert") {
        EMBEDDING_FAMILIES.to_vec()
    } else {
        Vec::new()
    }
}

/// `worker.hello` 的 `embeddingCapabilities`；这个构建没有嵌入后端时是 `None`（字段省略）。
pub fn hello_capabilities() -> Option<serde_json::Value> {
    let families = available_families();
    (!families.is_empty()).then(|| {
        json!({
            "families": families,
            "outputSizes": OUTPUT_SIZES,
            "maxBatch": MAX_BATCH,
            "maxInputTokens": MAX_INPUT_TOKENS,
            "inputs": ["text", "image"],
            "maxImageBatch": MAX_IMAGE_BATCH,
        })
    })
}

/// 嵌入模型包的组件检查：`embedding` 的 family 认得出、带了 `litertlm-runtime`、后端是 `litert-lm`，不混别的组件。
pub fn check_bundle(bundle: &VerifiedBundle) -> Result<(), ErrorBody> {
    let Some(embedding) = bundle.embedding.as_ref() else {
        return Err(ErrorBody::new(codes::MODEL_UNSUPPORTED, "the bundle has no embedding component")
            .with_details(json!({ "component": "embedding", "reason": "missing-component" })));
    };
    if !EMBEDDING_FAMILIES.contains(&embedding.family.as_str()) {
        return Err(ErrorBody::new(codes::MODEL_UNSUPPORTED, "unsupported embedding model family")
            .with_details(json!({ "component": "embedding", "family": embedding.family, "reason": "unknown-family" })));
    }
    if bundle.backend != BACKEND_ID {
        return Err(
            ErrorBody::new(codes::MODEL_UNSUPPORTED, "embedding bundles run on the litert-lm backend")
                .with_details(json!({ "backend": bundle.backend, "reason": "unknown-backend" })),
        );
    }
    match bundle.litertlm_runtime.as_ref() {
        None => {
            return Err(
                ErrorBody::new(codes::MODEL_UNSUPPORTED, "the bundle has no litertlm-runtime component")
                    .with_details(json!({ "component": "litertlm-runtime", "reason": "missing-component" })),
            );
        }
        Some(runtime) if runtime.family != crate::bundle::FAMILY_LITERTLM_RUNTIME => {
            return Err(ErrorBody::new(codes::MODEL_UNSUPPORTED, "unsupported litertlm-runtime family")
                .with_details(json!({ "component": "litertlm-runtime", "family": runtime.family, "reason": "unknown-family" })));
        }
        Some(_) => {}
    }
    for (component, files) in [
        ("asr", &bundle.asr),
        ("vad", &bundle.vad),
        ("aligner", &bundle.aligner),
        ("speaker", &bundle.speaker),
        ("segmentation", &bundle.segmentation),
        ("tokenizer", &bundle.tokenizer),
        ("tts", &bundle.tts),
        ("codec", &bundle.codec),
        ("aux", &bundle.aux),
        ("separator", &bundle.separator),
        ("image", &bundle.image),
    ] {
        if files.is_some() {
            return Err(
                ErrorBody::new(codes::MODEL_UNSUPPORTED, "an embedding bundle cannot carry other components")
                    .with_details(json!({ "component": component, "reason": "unexpected-component" })),
            );
        }
    }
    Ok(())
}

/// 加载嵌入模型包（组件已由 [`check_bundle`] 检查过）。
#[cfg(feature = "backend-litert")]
pub fn load(bundle: &VerifiedBundle, phase: &mut PhaseCallback<'_>) -> Result<LoadedEmbedding, ErrorBody> {
    litert::load(bundle, phase)
}

/// 没编译 `backend-litert` 时的占位。
#[cfg(not(feature = "backend-litert"))]
pub fn load(_bundle: &VerifiedBundle, _phase: &mut PhaseCallback<'_>) -> Result<LoadedEmbedding, ErrorBody> {
    Err(crate::backend::not_compiled(BACKEND_ID))
}

/// 一次 `embed.run`：检查形状、算向量、核对维度与数值，打包成 base64。
pub fn run(engine: &mut dyn EmbeddingEngine, params: &EmbedRunParams) -> Result<EmbedRunResult, ErrorBody> {
    params.validate()?;
    let started = std::time::Instant::now();
    let options = EmbedOptions {
        output_size: params.output_size,
        insert_special_tokens: params.insert_special_tokens,
    };
    let (vectors, expected) = if params.images.is_empty() {
        (engine.embed(&params.texts, options)?, params.texts.len())
    } else {
        let images = params
            .images
            .iter()
            .enumerate()
            .map(|(index, path)| read_image(index, path))
            .collect::<Result<Vec<_>, _>>()?;
        (engine.embed_images(&images, options)?, images.len())
    };
    if vectors.len() != expected {
        return Err(
            ErrorBody::new(codes::INFERENCE_FAILED, "the engine returned a different number of vectors")
                .with_details(json!({ "expected": expected, "actual": vectors.len() })),
        );
    }
    for (index, vector) in vectors.iter().enumerate() {
        if vector.len() != params.output_size as usize {
            return Err(
                ErrorBody::new(codes::INFERENCE_FAILED, "the engine returned a vector of the wrong size")
                    .with_details(json!({ "index": index, "expected": params.output_size, "actual": vector.len() })),
            );
        }
        if vector.iter().any(|value| !value.is_finite()) {
            return Err(
                ErrorBody::new(codes::INFERENCE_FAILED, "the engine returned a non-finite value").with_details(json!({ "index": index }))
            );
        }
    }
    Ok(EmbedRunResult {
        vectors: vectors.iter().map(|vector| encode_f32_le(vector)).collect(),
        dims: params.output_size,
        device: engine.device().to_owned(),
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

/// 读一张图：读不了或超过 [`MAX_IMAGE_BYTES`] 是 `INPUT_UNREADABLE`（带 `index`，不带路径）。
fn read_image(index: usize, path: &str) -> Result<Vec<u8>, ErrorBody> {
    let unreadable = |reason: &str| {
        ErrorBody::new(codes::INPUT_UNREADABLE, "cannot read the image").with_details(json!({ "index": index, "reason": reason }))
    };
    let size = std::fs::metadata(path).map_err(|_| unreadable("not-found"))?.len();
    if size == 0 || size > MAX_IMAGE_BYTES {
        return Err(unreadable("size"));
    }
    std::fs::read(path).map_err(|_| unreadable("read-failed"))
}

/// 加载的嵌入模型包没打开图像编码器（`model.load` 没带 `vision`）。
pub fn vision_not_loaded() -> ErrorBody {
    ErrorBody::new(codes::MODEL_UNSUPPORTED, "the loaded embedding bundle has no image encoder")
        .with_details(json!({ "capability": "embed", "reason": "vision-not-loaded" }))
}

/// 输入超过模型的最大长度。
pub fn input_too_long(index: usize, message: &str) -> ErrorBody {
    ErrorBody::new(codes::INPUT_TOO_LONG, message.to_owned()).with_details(json!({ "index": index }))
}

/// `f32` 序列 → little-endian 字节 → 标准 base64（带 `=` 填充）。
pub fn encode_f32_le(values: &[f32]) -> String {
    let bytes: Vec<u8> = values.iter().flat_map(|value| value.to_le_bytes()).collect();
    base64_encode(&bytes)
}

fn base64_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(ALPHABET[(n >> 18) as usize & 63] as char);
        out.push(ALPHABET[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 { ALPHABET[n as usize & 63] as char } else { '=' });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fake {
        dims_override: Option<usize>,
        too_long: Option<usize>,
    }

    impl EmbeddingEngine for Fake {
        fn embed(&mut self, texts: &[String], options: EmbedOptions) -> Result<Vec<Vec<f32>>, ErrorBody> {
            if let Some(index) = self.too_long {
                return Err(input_too_long(index, "too long"));
            }
            let dims = self.dims_override.unwrap_or(options.output_size as usize);
            Ok(texts.iter().enumerate().map(|(i, _)| vec![i as f32; dims]).collect())
        }

        fn device(&self) -> &str {
            "cpu"
        }
    }

    fn params(texts: &[&str], output_size: u32) -> EmbedRunParams {
        EmbedRunParams {
            request_id: "r1".into(),
            texts: texts.iter().map(|text| (*text).to_owned()).collect(),
            images: Vec::new(),
            output_size,
            insert_special_tokens: true,
        }
    }

    #[test]
    fn base64_matches_the_standard_alphabet_and_padding() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64_encode(&[0xff, 0xfe, 0xfd]), "//79");
        // 1.0f32 = 0x3f800000，little-endian 是 00 00 80 3f。
        assert_eq!(encode_f32_le(&[1.0]), "AACAPw==");
        assert_eq!(encode_f32_le(&[1.0, -2.5]).len(), 12);
    }

    #[test]
    fn params_parse_and_validate() {
        let parsed: EmbedRunParams = crate::protocol::parse_params(json!({
            "requestId": "q", "texts": ["a"], "outputSize": 768, "insertSpecialTokens": false,
        }))
        .unwrap();
        assert!(parsed.validate().is_ok());
        assert!(!parsed.insert_special_tokens);
        let unknown = crate::protocol::parse_params::<EmbedRunParams>(json!({
            "requestId": "q", "texts": ["a"], "outputSize": 768, "insertSpecialTokens": false, "extra": 1,
        }));
        assert_eq!(unknown.unwrap_err().code, codes::INVALID_PARAMS);

        assert_eq!(params(&[], 768).validate().unwrap_err().code, codes::INVALID_PARAMS);
        let seventeen = vec!["x"; MAX_BATCH + 1];
        assert_eq!(params(&seventeen, 768).validate().unwrap_err().code, codes::INVALID_PARAMS);
        assert!(params(&vec!["x"; MAX_BATCH], 768).validate().is_ok());
        assert_eq!(params(&["a", "  "], 768).validate().unwrap_err().details.unwrap()["index"], 1);
        assert_eq!(params(&["a"], 300).validate().unwrap_err().code, codes::INVALID_PARAMS);
        let huge = "x".repeat(MAX_TEXT_BYTES + 1);
        let error = params(&["a", &huge], 512).validate().unwrap_err();
        assert_eq!(error.code, codes::INPUT_TOO_LONG);
        assert_eq!(error.details.unwrap()["index"], 1);
    }

    #[test]
    fn run_packs_vectors_and_checks_the_engine_output() {
        let mut engine = Fake {
            dims_override: None,
            too_long: None,
        };
        let result = run(&mut engine, &params(&["a", "b"], 128)).unwrap();
        assert_eq!(result.vectors.len(), 2);
        assert_eq!(result.dims, 128);
        assert_eq!(result.device, "cpu");
        // 128 个 f32 = 512 字节 → 684 个 base64 字符（含填充）。
        assert_eq!(result.vectors[0].len(), 684);

        let mut wrong = Fake {
            dims_override: Some(10),
            too_long: None,
        };
        assert_eq!(run(&mut wrong, &params(&["a"], 128)).unwrap_err().code, codes::INFERENCE_FAILED);

        let mut long = Fake {
            dims_override: None,
            too_long: Some(1),
        };
        let error = run(&mut long, &params(&["a", "b"], 768)).unwrap_err();
        assert_eq!(error.code, codes::INPUT_TOO_LONG);
        assert!(!error.retryable);
    }

    #[test]
    fn images_are_an_alternative_to_texts() {
        let both = crate::protocol::parse_params::<EmbedRunParams>(json!({
            "requestId": "q", "texts": ["a"], "images": ["/a.jpg"], "outputSize": 768, "insertSpecialTokens": true,
        }))
        .unwrap();
        assert_eq!(both.validate().unwrap_err().code, codes::INVALID_PARAMS);
        let images = |paths: &[&str]| EmbedRunParams {
            images: paths.iter().map(|path| (*path).to_owned()).collect(),
            ..params(&[], 768)
        };
        assert!(images(&["/a.jpg"]).validate().is_ok());
        assert_eq!(
            images(&["/a.jpg"; MAX_IMAGE_BATCH + 1]).validate().unwrap_err().code,
            codes::INVALID_PARAMS
        );
        assert_eq!(images(&["/a.jpg", "b.jpg"]).validate().unwrap_err().details.unwrap()["index"], 1);

        // 文字引擎（默认实现）不接图像。
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("f.jpg");
        std::fs::write(&file, b"jpeg").unwrap();
        let mut engine = Fake {
            dims_override: None,
            too_long: None,
        };
        let error = run(&mut engine, &images(&[&file.to_string_lossy()])).unwrap_err();
        assert_eq!(error.code, codes::MODEL_UNSUPPORTED);
        assert_eq!(error.details.unwrap()["reason"], "vision-not-loaded");
        // 读不了的图在送进引擎之前报，不带路径。
        let missing = dir.path().join("missing.jpg");
        let error = run(&mut engine, &images(&[&file.to_string_lossy(), &missing.to_string_lossy()])).unwrap_err();
        assert_eq!(error.code, codes::INPUT_UNREADABLE);
        assert_eq!(error.details.as_ref().unwrap()["index"], 1);
        assert!(!error.message.contains("missing"));
    }

    #[test]
    fn hello_lists_families_only_when_compiled() {
        match hello_capabilities() {
            Some(caps) => {
                assert!(cfg!(feature = "backend-litert"));
                assert_eq!(caps["families"], json!(["embeddinggemma2-litert"]));
                assert_eq!(caps["maxBatch"], MAX_BATCH);
                assert_eq!(caps["outputSizes"], json!([128, 256, 512, 768]));
            }
            None => assert!(!cfg!(feature = "backend-litert")),
        }
    }
}
