//! 字体（架构设计 §9.1）：字体线程答的三个方法。
//!
//! - `fonts.resolve`：按「族名、字重、斜体」挑一个 face（与排版引擎同一套匹配），给出它在哪个文件、文件里第几个，以及
//!   把它抽成单独字体的做法（新的文件头与每张表从哪里搬到哪里）。先在本机字体里挑；本机没有这个族时，再到 Runtime
//!   给的下载缓存目录（`cacheDir`，按需下载的字体）里挑。每个 face 标明来源（`local` / `downloaded`）。编辑器预览经
//!   Runtime 的读取句柄按区间取这些表拼起来注入 WASM 渲染器；成片导出冻结时记下同一份解析，Render Worker 按同一个做法
//!   读文件拼出同样的字节。只按调用方给的 face 去找。
//! - `fonts.families`：本机已装的族名（只有名字，没有路径）。选字列表据此标出「本机」，Runtime 据此不去下载本机已有的族。
//! - `fonts.inspect`：检查一个字体文件（下载之后核对）：大小在上限内、按渲染用的同一套解析读得出哪些 face，以及它们的
//!   族名、字重、斜体。
//!
//! 进程里的请求由 [`FontWorker`] 在自己的线程上答：第一次要扫一遍本机字体的名字表（几百毫秒到一两秒），扫的期间
//! 引擎宿主照常处理别的请求；之后的请求直接查扫好的索引。有找不到的 face、而字体目录在扫过之后又变过（装了新字体、
//! 下载了字体）时重扫一遍再答，所以引擎宿主开着的时候新装、新下载的字体也找得到。

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Sender, channel};
use std::thread::JoinHandle;

use font_files::{FaceLayout, FaceQuery, FontFace, FontLibrary, MAX_FACE_BYTES, Missing};
use message_ref::msg;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use video_engine::{ErrorBody, Retryability};

use crate::Output;

/// 一个待答的请求：`id`、方法与 `params`。
type Request = (Value, String, Value);

/// 字体线程：到第一个 `fonts.*` 请求才起，按收到的顺序逐个答，响应直接写 stdout。
pub struct FontWorker {
    out: Output,
    queue: Option<(Sender<Request>, JoinHandle<()>)>,
}

impl FontWorker {
    pub fn new(out: Output) -> FontWorker {
        FontWorker { out, queue: None }
    }

    /// 收下一个请求（`id`、方法与 `params`），交给字体线程。
    pub fn submit(&mut self, id: Value, method: &str, params: Value) {
        let (sender, _) = self.queue.get_or_insert_with(|| {
            let (sender, receiver) = channel::<Request>();
            let out = self.out.clone();
            let handle = std::thread::Builder::new()
                .name("fonts".into())
                .spawn(move || {
                    let mut state = FontState::new(FontLibrary::scan);
                    for (id, method, params) in receiver {
                        out.write_line(&answer(id, &method, params, &mut state));
                    }
                })
                .expect("起字体线程");
            (sender, handle)
        });
        sender.send((id, method.to_string(), params)).expect("字体线程只在 finish 之后退出");
    }

    /// 不再收请求：等已收下的都答完。
    pub fn finish(self) {
        if let Some((sender, handle)) = self.queue {
            drop(sender);
            let _ = handle.join();
        }
    }
}

/// 字体线程扫好的字体：本机字体（第一次用时 `scan`，测试可用 `BAOCUT_FONT_DIRS` 换成指定目录）与下载缓存目录里的字体。
struct FontState {
    scan: fn() -> FontLibrary,
    system: Option<FontLibrary>,
    cache: Option<(PathBuf, FontLibrary)>,
}

impl FontState {
    fn new(scan: fn() -> FontLibrary) -> FontState {
        FontState {
            scan,
            system: None,
            cache: None,
        }
    }

    fn system(&mut self) -> &FontLibrary {
        self.system.get_or_insert_with(self.scan)
    }

    /// 下载缓存目录里的字体：第一次用或换了目录时扫。
    fn cache(&mut self, dir: &Path) -> &FontLibrary {
        if self.cache.as_ref().is_none_or(|(at, _)| at != dir) {
            self.cache = Some((dir.to_path_buf(), FontLibrary::from_dirs(&[dir.to_path_buf()])));
        }
        &self.cache.as_ref().expect("刚扫好").1
    }

    /// 扫过之后变过的字体目录重扫；有重扫的返回真。
    fn rescan_changed(&mut self) -> bool {
        let mut rescanned = false;
        if self.system.as_ref().is_some_and(FontLibrary::changed) {
            self.system = Some((self.scan)());
            rescanned = true;
        }
        if let Some((dir, library)) = &mut self.cache
            && library.changed()
        {
            *library = FontLibrary::from_dirs(std::slice::from_ref(dir));
            rescanned = true;
        }
        rescanned
    }

    /// 本机有这个族时只按本机的挑（与只有本机字体时一样）；本机没有这个族时到下载缓存里挑。
    fn pick(&mut self, query: &FaceQuery, cache_dir: Option<&Path>) -> Result<(FontFace, &'static str), Missing> {
        match (self.system().resolve_face(query), cache_dir) {
            (Ok(face), _) => Ok((face, "local")),
            (Err(Missing::NotFound), Some(dir)) => self.cache(dir).resolve_face(query).map(|face| (face, "downloaded")),
            (Err(reason), _) => Err(reason),
        }
    }
}

/// 一个请求的回执行（崩溃时是 `ENGINE_PANIC`）。
fn answer(id: Value, method: &str, params: Value, state: &mut FontState) -> Value {
    let outcome = catch_unwind(AssertUnwindSafe(|| match method {
        "fonts.resolve" => parse::<ResolveParams>(params).and_then(|p| resolve(&p, state)),
        "fonts.families" => parse::<FamiliesParams>(params).map(|_| families(state)),
        "fonts.inspect" => parse::<InspectParams>(params).and_then(|p| inspect(&p)),
        _ => Err(ErrorBody::new(
            "UNKNOWN_METHOD",
            msg!("engineHost.unknownMethod", "Unknown method: {method}", method),
            Retryability::Never,
        )),
    }));
    match outcome {
        Ok(Ok(result)) => json!({ "id": id, "result": result }),
        Ok(Err(error)) => json!({ "id": id, "error": error }),
        Err(_) => crate::panic_response(id, method),
    }
}

fn parse<T: DeserializeOwned>(params: Value) -> Result<T, ErrorBody> {
    serde_json::from_value::<T>(params).map_err(|e| ErrorBody::new(
            "INVALID_PARAMS",
            msg!("engineHost.paramsInvalid", "Invalid parameters: {error}", error = e.to_string()),
            Retryability::Never,
        ))
}

/// 一次最多问几个 face。
const MAX_FACES: usize = 32;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolveParams {
    faces: Vec<FaceParam>,
    /// 下载缓存目录（绝对路径）：本机没有的族再到这里找。不给时只找本机字体。
    #[serde(default)]
    cache_dir: Option<PathBuf>,
}

#[derive(Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FaceParam {
    family: String,
    weight: u16,
    italic: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FamiliesParams {}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InspectParams {
    path: PathBuf,
}

/// 先本机、后下载缓存地解析；有找不到的、字体目录又变过时重扫再答。
fn resolve(p: &ResolveParams, state: &mut FontState) -> Result<Value, ErrorBody> {
    check(p)?;
    let result = resolve_in(state, p);
    let missed = result["missing"].as_array().is_some_and(|missing| !missing.is_empty());
    if missed && state.rescan_changed() {
        return Ok(resolve_in(state, p));
    }
    Ok(result)
}

fn check(p: &ResolveParams) -> Result<(), ErrorBody> {
    let bad = |f: &FaceParam| f.family.trim().is_empty() || f.family.chars().count() > 200 || !(1..=1000).contains(&f.weight);
    if p.faces.is_empty() || p.faces.len() > MAX_FACES || p.faces.iter().any(bad) {
        return Err(ErrorBody::new(
            "INVALID_PARAMS",
            msg!(
                "engineHost.fontFacesInvalid",
                "Give 1 to {max} faces: each family name non-empty and at most 200 characters, each weight between 1 and 1000",
                max = MAX_FACES
            ),
            Retryability::Never,
        ));
    }
    if p.cache_dir.as_ref().is_some_and(|dir| !dir.is_absolute()) {
        return Err(ErrorBody::new(
            "INVALID_PARAMS",
            msg!("engineHost.cacheDirRelative", "cacheDir must be absolute"),
            Retryability::Never,
        ));
    }
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// `{ faces: [{ family, weight, italic, source, path, faceIndex, fileSize, size, header, tables: [{ from, length, to }] }],
/// missing: [{ family, weight, italic, reason }] }`：重复的请求只答一次、按请求的顺序。`source` 是 `local`（本机字体）
/// 或 `downloaded`（下载缓存）；`header` 是抽出来的字体的文件头（十六进制），`tables` 是每张表从原文件的 `from` 起
/// `length` 个字节放到新字体的 `to`，`size` 是拼好之后的字节数。
fn resolve_in(state: &mut FontState, p: &ResolveParams) -> Value {
    let mut faces = Vec::new();
    let mut missing = Vec::new();
    let mut seen: Vec<FaceParam> = Vec::new();
    for face in &p.faces {
        if seen.contains(face) {
            continue;
        }
        seen.push(face.clone());
        let query = FaceQuery {
            family: face.family.clone(),
            weight: face.weight,
            italic: face.italic,
        };
        let found = state.pick(&query, p.cache_dir.as_deref()).and_then(|(found, source)| {
            let layout = std::fs::File::open(&found.path)
                .and_then(|mut file| FaceLayout::read(&mut file, found.file_len, found.index))
                .map_err(|_| Missing::NotFound)?;
            Ok((found, source, layout))
        });
        match found {
            Ok((found, source, layout)) => {
                let tables: Vec<Value> = layout
                    .tables
                    .iter()
                    .map(|t| json!({ "from": t.from, "length": t.len, "to": t.to }))
                    .collect();
                faces.push(json!({
                    "family": &face.family,
                    "weight": face.weight,
                    "italic": face.italic,
                    "source": source,
                    "path": found.path,
                    "faceIndex": found.index,
                    "fileSize": found.file_len,
                    "size": layout.size,
                    "header": hex(&layout.header),
                    "tables": tables,
                }));
            }
            Err(reason) => missing.push(json!({
                "family": &face.family,
                "weight": face.weight,
                "italic": face.italic,
                "reason": reason.code(),
            })),
        }
    }
    json!({ "faces": faces, "missing": missing })
}

/// `{ families: [族名…] }`：本机已装的族（字体目录变过时先重扫）。
fn families(state: &mut FontState) -> Value {
    if state.system.as_ref().is_some_and(FontLibrary::changed) {
        state.system = Some((state.scan)());
    }
    json!({ "families": state.system().families() })
}

/// `{ faces: [{ index, families, postScriptName, weight, italic }] }`：文件超过 [`MAX_FACE_BYTES`]、读不出字体、表在
/// 文件之外时以 `FONT_INVALID` 拒绝。
fn inspect(p: &InspectParams) -> Result<Value, ErrorBody> {
    if !p.path.is_absolute() {
        return Err(ErrorBody::new(
            "INVALID_PARAMS",
            msg!("engineHost.fontPathRelative", "path must be absolute"),
            Retryability::Never,
        ));
    }
    let faces = font_files::inspect_file(&p.path, MAX_FACE_BYTES)
        .map_err(|e| ErrorBody::new(
            "FONT_INVALID",
            msg!("engineHost.fontInvalid", "Not a usable font file: {error}", error = e.to_string()),
            Retryability::Never,
        ))?;
    let faces: Vec<Value> = faces
        .iter()
        .map(|face| {
            json!({
                "index": face.index,
                "families": &face.names.families,
                "postScriptName": &face.names.post_script_name,
                "weight": face.weight,
                "italic": face.italic,
            })
        })
        .collect();
    Ok(json!({ "faces": faces }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bundled(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../render-raster/assets/fonts")
            .join(name)
    }

    thread_local! {
        static FONT_DIR: std::cell::RefCell<PathBuf> = std::cell::RefCell::default();
    }

    fn scan_test_dir() -> FontLibrary {
        FONT_DIR.with_borrow(|dir| FontLibrary::from_dirs(std::slice::from_ref(dir)))
    }

    fn params(value: Value) -> ResolveParams {
        let p: ResolveParams = serde_json::from_value(value).unwrap();
        check(&p).unwrap();
        p
    }

    #[test]
    fn faces_resolve_to_a_file_index_and_layout_or_a_reason() {
        let dir = tempfile::tempdir().unwrap();
        let source = bundled("PermanentMarker-Regular.ttf");
        let target = dir.path().join("marker.ttf");
        std::fs::copy(&source, &target).unwrap();
        FONT_DIR.set(dir.path().to_path_buf());
        let mut state = FontState::new(scan_test_dir);
        let p = params(json!({ "faces": [
            { "family": "Permanent Marker", "weight": 400, "italic": false },
            { "family": "Nowhere Sans", "weight": 700, "italic": true },
            { "family": "Permanent Marker", "weight": 400, "italic": false },
        ] }));
        let result = resolve_in(&mut state, &p);
        let bytes = std::fs::read(&source).unwrap();
        let face = &result["faces"][0];
        assert_eq!(result["faces"].as_array().unwrap().len(), 1);
        assert_eq!(face["path"], json!(target));
        assert_eq!(face["source"], "local");
        assert_eq!(face["faceIndex"], 0);
        assert_eq!(face["fileSize"], bytes.len());
        assert_eq!(
            result["missing"],
            json!([{ "family": "Nowhere Sans", "weight": 700, "italic": true, "reason": "not-found" }])
        );
        // 照这份做法从文件里搬表，拼出来的与抽 face 的结果相同。
        let header = face["header"].as_str().unwrap();
        let mut out = vec![0u8; face["size"].as_u64().unwrap() as usize];
        for (i, byte) in (0..header.len()).step_by(2).enumerate() {
            out[i] = u8::from_str_radix(&header[byte..byte + 2], 16).unwrap();
        }
        for table in face["tables"].as_array().unwrap() {
            let (from, length, to) = (
                table["from"].as_u64().unwrap() as usize,
                table["length"].as_u64().unwrap() as usize,
                table["to"].as_u64().unwrap() as usize,
            );
            out[to..to + length].copy_from_slice(&bytes[from..from + length]);
        }
        assert_eq!(out, font_files::extract_face(&bytes, 0).unwrap());
    }

    /// 引擎宿主开着的时候装了新字体：找不到、字体目录又变过时重扫，这次就找得到；目录没变时不重扫。
    #[test]
    fn a_font_installed_after_the_scan_is_found_on_the_next_miss() {
        let dir = tempfile::tempdir().unwrap();
        FONT_DIR.set(dir.path().to_path_buf());
        let p = params(json!({ "faces": [{ "family": "Permanent Marker", "weight": 400, "italic": false }] }));
        let mut state = FontState::new(scan_test_dir);
        let first = resolve(&p, &mut state).unwrap();
        assert_eq!(first["missing"].as_array().unwrap().len(), 1);
        assert!(!state.rescan_changed());
        std::fs::copy(bundled("PermanentMarker-Regular.ttf"), dir.path().join("marker.ttf")).unwrap();
        let second = resolve(&p, &mut state).unwrap();
        assert_eq!(second["faces"].as_array().unwrap().len(), 1, "{second}");
        assert!(!state.rescan_changed());
    }

    /// 本机没有的族到下载缓存里找（标 `downloaded`）；缓存里后来下载到的也找得到；本机有的族只认本机的。
    #[test]
    fn families_missing_locally_resolve_from_the_download_cache() {
        let local = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        std::fs::copy(bundled("Anton-Regular.ttf"), local.path().join("anton.ttf")).unwrap();
        std::fs::copy(bundled("Anton-Regular.ttf"), cache.path().join("anton-cached.ttf")).unwrap();
        FONT_DIR.set(local.path().to_path_buf());
        let mut state = FontState::new(scan_test_dir);
        let p = params(json!({ "cacheDir": cache.path(), "faces": [
            { "family": "Anton", "weight": 400, "italic": false },
            { "family": "Permanent Marker", "weight": 400, "italic": false },
        ] }));
        let first = resolve(&p, &mut state).unwrap();
        assert_eq!(first["faces"][0]["source"], "local");
        assert_eq!(first["faces"][0]["path"], json!(local.path().join("anton.ttf")));
        assert_eq!(first["missing"][0]["family"], "Permanent Marker");
        // 下载完成：文件进了缓存目录，下次找不到时重扫缓存。
        let sub = cache.path().join("permanent-marker");
        std::fs::create_dir(&sub).unwrap();
        std::fs::copy(bundled("PermanentMarker-Regular.ttf"), sub.join("permanent-marker-400.ttf")).unwrap();
        let second = resolve(&p, &mut state).unwrap();
        assert_eq!(second["missing"], json!([]), "{second}");
        assert_eq!(second["faces"][1]["source"], "downloaded");
        assert_eq!(second["faces"][1]["path"], json!(sub.join("permanent-marker-400.ttf")));
        // 不给缓存目录时只找本机。
        let only_local = resolve(
            &params(json!({ "faces": [{ "family": "Permanent Marker", "weight": 400, "italic": false }] })),
            &mut state,
        )
        .unwrap();
        assert_eq!(only_local["missing"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn requests_are_bounded() {
        let face = |family: &str, weight: u16| json!({ "family": family, "weight": weight, "italic": false });
        let many: Vec<Value> = (0..=MAX_FACES).map(|i| face(&format!("F{i}"), 400)).collect();
        let p: ResolveParams = serde_json::from_value(json!({ "faces": many })).unwrap();
        assert_eq!(check(&p).unwrap_err().code, "INVALID_PARAMS");
        for bad in [json!([]), json!([face(" ", 400)]), json!([face("A", 0)]), json!([face("A", 1001)])] {
            let p: ResolveParams = serde_json::from_value(json!({ "faces": bad })).unwrap();
            assert!(check(&p).is_err());
        }
        let relative: ResolveParams = serde_json::from_value(json!({ "faces": [face("A", 400)], "cacheDir": "fonts" })).unwrap();
        assert!(check(&relative).is_err());
        assert!(serde_json::from_value::<ResolveParams>(json!({ "faces": [], "dirs": [] })).is_err());
        assert!(serde_json::from_value::<ResolveParams>(json!({ "families": ["A"] })).is_err());
    }

    #[test]
    fn inspect_reports_faces_and_rejects_files_that_are_not_fonts() {
        let ok = inspect(&InspectParams {
            path: bundled("PlayfairDisplay-Italic.ttf"),
        })
        .unwrap();
        assert_eq!(ok["faces"][0]["families"][0], "Playfair Display");
        assert_eq!(ok["faces"][0]["italic"], true);
        let dir = tempfile::tempdir().unwrap();
        let html = dir.path().join("page.ttf");
        std::fs::write(&html, b"<!DOCTYPE html>").unwrap();
        assert_eq!(inspect(&InspectParams { path: html }).unwrap_err().code, "FONT_INVALID");
        assert_eq!(inspect(&InspectParams { path: "a.ttf".into() }).unwrap_err().code, "INVALID_PARAMS");
    }

    /// 写进内存的 stdout。
    #[derive(Clone, Default)]
    struct Captured(std::sync::Arc<std::sync::Mutex<Vec<u8>>>);

    impl std::io::Write for Captured {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn the_font_thread_answers_every_request_in_whole_lines() {
        let captured = Captured::default();
        let mut worker = FontWorker::new(Output::new(Box::new(captured.clone())));
        assert!(worker.queue.is_none(), "没有字体请求时不起线程");
        worker.submit(
            json!(7),
            "fonts.resolve",
            json!({ "faces": [{ "family": "Nowhere Sans", "weight": 400, "italic": false }] }),
        );
        worker.submit(json!("b"), "fonts.resolve", json!({ "faces": [], "dirs": [] }));
        worker.submit(json!(9), "fonts.inspect", json!({ "path": bundled("Anton-Regular.ttf") }));
        worker.submit(json!(10), "fonts.unknown", json!({}));
        worker.finish();
        let text = String::from_utf8(captured.0.lock().unwrap().clone()).unwrap();
        let lines: Vec<Value> = text.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(lines.len(), 4);
        assert_eq!(lines[0]["id"], json!(7));
        assert!(lines[0]["result"]["faces"].is_array());
        assert_eq!(lines[1]["id"], json!("b"));
        assert_eq!(lines[1]["error"]["code"], "INVALID_PARAMS");
        assert_eq!(lines[2]["result"]["faces"][0]["families"][0], "Anton");
        assert_eq!(lines[3]["error"]["code"], "UNKNOWN_METHOD");
    }
}
