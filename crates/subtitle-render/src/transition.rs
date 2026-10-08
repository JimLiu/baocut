#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TransitionPose {
    pub opacity: f64,
    pub scale_x: f64,
    pub scale_y: f64,
    pub blur: f64,
    pub active: bool,
}

impl TransitionPose {
    const IDENTITY: Self = Self {
        opacity: 1.0,
        scale_x: 1.0,
        scale_y: 1.0,
        blur: 0.0,
        active: false,
    };
}

/// 字幕入场姿态（`transition.caption.*@1`）。
///
/// 阶段 5 起这里只做**取用**：贝塞尔控制点、求解器、相位量化与派生通道全部
/// 在 `core/presets/builtin/transition/caption.*.json` 里，由
/// `motion::preset_registry::caption_transition` 按持久化的历史 id
/// （`magic-fade` / `magic-pop` / `magic-flip`）查出。配方之外没有第二份数字。
pub fn transition_pose(
    style: &Value,
    display_start: f64,
    time: f64,
    canvas_scale: f64,
    fps: f64,
) -> TransitionPose {
    let transition = style.get("transition").unwrap_or(&Value::Null);
    let id = transition
        .get("transitionId")
        .or_else(|| transition.get("id"))
        .and_then(Value::as_str)
        .or_else(|| style.get("transitionId").and_then(Value::as_str))
        .unwrap_or("none");
    let Some(recipe) = render_raster::caption_transition(id) else {
        return TransitionPose::IDENTITY;
    };
    let duration = transition_duration(style);
    if duration <= 0.0 {
        return TransitionPose::IDENTITY;
    }
    let phase = recipe.phase(time, display_start, duration, fps);
    if phase >= 1.0 {
        return TransitionPose::IDENTITY;
    }
    let eased = recipe.eased(phase);
    let mut pose = TransitionPose {
        active: true,
        ..TransitionPose::IDENTITY
    };
    for channel in &recipe.channels {
        let value = recipe.channel_value(channel, eased, canvas_scale);
        match channel.prop.as_str() {
            "opacity" => pose.opacity = value,
            "scale" => {
                pose.scale_x = value;
                pose.scale_y = value;
            }
            "scaleX" => pose.scale_x = value,
            "scaleY" => pose.scale_y = value,
            "blur" => pose.blur = value,
            // 通道名是配方解析期的封闭集合，走不到这里。
            _ => {}
        }
    }
    pose
}

pub fn mode_lines(mode: StudioMode, order: &str) -> Vec<LineKind> {
    match mode {
        StudioMode::Original => vec![LineKind::Original],
        StudioMode::Translated => vec![LineKind::Translation],
        StudioMode::Bilingual if order == "orig" => {
            vec![LineKind::Original, LineKind::Translation]
        }
        StudioMode::Bilingual => vec![LineKind::Translation, LineKind::Original],
    }
}

#[derive(Debug, Clone)]
pub struct CachedFrame {
    pub key: String,
    pub rgba: Arc<Vec<u8>>,
    pub next_change: Option<f64>,
    /// 渲染时求得的非零 alpha 包围盒；`None` = 整帧透明。缓存它让
    /// `ensure_composited` 不必对复用的帧再扫描一次整幅缓冲。
    pub bounds: Option<ContentBox>,
    pub composite: CaptionCompositeMode,
}

pub struct OverlayFrame {
    /// 本帧**字幕层**的内容键（`RenderedSubtitleFrame::key`）。几何侧车
    /// [`OverlayRenderPlan::subtitle_layout`] 在同一时刻算出逐字相同的值，
    /// `X-Bcut-Overlay-Key` 就是它加上计划前缀的哈希——两端同源靠的是这个字段，
    /// 不是整图指纹（侧车不光栅化，拿不到也不该拿 DrawOp 指纹）。
    pub subtitle_key: String,
    /// 整幅 overlay（字幕层 + timeline 元素）的像素身份。「这张图变没变」只能问它。
    pub draw_op_fingerprint: u64,
    pub png: Vec<u8>,
    pub next_change: Option<f64>,
}

/// 一帧 overlay 的 premultiplied RGBA 与它的两个身份。
///
/// 与 [`OverlayFrame`] 是同一次渲染的两种交付形态：serve 的 HTTP 端点要 PNG，
/// App v2 的进程内预览要可直接上传的像素。**两个身份不可互相顶替**——
/// `subtitle_key` 只认字幕层内容（几何侧车不光栅化也能算出同一个值），
/// `draw_op_fingerprint` 才是「这张图变没变」；只看前者会让「字幕没变、
/// 只有 timeline 元素在动」的帧被整段吞掉，画面钉死。
pub struct OverlayRgbaFrame {
    pub width: u32,
    pub height: u32,
    /// 本帧字幕层的内容键，与 `X-Bcut-Overlay-Key` 同源。
    pub subtitle_key: String,
    /// 整幅 overlay（字幕层 + timeline 元素）的像素身份。
    pub draw_op_fingerprint: u64,
    /// premultiplied RGBA，长度 = `width * height * 4`。
    pub rgba: Vec<u8>,
    pub next_change: Option<f64>,
}

pub struct RenderedSubtitleFrame {
    pub key: String,
    pub rgba: Arc<Vec<u8>>,
    pub next_change: Option<f64>,
    /// 非零 alpha 包围盒，`None` = 整帧透明。字幕层永远知道自己的包围盒。
    pub bounds: Option<ContentBox>,
    pub composite: CaptionCompositeMode,
}

/// 浏览器字幕层的交付形态：[`RenderedSubtitleFrame`] 的非零 alpha 子矩形，
/// 且**已解预乘**。
///
/// 两点都不是优化而是正确性：Canvas2D 的 `putImageData` 只接受 straight
/// alpha，把预乘字节直接喂进去会给每个抗锯齿字形边缘描一道暗边；整幅画布每帧
/// 过一次 JS 边界在 1080p 是 8.3 MB，而字幕永远只占画面下缘一条。
///
/// 什么时候用它：glyph scene 报 [`SubtitleSceneFallback`] 时宿主必须显式回退整幅
/// CPU 字幕 overlay，这就是浏览器侧那条回退口。`width == 0` 表示整帧透明。
#[derive(Debug, Clone)]
pub struct SubtitleRasterLayer {
    /// 与 [`RenderedSubtitleFrame::key`] 同一个内容键：宿主据此判断能不能留着
    /// 上一帧的位图不重画。
    pub key: String,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    /// straight-alpha RGBA，长度 = `width * height * 4`。
    pub rgba: Vec<u8>,
    pub next_change: Option<f64>,
    pub composite: CaptionCompositeMode,
}

/// R2 的字幕 GPU 场景交付形态。`key` 仍由现有 OverlayRenderPlan 内容键产生；
/// scene 只换执行层，不另造排版身份。
#[derive(Debug, Clone)]
pub struct SubtitleSceneFrame {
    pub key: String,
    pub scene: element_draw::SceneFrame,
}

/// 当前 glyph scene 尚未覆盖的样式必须显式回退整幅 CPU overlay。每加一种 GPU
/// 效果 pass 就删掉对应分支；禁止以“接近”名义静默漏画。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubtitleSceneFallback {
    CompositeMode,
    WordAnimation,
    InvalidMask,
    SceneLimit,
}

impl std::fmt::Display for SubtitleSceneFallback {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let reason = match self {
            Self::CompositeMode => "blend mode 尚未进入 glyph pass",
            Self::WordAnimation => "逐词配方尚未 uniform 化",
            Self::InvalidMask => "swash 无法提供有效的 glyph atlas 图像",
            Self::SceneLimit => "scene 节点或 glyph run uniform 数量超出上限",
        };
        formatter.write_str(reason)
    }
}

impl std::error::Error for SubtitleSceneFallback {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptionCompositeMode {
    Normal,
    Difference,
    Exclusion,
    Screen,
}

/// overlay 像素的非零区域。DrawOp 全路径（timeline 元素）不跟踪包围盒，
/// 用 `Unknown` 交给调用方扫描。
pub enum OverlayContent {
    Unknown,
    Empty,
    Bounds(ContentBox),
}

/// 导出路径的帧级合成缓存：`[start, end)` 区间内 overlay 像素完全一致
/// （由 `next_change` 契约保证），区间内的帧直接复用合成结果，跳过排版、
/// 光栅化与整帧拷贝。
pub struct CompositedOverlay {
    pub start: f64,
    pub end: f64,
    /// 字幕层在下、timeline 元素层在上。空数组表示整帧透明。
    pub frames: Vec<CompositedFrame>,
}

/// 一份可复用的 overlay 像素与其非零 alpha 包围盒；混合只遍历包围盒。
pub struct CompositedFrame {
    pub rgba: Arc<Vec<u8>>,
    pub bounds: ContentBox,
    pub composite: CaptionCompositeMode,
}

pub struct ExportOverlayLayer {
    pub rgba: Arc<Vec<u8>>,
    pub content: OverlayContent,
    pub composite: CaptionCompositeMode,
}

/// 非零内容的行/列包围盒（半开区间）。定义已迁到 `render_raster::effects`
/// （模糊 / 合成的参考实现都按它切子区），这里只保留本模块的名字。
use render_raster::effects::ContentBox;

/// 按 `(层, 行 id)` 缓存 shaping 结果：字幕行显示期间文本与样式不变，
/// 排版与逐词状态无关，同一行只 shaping 一次。
pub struct CachedLayout {
    pub lines: Arc<[LayoutLine]>,
    pub width: f64,
}

pub struct RenderedOverlayFrame {
    /// 本帧字幕层的内容键；`None` = 这一帧根本没有字幕层（导出的元素独立层）。
    pub subtitle_key: Option<String>,
    pub draw_op_fingerprint: u64,
    pub rgba: Vec<u8>,
    pub next_change: Option<f64>,
}

#[derive(Clone)]
pub struct TimelineVisualElement {
    pub id: String,
    pub kind: ElementKind,
    pub start: f64,
    pub end: f64,
    pub place: Place,
    pub vertical_align: Option<VerticalAlign>,
    pub src_id: Option<String>,
    pub src_start: f64,
    pub rate: f64,
    pub audio_fade_in: f64,
    pub audio_fade_out: f64,
    pub mode: VisualMode,
    pub fit: Fit,
    /// 全屏 + contain 时留边的底。`None` 不预填底板：合成实例的预渲染替身（视频格式规范 §3.7）没有
    /// `bg`，透明区域要露出下层。
    pub bg: Option<Background>,
    pub text: Option<String>,
    pub counter: Option<CounterProps>,
    pub style: Value,
    pub tile: Option<Tile>,
    pub mask: Option<Mask>,
    pub fx: Option<Fx>,
    pub animation: Option<Animation>,
    pub transitions: Option<timeline::video_transitions::VideoTransitions>,
    /// 0.12 的逐属性关键帧（设计 G6）。画面属性的取样值在每帧开头**替换**
    /// 静态 `place` 成为基础姿态（[`Self::keyframe_place`]），入场 / 退场 /
    /// 循环槽照旧叠在上面；`volume` 关键帧只进混音，不在这里用。
    pub keyframes: Option<timeline::keyframes::Keyframes>,
    /// 0.2 转正的四组元素 props（设计 §5.2）。互斥由 `Element::validate`
    /// 的 `element-props-mismatch` 保证，这里原样带过来即可。
    pub shape: Option<ShapeProps>,
    pub sticker: Option<StickerProps>,
    pub visualizer: Option<VisualizerProps>,
    pub progress: Option<ProgressProps>,
    pub draw: Option<DrawProps>,
    pub placeholder: Option<PlaceholderProps>,
    /// 0.6 的彩纸参数（`kind: "confetti"`）。
    pub confetti: Option<ConfettiProps>,
    pub whiteboard: Option<WhiteboardProps>,
}

impl TimelineVisualElement {
    /// 把 `time`（元素所在的钟）的关键帧取样代入 `place`。没有画面关键帧时
    /// 不动，老文档逐位不变。每帧求值开头调用一次，之后所有读 `place` 的地方
    /// （盒、变换、效果、指纹）看到的都是这一刻的基础姿态。
    pub fn keyframe_place(&mut self, time: f64) {
        if let Some(place) = timeline::keyframes::place_at(
            Some(&self.place),
            self.keyframes.as_ref(),
            time - self.start,
            (self.end - self.start).max(0.0),
        ) {
            self.place = place;
        }
    }

    /// 带画面关键帧：基础姿态逐帧在变，调度要逐帧推进。
    pub fn has_visual_keyframes(&self) -> bool {
        self.keyframes
            .as_ref()
            .is_some_and(timeline::keyframes::Keyframes::has_visual)
    }

    /// 只给「舞台彩纸试穿」用的合成件：素材库网格悬停一格时，时间轴里根本没有
    /// 对应的元素，就地补丁无处落笔（第 236 轮）。
    ///
    /// **敢凭空造一件，是因为彩纸是闭式运动核算出来的**：没有 `src_id`、没有
    /// 字体、没有位图，画它不需要 media store 里存在任何东西。贴纸 / 视频 /
    /// 文字 / 声波都不成立——它们要么要素材装载，要么要 shaping，照抄这个构造器
    /// 只会得到一件永远画不出来的空壳。
    ///
    /// 它只进 App 的**预览**计划：不写文档、不进历史、不进导出。`start` / `end`
    /// 就是这一次试穿的窗口，采样时刻由既有的 `element_sample_time` 通道推。
    pub fn confetti_preview(
        id: impl Into<String>,
        props: ConfettiProps,
        start: f64,
        end: f64,
    ) -> Self {
        Self {
            id: id.into(),
            kind: ElementKind::Confetti,
            start,
            end,
            place: Place::default(),
            vertical_align: None,
            src_id: None,
            src_start: 0.0,
            rate: 1.0,
            audio_fade_in: 0.0,
            audio_fade_out: 0.0,
            mode: VisualMode::Pip,
            fit: Fit::Cover,
            bg: Some(Background::Black),
            text: None,
            counter: None,
            style: Value::Object(serde_json::Map::new()),
            tile: None,
            mask: None,
            fx: None,
            animation: None,
            transitions: None,
            keyframes: None,
            shape: None,
            sticker: None,
            visualizer: None,
            progress: None,
            draw: None,
            placeholder: None,
            confetti: Some(props),
            whiteboard: None,
        }
    }
}

pub struct OverlayFrameMedia {
    #[cfg(feature = "host")]
    pub base: MediaStore,
    #[cfg(not(feature = "host"))]
    pub base: InjectedMediaStore,
    pub dynamic: HashMap<String, Arc<Pixmap>>,
    /// v3：宿主按 id 注入的源画面（`frame-render` 把解码好的视频帧、图片与 Lottie 帧放在这里），
    /// 取源时先于 `base`。与 `dynamic` 不同，它不在每帧组装指令流时清空，由宿主自己换。
    pub injected: HashMap<String, Arc<Pixmap>>,
}

/// wasm-safe 字幕 scene 不读取媒体；这个空 store 只让共享 CPU effect 代码保留
/// 同一个 [`FrameMedia`] 边界。若错误地把媒体 DrawOp 送进浏览器计划，会显式报错。
#[cfg(not(feature = "host"))]
pub struct InjectedMediaStore;

#[cfg(not(feature = "host"))]
impl InjectedMediaStore {
    pub fn video_duration(&self, _id: &str) -> Option<f64> {
        None
    }

    pub fn video_last_frame_time(&self, _id: &str) -> Option<f64> {
        None
    }

    pub fn has_video(&self, _id: &str) -> bool {
        false
    }

    pub fn has_animated(&self, _id: &str) -> bool {
        false
    }

    pub fn animated_duration(&self, _id: &str) -> Option<f64> {
        None
    }

    pub fn is_time_varying(&self, _id: &str) -> bool {
        false
    }

    pub fn media_duration(&self, _id: &str) -> Option<f64> {
        None
    }
}

#[cfg(not(feature = "host"))]
impl FrameMedia for InjectedMediaStore {
    fn frame(&mut self, id: &str, _media_ms: i64) -> Result<Arc<Pixmap>> {
        bail!("wasm-safe 字幕计划没有注入媒体资源：{id}")
    }
}

impl OverlayFrameMedia {
    /// 这个 id 手上是否已有一份可取帧的素材：静态图，或 Lottie（含换色变体）。
    ///
    /// 素材贴纸换色变体的存在性判据（见 `sticker_fill_variant_id`）：变体是
    /// 预载期按需生成的，取帧前必须先问一句，否则 `frame()` 会对着没备货的 id
    /// 报错，把「不换色」变成「画不出来」。
    pub fn has_image(&self, id: &str) -> bool {
        if self.dynamic.contains_key(id) || self.injected.contains_key(id) {
            return true;
        }
        #[cfg(feature = "host")]
        {
            self.base.has_image(id) || self.base.has_lottie(id)
        }
        #[cfg(not(feature = "host"))]
        {
            let _ = id;
            false
        }
    }

    pub fn empty(fps: f64) -> Self {
        #[cfg(not(feature = "host"))]
        let _ = fps;
        Self {
            #[cfg(feature = "host")]
            base: MediaStore::new(Arc::new(LoadedAssets::default()), fps),
            #[cfg(not(feature = "host"))]
            base: InjectedMediaStore,
            dynamic: HashMap::new(),
            injected: HashMap::new(),
        }
    }

    /// v3：媒体元素取源画面——宿主注入的优先，其次是装载的素材。
    pub fn source_frame(&mut self, id: &str, media_ms: i64) -> Result<Arc<Pixmap>> {
        if let Some(pixmap) = self.injected.get(id) {
            return Ok(pixmap.clone());
        }
        FrameMedia::frame(&mut self.base, id, media_ms)
    }
}

impl FrameMedia for OverlayFrameMedia {
    fn frame(&mut self, id: &str, media_ms: i64) -> Result<Arc<Pixmap>> {
        if let Some(pixmap) = self.dynamic.get(id) {
            return Ok(pixmap.clone());
        }
        self.source_frame(id, media_ms)
    }
}

#[cfg(feature = "host")]
pub fn overlay_document_with_live_timeline(project: &Path, document: &Value) -> Result<Value> {
    overlay_document_with_live_timeline_owned(project, document.clone())
}

/// [`overlay_document_with_live_timeline`] 的拿走所有权版本：投影直接改在
/// 传入的正文上，不再深拷一份。已带 `_overlayTimelineFingerprint` 的正文原样
/// 返回（与借用版本的早退语义一致）。
#[cfg(feature = "host")]
pub fn overlay_document_with_live_timeline_owned(
    project: &Path,
    mut document: Value,
) -> Result<Value> {
    if document
        .get("_overlayTimelineFingerprint")
        .is_some_and(Value::is_string)
    {
        return Ok(document);
    }
    let timeline = crate::host::studio_timeline_projection(project)?;
    document["timeline"] = timeline;
    let projection = crate::host::project_timeline_projection(project)?;
    project_overlay_timed_items(&mut document, &projection);
    let truth = fs::read(project.join("timeline.json")).unwrap_or_default();
    document["_overlayTimelineFingerprint"] =
        serde_json::json!(format!("{:016x}", render_raster::drawop::fnv1a64(&truth)));
    Ok(document)
}

pub fn mapped_item_words(item: &mut Value, mapped: &timeline::MappedEvent) {
    let Some(words) = item.get("words").and_then(Value::as_array) else {
        return;
    };
    let had_words = !words.is_empty();
    let source_duration = mapped.source_end - mapped.source_start;
    let timeline_duration = mapped.timeline_end - mapped.timeline_start;
    let scale = if source_duration > 0.0 {
        timeline_duration / source_duration
    } else {
        1.0
    };
    let mut projected = Vec::new();
    for word in words {
        let Some(start) = word
            .get("t0")
            .or_else(|| word.get("start"))
            .and_then(Value::as_f64)
        else {
            continue;
        };
        let Some(end) = word
            .get("t1")
            .or_else(|| word.get("end"))
            .and_then(Value::as_f64)
        else {
            continue;
        };
        let source_start = start.max(mapped.source_start);
        let source_end = end.min(mapped.source_end);
        if source_end <= source_start {
            continue;
        }
        let mut word = word.clone();
        let timeline_start = mapped.timeline_start + (source_start - mapped.source_start) * scale;
        let timeline_end = mapped.timeline_start + (source_end - mapped.source_start) * scale;
        if let Some(object) = word.as_object_mut() {
            if object.contains_key("t0") {
                object.insert("t0".to_owned(), serde_json::json!(timeline_start));
            }
            if object.contains_key("t1") {
                object.insert("t1".to_owned(), serde_json::json!(timeline_end));
            }
            if object.contains_key("start") {
                object.insert("start".to_owned(), serde_json::json!(timeline_start));
            }
            if object.contains_key("end") {
                object.insert("end".to_owned(), serde_json::json!(timeline_end));
            }
        }
        projected.push(word);
    }
    if let Some(object) = item.as_object_mut() {
        if !projected.is_empty() {
            let text = speech_doc::atomize::join_word_texts(
                // 词上的「贴前」标记随投影带过来（稀疏，缺省 false）。
                projected.iter().filter_map(|word| {
                    let glue = word.get("glue").and_then(Value::as_bool).unwrap_or(false);
                    Some((word.get("text").and_then(Value::as_str)?, glue))
                }),
            );
            if !text.trim().is_empty() {
                object.insert("text".to_owned(), Value::String(text));
            }
        } else if had_words {
            object.insert("text".to_owned(), Value::String(String::new()));
        }
        object.insert("words".to_owned(), Value::Array(projected));
    }
}

pub fn project_source_items(
    source_docs: &serde_json::Map<String, Value>,
    projection: &timeline::TimelineProjection,
    key: &str,
) -> Vec<Value> {
    let mut output = Vec::new();
    for (source_id, source) in source_docs {
        for item in source
            .get(key)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some(start) = item.get("start").and_then(Value::as_f64) else {
                continue;
            };
            let Some(end) = item.get("end").and_then(Value::as_f64) else {
                continue;
            };
            let item_id = item
                .get("id")
                .or_else(|| item.get("sid"))
                .and_then(Value::as_str)
                .unwrap_or(key);
            for mapped in projection.clamp_source_event(
                source_id,
                start,
                end,
                timeline::MIN_EVENT_DURATION,
            ) {
                let mut projected = item.clone();
                if let Some(object) = projected.as_object_mut() {
                    object.insert(
                        "id".to_owned(),
                        Value::String(format!(
                            "{source_id}:{}:{item_id}:{:.9}",
                            mapped.clip_id, mapped.timeline_start
                        )),
                    );
                    object.insert("sourceId".to_owned(), Value::String(source_id.clone()));
                    object.insert("sourceItemId".to_owned(), Value::String(item_id.to_owned()));
                    object.insert("clipId".to_owned(), Value::String(mapped.clip_id.clone()));
                    object.insert(
                        "sourceStart".to_owned(),
                        serde_json::json!(mapped.source_start),
                    );
                    object.insert("sourceEnd".to_owned(), serde_json::json!(mapped.source_end));
                    object.insert("start".to_owned(), serde_json::json!(mapped.timeline_start));
                    object.insert("end".to_owned(), serde_json::json!(mapped.timeline_end));
                }
                mapped_item_words(&mut projected, &mapped);
                output.push(projected);
            }
        }
    }
    output.sort_by(|left, right| {
        numeric_sort(left.get("start"), right.get("start"))
            .then_with(|| numeric_sort(left.get("end"), right.get("end")))
            .then_with(|| {
                left.get("id")
                    .and_then(Value::as_str)
                    .cmp(&right.get("id").and_then(Value::as_str))
            })
    });
    if key == "transCues" {
        output = merge_collapsed_translation_fragments(output);
    }
    output
}

/// A source-time translation cue may cross a removed source interval. The
/// timeline projection returns one fragment per kept span, but those spans are
/// adjacent after cut collapse and still represent one delivery cue. Merge only
/// fragments from the same clip/item; reused clips remain separate occurrences.
pub fn merge_collapsed_translation_fragments(items: Vec<Value>) -> Vec<Value> {
    const EPSILON: f64 = 1e-6;
    let mut output: Vec<Value> = Vec::new();
    for item in items {
        let merge = output.last().is_some_and(|previous| {
            previous["sourceId"] == item["sourceId"]
                && previous["clipId"] == item["clipId"]
                && previous["sourceItemId"] == item["sourceItemId"]
                && previous["text"] == item["text"]
                && previous["end"]
                    .as_f64()
                    .zip(item["start"].as_f64())
                    .is_some_and(|(end, start)| (end - start).abs() <= EPSILON)
        });
        if merge {
            let previous = output.last_mut().expect("checked above");
            previous["end"] = item["end"].clone();
            previous["sourceEnd"] = item["sourceEnd"].clone();
            continue;
        }
        output.push(item);
    }
    output
}

pub fn numeric_sort(left: Option<&Value>, right: Option<&Value>) -> std::cmp::Ordering {
    left.and_then(Value::as_f64)
        .unwrap_or_default()
        .total_cmp(&right.and_then(Value::as_f64).unwrap_or_default())
}

pub fn project_overlay_timed_items(
    document: &mut Value,
    projection: &timeline::TimelineProjection,
) {
    let Some(mut source_docs) = document
        .get("sourceDocs")
        .and_then(Value::as_object)
        .cloned()
    else {
        return;
    };
    let root = source_docs
        .entry("main".to_owned())
        .or_insert_with(|| serde_json::json!({}));
    for key in ["cues", "sentences", "transCues"] {
        if document.get(key).is_some_and(Value::is_array) {
            root[key] = document[key].clone();
        }
    }
    document["cues"] = Value::Array(project_source_items(&source_docs, projection, "cues"));
    document["sentences"] =
        Value::Array(project_source_items(&source_docs, projection, "sentences"));
    document["transCues"] =
        Value::Array(project_source_items(&source_docs, projection, "transCues"));
    document["meta"]["duration"] = serde_json::json!(projection.duration());
}

#[cfg(feature = "host")]
pub fn source_path(
    project: &Path,
    timeline: &TimelineDocument,
    source_id: &str,
) -> Result<PathBuf> {
    if source_id == "main" {
        return project_media(project);
    }
    let raw = timeline
        .sources
        .get(source_id)
        .and_then(|source| source.path.as_deref())
        .with_context(|| format!("source {source_id} 缺少 path"))?;
    let path = crate::paths::resolve(project, raw);
    if !path.is_file() {
        bail!("source 媒体不存在：{}", path.display());
    }
    Ok(path)
}

/// 一次舞台彩纸试穿（第 236 轮）。
///
/// `window` 只在计划里没有 `id` 这一件、要凭空补一件幽灵时用得上；试穿的是
/// 已有元素时那一件自带 `[start, end)`，这里的窗口不参与。
#[derive(Clone, Debug, PartialEq)]
pub struct ConfettiPeek {
    pub id: String,
    pub props: ConfettiProps,
    pub window: (f64, f64),
}

/// 一次彩纸试穿撤回时要做什么（第 236 轮）。
///
/// 就地补丁是**破坏性**的：写进 `element.confetti` 之后，原配方在计划里就没有
/// 第二份副本了。所以装的那一刻必须把撤回动作一起记下来，否则鼠标离开只能靠
/// `plan = None` 整份重编译把原值「找回来」——那正是这条通道要省掉的开销。
#[derive(Clone, Debug, PartialEq)]
pub enum ConfettiPeekUndo {
    /// 试穿的是计划里本来就有的一件：把原配方写回去。
    Restore(Option<ConfettiProps>),
    /// 试穿的是凭空补的幽灵件（素材库网格）：整件摘掉。
    Remove,
}

pub struct OverlayRenderPlan {
    /// 动态栅格的资源名取法，见 [`DynamicAssetNames`]。
    pub dynamic_asset_names: DynamicAssetNames,
    /// 媒体元素用完注入的源画面就从 `media.injected` 里拿走（见
    /// [`OverlayRenderPlan::set_consume_injected_sources`]）。
    pub consume_injected_sources: bool,
    /// 分层文字动画（`textMotion` / `wordBackground`）的逐条编译期量，与
    /// [`Self::cues`] / [`Self::translations`] 下标一一对应；`None` = 这一条的
    /// 最终样式（整条轨叠逐条覆盖）不带新动画。是否走 CPU 光栅按帧看这里，
    /// 不再有整片静态位。
    text_motion_cues: Vec<Option<TextMotionItem>>,
    text_motion_translations: Vec<Option<TextMotionItem>>,
    /// Ephemeral editor audition clock. Never serialized into the project.
    pub element_sample_time: Option<(String, f64)>,
    /// 舞台彩纸试穿。只活在 App 的预览计划里，从不落盘、从不进导出。
    pub confetti_peek: Option<ConfettiPeek>,
    /// 撤回上一次试穿的动作，与 [`Self::confetti_peek`] 同生同死。
    pub confetti_peek_undo: Option<ConfettiPeekUndo>,
    /// 白板手绘元素的分析记忆（ADR-WB02）：`源 id | 源尺寸 | 参数` → 时间场。
    /// 分析只取决于源图像素与 props，不落盘；换源或改 props 自然换键。
    pub whiteboard_cache: HashMap<String, Arc<render_raster::source::WhiteboardAnalysis>>,
    /// 白板源图按元素盒降采样后的备份：`(源 id, 目标宽, 目标高)` → 像素。
    ///
    /// 揭示场是逐帧算的、成本跟着**源图有多少像素**走，而那张图最后只会被画进
    /// 元素盒里。源比盒大就先缩一次再揭示——缩这一下本身也只做一次，不然等于把
    /// 逐帧的账从揭示挪到重采样。
    pub whiteboard_sources: HashMap<(String, u32, u32), Arc<Pixmap>>,
    pub definition_key: String,
    pub style: Value,
    pub mode: StudioMode,
    pub order: String,
    pub cues: Vec<TimedItem>,
    pub translations: Vec<TimedItem>,
    pub original_style: LineStyle,
    pub translation_style: LineStyle,
    /// 原文行的逐词动画，**编译期定案一次**。`style` 在编译之后不再变动，所以
    /// `word_animation(merged_line_style(style, Original))` 是个常量——以前每帧
    /// 要重算三四遍，每遍都深拷一份根样式 Map 再解析一轮 CSS 颜色。
    /// 用 `Arc` 持有是为了让 `&mut self` 的方法能廉价取一份不借用 `self` 的句柄。
    pub original_animation: Arc<WordAnimation>,
    /// `original_animation.caption` 对应的配方描述符（同样是编译期常量）。
    pub caption_descriptor: Option<&'static CaptionRecipeDescriptor>,
    /// 样式是否带 Designed Caption（`designed_caption_active` 的常量形态）。
    pub designed_caption: bool,
    /// 经典逐词高亮块是否带非恒定的时间轨（`word_box_animated` 的常量形态）。
    /// 有轨时字幕层必须逐帧出图：块在词的窗口里胀缩，`(cue, 当前词)` 已经不足
    /// 以标识一帧。
    pub word_box_animated: bool,
    /// Designed Caption 的复合模式（`caption_recipe_composite_mode` 的常量形态）。
    pub caption_composite: CaptionCompositeMode,
    /// 配方是否要求整组居中（`stack_layout` 的锚点分支）。
    pub centered_caption: bool,
    /// 整条轨的原文长相（上面五个字段的打包形态），没有逐条覆盖的字幕都用它。
    /// `designed_caption` / `word_box_animated` 两个字段是全片口径（任一条带就算），
    /// 这里的同名字段只说整条轨。
    pub track_look: CaptionLook,
    /// 逐条样式（`style.cueStyles`），按 [`TimedItem::id`] 索引，编译期定案。
    pub cue_original: HashMap<String, Arc<CueOverride>>,
    pub cue_translation: HashMap<String, Arc<CueOverride>>,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    pub fps: f64,
    pub text: TextEngine,
    /// 实际交给 [`TextEngine`] 的字体份数（内嵌 studio 字体 ＋ 用户字体库）。
    ///
    /// 存下来而不是让调用方重算 `bundled_studio_fonts().len() + ...`：
    /// 重算出来的数字跟这份计划真正加载的可以不一致（用户字体库随时在变），
    /// 那样的日志比没有更坏。App v2 的 `overlay: plan compiled … fonts=N`
    /// 钩子读的就是这个字段。
    pub fonts_loaded: usize,
    /// 本次导出保留哪几类叠加内容；[`OverlayRenderPlan::load_timeline_elements`]
    /// 按它筛掉整类元素。
    pub includes: OverlayIncludes,
    pub main: Option<Main>,
    pub elements: Vec<TimelineVisualElement>,
    /// 每个 visualizer 元素的整轨频谱，key 是**元素 id**。
    ///
    /// 元素方案 ADR-E04 数据流的第 3 步：host 在 preflight 读 BCS1、按该元素的
    /// `minDb` / `maxDb` / `smoothing` / `gain` 派生完整 `VizTrack`，渲染期只
    /// `sample(t)`。与 `HostInputs` 注入 `MediaMeta` / `CoreWord` 同构——host
    /// 探测、core 消费，渲染期不再有任何 I/O。
    ///
    /// 按元素 id 而不是按音频源存：同一条音轨可以被两个参数不同的 visualizer
    /// 引用，那是两条轨。相同 `(源, 参数)` 的元素共享同一个 `Arc`。
    pub viz_tracks: HashMap<String, Arc<render_raster::source::VizTrack>>,
    /// 输出时刻 → 源媒体时刻的折算（`audio: "project"` 的采样时刻，P3 定案）。
    ///
    /// visualizer 反映的是**输出时刻观众实际听到的声音**：剪切过的项目里输出
    /// 第 7 秒可能对应源媒体的第 12 秒，而 BCS1 是按**整条源媒体**算的，因此
    /// 采样前必须过一次 `TimelineProjection::timeline_to_source`。
    ///
    /// `None` = 这份计划没经过 `compile_project`（单测的 `compile_with`），
    /// 或项目里没有 visualizer 元素——此时退化为"输出时刻即源时刻"。
    pub viz_projection: Option<timeline::TimelineProjection>,
    pub media: OverlayFrameMedia,
    pub cache: VecDeque<CachedFrame>,
    /// 全部字幕边界（display_start/display_end/word.end）升序排列，
    /// `next_change_after` 用二分而不是每帧线性扫描全片词表。
    pub change_points: Vec<f64>,
    pub layout_cache: VecDeque<(String, Arc<CachedLayout>)>,
    /// 非 Designed Caption 的 glyph scene 稳定几何。逐词状态与入场姿态不进 key；
    /// 命中后只重建小型 run uniform 数组。条目数与 layout cache 同样固定限容，
    /// 避免 Arc mask 因长视频遍历而无界驻留。
    pub glyph_geometry_cache: VecDeque<(String, Arc<[element_draw::GlyphInstance]>)>,
    /// 与正文几何分开驻留的描边 atlas quad；颜色/逐词透明度仍是小型 uniform，
    /// 线宽已经进入 `definition_key`，不会把不同样式错配到同一组 mask。
    /// 该键只服务计划内部缓存与 retained scene 身份，不得写入 DrawOp 动态资产名。
    pub glyph_outline_geometry_cache: VecDeque<(String, Arc<[element_draw::GlyphInstance]>)>,
    /// Designed Caption 的 emoji / 用户 emoji 覆盖共用的独立稳定字形层。正文词态
    /// 变化只更新透明度；emoji mask/RGBA bitmap 与基线 placement 不重复光栅。
    pub glyph_decoration_geometry_cache: VecDeque<(String, Arc<[element_draw::GlyphInstance]>)>,
    /// 底板/下划线为保持 CPU z 序而切开的 glyph run。segment key 包含基础几何
    /// 身份、fill/outline 层与 uniform index 集；逐帧只重建 uniform，不能因分段
    /// 让 compositor 误判为一批新 atlas quad。
    pub glyph_segment_geometry_cache: VecDeque<(String, Arc<[element_draw::GlyphInstance]>)>,
    /// 每个可见字幕行各自一组 effect fill quad。effect 在 CPU reference 中逐行
    /// 独立模糊后再合成，不能把不同半径的行先并到一张中间层。
    pub glyph_effect_geometry_cache: VecDeque<(String, Arc<[Arc<[element_draw::GlyphInstance]>]>)>,
    /// effect 的描边 source 与正文 source 在模糊前合成；单独驻留避免每次词边界
    /// 再生成带 effect 位移的 stroke quad。
    pub glyph_effect_outline_geometry_cache:
        VecDeque<(String, Arc<[Arc<[element_draw::GlyphInstance]>]>)>,
    pub composited: Option<CompositedOverlay>,
    pub blank_frame: Option<Arc<Vec<u8>>>,
    /// 字幕效果层的可复用整幅缓冲。用完按包围盒清零后归还，保证下次取出时
    /// 仍是全零——省掉 4K 下每行效果 33MB 的分配。
    pub effect_scratch: Option<Pixmap>,
    /// S14：把字幕入场转场压成单位姿态。渲染计划本身与压制无关（同一份排版、
    /// 同一批字形），所以它是**逐次渲染**的开关而不是编译期属性——切一次选中态
    /// 不该重编译整份计划。默认 `false`：导出与老客户端一律保持原行为。
    pub suppress_transition: bool,
    /// FramePlan 的 CPU 执行器与它的能力档案指纹。overlay 的每一帧都是一张
    /// **折叠计划**（单个 Draw pass），执行器对它直接调 `rasterize_with_media`。
    pub executor: render_raster::CpuExecutor,
    pub capability: u64,
    /// 元素效果栈的 preflight 报告（设计 §6.5）。overlay 的效果全部由
    /// `timeline::lower_element_effects` 产出，因此这就是那一组引用在
    /// 当前后端上的可用性结论；`fallbacks[]` 经 serve 的任务信封透出。
    pub preflight: render_raster::PreflightReport,
    pub warnings: Vec<String>,
    /// 项目套用的模板层（`None` = 没套，或本计划没经过 `compile_project` 且没注入）。
    pub chrome: Option<TemplateLayer>,
    /// 装饰层**装载失败**的原因。合成失败不该让整幅 overlay 黑掉——字幕与元素
    /// 照画，装饰层缺席并把话说出口（App 在模板属性页显示，`serve` 走
    /// `X-Bcut-Template-Error`）。
    pub chrome_error: Option<String>,
    /// 倒鸭子（跨句序列配方）：编译期只定「开不开」与字体口径，计划本身首帧懒建。
    /// `None` = 这份计划不走序列路，所有字幕仍按 cue 级排版。
    pub sequence: Option<SequenceState>,
}

#[derive(Clone)]
pub struct GlyphChunk {
    /// Original shaped span; animation groups clusters without reshaping letters.
    pub text: String,
    pub word: Option<usize>,
    pub part: Option<usize>,
    pub width: f64,
    pub font_name: String,
    pub font_size: f64,
    pub font_weight: u16,
    pub italic: bool,
    pub shaped: render_raster::fonts::ShapedLine,
}

#[derive(Clone, Default)]
pub struct LayoutLine {
    pub chunks: Vec<GlyphChunk>,
    pub width: f64,
    pub height: f64,
    pub gap_after: f64,
}

/// 字幕及文字元素的水平对齐，供 CPU/GPU 共用布局消费。
/// 字幕读取根样式与行级覆盖的 `align`，文字元素也接受 `style.textAlign`。
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum LineTextAlign {
    Left,
    #[default]
    Center,
    Right,
}

impl LineTextAlign {
    pub fn from_style(style: &Value) -> Self {
        match style
            .get("textAlign")
            .or_else(|| style.get("align"))
            .and_then(Value::as_str)
        {
            Some("left") => Self::Left,
            Some("right") => Self::Right,
            _ => Self::Center,
        }
    }
}

/// 字幕根样式的键：为 `true` 时各行在折行宽度（`width`）里对齐，而不是在字幕块自己的宽里——块不再总是居中在锚点上，
/// 左对齐贴折行区域的左边、右对齐贴右边，与文字元素一样。Studio 样式不写它（行在块宽里对齐，与 v2 一致）；定位框样式
/// 换算成 Studio 样式时写上，左右对齐才贴得到框边。
pub const ALIGN_WITHIN_WRAP_KEY: &str = "alignWithinWrap";

/// 这份（合并后的）行样式是否按折行宽度对齐，见 [`ALIGN_WITHIN_WRAP_KEY`]。
pub fn aligns_within_wrap(style: &Value) -> bool {
    style.get(ALIGN_WITHIN_WRAP_KEY).and_then(Value::as_bool) == Some(true)
}

#[derive(Clone)]
pub struct LineLayout {
    pub kind: LineKind,
    pub style: LineStyle,
    pub item: TimedItem,
    pub lines: Arc<[LayoutLine]>,
    pub width: f64,
    pub height: f64,
    /// 各视觉行在这段宽度里按 [`LineTextAlign`] 摆放。字幕等于 `width`（根样式带
    /// [`ALIGN_WITHIN_WRAP_KEY`] 时是折行宽度）；文字元素等于 `place.w` 折算后的实际像素宽。
    pub align_width: f64,
    pub text_align: LineTextAlign,
    pub current_word: usize,
    pub render_time: f64,
    pub render_fps: f64,
    pub animation_parts: Vec<timeline::AnimationPartPose>,
    pub animation_short_edge: f64,
    /// KTV 双行排版里预告的下一句（`textMotion.karaoke.nextLine`）：只画底色，
    /// 不采样动效、不扫字、不进缓存键。
    pub preview: bool,
    /// 译文行 KTV 扫字借用的原文真实词 `(起, 止)`（项目秒）；原文行为 `None`，
    /// 它读自己的 `item.words`。
    pub karaoke_words: Option<Arc<[(f64, f64)]>>,
    /// 引导点画在行下方而不是上方：双语叠放时上面还有一行，点不压它的字。
    pub guide_below: bool,
}

/// 这一行是不是真的画得出一块底板——镜像 Mac `StyleFX.bgOn(style) && !isTransparent(bgColor)`。
///
/// `VKColor.isTransparent` 的阈值是 alpha ≤ 0.01，落到 u8 就是 ≤ 2。
/// 共享底板选哪一行的 padding 靠它裁决，所以判据必须与 Mac 逐字对齐。
pub fn has_real_background(line: &LineLayout) -> bool {
    line.style.background_on && line.style.background_color.a > 2
}

/// 共享底板跟哪一行的 spec 走——镜像 Mac `sharedBackgroundSpec`：
/// `!源行有真背景 && 译文行有真背景 ? 译文行 : 源行`。
///
/// 改用译文行有**两个**前提，译文行自己得画得出板；两行都没真背景时仍然取源行。
/// 这不是可以随便选的退化情形：shared 的 plate pad 参与字形落位
/// （`StackPlate::Shared` 的 `plate_pad_v`），板不画照样撑开槽位，
/// 所以两行 backgroundPadding 不同时选错行就是实打实的几何分叉。
pub fn shared_plate_line<T: Copy>(
    source: Option<T>,
    trans: Option<T>,
    has_background: impl Fn(T) -> bool,
) -> Option<T> {
    match (source, trans) {
        (Some(source), Some(trans)) if !has_background(source) && has_background(trans) => {
            Some(trans)
        }
        (Some(source), _) => Some(source),
        (None, trans) => trans,
    }
}
