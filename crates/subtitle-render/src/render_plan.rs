/// 一次烧录保留哪几类叠加内容。语义与 `bcut-editable` 的 `include_element`
/// 逐条对齐（见 `core/crates/bcut-editable/src/builder.rs`）：可编辑工程导出
/// 和视频烧录必须对同一份 `--no-*` 组合给出同一套元素，否则「先预览再导工程」
/// 会看到两份不同的内容。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OverlayIncludes {
    pub subtitles: bool,
    pub texts: bool,
    pub media_overlays: bool,
    pub watermarks: bool,
}

impl OverlayIncludes {
    /// 全部保留——预览、单测和未指定 `--no-*` 的导出都用它。
    pub const ALL: Self = Self {
        subtitles: true,
        texts: true,
        media_overlays: true,
        watermarks: true,
    };

    /// 与 `bcut-editable::builder::include_element` 同构：水印角色先于 kind 判定，
    /// 但仅在水印被排除时短路，否则仍要过 kind 那一关。
    pub fn allows(self, element: &Element) -> bool {
        if element.role == Some(ElementRole::Watermark) && !self.watermarks {
            return false;
        }
        match element.kind {
            ElementKind::Text => self.texts,
            // 叠加层不承载音频：音轨由 timeline_media 预合成进源媒体。
            ElementKind::Audio => false,
            ElementKind::Image | ElementKind::Video | ElementKind::Whiteboard => {
                self.media_overlays
            }
            // 0.2 转正的四种元素**没有对应的 `--no-*` 开关**：`--no-texts` 是
            // 「普通文字元素」、`--no-broll` 是「B-roll 图片/视频」，把形状或
            // 波形塞进任一类都会让那个开关名不副实。要不要给它们一个开关是
            // 产品决定，不是本阶段能顺手替用户做的（新开关还会改 CLI 契约，
            // 触发 `docs/design/cli/bcut-cli-server-reference.md` 的同步硬规则）。
            ElementKind::Shape
            | ElementKind::Sticker
            | ElementKind::Visualizer
            | ElementKind::Progress
            | ElementKind::Confetti
            | ElementKind::Draw
            | ElementKind::Placeholder => true,
        }
    }

    /// 帧缓存键的一段——同一份文档在不同 `--no-*` 组合下画出的像素不同。
    pub fn key(self) -> String {
        [
            self.subtitles,
            self.texts,
            self.media_overlays,
            self.watermarks,
        ]
        .map(|on| if on { '1' } else { '0' })
        .iter()
        .collect()
    }
}

impl Default for OverlayIncludes {
    fn default() -> Self {
        Self::ALL
    }
}

#[cfg(feature = "host")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TimelineMediaFailurePolicy {
    /// CLI/export：素材缺失或损坏必须失败，不能静默交付缺层视频。
    Strict,
    /// App 实时预览：跳过坏素材对应的元素，保住同一张 overlay 上的文字与矢量。
    SkipFailedElement,
}

pub fn item_text_is_filled(item: &Value, key: &str) -> bool {
    item.get(key)
        .and_then(Value::as_str)
        .is_some_and(|text| !text.trim().is_empty())
}

pub fn same_projected_scope(left: &Value, right: &Value) -> bool {
    left.get("sourceId").and_then(Value::as_str) == right.get("sourceId").and_then(Value::as_str)
        && left.get("clipId").and_then(Value::as_str) == right.get("clipId").and_then(Value::as_str)
}

pub fn source_item_id(item: &Value) -> Option<&str> {
    item.get("sourceItemId")
        .or_else(|| item.get("id"))
        .and_then(Value::as_str)
}

/// 原文行的「长相」：逐词动画与由它派生的配方常量。整条轨一份
/// （[`OverlayRenderPlan::track_look`]），每条带逐条样式的字幕各一份。
#[derive(Debug, Clone)]
pub struct CaptionLook {
    pub animation: Arc<WordAnimation>,
    pub descriptor: Option<&'static CaptionRecipeDescriptor>,
    /// 样式是否带 Designed Caption。
    pub designed: bool,
    /// 经典逐词高亮块是否带非恒定的时间轨。
    pub word_box_animated: bool,
    pub composite: CaptionCompositeMode,
    /// 配方是否要求整组居中。
    pub centered: bool,
    /// 跨句序列配方（倒鸭子）：原文行不走 cue 级排版，整条轨由 `CaptionSequencePlan` 接管。
    pub sequence: bool,
}

impl CaptionLook {
    /// `merged_original` 是 `merged_line_style(root, Original)`。
    pub fn of(merged_original: &Value) -> Self {
        let animation = Arc::new(word_animation(merged_original));
        let descriptor = animation
            .caption
            .as_ref()
            .and_then(caption_recipe_design_descriptor);
        let designed = merged_original
            .pointer("/wordAnimation/caption")
            .is_some_and(Value::is_object);
        let word_box_animated = animation.motion_id.is_some()
            || animation
                .box_track
                .as_ref()
                .is_some_and(WordBoxTrack::is_animated);
        let composite = caption_recipe_composite_mode(&animation);
        let centered = descriptor.is_some_and(|descriptor| {
            matches!(descriptor.layout.as_str(), "fullScreenWord" | "centerBand")
        });
        Self {
            animation,
            descriptor,
            designed,
            word_box_animated,
            composite,
            centered,
            sequence: descriptor.is_some_and(CaptionRecipeDescriptor::is_sequence),
        }
    }
}

/// 一条字幕的逐条样式，编译期解好：叠过覆盖表的根样式、行样式与原文长相。
#[derive(Debug, Clone)]
pub struct CueOverride {
    pub root: Value,
    pub style: LineStyle,
    pub look: CaptionLook,
}

pub fn translation_inputs<'a>(
    document: &'a Value,
    target_language: &'a str,
) -> Vec<TimedInput<'a>> {
    let trans_cues = document["transCues"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let sentences = document["sentences"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let mut inputs = trans_cues
        .iter()
        .filter(|item| item_text_is_filled(item, "text"))
        .map(|item| TimedInput {
            item,
            text_key: "text",
            language: target_language,
        })
        .collect::<Vec<_>>();

    // A projection can contain aligned translation cues for some sentences and
    // sentence-level translations for others. Keep both instead of treating a
    // single transCue as proof that every sentence has an aligned row.
    inputs.extend(sentences.iter().filter_map(|sentence| {
        if !item_text_is_filled(sentence, "trans") {
            return None;
        }
        let sentence_id = source_item_id(sentence)?;
        let has_cue = trans_cues.iter().any(|cue| {
            item_text_is_filled(cue, "text")
                && cue.get("sid").and_then(Value::as_str) == Some(sentence_id)
                && same_projected_scope(cue, sentence)
        });
        (!has_cue).then_some(TimedInput {
            item: sentence,
            text_key: "trans",
            language: target_language,
        })
    }));
    inputs
}

/// 这一句在当前投影里是否已有可用译文：对齐后的 `transCue` 命中，或句级 `trans`
/// 非空。
///
/// 判定为「未译」的句子在译文模式下直接留空——不排任何绘制输入，也不画背景框。
/// 导出信封的译文覆盖率共用这一个口径：画面上的空白和信封里的缺译数必须来自同一
/// 处判定，否则用户既看不见译文，也不知道少了几句。
pub fn sentence_is_translated(sentence: &Value, sentence_id: &str, trans_cues: &[Value]) -> bool {
    item_text_is_filled(sentence, "trans")
        || trans_cues.iter().any(|cue| {
            item_text_is_filled(cue, "text")
                && cue.get("sid").and_then(Value::as_str) == Some(sentence_id)
                && same_projected_scope(cue, sentence)
        })
}

/// 当前投影的句级译文覆盖率 `(已译, 参与判定的句数)`。
///
/// 差值就是译文模式下会被留空的句数——用户看到的「这一句突然没字幕」正是它。
/// 没有 id 的句子不计入分母，与烧录侧的取样保持一致。
///
/// 传进来的必须是已经过时间轴投影的文档（`overlay_document_with_live_timeline`
/// 的产物）：未投影的正文顶层只镜像主素材，且包含被剪掉的句子，数出来的不是成片
/// 里真正出现的内容。
pub fn sentence_translation_coverage(document: &Value) -> (usize, usize) {
    let sentences = document["sentences"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let trans_cues = document["transCues"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let mut translated = 0_usize;
    let mut total = 0_usize;
    for sentence in sentences {
        let Some(sentence_id) = source_item_id(sentence) else {
            continue;
        };
        total += 1;
        if sentence_is_translated(sentence, sentence_id, trans_cues) {
            translated += 1;
        }
    }
    (translated, total)
}

/// 这次烧录真正生效的显示模式。**唯一一处**烧录侧的模式判据。
///
/// - `--mode` 给了就它说了算（串非法 → `Err`）；
/// - 缺省时按**生效**字幕轨集派生（[`effective_mode`]：先读时迁移，再跳过
///   `hidden`）。不给 `--mode` 的导出照样按 timeline 上摆着的轨烧译文；
/// - 生效轨集为空（所有字幕轨都被关掉）→ `Ok(None)` = 这次一条字幕都不烧，
///   等价 `--no-subs`。
///
/// 注意与 [`StudioMode::of_style`] 的分工：那个读的是文档**声明**的模式（样式
/// 面板、轨头、写路径 canonicalize 用），这里读的是**画面上真会出现什么**。
fn burn_in_mode(document: &Value, mode_override: Option<&str>) -> Result<Option<StudioMode>> {
    match mode_override {
        Some(value) => Ok(Some(
            StudioMode::parse(value).ok_or_else(|| anyhow!("未知字幕显示模式：{value}"))?,
        )),
        None => Ok(effective_mode(
            document.get("style").unwrap_or(&Value::Null),
        )),
    }
}

/// 这次烧录会不会排出译文轨，以及按哪种模式：`None` 表示原文模式、模式串非法
/// （由 [`OverlayRenderPlan::compile`] 去报错），或字幕轨全被关掉，此时「缺译」
/// 无从谈起。判据见 [`burn_in_mode`]。
pub fn translation_burn_in_mode(
    document: &Value,
    mode_override: Option<&str>,
) -> Option<&'static str> {
    match burn_in_mode(document, mode_override).ok().flatten()? {
        StudioMode::Original => None,
        StudioMode::Translated => Some("translated"),
        StudioMode::Bilingual => Some("bilingual"),
    }
}

/// MP4 字幕必须覆盖 Mac 样式面板真正提供的完整内置字体集，而不只是旧 Web
/// Studio 的五个选项。Standalone CLI 内嵌字体；App-only 包从同一套签名资源
/// 读字节，两条路径保持完全相同的顺序与内容。
#[cfg(feature = "host")]
pub fn bundled_studio_fonts() -> Vec<Vec<u8>> {
    // 字节都在 bcut-render（`include_bytes!` 只在那一处）：BCF 文档渲染按名字用的是
    // 同一份，思源黑体与展示字体都不会在二进制里躺两遍。
    std::iter::once(render_raster::fonts::cjk_fallback_font())
        .chain(render_raster::fonts::bundled_display_fonts().iter().copied())
        .map(<[u8]>::to_vec)
        .collect()
}

/// BaoCut 的“导入字体”：由宿主经 [`crate::host::FontSource`] 注入
/// （提案 §5.2）。渲染内核不再自己定位配置根——`<config_root>/fonts` 的解析
/// 属于宿主，实现在 `bcut_workspace::timeline::overlay`，CLI / `bcut serve` /
/// App v2 三处经同一个 `register` 拿到同一份。
///
/// 记录筛选判据（只认 registry 明确认领的 bare filename）仍在
/// [`font_library_fonts_at`]，宿主实现直接调它。
#[cfg(feature = "host")]
pub fn baocut_library_fonts() -> Vec<Vec<u8>> {
    crate::host::extra_fonts()
}

#[cfg(feature = "host")]
pub fn font_library_fonts_at(directory: &Path) -> Vec<Vec<u8>> {
    let Ok(registry) = fs::read(directory.join("library.json")) else {
        return Vec::new();
    };
    let Ok(records) = serde_json::from_slice::<Vec<Value>>(&registry) else {
        return Vec::new();
    };
    let mut files = records
        .iter()
        .filter_map(|record| record.get("file").and_then(Value::as_str))
        .filter_map(|file| {
            let relative = Path::new(file);
            let is_bare = relative.file_name().and_then(|name| name.to_str()) == Some(file);
            let supported = relative
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| {
                    matches!(
                        extension.to_ascii_lowercase().as_str(),
                        "ttf" | "otf" | "ttc" | "otc"
                    )
                });
            (is_bare && supported).then(|| directory.join(relative))
        })
        .collect::<Vec<_>>();
    files.sort();
    files.dedup();
    files
        .into_iter()
        .filter_map(|path| fs::read(path).ok())
        .collect()
}

/// `visualizer.audio` → 媒体源 id。
///
/// `"project"` 是「整片输出音轨」的写法，落到媒体上就是 `main` 源；与
/// `serve` 的渲染指纹（`jobs_history::visualizer_spectrum_hashes`）用的是同一条
/// 换算，两处一旦分叉就会出现「指纹说没变、画面已经变了」。
///
/// 实现在 `bcut-timeline-render`（P6a 下沉）：wasm 预览按同一条换算取频谱，
/// 「预览 = 导出」才成立。
pub fn visualizer_audio_source(props: &VisualizerProps) -> String {
    element_draw::visualizer_audio_source(props)
}

/// `TimelineVisualElement` → 下沉层的借用视图。
///
/// 本地元素表的字段比绘制需要的多（媒体、文本、效果、动画……），绘制只读
/// 契约那几项；视图把这条边收窄成一处。
pub fn element_view(element: &TimelineVisualElement) -> element_draw::ElementDraw<'_> {
    element_draw::ElementDraw {
        id: &element.id,
        kind: element.kind,
        start: element.start,
        end: element.end,
        place: &element.place,
        shape: element.shape.as_ref(),
        sticker: element.sticker.as_ref(),
        visualizer: element.visualizer.as_ref(),
        progress: element.progress.as_ref(),
        draw: element.draw.as_ref(),
        placeholder: element.placeholder.as_ref(),
        confetti: element.confetti.as_ref(),
        whiteboard: element.whiteboard.as_ref(),
        has_source: element.src_id.is_some(),
    }
}

/// 「按屏幕上的实际大小光栅」这条规则的唯一判据：`ratio` ＝ 屏幕尺寸 ÷ 自然
/// 尺寸，返回要用的目标像素（`None` ＝ 照自然尺寸）。
///
/// 只在**能省**的时候给目标：放大一律不做（矢量放大更清楚，但那是另一件事，
/// 会让既有产物的像素变），省下不到一成也不做（多走一遍光栅不值）。
fn shrink_target_px(natural_width: u32, natural_height: u32, ratio: f64) -> Option<(u32, u32)> {
    /// 目标尺寸的像素下限：再小的图也不值得为省几微秒画成一团。
    const MIN_EDGE: f64 = 16.0;
    /// 省不到这个比例就照自然尺寸走。
    const WORTH_IT: f64 = 0.9;

    if !(ratio > 0.0) || ratio >= WORTH_IT {
        return None;
    }
    let width = (f64::from(natural_width) * ratio).round().max(MIN_EDGE);
    let height = (f64::from(natural_height) * ratio).round().max(MIN_EDGE);
    let target = (width as u32, height as u32);
    (target != (natural_width, natural_height)).then_some(target)
}

/// 纯几何探针 → 这枚外部纹理在画布上实际占多少像素（等比，`None` ＝ 照自然尺寸）。
///
/// 节点带的 `transform` 里含 `place.scale` 与动画 pose 的缩放，所以弹跳、放大
/// 入场这类动效不会被按静止尺寸光栅成糊的。判据本身见 [`shrink_target_px`]。
#[cfg(feature = "host")]
fn scene_texture_target_px(
    nodes: &[element_draw::SceneNode],
    natural_width: u32,
    natural_height: u32,
) -> Option<(u32, u32)> {
    fn scan(nodes: &[element_draw::SceneNode], width: u32, height: u32, best: &mut f64) {
        for node in nodes {
            match node {
                element_draw::SceneNode::Texture(texture) => {
                    let matrix = texture.transform;
                    let scale_x = f64::from(matrix[0]).hypot(f64::from(matrix[1]));
                    let scale_y = f64::from(matrix[2]).hypot(f64::from(matrix[3]));
                    let ratio = (f64::from(texture.rect[2]) * scale_x / f64::from(width.max(1)))
                        .max(f64::from(texture.rect[3]) * scale_y / f64::from(height.max(1)));
                    if ratio.is_finite() {
                        *best = best.max(ratio);
                    }
                }
                element_draw::SceneNode::BlurredGroup(group) => {
                    scan(&group.nodes, width, height, best);
                }
                _ => {}
            }
        }
    }

    let mut ratio = 0.0f64;
    scan(nodes, natural_width, natural_height, &mut ratio);
    shrink_target_px(natural_width, natural_height, ratio)
}

/// native 导出的外部媒体元素 → R3 已冻结的 renderer-neutral 纹理视图。
/// `texture` 是本计划内的元素级槽，不等于项目 `srcId`：同一视频源可以被两个
/// 元素以不同 `srcStart/rate` 同时采样，二者不能争用一张纹理。
#[cfg(feature = "host")]
fn external_media_view<'a>(
    element: &'a TimelineVisualElement,
    texture: &'a str,
    time: f64,
) -> element_draw::ExternalMediaElement<'a> {
    element_draw::ExternalMediaElement {
        id: &element.id,
        kind: element.kind,
        texture: Some(texture),
        place: &element.place,
        mode: element.mode,
        fit: element.fit,
        background: element.bg,
        tile: element.tile.as_ref(),
        mask: element.mask.as_ref(),
        fx: element.fx.as_ref(),
        sticker: element.sticker.as_ref(),
        transition: element
            .transitions
            .as_ref()
            .map(|v| v.sample(time - element.start, element.end - element.start))
            .unwrap_or_default(),
    }
}

/// 读项目里某个源的 BCS1 缓存。**缺就报错，不代生成、不静默出空图。**
///
/// 路径解析与 `bcut spectrum` / `GET /__bcut/spectrum` / 渲染指纹逐字相同
/// （`paths::project_media_path` + `paths::spectrum_cache_path`）：换一条解析就会
/// 算出另一个缓存文件名，"命令刚生成过、导出却说找不到"就是这么来的。
#[cfg(feature = "host")]
pub fn read_project_spectrum(project: &Path, source_id: &str, element_id: &str) -> Result<Vec<u8>> {
    let hint = format!(
        "先运行 `bcut spectrum {} --src {source_id}` 生成频谱缓存",
        project.display()
    );
    let media = crate::paths::project_media_path(project, source_id)
        .with_context(|| format!("元素 {element_id} 的音频源 {source_id} 找不到媒体；{hint}"))?;
    let path = crate::paths::spectrum_cache_path(project, &media)
        .with_context(|| format!("元素 {element_id} 的频谱缓存路径无法确定；{hint}"))?;
    let bytes = fs::read(&path).map_err(|error| {
        anyhow!(
            "元素 {element_id} 需要音频源 {source_id} 的 BCS1 频谱，但 {} 不可读（{error}）；{hint}",
            path.display()
        )
    })?;
    // 提前校验一次：坏缓存要在 preflight 就说清楚是哪个元素、哪条源。
    waveform::bcs1::parse(&bytes).with_context(|| {
        format!(
            "元素 {element_id} 的频谱缓存 {} 无效；{hint}",
            path.display()
        )
    })?;
    Ok(bytes)
}

// ── 模板层 ──────────────────────────────────────────────────────────────

/// 项目套用的模板层（`timeline.json` 的 `template`），逐帧由
/// [`crate::template_layer::raster`] 直绘成一张与画布同尺寸的透明底 Pixmap，
/// 随后按**字幕层同一形态**（动态资源 ＋ 一条 `DrawMedia`）并进 overlay 的指令流：
/// scene 身份（[`element_draw::SceneFrame::fingerprint`]）要不要算。
///
/// 算它的代价几乎全在**整帧解码像素**的 FNV-1a 上：时间轴媒体元素每帧都要把
/// 自己那张 RGBA 过一遍（720p 实测 3.3 ms/帧，占 GPU 导出「字幕合成」的 23%），
/// 模板 chrome 同理。
///
/// 而这个身份只有一个生产消费者：macOS GPU 预览用它给 overlay 上屏去重
/// （`apps/baocut/src/engine/overlay.rs` 的 `gpu_presentation_fingerprint`）。
/// 离线导出那条路只读 `next_change` 做场景缓存窗口，从不读 `fingerprint`。
///
/// 预览那条路也付不起像素哈希：1080p 源一帧 8.3 MB、4K 33 MB，模板 chrome 还要
/// 再按**画布**尺寸（5K 全屏 ≈ 42 MB）哈希一次，在 overlay 线程上实测占了播放期
/// CPU 的 79%。去重只需要「这张纹理是不是同一张」，而同一 `MediaStore` 里
/// `(源 id, 媒体时钟)` 就唯一决定解码结果，所以 [`Self::Structural`] 拿它做像素
/// 代理，只哈希几十个字节。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SceneIdentity {
    /// 照常算，像素逐字节进身份。wasm 与测试用这一档，`fingerprint` 可用。
    Full,
    /// 结构身份：节点几何、采样钟、效果照旧逐字段冻结，像素位换成
    /// `(纹理 key, 真正取帧的源 id, media_ms, 源尺寸)`；模板 chrome 用
    /// `(chrome 指纹, 画布尺寸, 正文字体)`。同一计划内与 [`Self::Full`] 等价
    /// 可用于去重；**不能**跨计划 / 跨进程对拍像素。macOS GPU 预览用这一档。
    Structural,
    /// 跳过整帧像素哈希，`fingerprint` 恒为 `0`——**不得**再拿它做去重或对拍。
    Skip,
}

/// 模板前景恒在正片、字幕与元素之上。
///
/// 两个 feature 共用：场景本身无 I/O，`host` 由 [`crate::host::OverlayHost::template_scene`]
/// 装载，浏览器 / App 预览经 [`OverlayRenderPlan::set_template_scene`] 注入。
pub struct TemplateLayer {
    /// 场景内容指纹（文档、章节、标题、台标像素任一变了都变）。
    pub fingerprint: u64,
    pub scene: TemplateScene,
}

impl TemplateLayer {
    pub fn new(scene: TemplateScene) -> Self {
        Self {
            fingerprint: scene.fingerprint,
            scene,
        }
    }

    /// 模板层没有时间区间：套上就整片在场。
    pub fn active(&self, _time: f64) -> bool {
        true
    }

    /// 下一次内容变化的**保守上界**：章节条与进度线逐帧都在动，内核无从静态
    /// 判定，于是一律退化为「下一帧」。代价是导出的 `ensure_composited` 缓存
    /// 在模板项目里失效——先接对，性能另计。
    fn next_change(&self, time: f64, fps: f64) -> Option<f64> {
        Some(time + 1.0 / fps.max(1.0))
    }

    /// 取一帧模板像素（premultiplied RGBA，透明底），直接按 overlay 画布尺寸画。
    fn frame(
        &self,
        time: f64,
        duration: f64,
        width: u32,
        height: u32,
        fallback_family: &str,
        text: &mut TextEngine,
    ) -> Result<Pixmap> {
        crate::template_layer::raster(
            &self.scene,
            crate::template_layer::FrameParams {
                time,
                duration,
                width,
                height,
                fallback_family,
            },
            text,
            false,
        )
        .context("渲染模板层")
    }
}

/// Paint the plate described by one line layout. `block` is a single rectangle;
/// `wrap` clones the plate for every visual line, matching CSS
/// `box-decoration-break: clone` without moving text layout.
#[derive(Debug, Clone, Copy, PartialEq)]
struct SubtitlePlateRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    radius: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct SubtitlePlate {
    rect: SubtitlePlateRect,
    color: SubtitleColor,
    motion_line: Option<usize>,
}

fn line_background_rects(layout: &LineLayout, center_x: f64, top: f64) -> Vec<SubtitlePlateRect> {
    let style = &layout.style;
    if style.block_background || layout.lines.len() <= 1 {
        let width = (layout.width + style.background_pad_h * 2.0).max(style.background_min_width);
        return vec![SubtitlePlateRect {
            x: line_start_x(layout, layout.width, center_x) - (width - layout.width) / 2.0,
            y: top - style.background_pad_v,
            width,
            height: layout.height + style.background_pad_v * 2.0,
            radius: style.background_radius,
        }];
    }

    let mut rects = Vec::with_capacity(layout.lines.len());
    let mut line_top = top;
    for line in layout.lines.iter() {
        let line_height = line.height.max(style.font_size * style.line_height);
        rects.push(SubtitlePlateRect {
            x: line_start_x(layout, line.width, center_x) - style.background_pad_h,
            y: line_top - style.background_pad_v,
            width: line.width + style.background_pad_h * 2.0,
            height: line_height + style.background_pad_v * 2.0,
            radius: style.background_radius,
        });
        line_top += line_height + line.gap_after;
    }
    rects
}

fn draw_line_background(
    pixmap: &mut Pixmap,
    layout: &LineLayout,
    center_x: f64,
    top: f64,
    opacity: f64,
    transform: Transform,
) -> DrawBounds {
    let mut bounds = DrawBounds::default();
    for rect in line_background_rects(layout, center_x, top) {
        bounds.merge(fill_round_rect(
            pixmap,
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            rect.radius,
            layout.style.background_color,
            opacity,
            transform,
        ));
    }
    bounds
}

/// 当前帧动态栅格的资源名。`owner` 只负责区分同帧里的资产槽，像素指纹负责
/// 让内容变化进入 DrawOp 指令流。
///
/// 不得把 [`OverlayRenderPlan::definition_key`] 拼进这里：动态表在每帧组装前
/// 清空，字幕只有一个固定槽，timeline 元素 id 又由文档校验保证唯一，因此计划
/// 缓存键不参与资源查找的唯一性。把它编码进资源名只会让渲染无关的文档 schema
/// 变化污染 `draw_op_fingerprint`。
fn dynamic_raster_asset_name(kind: &str, owner: &str, rgba: &[u8]) -> String {
    let pixel_fingerprint = render_raster::drawop::fnv1a64(rgba);
    format!("{kind}:{owner}:{pixel_fingerprint:016x}")
}

/// Timeline 的历史 `SourceKind::Image` 同时接收 PNG/JPEG 与 GIF/APNG/animated
/// WebP。按容器字节先尝试动图，静态 PNG/WebP 再回落静态解码；这样无需改写
/// Timeline 0.3 持久格式，旧项目与新导入都能直接恢复动态画面。
/// 一份「素材贴纸 ＋ 换色表」在光栅缓存里的键。
///
/// 光栅缓存（`LoadedAssets.images`）本来按 source id 键，可
/// `sticker.fillOverrides` 是**元素级**的：同一份 SVG 被两个贴纸用两张覆盖表
/// 引用时，画面必须是两张不同的图。所以换色后的位图按 `(source, 覆盖表)` 另
/// 起一个 id 存放，取帧时再按同一把尺算回来——两处必须调这一个函数，否则
/// 「预载了却取不到」会静默退回原色（正是用户 2026-09-08 回报的现象）。
pub fn sticker_fill_variant_id(
    source_id: &str,
    overrides: &std::collections::BTreeMap<String, String>,
) -> String {
    let mut canonical = String::new();
    for (source, target) in overrides {
        canonical.push_str(source);
        canonical.push('>');
        canonical.push_str(target);
        canonical.push(';');
    }
    format!(
        "{source_id}#fill:{:016x}",
        render_raster::drawop::fnv1a64(canonical.as_bytes())
    )
}

/// 一个 Timeline source 该走哪个解码器：由引用它的元素 kind 与 source 自述
/// kind 共同决定（见 `load_timeline_media` 里的归一化）。
#[cfg(feature = "host")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TimelineSourceDecoder {
    Image,
    Video,
    /// Timeline 0.7 `sources[].kind: "lottie"`（bodymovin JSON），只有素材贴纸引用。
    Lottie,
    /// 元素不引用媒体源（text / shape / visualizer …）。
    None,
}

/// 装载一个 Lottie source（Timeline 0.7）：解析 → 收集并读入子资源（内嵌或相对
/// 于 JSON 所在目录）→ 可选换色 → prepare / probe → 以 `source_id` 归档进
/// `assets.lotties`。与 BCF 的 `assets.rs` Lottie 分支同一套顺序，渲染期不再 I/O。
///
/// `overrides` 非空时这就是一份换色变体（调用方以 `sticker_fill_variant_id`
/// 作 `source_id`）；子资源仍按变体 id 归档，两份 Lottie 互不共享像素表。
#[cfg(feature = "host")]
fn load_timeline_lottie_source(
    assets: &mut LoadedAssets,
    source_id: &str,
    path: &Path,
    bytes: &[u8],
    overrides: Option<&std::collections::BTreeMap<String, String>>,
) -> Result<()> {
    use render_raster::source::{Lottie, PrepareCtx, VisualSource};
    let label = path.to_string_lossy();
    let mut lottie = Lottie::parse(source_id, &label, bytes)
        .with_context(|| format!("lottie source {source_id} 解析失败"))?;
    let lottie_dir = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let mut loaded = Vec::new();
    for requirement in lottie.image_requirements().to_vec() {
        let (bytes, label) = match (&requirement.embedded, &requirement.path) {
            (Some(inline), _) => (inline.clone(), format!("<内嵌 {}>", requirement.id)),
            (None, Some(relative)) => {
                let child = lottie_dir.join(relative);
                let bytes = fs::read(&child).with_context(|| {
                    format!(
                        "lottie source {source_id}：读子资源 {} 失败",
                        child.display()
                    )
                })?;
                (bytes, child.display().to_string())
            }
            (None, None) => bail!(
                "lottie source {source_id}：子资源 \"{}\" 既不是内嵌也没有路径",
                requirement.id
            ),
        };
        let pixmap = requirement
            .decode(&bytes)
            .with_context(|| format!("lottie source {source_id}：子资源 {label} 解码失败"))?;
        let pixmap = Arc::new(pixmap);
        assets
            .images
            .insert(requirement.asset_name.clone(), pixmap.clone());
        loaded.push((requirement.asset_name, bytes, pixmap));
    }
    lottie.attach_images(loaded);
    if let Some(overrides) = overrides {
        lottie.apply_fill_overrides(overrides);
    }
    let budget = PrepareCtx::default();
    lottie
        .prepare(&budget)
        .with_context(|| format!("lottie source {source_id} 预备失败"))?;
    lottie
        .probe()
        .with_context(|| format!("lottie source {source_id} 探测失败"))?;
    assets
        .source_diagnostics
        .extend(lottie.diagnostics().iter().cloned());
    assets
        .lotties
        .insert(source_id.to_owned(), Arc::new(lottie));
    Ok(())
}

#[cfg(feature = "host")]
fn load_timeline_image_source(
    assets: &mut LoadedAssets,
    source_id: &str,
    path: &Path,
    bytes: &[u8],
) -> Result<()> {
    if path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("svg"))
    {
        let text = std::str::from_utf8(bytes).context("SVG must be UTF-8")?;
        if let Some(animation) = timeline::svg_animation::SvgAnimation::parse(text)? {
            let poster = decode_image("poster.svg", animation.sample(0.0).as_bytes())?;
            assets.images.insert(source_id.to_owned(), Arc::new(poster));
            assets
                .animated_svgs
                .insert(source_id.to_owned(), Arc::new(animation));
            return Ok(());
        }
    }
    if render_raster::source::animated_image::AnimatedFormat::sniff(bytes).is_some() {
        let budget = render_raster::source::PrepareCtx::default();
        match render_raster::source::AnimatedImage::decode(&path.to_string_lossy(), bytes, &budget) {
            Ok(source) => {
                render_raster::source::VisualSource::prepare(&source, &budget)?;
                assets
                    .animated
                    .insert(source_id.to_owned(), Arc::new(source));
                return Ok(());
            }
            Err(animated_error) => {
                // 静态 PNG/WebP 也有这些容器魔数；只有静态解码同样失败时，才把
                // 两条诊断一起交给 strict export 或 preview 的单元素隔离策略。
                return match decode_image(&path.to_string_lossy(), bytes) {
                    Ok(pixmap) => {
                        assets.images.insert(source_id.to_owned(), Arc::new(pixmap));
                        Ok(())
                    }
                    Err(image_error) => bail!(
                        "解码 image source {}：动图解码：{animated_error:#}；静态解码：{image_error:#}",
                        path.display()
                    ),
                };
            }
        }
    }
    let pixmap = decode_image(&path.to_string_lossy(), bytes)
        .with_context(|| format!("解码 image source {}", path.display()))?;
    assets.images.insert(source_id.to_owned(), Arc::new(pixmap));
    Ok(())
}

/// 文字元素的整块底板（`backgroundStyle == "block"`）宽度：原型 `textCss` 在
/// `mode: 'block'` 下是 `display: block`，底板填满元素盒——盒宽即 `place.w`；没给宽度
/// 时盒子包住最宽的一行加内边距。字幕轨那条「28% 画幅最小宽」（`resolve_line_style`）
/// 是给逐条字幕定的，套在标题上就是用户 2026-09-05 回报的「背景色明显太大」：
/// 一个词的标题拖出半屏宽的底板。字幕路径不经这里，golden 不变。
fn text_element_block_plate(
    style: &mut LineStyle,
    element: &TimelineVisualElement,
    wrap_width: f64,
) {
    if !style.block_background {
        return;
    }
    style.background_min_width = element.place.w.map_or(0.0, |_| wrap_width);
}

impl OverlayRenderPlan {
    /// 保留全部叠加内容地编译。Studio 预览走这条路：预览永远画全量。
    #[cfg(feature = "host")]
    pub fn compile_project(
        project: &Path,
        document: &Value,
        width: u32,
        height: u32,
        duration: f64,
        fps: f64,
        mode_override: Option<&str>,
    ) -> Result<Self> {
        Self::compile_project_with(
            project,
            document,
            width,
            height,
            duration,
            fps,
            mode_override,
            OverlayIncludes::ALL,
        )
    }

    #[allow(clippy::too_many_arguments)]
    #[cfg(feature = "host")]
    pub fn compile_project_with(
        project: &Path,
        document: &Value,
        width: u32,
        height: u32,
        duration: f64,
        fps: f64,
        mode_override: Option<&str>,
        includes: OverlayIncludes,
    ) -> Result<Self> {
        Self::compile_project_with_media_policy(
            project,
            std::borrow::Cow::Borrowed(document),
            width,
            height,
            duration,
            fps,
            mode_override,
            includes,
            TimelineMediaFailurePolicy::Strict,
        )
    }

    /// App 实时预览入口。与严格导出使用同一份布局/绘制实现，唯一差别是一个坏
    /// 媒体源只拿掉引用它的元素并留下 warning，不能让共享 overlay 上的文字、
    /// shape、visualizer 一起消失。
    #[allow(clippy::too_many_arguments)]
    #[cfg(feature = "host")]
    pub fn compile_project_preview_with(
        project: &Path,
        document: &Value,
        width: u32,
        height: u32,
        duration: f64,
        fps: f64,
        mode_override: Option<&str>,
        includes: OverlayIncludes,
    ) -> Result<Self> {
        Self::compile_project_with_media_policy(
            project,
            std::borrow::Cow::Borrowed(document),
            width,
            height,
            duration,
            fps,
            mode_override,
            includes,
            TimelineMediaFailurePolicy::SkipFailedElement,
        )
    }

    /// [`Self::compile_project_preview_with`] 的**拿走所有权**版本：调用方手里
    /// 的正文本来就是一份可丢弃的副本（App 从内核共享缓存 `Arc` 里深拷出来的
    /// 那一份）时走这条，活时间轴投影直接改在它身上，不再为投影多深拷一次
    /// 十几 MB 的 Studio 正文。语义与借用版本逐字相同。
    #[allow(clippy::too_many_arguments)]
    #[cfg(feature = "host")]
    pub fn compile_project_preview_owned(
        project: &Path,
        document: Value,
        width: u32,
        height: u32,
        duration: f64,
        fps: f64,
        mode_override: Option<&str>,
        includes: OverlayIncludes,
    ) -> Result<Self> {
        Self::compile_project_with_media_policy(
            project,
            std::borrow::Cow::Owned(document),
            width,
            height,
            duration,
            fps,
            mode_override,
            includes,
            TimelineMediaFailurePolicy::SkipFailedElement,
        )
    }

    #[allow(clippy::too_many_arguments)]
    #[cfg(feature = "host")]
    fn compile_project_with_media_policy(
        project: &Path,
        document: std::borrow::Cow<'_, Value>,
        width: u32,
        height: u32,
        duration: f64,
        fps: f64,
        mode_override: Option<&str>,
        includes: OverlayIncludes,
        media_failure_policy: TimelineMediaFailurePolicy,
    ) -> Result<Self> {
        // `overlay_document_with_live_timeline` 会为活时间轴投影深拷整份 Studio
        // 文档，并逐条复制 cue / sentence / word。超长项目里这一步的瞬时堆峰值
        // 可达正文常驻体积的数倍。译文模式且整份项目根本没有译文时，结果必然
        // 失败；在投影前做无分配 preflight，避免先制造几百 MB 临时对象再报错。
        // 多源项目必须扫描 sourceDocs，不能只看正文顶层的 main 镜像。
        if includes.subtitles
            && let Some(mode) = burn_in_mode(&document, mode_override)?
            && matches!(mode, StudioMode::Translated | StudioMode::Bilingual)
            && !document_has_translation(&document)
        {
            bail!("当前 Studio 投影没有译文，无法导出译文或双语视频");
        }
        let document = overlay_document_with_live_timeline_owned(project, document.into_owned())?;
        let mut plan = Self::compile_with_fonts(
            &document,
            width,
            height,
            duration,
            fps,
            mode_override,
            includes,
            baocut_library_fonts(),
        )?;
        plan.load_timeline_elements_with_policy(project, &document, media_failure_policy)?;
        // 模板层装载失败不外抛：章节表读坏、台标图片被删——这些都不该让整幅
        // overlay 编译失败，那意味着字幕连带黑掉。原因存进 `chrome_error`，
        // 由宿主决定怎么说（App 挂在模板属性页上）。
        match crate::host::template_scene(project) {
            Ok(scene) => plan.set_template_scene(scene),
            Err(error) => plan.chrome_error = Some(format!("{error:#}")),
        }
        plan.run_preflight()?;
        Ok(plan)
    }

    /// 保留全部叠加内容地编译。单测专用——生产路径一律显式给出 includes。
    #[cfg(feature = "host")]
    pub fn compile(
        document: &Value,
        width: u32,
        height: u32,
        duration: f64,
        fps: f64,
        mode_override: Option<&str>,
    ) -> Result<Self> {
        Self::compile_with(
            document,
            width,
            height,
            duration,
            fps,
            mode_override,
            OverlayIncludes::ALL,
        )
    }

    #[allow(clippy::too_many_arguments)]
    #[cfg(feature = "host")]
    pub fn compile_with(
        document: &Value,
        width: u32,
        height: u32,
        duration: f64,
        fps: f64,
        mode_override: Option<&str>,
        includes: OverlayIncludes,
    ) -> Result<Self> {
        Self::compile_with_fonts(
            document,
            width,
            height,
            duration,
            fps,
            mode_override,
            includes,
            Vec::new(),
        )
    }

    #[allow(clippy::too_many_arguments)]
    #[cfg(feature = "host")]
    pub fn compile_with_fonts(
        document: &Value,
        width: u32,
        height: u32,
        duration: f64,
        fps: f64,
        mode_override: Option<&str>,
        includes: OverlayIncludes,
        extra_fonts: Vec<Vec<u8>>,
    ) -> Result<Self> {
        let mut fonts = bundled_studio_fonts();
        fonts.extend(extra_fonts);
        Self::compile_with_font_engine(
            document,
            width,
            height,
            duration,
            fps,
            mode_override,
            includes,
            fonts.len(),
            TextEngine::with_system_and_fonts(&fonts),
        )
    }

    /// 浏览器 / 文档资产宿主的确定性字幕入口：只使用调用方注入的字体字节，
    /// 不扫描系统字体，也不把 Studio 的整套内嵌字体链接进消费者产物。
    ///
    /// 字体列表不能为空。首份字体同时是未知 family 的确定性 sans-serif fallback；
    /// 因此 host 应把 Noto Sans SC 放在第一个，再追加当前样式实际引用的字体。
    #[allow(clippy::too_many_arguments)]
    pub fn compile_with_injected_fonts(
        document: &Value,
        width: u32,
        height: u32,
        duration: f64,
        fps: f64,
        mode_override: Option<&str>,
        includes: OverlayIncludes,
        fonts: Vec<Vec<u8>>,
    ) -> Result<Self> {
        if fonts.is_empty() {
            bail!("compile_with_injected_fonts 至少需要一份 fallback 字体");
        }
        for (index, font) in fonts.iter().enumerate() {
            if font.is_empty() {
                bail!("compile_with_injected_fonts 的第 {index} 份字体是空字节");
            }
        }
        Self::compile_with_font_engine(
            document,
            width,
            height,
            duration,
            fps,
            mode_override,
            includes,
            fonts.len(),
            TextEngine::with_document_fonts(&fonts),
        )
    }

    /// 同 [`Self::compile_with_injected_fonts`]，沿用一个已经装好字体的排版引擎（`fonts_loaded` 是它装的字体份数）：
    /// 同一批字体换尺寸、换样式重编时不必再解析一遍字体。
    #[allow(clippy::too_many_arguments)]
    pub fn compile_with_text_engine(
        document: &Value,
        width: u32,
        height: u32,
        duration: f64,
        fps: f64,
        mode_override: Option<&str>,
        includes: OverlayIncludes,
        fonts_loaded: usize,
        text: TextEngine,
    ) -> Result<Self> {
        Self::compile_with_font_engine(document, width, height, duration, fps, mode_override, includes, fonts_loaded, text)
    }

    /// 拆下这份计划的排版引擎（连同字形缓存），给同一批字体的下一份计划用。
    pub fn into_text_engine(self) -> TextEngine {
        self.text
    }

    #[allow(clippy::too_many_arguments)]
    fn compile_with_font_engine(
        document: &Value,
        width: u32,
        height: u32,
        duration: f64,
        fps: f64,
        mode_override: Option<&str>,
        includes: OverlayIncludes,
        fonts_loaded: usize,
        text: TextEngine,
    ) -> Result<Self> {
        let style = document.get("style").cloned().unwrap_or(Value::Null);
        text_design::validate_motion_tree(&style).map_err(|error| anyhow!(error))?;
        // 生效轨集为空 = 所有字幕轨都被关掉（D10 / lanes `subs:` 覆盖），这次就
        // 不烧字幕：从这里收窄 `includes`，下面所有 `includes.subtitles` 分支和
        // `--no-subs` 走同一条路，不必再各自判一次。
        let mut includes = includes;
        let mode = match burn_in_mode(document, mode_override)? {
            Some(mode) => mode,
            None => {
                includes.subtitles = false;
                StudioMode::Original
            }
        };
        let order = style
            .get("order")
            .and_then(Value::as_str)
            .unwrap_or("trans")
            .to_owned();
        let source_language = document
            .pointer("/meta/sourceLang/code")
            .and_then(Value::as_str)
            .unwrap_or("und");
        let target_language = document
            .pointer("/meta/targetLang/code")
            .and_then(Value::as_str)
            .unwrap_or("und");
        let translation_inputs = if includes.subtitles {
            translation_inputs(document, target_language)
        } else {
            // 不烧录字幕：不扫描译文，也不物化任何字幕输入。显示模式的前提
            // 校验一并让路，没有译文也能导出干净画面。
            Vec::new()
        };
        let has_translation = !translation_inputs.is_empty();
        if includes.subtitles {
            if matches!(mode, StudioMode::Translated | StudioMode::Bilingual) && !has_translation {
                bail!("当前 Studio 投影没有译文，无法导出译文或双语视频");
            }
        }
        // 译文前提已经验证后再把全量原文物化成 TimedItem。失败路径不应为
        // 11 万词的长项目分配每个 Word/String；这也是 compile_with（不走项目
        // 时间轴投影）的低峰值保证。
        let cues = if includes.subtitles {
            timed_items(
                document["cues"]
                    .as_array()
                    .map(Vec::as_slice)
                    .unwrap_or(&[]),
                "text",
                &style,
                source_language,
            )
        } else {
            Vec::new()
        };
        if includes.subtitles && mode == StudioMode::Bilingual && cues.is_empty() {
            bail!("当前 Studio 投影没有原文字幕，无法导出双语视频");
        }
        // 译文模式下缺译句不排任何输入：那一段画面留空（连字幕背景框都不画），
        // 绝不用原文顶替译文。缺译句数由 `sentence_translation_coverage` 记进导
        // 出信封的 `missingTranslations` 并出 `partial-translation` 告警——留空
        // 只有配上信封才是「可见的缺译」，而不是悄悄少几句。
        let translations = timed_inputs(&translation_inputs, &style);
        let compact_original = mode == StudioMode::Bilingual;
        let original_style =
            resolve_line_style(&style, LineKind::Original, width, height, compact_original);
        let translation_style = resolve_line_style(
            &style,
            LineKind::Translation,
            width,
            height,
            compact_original,
        );
        // 逐词动画只由 `style` 决定，而 `style` 编译之后不再变动——所以这里解一次
        // 就是全片的答案。以前 `render_subtitle_frame` / `active_layouts` /
        // `stack_layout` / `designed_caption_active` 每帧各自重算一遍，每遍都要
        // 深拷根样式 Map 并重新解析 CSS 颜色。
        let track_look = CaptionLook::of(&merged_line_style(&style, LineKind::Original));
        let CaptionLook {
            animation: original_animation,
            descriptor: caption_descriptor,
            designed: track_designed,
            word_box_animated: track_word_box_animated,
            composite: caption_composite,
            centered: centered_caption,
            sequence: track_sequence,
        } = track_look.clone();
        // 逐条样式：每条带覆盖的字幕各解一份行样式与长相。同一源条目在投影里可能出现
        // 多次（同一段素材剪进来两回），按源 id 共用一份。
        let has_cue_styles = includes.subtitles
            && style
                .get(CUE_STYLES_KEY)
                .and_then(Value::as_object)
                .is_some_and(|map| !map.is_empty());
        let cue_overrides = |kind: LineKind, inputs: &mut dyn Iterator<Item = (&Value, &str)>| {
            let mut by_source: HashMap<String, Option<Arc<CueOverride>>> = HashMap::new();
            let mut by_item = HashMap::new();
            if !has_cue_styles {
                return by_item;
            }
            for (index, (item, text_key)) in inputs.enumerate() {
                let Some(source_id) = source_item_id(item) else {
                    continue;
                };
                let resolved = by_source
                    .entry(source_id.to_owned())
                    .or_insert_with(|| {
                        let root = cue_root(&style, kind, source_id, mode)?;
                        Some(Arc::new(CueOverride {
                            style: resolve_line_style(&root, kind, width, height, compact_original),
                            look: CaptionLook::of(&merged_line_style(&root, LineKind::Original)),
                            root,
                        }))
                    })
                    .clone();
                if let Some(resolved) = resolved {
                    by_item.insert(timed_input_id(item, text_key, index), resolved);
                }
            }
            by_item
        };
        let cue_original = cue_overrides(
            LineKind::Original,
            &mut document["cues"]
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or(&[])
                .iter()
                .map(|item| (item, "text")),
        );
        let cue_translation = cue_overrides(
            LineKind::Translation,
            &mut translation_inputs
                .iter()
                .map(|input| (input.item, input.text_key)),
        );
        let override_looks = || {
            cue_original
                .values()
                .chain(cue_translation.values())
                .map(|entry| &entry.look)
        };
        let designed_caption = track_designed || override_looks().any(|look| look.designed);
        let word_box_animated =
            track_word_box_animated || override_looks().any(|look| look.word_box_animated);
        let mut families = vec![
            original_style.font_name.as_str(),
            translation_style.font_name.as_str(),
        ];
        let mut override_families = cue_original
            .values()
            .chain(cue_translation.values())
            .map(|entry| entry.style.font_name.as_str())
            .collect::<Vec<_>>();
        override_families.sort_unstable();
        override_families.dedup();
        for family in override_families {
            if !families.contains(&family) {
                families.push(family);
            }
        }
        let warnings = families
            .into_iter()
            .filter(|family| !text.has_family(family))
            .map(|family| {
                format!("字体 {family:?} 在当前字体库中不可用，将使用 Noto Sans SC fallback")
            })
            .collect();
        // `--no-*` 不改文档，却决定画哪些元素，必须自成一段进缓存键。画质档不参与：
        // 它只改码率，不改任何一个像素。
        let definition_key = format!(
            "{:016x}:{width}x{height}:{duration:.6}:{:.6}:{}:{}",
            render_raster::drawop::fnv1a64(serde_json::to_string(document)?.as_bytes()),
            fps.max(1.0),
            mode_token(mode),
            includes.key(),
        );
        let mut change_points: Vec<f64> = cues
            .iter()
            .chain(translations.iter())
            .flat_map(|item| {
                [item.display_start, item.display_end]
                    .into_iter()
                    .chain(item.words.iter().flat_map(|word| [word.start, word.end]))
            })
            .collect();
        change_points.sort_by(f64::total_cmp);
        change_points.dedup();
        let caps = render_raster::CapabilityProfile::cpu_reference();
        // 倒鸭子：只在原文轨参与、字幕层打开时启用；字体口径取原文行的非紧凑
        // 解算（双语也按单语字号排世界），说话人投影读 cue 的 `sp`。
        let sequence = (track_sequence && includes.subtitles && mode != StudioMode::Translated)
            .then(|| {
                let full = resolve_line_style(&style, LineKind::Original, width, height, false);
                let speakers = document
                    .get("cues")
                    .and_then(Value::as_array)
                    .map(Vec::as_slice)
                    .unwrap_or(&[])
                    .iter()
                    .enumerate()
                    .filter_map(|(index, item)| {
                        let speaker = item.get("sp")?.as_str()?.trim();
                        (!speaker.is_empty())
                            .then(|| (timed_input_id(item, "text", index), speaker.to_owned()))
                    })
                    .collect();
                SequenceState {
                    font_name: full.font_name.clone(),
                    font_weight: full.font_weight.max(700),
                    font_px: full.font_size,
                    speakers,
                    plan: None,
                    clip: None,
                    cache: VecDeque::new(),
                    edit: None,
                }
            });
        let text_motion_cues = text_motion_items(
            &cues,
            LineKind::Original,
            &original_style,
            &cue_original,
            &[],
            fps,
        );
        let text_motion_translations = text_motion_items(
            &translations,
            LineKind::Translation,
            &translation_style,
            &cue_translation,
            &cues,
            fps,
        );
        Ok(Self {
            text_motion_cues,
            text_motion_translations,
            definition_key,
            style,
            mode,
            order,
            cues,
            translations,
            original_style,
            translation_style,
            original_animation,
            caption_descriptor,
            designed_caption,
            word_box_animated,
            caption_composite,
            centered_caption,
            track_look,
            cue_original,
            cue_translation,
            width,
            height,
            duration,
            fps: fps.max(1.0),
            fonts_loaded,
            text,
            includes,
            main: None,
            elements: Vec::new(),
            viz_tracks: HashMap::new(),
            viz_projection: None,
            media: OverlayFrameMedia::empty(fps.max(1.0)),
            cache: VecDeque::new(),
            change_points,
            layout_cache: VecDeque::new(),
            glyph_geometry_cache: VecDeque::new(),
            glyph_outline_geometry_cache: VecDeque::new(),
            glyph_decoration_geometry_cache: VecDeque::new(),
            glyph_segment_geometry_cache: VecDeque::new(),
            glyph_effect_geometry_cache: VecDeque::new(),
            glyph_effect_outline_geometry_cache: VecDeque::new(),
            composited: None,
            element_sample_time: None,
            confetti_peek: None,
            confetti_peek_undo: None,
            whiteboard_cache: HashMap::new(),
            whiteboard_sources: HashMap::new(),
            blank_frame: None,
            effect_scratch: None,
            suppress_transition: false,
            executor: render_raster::CpuExecutor::new(caps.clone()),
            capability: caps.fingerprint(),
            preflight: render_raster::PreflightReport::default(),
            warnings,
            chrome: None,
            chrome_error: None,
            sequence,
        })
    }

    /// 装饰层装载失败的原因（`None` = 没绑定，或装载成功）。
    pub fn template_chrome_error(&self) -> Option<&str> {
        self.chrome_error.as_deref()
    }

    pub fn sample_time_for(&self, id: &str, time: f64) -> f64 {
        self.element_sample_time
            .as_ref()
            .filter(|(target, sample)| target == id && sample.is_finite())
            .map_or(time, |(_, sample)| *sample)
    }

    pub fn set_element_sample_time(&mut self, sample: Option<(String, f64)>) {
        if self.element_sample_time != sample {
            self.element_sample_time = sample;
            self.composited = None;
        }
    }

    /// 舞台彩纸试穿：把一份临时配方**就地**装到计划上；`None` 撤回（第 236 轮）。
    ///
    /// 与 `set_element_anim_preview` 那条「整份重编译」通道的差别是全部收益所在：
    /// 换一款彩纸只动 `element.confetti` 一个字段，画面靠 `composited = None`
    /// 重出一帧，**不重读磁盘、不重编译、不重装素材**。彩纸的配方进的是 draw
    /// ops，`element_drawop_fingerprint` 天然跟着变，宿主的同指纹去重不会把预览
    /// 帧吞掉——这一点字幕样式那条通道做不到（它要绕 `hash_document`）。
    ///
    /// `id` 在计划里找不到时**凭空补一件幽灵**（[`TimelineVisualElement::confetti_preview`]）：
    /// 素材库网格悬停一格时时间轴上还没有这件元素，这是那条链唯一能在舞台上看见
    /// 效果的办法。幽灵追加在末尾＝最上层，与「点这一格新建一件」落到的层序一致。
    ///
    /// 采样时刻不在这条通道里：它走既有的 [`Self::set_element_sample_time`]，
    /// 目标件与幽灵件同一个 id、同一套 `[start, end)` 判活。
    pub fn set_confetti_peek(&mut self, peek: Option<ConfettiPeek>) {
        if self.confetti_peek == peek {
            return;
        }
        // 先撤上一次，再装这一次：装第二次之前不撤，第一次的原配方就永久丢了。
        match self.confetti_peek_undo.take() {
            Some(ConfettiPeekUndo::Restore(saved)) => {
                if let Some(current) = self.confetti_peek.as_ref() {
                    let id = current.id.clone();
                    if let Some(element) = self.elements.iter_mut().find(|e| e.id == id) {
                        element.confetti = saved;
                    }
                }
            }
            Some(ConfettiPeekUndo::Remove) => {
                if let Some(current) = self.confetti_peek.as_ref() {
                    let id = current.id.clone();
                    self.elements.retain(|element| element.id != id);
                }
            }
            None => {}
        }
        self.confetti_peek = peek.clone();
        if let Some(peek) = peek {
            match self
                .elements
                .iter_mut()
                .find(|element| element.id == peek.id)
            {
                Some(element) => {
                    self.confetti_peek_undo =
                        Some(ConfettiPeekUndo::Restore(element.confetti.clone()));
                    element.confetti = Some(peek.props);
                }
                None => {
                    self.confetti_peek_undo = Some(ConfettiPeekUndo::Remove);
                    self.elements.push(TimelineVisualElement::confetti_preview(
                        peek.id,
                        peek.props,
                        peek.window.0,
                        peek.window.1,
                    ));
                }
            }
        }
        self.composited = None;
    }

    /// 这份计划是否带一层模板。
    pub fn has_template_chrome(&self) -> bool {
        self.chrome.is_some()
    }

    /// 当前套用的模板场景（`None` = 没套）。
    pub fn template_scene(&self) -> Option<&TemplateScene> {
        self.chrome.as_ref().map(|layer| &layer.scene)
    }

    /// 换入 / 撤掉模板场景。App 版面编辑器的草稿真渲染与浏览器合成器都走这里
    /// （它们不经 `compile_project`）；换场景会让帧身份与字幕避让一起跟着变，
    /// 已合成缓存随之作废。
    pub fn set_template_scene(&mut self, scene: Option<TemplateScene>) {
        self.chrome = scene.map(TemplateLayer::new);
        self.chrome_error = None;
        self.composited = None;
        self.cache.clear();
    }

    /// 取一帧模板像素（`None` = 没套模板）。`fallback_family` 是原文行的字体。
    fn template_frame(&mut self, time: f64) -> Result<Option<Pixmap>> {
        let Some(layer) = self.chrome.as_ref() else {
            return Ok(None);
        };
        let pixmap = layer.frame(
            time,
            self.duration,
            self.width,
            self.height,
            &self.original_style.font_name,
            &mut self.text,
        )?;
        Ok(Some(pixmap))
    }

    /// 元素效果的 preflight（设计 §6.5）：在逐帧之前定案，不允许渲染到一半
    /// 才发现后端不支持。overlay 的效果只能来自 `lower_element_effects`，
    /// 所以两种形态（画中画/平铺与全屏）各走一遍就是完整的引用集合。
    pub fn run_preflight(&mut self) -> Result<()> {
        let mut refs: Vec<render_raster::plan::EffectRef> = Vec::new();
        for element in &self.elements {
            for pip_or_tiled in [false, true] {
                for lowered in timeline::lower_element_effects(
                    element.fx.as_ref(),
                    element.mask.as_ref(),
                    Some(&element.place),
                    Some(1.0),
                    pip_or_tiled,
                ) {
                    if !refs.contains(&lowered.effect) {
                        refs.push(lowered.effect);
                    }
                }
            }
        }
        self.preflight = render_raster::plan::preflight_effects(
            &refs,
            &render_raster::CapabilityProfile::cpu_reference(),
        )?;
        Ok(())
    }

    /// 本次导出的 preflight 结论。`bcut serve` 的视频任务信封读它。
    pub fn preflight(&self) -> &render_raster::PreflightReport {
        &self.preflight
    }

    /// 从 host 已完成词锚解析的 Studio 投影载入元素。这里只解析契约、筛 include、
    /// 稳定提升 watermark；不读 timeline.json、不探测素材，也不拉频谱，因此
    /// 浏览器字体规划器与 CLI host 可以共用同一份元素顺序。
    pub fn load_projected_timeline_elements(&mut self, document: &Value) -> Result<()> {
        self.parse_projected_timeline_elements(document).map(|_| ())
    }

    fn parse_projected_timeline_elements(
        &mut self,
        document: &Value,
    ) -> Result<Vec<(String, ElementKind)>> {
        self.elements.clear();
        let mut required_sources = Vec::new();
        // 水印**渲染期固定最上层**（M5-B8，设计文档 §20 #10）：轨道顺序决定其余
        // 元素的 z 序，水印不参与。稳定提取后统一追加，水印之间仍保持文档顺序。
        let mut watermarks: Vec<TimelineVisualElement> = Vec::new();
        let tracks = document
            .pointer("/timeline/tracks")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        for track in tracks {
            if track.get("hidden").and_then(Value::as_bool) == Some(true) {
                continue;
            }
            for raw in track
                .get("elements")
                .and_then(Value::as_array)
                .map(Vec::as_slice)
                .unwrap_or(&[])
            {
                let Some(start) = raw.get("start").and_then(Value::as_f64) else {
                    self.warnings.push(format!(
                        "元素 {} 的 start 词锚无法解析，已跳过渲染",
                        raw.get("id").and_then(Value::as_str).unwrap_or("<unknown>")
                    ));
                    continue;
                };
                let end = raw
                    .get("end")
                    .and_then(Value::as_f64)
                    .unwrap_or(self.duration);
                if end <= start || raw.get("hidden").and_then(Value::as_bool) == Some(true) {
                    continue;
                }
                let mut normalized = raw.clone();
                if let Some(object) = normalized.as_object_mut() {
                    for key in [
                        "startAnchor",
                        "startError",
                        "endAnchor",
                        "endError",
                        "whiteboardBeatAnchors",
                    ] {
                        object.remove(key);
                    }
                    object.insert("start".to_owned(), serde_json::json!(start));
                    object.insert("end".to_owned(), serde_json::json!(end));
                }
                let element: Element = serde_json::from_value(normalized).with_context(|| {
                    format!(
                        "解析 timeline element {}",
                        raw.get("id").and_then(Value::as_str).unwrap_or("<unknown>")
                    )
                })?;
                if !self.includes.allows(&element) {
                    continue;
                }
                if let Some(source_id) = &element.src_id {
                    required_sources.push((source_id.clone(), element.kind));
                }
                let is_watermark = element.role == Some(ElementRole::Watermark);
                let visual = TimelineVisualElement {
                    id: element.id,
                    kind: element.kind,
                    start,
                    end,
                    place: element.place.unwrap_or_default(),
                    vertical_align: element
                        .vertical_align
                        .as_deref()
                        .and_then(vertical_align_from_str),
                    src_id: element.src_id,
                    src_start: element.src_start.unwrap_or(0.0),
                    rate: element.rate.unwrap_or(1.0),
                    audio_fade_in: element.audio_fade_in.unwrap_or(0.0),
                    audio_fade_out: element.audio_fade_out.unwrap_or(0.0),
                    mode: element.mode.unwrap_or(VisualMode::Pip),
                    fit: element.fit.unwrap_or(Fit::Cover),
                    bg: Some(element.bg.unwrap_or(Background::Black)),
                    text: element.text,
                    counter: element.counter,
                    style: element.style.unwrap_or_else(|| serde_json::json!({})),
                    tile: element.tile,
                    mask: element.mask,
                    fx: element.fx,
                    animation: element.animate,
                    transitions: element.transitions,
                    keyframes: element.keyframes,
                    shape: element.shape,
                    sticker: element.sticker,
                    visualizer: element.visualizer,
                    progress: element.progress,
                    draw: element.draw,
                    placeholder: element.placeholder,
                    confetti: element.confetti,
                    whiteboard: element.whiteboard,
                };
                if is_watermark {
                    watermarks.push(visual);
                } else {
                    self.elements.push(visual);
                }
            }
        }
        self.elements.extend(watermarks);
        Ok(required_sources)
    }

    #[cfg(feature = "host")]
    pub fn load_timeline_elements(&mut self, project: &Path, document: &Value) -> Result<()> {
        self.load_timeline_elements_with_policy(
            project,
            document,
            TimelineMediaFailurePolicy::Strict,
        )
    }

    #[cfg(feature = "host")]
    fn load_timeline_elements_with_policy(
        &mut self,
        project: &Path,
        document: &Value,
        media_failure_policy: TimelineMediaFailurePolicy,
    ) -> Result<()> {
        let timeline_path = project.join("timeline.json");
        let timeline = if timeline_path.is_file() {
            let contents = fs::read_to_string(&timeline_path)?;
            // 旧撤销记录曾把「不存在的可选时间轴」恢复成空文件。编辑器
            // ProjectTimeline::load 已将其视为缺省文档；渲染必须同样处理，
            // 否则投影中的视频元素能播放声音，却因这里解析失败而整层黑屏。
            // 只读兼容，不修写项目；非空损坏 JSON 仍明确报错。
            if contents.trim().is_empty() {
                TimelineDocument::default()
            } else {
                serde_json::from_str::<TimelineDocument>(&contents)
                    .with_context(|| format!("解析 {}", timeline_path.display()))?
            }
        } else {
            TimelineDocument::default()
        };
        timeline
            .validate()
            .map_err(|error| anyhow!("timeline.json 无效：{error}"))?;
        self.main = document
            .pointer("/timeline/main")
            .filter(|value| value.is_object())
            .map(|value| serde_json::from_value(value.clone()))
            .transpose()?
            .or_else(|| timeline.main.clone());

        let projected_sources = self.parse_projected_timeline_elements(document)?;
        let mut required_sources: HashMap<String, TimelineSourceDecoder> = HashMap::new();
        for (source_id, kind) in projected_sources {
            // sticker / placeholder 的解码器**跟着 source 的自述 kind 走**（P7b）：
            // 静态资产与 image 共用解码器，带 alpha 的循环 WebM 必须走视频解码器，
            // Timeline 0.7 的 `lottie` 源走 bodymovin 光栅器。
            let source_kind = timeline
                .sources
                .get(&source_id)
                .and_then(|source| source.kind);
            let decoder = match kind {
                // 白板元素的源恒为静态图（`whiteboard-source-kind` 已在 schema 校验）。
                ElementKind::Image | ElementKind::Whiteboard => TimelineSourceDecoder::Image,
                ElementKind::Video => TimelineSourceDecoder::Video,
                ElementKind::Sticker | ElementKind::Placeholder => match source_kind {
                    Some(timeline::SourceKind::Video) => TimelineSourceDecoder::Video,
                    Some(timeline::SourceKind::Lottie) => TimelineSourceDecoder::Lottie,
                    _ => TimelineSourceDecoder::Image,
                },
                // shape / visualizer / progress 不引用媒体源（visualizer 的
                // `audio` 指的是 BCS1 频谱，P1 的活）。
                ElementKind::Text
                | ElementKind::Audio
                | ElementKind::Shape
                | ElementKind::Visualizer
                | ElementKind::Progress
                | ElementKind::Confetti
                | ElementKind::Draw => TimelineSourceDecoder::None,
            };
            if let Some(previous) = required_sources.insert(source_id.clone(), decoder)
                && previous != decoder
            {
                bail!("source {source_id} 被 image/video 两种元素 kind 同时引用，无法确定解码器");
            }
        }

        let mut assets = LoadedAssets::default();
        let mut external_video = Vec::new();
        let mut failed_sources = std::collections::HashSet::new();
        for (source_id, decoder) in required_sources {
            let load = (|| -> Result<()> {
                if matches!(decoder, TimelineSourceDecoder::Video) {
                    let declared = timeline
                        .sources
                        .get(&source_id)
                        .and_then(|source| source.path.as_deref());
                    if let Some(source) = crate::host::prepare_video_source(
                        project,
                        &source_id,
                        declared,
                        if matches!(
                            media_failure_policy,
                            TimelineMediaFailurePolicy::SkipFailedElement
                        ) {
                            crate::host::VideoSourceUse::Preview { width: self.width }
                        } else {
                            crate::host::VideoSourceUse::Export {
                                canvas_width: self.width,
                                canvas_height: self.height,
                            }
                        },
                    )? {
                        if let Some(warning) = source.warning {
                            self.warn_once(warning);
                        }
                        assets.videos.insert(source_id.clone(), source.info);
                        external_video.push((source_id.clone(), source.frames));
                        return Ok(());
                    }
                }
                let path = source_path(project, &timeline, &source_id)?;
                match decoder {
                    TimelineSourceDecoder::Image => {
                        let bytes = fs::read(&path)
                            .with_context(|| format!("读取 image source {}", path.display()))?;
                        load_timeline_image_source(&mut assets, &source_id, &path, &bytes)?;
                    }
                    TimelineSourceDecoder::Lottie => {
                        let bytes = fs::read(&path)
                            .with_context(|| format!("读取 lottie source {}", path.display()))?;
                        load_timeline_lottie_source(&mut assets, &source_id, &path, &bytes, None)?;
                    }
                    TimelineSourceDecoder::Video => {
                        let (width, height, source_duration, source_fps) =
                            probe_media(&path, true)?;
                        assets.videos.insert(
                            source_id.clone(),
                            VideoInfo {
                                // 带 alpha 的 WebM（动态贴纸）要点名解码器，
                                // 否则 alpha 平面被静默丢掉（P7b）。
                                decoder: render_raster::assets::probe_alpha_decoder(&path),
                                path,
                                width,
                                height,
                                duration: source_duration,
                                fps: source_fps,
                            },
                        );
                    }
                    TimelineSourceDecoder::None => {}
                }
                Ok(())
            })();
            if let Err(error) = load {
                if media_failure_policy == TimelineMediaFailurePolicy::Strict {
                    return Err(error);
                }
                failed_sources.insert(source_id.clone());
                self.warn_once(format!(
                    "预览已跳过媒体 source {source_id} 及其元素：{error:#}"
                ));
            }
        }
        if !failed_sources.is_empty() {
            self.elements.retain(|element| {
                element
                    .src_id
                    .as_ref()
                    .is_none_or(|source_id| !failed_sources.contains(source_id))
            });
            self.composited = None;
        }
        self.load_sticker_fill_variants(&mut assets, project, &timeline);
        self.media = OverlayFrameMedia {
            base: MediaStore::new(Arc::new(assets), self.fps),
            dynamic: HashMap::new(),
            injected: HashMap::new(),
        };
        for (id, source) in external_video {
            self.media.base.insert_video_source(id, source);
        }
        self.load_visualizer_tracks(project)?;
        Ok(())
    }

    /// 预载**换色后**的素材贴纸位图（第 122 轮 §14.4 的渲染腿）。
    ///
    /// 判据在纯层 [`timeline::svg_fill::apply_overrides`]，与属性页色卡
    /// 共用一份分组——面板上点出来的颜色和画面上看到的颜色因此不可能分家。
    /// 这里只负责读盘、光栅化并按 [`sticker_fill_variant_id`] 归档。
    ///
    /// Lottie 源（Timeline 0.7）走 [`render_raster::source::Lottie::apply_fill_overrides`]：
    /// 命中的纯色填充 / 描边在文档层换掉，变体以另一份 `Lottie` 归档，逐帧
    /// 采样与循环语义和原件完全一样。
    ///
    /// 三类源**故意不生成变体**，取帧时会原样退回 source id 那一份：位图
    /// （`fillOverrides` 对 PNG 无意义）、动图/视频贴纸（逐帧解码，换色要另设
    /// 计划），以及读盘或光栅失败的素材。缺变体不是错误，只是不换色。
    #[cfg(feature = "host")]
    fn load_sticker_fill_variants(
        &mut self,
        assets: &mut LoadedAssets,
        project: &Path,
        timeline: &TimelineDocument,
    ) {
        let wanted: Vec<(String, std::collections::BTreeMap<String, String>)> = self
            .elements
            .iter()
            .filter_map(|element| {
                let source_id = element.src_id.clone()?;
                let sticker = element.sticker.as_ref()?;
                (!sticker.fill_overrides.is_empty())
                    .then(|| (source_id, sticker.fill_overrides.clone()))
            })
            .collect();
        let mut seen = std::collections::HashSet::new();
        for (source_id, overrides) in wanted {
            let variant = sticker_fill_variant_id(&source_id, &overrides);
            if !seen.insert(variant.clone()) || assets.images.contains_key(&variant) {
                continue;
            }
            let Ok(path) = source_path(project, timeline, &source_id) else {
                continue;
            };
            // Lottie 的换色在文档层做（纯色填充 / 描边），变体是另一份
            // `Lottie`，与 SVG 变体同样按 `sticker_fill_variant_id` 归档。
            if assets.lotties.contains_key(&source_id) {
                if assets.lotties.contains_key(&variant) {
                    continue;
                }
                let load = fs::read(&path)
                    .with_context(|| format!("读取 {}", path.display()))
                    .and_then(|bytes| {
                        load_timeline_lottie_source(
                            assets,
                            &variant,
                            &path,
                            &bytes,
                            Some(&overrides),
                        )
                    });
                if let Err(error) = load {
                    self.warn_once(format!(
                        "贴纸 source {source_id} 换色失败，按原色渲染：{error:#}"
                    ));
                }
                continue;
            }
            // 只有走静态图解码器的源才有换色变体；动图/视频那一份不在 images 里。
            if !assets.images.contains_key(&source_id) {
                continue;
            }
            if !path
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("svg"))
            {
                continue;
            }
            let svg = match fs::read_to_string(&path) {
                Ok(svg) => svg,
                Err(error) => {
                    self.warn_once(format!(
                        "贴纸 source {source_id} 换色失败，按原色渲染：读取 {}：{error}",
                        path.display()
                    ));
                    continue;
                }
            };
            let recolored = timeline::svg_fill::apply_overrides(&svg, &overrides);
            match load_timeline_image_source(assets, &variant, &path, recolored.as_bytes()) {
                Ok(()) => {}
                Err(error) => self.warn_once(format!(
                    "贴纸 source {source_id} 换色后无法光栅，按原色渲染：{error:#}"
                )),
            }
        }
    }

    /// **ADR-E04 数据流的 host 侧**：读 BCS1 → 按元素参数整轨派生 → 注入。
    ///
    /// 三件事必须在这里做完，渲染期一件都不许再做：
    ///
    /// 1. **读**。`bcut-render` 是无 I/O 的，BCS1 的缓存路径、指纹与读取只能在
    ///    host。缓存文件由 `bcut spectrum` 产出，本函数**不代生成**——重新解码
    ///    一整条音轨是分钟级的活，藏在一次 overlay 渲染里不合适。
    /// 2. **派生**。指数平滑天然递推（`y[n] = τ·y[n-1] + (1-τ)·x[n]`，`y[-1]=0`），
    ///    必须从帧 0 顺序推进；`VizTrack::derive` 一次性走完整条轨，
    ///    `sample(t)` 因此是纯查表，乱序采样才可能与顺序采样逐位一致。
    /// 3. **fail-fast**。缺 BCS1 直接报错并指路 `bcut spectrum`，绝不静默出空图
    ///    ——「频谱还没生成」和「这段确实静音」在画面上长得一模一样。
    #[cfg(feature = "host")]
    pub fn load_visualizer_tracks(&mut self, project: &Path) -> Result<()> {
        let wanted: Vec<(String, String, VisualizerProps)> = self
            .elements
            .iter()
            .filter(|element| element.kind == ElementKind::Visualizer)
            .filter_map(|element| {
                let props = element.visualizer.clone()?;
                Some((element.id.clone(), visualizer_audio_source(&props), props))
            })
            .collect();
        if wanted.is_empty() {
            return Ok(());
        }
        // 采样时刻的折算表（见 `viz_projection` 的字段文档）。只在真的有
        // visualizer 元素时才建：没有元素的项目一个字节都不该多读。
        self.viz_projection = Some(
            crate::host::project_timeline_projection(project)
                .context("visualizer 的采样时刻需要时间轴投影")?,
        );
        // `(源, 参数)` 相同的元素共享同一条轨：一条 3 分钟音轨的 VizTrack 是
        // 十几 MB，两个同参数的波形没有理由各存一份。
        let mut derived: HashMap<String, Arc<render_raster::source::VizTrack>> = HashMap::new();
        let mut spectra: HashMap<String, Arc<Vec<u8>>> = HashMap::new();
        for (element_id, source_id, props) in wanted {
            let params = render_raster::source::VizParams {
                min_db: props.min_db(),
                max_db: props.max_db(),
                smoothing: props.smoothing(),
                gain: props.gain(),
            };
            let key = format!(
                "{source_id}\u{1}{}\u{1}{}\u{1}{}\u{1}{}",
                params.min_db, params.max_db, params.smoothing, params.gain
            );
            if let Some(track) = derived.get(&key) {
                self.viz_tracks.insert(element_id, track.clone());
                continue;
            }
            let bytes = match spectra.get(&source_id) {
                Some(bytes) => bytes.clone(),
                None => {
                    let bytes = Arc::new(read_project_spectrum(project, &source_id, &element_id)?);
                    spectra.insert(source_id.clone(), bytes.clone());
                    bytes
                }
            };
            let track = Arc::new(
                render_raster::source::VizTrack::derive(&bytes, params).with_context(|| {
                    format!("元素 {element_id} 的频谱轨派生失败（音频源 {source_id}）")
                })?,
            );
            derived.insert(key, track.clone());
            self.viz_tracks.insert(element_id, track);
        }
        Ok(())
    }

    pub fn warnings(&self) -> &[String] {
        &self.warnings
    }

    /// 输出时间轴上的字幕内容签名：每条原文/译文行一项，`key` 覆盖一切会改变
    /// 画面的内容（层、id、文本、显示窗、逐词高亮时刻）。
    ///
    /// 区间重渲用它判定「基线文档与本次文档的差异是否全部落在补丁窗内」——窗外
    /// 每一帧都从基线产物直通，一处窗外差异就是一份静默的错误产物。字幕行只在
    /// `[display_start, display_end)` 内参与绘制，因此比对整条显示窗即可。
    pub fn subtitle_spans(&self) -> Vec<SubtitleSpan> {
        let layers = self
            .cues
            .iter()
            .map(|item| ("orig", item))
            .chain(self.translations.iter().map(|item| ("trans", item)));
        layers
            .map(|(layer, item)| {
                let words = item
                    .words
                    .iter()
                    .map(|word| format!("{}@{:.4}", word.text, word.end))
                    .collect::<Vec<_>>()
                    .join("\u{1}");
                SubtitleSpan {
                    start: item.display_start,
                    end: item.display_end,
                    key: format!(
                        "{layer}\u{2}{}\u{2}{}\u{2}{:.4}\u{2}{:.4}\u{2}{words}",
                        item.id, item.text, item.display_start, item.display_end
                    ),
                }
            })
            .collect()
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    /// 同一条字幕行显示期间文本、样式与换行宽度都不变，shaping 结果按
    /// `(层, 行 id)` 复用；逐词高亮只影响绘制阶段，不参与排版。
    pub fn cached_layout(
        &mut self,
        kind: LineKind,
        item: &TimedItem,
        style: &LineStyle,
        wrap_width: f64,
    ) -> Arc<CachedLayout> {
        let key = format!(
            "{}:{}",
            match kind {
                LineKind::Original => "orig",
                LineKind::Translation => "trans",
            },
            item.id
        );
        if let Some(index) = self
            .layout_cache
            .iter()
            .position(|(cached, _)| *cached == key)
        {
            let entry = self.layout_cache.remove(index).expect("layout cache entry");
            self.layout_cache.push_front(entry.clone());
            return entry.1;
        }
        let (lines, width) = layout_subtitle_text(&mut self.text, item, style, wrap_width);
        let layout = Arc::new(CachedLayout {
            lines: lines.into(),
            width,
        });
        self.layout_cache.push_front((key, layout.clone()));
        while self.layout_cache.len() > 4 {
            self.layout_cache.pop_back();
        }
        layout
    }

    #[allow(clippy::too_many_arguments)]
    pub fn cached_caption_layout(
        &mut self,
        item: &TimedItem,
        style: &LineStyle,
        design: &DesignedCaption,
        descriptor: &'static CaptionRecipeDescriptor,
        wrap_width: f64,
        time: f64,
        canvas_scale: f64,
    ) -> Arc<CachedLayout> {
        let group = caption_recipe_visible_group(design, item, time, self.fps)
            .map_or_else(|| "none".to_owned(), |group| group.index.to_string());
        let key = format!(
            "orig:{}:caption:{}:{}:{group}",
            item.id, descriptor.id, descriptor.version
        );
        if let Some(index) = self
            .layout_cache
            .iter()
            .position(|(cached, _)| *cached == key)
        {
            let entry = self.layout_cache.remove(index).expect("layout cache entry");
            self.layout_cache.push_front(entry.clone());
            return entry.1;
        }
        let (lines, width) = layout_caption_text(
            &mut self.text,
            item,
            style,
            design,
            descriptor,
            wrap_width,
            time,
            self.fps,
            self.width,
            self.height,
            canvas_scale,
        );
        let layout = Arc::new(CachedLayout {
            lines: lines.into(),
            width,
        });
        self.layout_cache.push_front((key, layout.clone()));
        while self.layout_cache.len() > 12 {
            self.layout_cache.pop_back();
        }
        layout
    }

    pub fn active_layouts(&mut self, time: f64) -> Vec<LineLayout> {
        let original = active_at(&self.cues, time).cloned();
        let translation = active_at(&self.translations, time).cloned();
        let base_wrap_width = f64::from(self.width)
            * clamp(finite(self.style.get("width"), 80.0), 5.0, 100.0)
            / 100.0;
        // 编译期定案的常量，取一份不借用 `self` 的句柄，好在下面继续调
        // `&mut self` 的布局缓存方法。
        let track_look = self.track_look.clone();
        let canvas_scale = f64::from(self.width.min(self.height)) / REFERENCE_SHORT_EDGE
            * finite(self.style.get("scale"), 1.0).max(0.05);
        let sequence_takes_original = self.sequence.is_some();
        let mut layouts = mode_lines(self.mode, &self.order)
            .into_iter()
            // 倒鸭子接管原文轨：cue 级排版只剩译文行（双语）或什么都不画（单语）。
            .filter(|kind| !(sequence_takes_original && *kind == LineKind::Original))
            .filter_map(|kind| {
                let mut item = match kind {
                    LineKind::Original => original.clone(),
                    LineKind::Translation => translation.clone(),
                }?;
                let cue = self.cue_override(kind, &item.id).cloned();
                let style = match (&cue, kind) {
                    (Some(cue), _) => cue.style.clone(),
                    (None, LineKind::Original) => self.original_style.clone(),
                    (None, LineKind::Translation) => self.translation_style.clone(),
                };
                if style.text_motion.is_some() {
                    item.display_end = item.display_end.min(self.duration);
                }
                let look = cue.as_ref().map_or(&track_look, |cue| &cue.look);
                let caption = look.animation.caption.as_ref();
                let caption_descriptor = look.descriptor;
                let wrap_width = if kind == LineKind::Original {
                    caption_descriptor.map_or(base_wrap_width, |descriptor| {
                        caption_recipe_layout_token(descriptor, self.width, self.height)
                            .map_or_else(
                                || match descriptor.layout.as_str() {
                                    "fullScreenWord" | "centerBand" => f64::from(self.width) * 0.9,
                                    "dualBand" | "editorialBlock" => (f64::from(self.width) * 0.92)
                                        .min(base_wrap_width.max(f64::from(self.width) * 0.82)),
                                    _ => base_wrap_width,
                                },
                                |token| f64::from(self.width) * token.width,
                            )
                    })
                } else {
                    base_wrap_width
                };
                let layout = match (kind, caption, caption_descriptor) {
                    (LineKind::Original, Some(design), Some(descriptor)) => self
                        .cached_caption_layout(
                            &item,
                            &style,
                            design,
                            descriptor,
                            wrap_width,
                            time,
                            canvas_scale,
                        ),
                    _ => self.cached_layout(kind, &item, &style, wrap_width),
                };
                let (lines, width) = (Arc::clone(&layout.lines), layout.width);
                let current_word = current_word_index(&item, time);
                let karaoke_words = self
                    .active_text_motion(kind, time)
                    .and_then(|(_, motion)| motion.karaoke_words.clone());
                let line_style =
                    merged_line_style(cue.as_ref().map_or(&self.style, |cue| &cue.root), kind);
                Some(LineLayout {
                    kind,
                    height: layout_lines_height(&lines),
                    width,
                    align_width: if crate::aligns_within_wrap(&line_style) {
                        wrap_width
                    } else {
                        width
                    },
                    text_align: LineTextAlign::from_style(&line_style),
                    style,
                    item,
                    lines,
                    current_word,
                    render_time: time,
                    render_fps: self.fps,
                    animation_parts: Vec::new(),
                    animation_short_edge: f64::from(self.width.min(self.height)),
                    preview: false,
                    karaoke_words,
                    guide_below: false,
                })
            })
            .collect::<Vec<_>>();
        // 双语两行叠放：下面那行的引导点画在它自己下方，不压上一行的字。
        for line in layouts.iter_mut().skip(1) {
            line.guide_below = true;
        }
        if let Some(preview) = self.karaoke_next_line(&layouts, base_wrap_width) {
            layouts.push(preview);
        }
        layouts
    }

    /// KTV 双行排版：只显示一行（原文或仅译文）时，正在唱的这句带
    /// `textMotion.karaoke.nextLine`，下一句排在它下面预告。双语画面本来就是
    /// 原文 + 译文两行，再预告就成了四行，所以不预告。下一句离得太远（间奏）
    /// 也不预告。
    fn karaoke_next_line(
        &mut self,
        layouts: &[LineLayout],
        wrap_width: f64,
    ) -> Option<LineLayout> {
        let kind = match self.mode {
            StudioMode::Original => LineKind::Original,
            StudioMode::Translated => LineKind::Translation,
            StudioMode::Bilingual => return None,
        };
        let current = layouts.iter().find(|line| line.kind == kind)?;
        let karaoke = current.style.text_motion.as_ref()?.spec.karaoke.as_ref()?;
        if !karaoke.next_line {
            return None;
        }
        let items = match kind {
            LineKind::Original => &self.cues,
            LineKind::Translation => &self.translations,
        };
        let index = items.iter().position(|item| item.id == current.item.id)?;
        let next = items.get(index + 1)?.clone();
        if next.display_start - current.item.display_end > KARAOKE_NEXT_LINE_MAX_GAP {
            return None;
        }
        let style = current.style.clone();
        let layout = self.cached_layout(kind, &next, &style, wrap_width);
        let (lines, width) = (Arc::clone(&layout.lines), layout.width);
        let within_wrap =
            crate::aligns_within_wrap(&merged_line_style(&self.style, kind));
        Some(LineLayout {
            kind,
            height: layout_lines_height(&lines),
            width,
            align_width: if within_wrap { wrap_width } else { width },
            text_align: current.text_align,
            style,
            item: next,
            lines,
            current_word: 0,
            render_time: current.render_time,
            render_fps: self.fps,
            animation_parts: Vec::new(),
            animation_short_edge: current.animation_short_edge,
            preview: true,
            karaoke_words: None,
            guide_below: false,
        })
    }

    pub fn cache_key(
        &self,
        layouts: &[LineLayout],
        time: f64,
        pose: TransitionPose,
        suppressed: bool,
    ) -> String {
        // 预告行由当前句决定，不进键：与 `render_subtitle_frame` 的轻量键同形。
        let items = layouts
            .iter()
            .filter(|line| !line.preview)
            .map(|line| (line.item.id.as_str(), line.current_word))
            .collect::<Vec<_>>();
        self.cache_key_of(&items, time, pose, suppressed)
    }

    /// [`Self::cache_key`] 的**轻量**形态：键只认「哪几条 cue + 各自当前词」，
    /// 排版结果一个字节都不进键。所以查缓存根本不需要先把布局物化出来——
    /// `render_subtitle_frame` 靠这一点把 shaping 深拷贝推迟到未命中之后。
    ///
    /// 两条路径必须走同一个函数：键要是分叉了，命中的就是另一张图。
    pub fn cache_key_of(
        &self,
        items: &[(&str, usize)],
        time: f64,
        pose: TransitionPose,
        suppressed: bool,
    ) -> String {
        let items = items
            .iter()
            .map(|(id, current_word)| format!("{id}:{current_word}"))
            .collect::<Vec<_>>()
            .join("|");
        let (motion_changes, motion_key, _) = self.text_motion_state(time);
        let transition = if self.per_frame_subtitle(pose.active) || motion_changes {
            format!("@{}", (time * self.fps).round() as i64)
        } else {
            "@settled".to_owned()
        };
        // 真被压掉的那些帧必须与不压制时分键：Designed Caption 活跃时逐帧键
        // 只按帧号取值，两种状态会在同一帧号上撞成同一个键、却是两张不同的图。
        // 落定之后压制本就是恒等变换，键保持一致，不平白打散缓存。
        let suppressed = if suppressed { "!nt" } else { "" };
        format!("{items}{transition}{suppressed}{motion_key}")
    }

    /// 本帧的字幕入场姿态，外加「压制是否真的改变了这一帧」（只喂缓存键）。
    ///
    /// 客户端不能也不该二次施加转场：`scale_x/scale_y` 经 `group_transform`
    /// 绕锚点落地、`opacity` 逐笔进 `raster::paint`、`blur` 经
    /// `box_blur_rgba_bounded` 落地，全在这张 PNG 里烘死了。所以 Mac
    /// `Stage/Frame/StageFrameMotion.swift::subtitlePoseNodes` 的两处压制
    /// （任意字幕被选中 / Designed Caption 让位）只能从这里开口。
    pub fn transition_pose_at(
        &self,
        display_start: f64,
        time: f64,
        canvas_scale: f64,
    ) -> (TransitionPose, bool) {
        let pose = transition_pose(&self.style, display_start, time, canvas_scale, self.fps);
        if self.suppress_transition {
            (TransitionPose::IDENTITY, pose.active)
        } else {
            (pose, false)
        }
    }

    /// S14：把字幕入场压成单位姿态。默认 `false`，与 2.0 前逐字节一致。
    pub fn set_suppress_transition(&mut self, suppress: bool) {
        self.suppress_transition = suppress;
    }

    /// 把底层视频解码器切到**随机访问**：向前跳太远时重开而不是逐帧抽干
    /// （见 `render_raster::MediaStore::set_random_access`）。
    ///
    /// 只给交互式预览用（App 的 overlay 渲染线程、serve 的单帧预览端点）：
    /// 那里一次跳转能跨过成千上万帧，抽干等于把整段视频重解一遍。导出走的
    /// `studio_export` 不调用它，行为一字不改；两条路径取的仍是同一源帧。
    #[cfg(feature = "host")]
    pub fn set_random_access(&mut self, enabled: bool) {
        self.media.base.set_random_access(enabled);
    }

    /// 底层视频解码器的**关键帧吸附**开关（见
    /// `render_raster::MediaStore::set_keyframe_snap`）：拖 playhead 期间取帧时刻
    /// 吸到之前最近的关键帧，只解一帧；松手后关掉即回到精确取帧。导出不碰。
    #[cfg(feature = "host")]
    pub fn set_keyframe_snap(&mut self, enabled: bool) {
        self.media.base.set_keyframe_snap(enabled);
    }

    pub fn designed_caption_active(&self) -> bool {
        self.designed_caption
    }

    /// 某一行上这条字幕的逐条样式（没有覆盖时 `None`）。
    pub fn cue_override(&self, kind: LineKind, item_id: &str) -> Option<&Arc<CueOverride>> {
        match kind {
            LineKind::Original => self.cue_original.get(item_id),
            LineKind::Translation => self.cue_translation.get(item_id),
        }
    }

    /// 这一行画出来用的根样式：有逐条覆盖就是叠过覆盖的那份，否则整条轨。
    fn line_root(&self, kind: LineKind, item_id: &str) -> &Value {
        self.cue_override(kind, item_id)
            .map_or(&self.style, |entry| &entry.root)
    }

    /// 决定这一帧长相的那一行：译文模式看译文行，其余看原文行。
    fn look_kind(&self) -> LineKind {
        if self.mode == StudioMode::Translated {
            LineKind::Translation
        } else {
            LineKind::Original
        }
    }

    /// 这一帧的原文长相，按已经排好的行取。
    fn look_for_layouts(&self, layouts: &[LineLayout]) -> &CaptionLook {
        let kind = self.look_kind();
        layouts
            .iter()
            .find(|line| line.kind == kind)
            .and_then(|line| self.cue_override(kind, &line.item.id))
            .map_or(&self.track_look, |entry| &entry.look)
    }

    /// 与 [`Self::look_for_layouts`] 同一答案，但不必先排版（缓存命中路径用）。
    fn look_at(&self, time: f64) -> &CaptionLook {
        let kind = self.look_kind();
        let items = match kind {
            LineKind::Original => &self.cues,
            LineKind::Translation => &self.translations,
        };
        active_at(items, time)
            .and_then(|item| self.cue_override(kind, &item.id))
            .map_or(&self.track_look, |entry| &entry.look)
    }

    /// 本片是否有会随时间变化的逐词高亮块。与 [`Self::designed_caption_active`]
    /// 一样只喂缓存键与 `next_change`：两者都表示「字幕层这一帧不能靠
    /// `(cue, 当前词)` 定身份」。
    pub fn word_box_animated(&self) -> bool {
        self.word_box_animated
    }

    /// 字幕层是否必须逐帧出图（转场姿态 ／ Designed Caption ／ 逐词块时间轨）。
    fn per_frame_subtitle(&self, pose_active: bool) -> bool {
        pose_active || self.designed_caption_active() || self.word_box_animated()
    }

    /// 本片是否有任何一条字幕带分层文字动画。**不是**准入判据——GPU 场景按帧
    /// 看 [`Self::text_motion_active_at`]；这里只留给还按整片决定字幕层交付形态的
    /// 宿主（浏览器预览：一旦有动效就整层走 `render_subtitle_raster`，避免首个
    /// 动效帧抛错那一帧字幕空白）。
    pub fn has_text_motion(&self) -> bool {
        self.text_motion_cues
            .iter()
            .chain(&self.text_motion_translations)
            .any(Option::is_some)
    }

    /// 某一行在 `time` 的活动字幕，以及它编译期冻结的动效量（不带新动画时 `None`）。
    fn active_text_motion(
        &self,
        kind: LineKind,
        time: f64,
    ) -> Option<(&TimedItem, &TextMotionItem)> {
        let (items, motion) = match kind {
            LineKind::Original => (&self.cues, &self.text_motion_cues),
            LineKind::Translation => (&self.translations, &self.text_motion_translations),
        };
        let index = active_index(items, time)?;
        Some((items.get(index)?, motion.get(index)?.as_ref()?))
    }

    /// 这一帧真正画出来的某一行是否带分层文字动画 / 逐词底块。字幕 glyph scene
    /// 还表达不了它们：这一帧返回 [`SubtitleSceneFallback::WordAnimation`]，宿主
    /// 只把**字幕层**换成 CPU 光栅（host 合成器里是一张纹理节点），元素照旧在 GPU。
    pub fn text_motion_active_at(&self, time: f64) -> bool {
        (0.0..self.duration).contains(&time)
            && mode_lines(self.mode, &self.order)
                .into_iter()
                .any(|kind| self.active_text_motion(kind, time).is_some())
    }

    fn text_motion_state(&self, time: f64) -> (bool, String, Option<f64>) {
        use std::fmt::Write as _;
        let mut changing = false;
        let mut key = String::new();
        let mut next: Option<f64> = None;
        for kind in mode_lines(self.mode, &self.order) {
            let Some((item, motion)) = self.active_text_motion(kind, time) else {
                continue;
            };
            let base = match kind {
                LineKind::Original => &self.original_style,
                LineKind::Translation => &self.translation_style,
            };
            let style = self.cue_override(kind, &item.id).map_or(base, |v| &v.style);
            let Some(m) = &style.text_motion else {
                continue;
            };
            let local = ((time - item.display_start) * self.fps).round() / self.fps;
            let sweep_starts = motion.karaoke_words.as_ref().map(|words| {
                words
                    .iter()
                    .map(|(start, _)| start - item.display_start)
                    .collect::<Vec<_>>()
            });
            let starts: &[f64] = sweep_starts.as_deref().unwrap_or(&motion.starts);
            let duration = item.display_end.min(self.duration) - item.display_start;
            let units = motion.units;
            changing |= m.changing_at(local, duration, self.fps, units, starts);
            let _ = write!(key, "/tm{}:{:?}", item.id, m.active_word(local, starts));
            let (enter, exit) = m.boundary_windows(duration, self.fps, units);
            for boundary in [enter, exit] {
                let boundary = item.display_start + boundary - 0.5 / self.fps;
                if boundary > time + 1e-8 {
                    next = Some(next.map_or(boundary, |v| v.min(boundary)));
                }
            }
        }
        (changing, key, next)
    }

    pub fn next_change_after(&self, time: f64, transition_active: bool) -> Option<f64> {
        let (motion_changes, _, motion_next) = self.text_motion_state(time);
        let epsilon = 1.0 / (self.fps * 100.0);
        let index = self
            .change_points
            .partition_point(|boundary| *boundary <= time + epsilon);
        let mut next = self
            .change_points
            .get(index)
            .copied()
            .filter(|boundary| *boundary <= self.duration + epsilon);
        if let Some(boundary) = motion_next {
            next = Some(next.map_or(boundary, |v| v.min(boundary)));
        }
        if transition_active || motion_changes {
            let bucket = (time * self.fps).round();
            let mut boundary = (bucket + 0.5) / self.fps;
            if boundary <= time + epsilon {
                boundary = (bucket + 1.5) / self.fps;
            }
            if boundary <= self.duration + epsilon {
                next = Some(next.map_or(boundary, |current| current.min(boundary)));
            }
        }
        next
    }

    /// 空白帧共享同一份零缓冲，避免每帧分配整幅 RGBA。
    pub fn blank_rgba(&mut self) -> Arc<Vec<u8>> {
        if let Some(blank) = &self.blank_frame {
            return blank.clone();
        }
        let blank = Arc::new(vec![0; self.width as usize * self.height as usize * 4]);
        self.blank_frame = Some(blank.clone());
        blank
    }

    /// 字幕堆栈的**摆放**几何：锚点、每行槽位、共享底板判定与堆栈跨度。
    ///
    /// 光栅化（[`Self::render_subtitle_frame`]）与几何侧车
    /// （[`Self::subtitle_layout`]，供客户端做行命中/拖拽）共用同一份答案。
    /// 拆出来的唯一理由就是这个：两处各算一遍摆放，就是两种「这行在哪」的意见，
    /// 而选中框跟画面错位正是这一类分叉的典型症状。
    pub fn stack_layout(&self, layouts: &[LineLayout], canvas_scale: f64) -> StackLayout {
        let centered_caption = self.look_for_layouts(layouts).centered;
        // 单行模式只有一行，它的逐条覆盖可以挪整组锚点；双语的锚点恒是整条轨的，
        // 逐条位置走下面的行级覆盖。
        let anchor_root = match layouts.first() {
            Some(line) if self.mode != StudioMode::Bilingual => {
                self.line_root(line.kind, &line.item.id)
            }
            _ => &self.style,
        };
        let x = if centered_caption {
            f64::from(self.width) / 2.0
        } else {
            f64::from(self.width) * finite(anchor_root.get("x"), 50.0) / 100.0
        };
        // 模板避让（原型第 112 轮）：底部有整宽的模板带时，字幕锚线最多抬到带的上沿。
        // 只抬 y，不动字号 / 宽度 / 底板——模板改字幕摆位，不改字幕长相。
        let lift = self.chrome.as_ref().map_or(0.0, |layer| {
            timeline::template::subs_bottom(&layer.scene.doc, 0.0)
        });
        let center_y = if centered_caption {
            f64::from(self.height) / 2.0
        } else {
            let mut y = finite(anchor_root.get("y"), 86.0);
            if lift > 0.0 {
                y = y.min(100.0 - lift);
            }
            f64::from(self.height) * y / 100.0
        };
        let gap = finite(self.style.get("gap"), 6.0).max(0.0) * canvas_scale;
        // 行级位置覆盖只改「这一行画在哪」；width/scale/rotation 与转场仍是整组共享，
        // 所以 group_tf 的支点始终是全局锚点，脱离堆栈的行照样跟着整组缩放旋转。
        let boxes = layouts
            .iter()
            .map(|line| LineBox {
                height: line.height,
                reference: line.style.font_size * line.style.line_height,
                pad_v: line.style.background_pad_v,
                over: line_position_override(
                    self.line_root(line.kind, &line.item.id),
                    line.kind,
                    self.mode,
                ),
                align: line_vertical_align(
                    self.line_root(line.kind, &line.item.id),
                    line.kind,
                    self.mode,
                ),
            })
            .collect::<Vec<_>>();
        let overrides = boxes.iter().map(|line| line.over).collect::<Vec<_>>();
        // 共享底板的样式只跟**一行**走（见 `shared_plate_line`）：另一行的
        // backgroundPadding / backgroundColor 在 shared 模式下被完全忽略。
        //
        // 这里必须按 kind 取行，不能顺手取「堆栈里的第一行」：`mode_lines` 在 transTop 时
        // 把译文行排在前面，而 `origStyle`/`transStyle` 能各自覆盖 backgroundPadding，
        // 那样两端会分叉。
        let stacked_line = |want: LineKind| {
            layouts
                .iter()
                .zip(&overrides)
                .enumerate()
                .find_map(|(index, (line, over))| {
                    (over.is_none() && line.kind == want).then_some(index)
                })
        };
        let plate_line = shared_plate_line(
            stacked_line(LineKind::Original),
            stacked_line(LineKind::Translation),
            |index| has_real_background(&layouts[index]),
        );
        // 共享背景只包住仍在堆栈里的行：脱离堆栈的行不在这个矩形的连续区间内，
        // 它自己画自己的底板。堆栈只剩一行时共享矩形与单行底板逐像素等价，
        // 所以这里直接退回逐行分支。
        //
        // 判据只有 backgroundMode 与堆栈行数——**不含** background_on。摆放形态必须
        // 与 Mac `prepareStack` 一致，底板关掉的 shared 栈也得按共享槽位排，
        // 「画不画那块板」是后面 `has_real_background` 单独管的事。
        let stacked_count = boxes.iter().filter(|line| line.over.is_none()).count();
        let shared_background = self.style.get("backgroundMode").and_then(Value::as_str)
            == Some("shared")
            && stacked_count > 1;
        let plate = if shared_background {
            StackPlate::Shared {
                pad_v: plate_line.map_or(0.0, |index| layouts[index].style.background_pad_v),
            }
        } else {
            StackPlate::Separate
        };
        let placements = place_lines(
            &boxes,
            (x, center_y),
            gap,
            (f64::from(self.width), f64::from(self.height)),
            parse_vertical_align(anchor_root.get("verticalAlign")),
            plate,
        );
        let span = stacked_span(&placements, &boxes);
        StackLayout {
            anchor: (x, center_y),
            overrides,
            plate_line,
            shared_background,
            placements,
            span,
        }
    }

    /// 几何侧车：当前时刻每条字幕行的画布矩形，供客户端做行命中、选中框与拖拽。
    ///
    /// 与 [`Self::render_subtitle_frame`] 同源（同一次 `active_layouts` +
    /// 同一个 [`Self::stack_layout`]），只是不光栅化。`key` 与 overlay PNG 的
    /// `X-Bcut-Overlay-Key` 是同一个内容键，客户端据此判断「这份几何配不配
    /// 得上手里那张图」。
    pub fn subtitle_layout(&mut self, time: f64) -> Result<SubtitleLayoutFrame> {
        let mut classic = self.subtitle_layout_classic(time)?;
        if self.sequence.is_none() || !(0.0..self.duration).contains(&time) {
            return Ok(classic);
        }
        let Some(plan) = self.ensure_caption_sequence() else {
            return Ok(classic);
        };
        // 键与 `render_subtitle_frame` / `subtitle_scene_frame` 同一条拼法，宿主拿它对帧
        let (frame, sequence_key, _) = self.caption_sequence_frame(&plan, time);
        classic.key = format!("{sequence_key}|{}", classic.key);
        classic.sequence = Some(self.caption_sequence_layout(&plan, &frame));
        Ok(classic)
    }

    fn subtitle_layout_classic(&mut self, time: f64) -> Result<SubtitleLayoutFrame> {
        let (canvas_w, canvas_h) = (self.width, self.height);
        let empty = move |key: String| SubtitleLayoutFrame {
            key,
            width: canvas_w,
            height: canvas_h,
            rotation: 0.0,
            anchor: (0.0, 0.0),
            lines: Vec::new(),
            sequence: None,
        };
        if !(0.0..self.duration).contains(&time) {
            return Ok(empty("blank:outside".to_owned()));
        }
        let layouts = self.active_layouts(time);
        if layouts.is_empty() {
            let next_change = self.next_change_after(time, false);
            return Ok(empty(format!(
                "blank:{}",
                next_change.map_or_else(|| "end".to_owned(), |value| format!("{value:.6}"))
            )));
        }
        let display_start = layouts
            .iter()
            .map(|line| line.item.display_start)
            .fold(f64::INFINITY, f64::min);
        let canvas_scale = f64::from(self.width.min(self.height)) / REFERENCE_SHORT_EDGE
            * finite(self.style.get("scale"), 1.0).max(0.05);
        let (pose, suppressed) = self.transition_pose_at(display_start, time, canvas_scale);
        let key = self.cache_key(&layouts, time, pose, suppressed);
        let stack = self.stack_layout(&layouts, canvas_scale);
        let lines = layouts
            .iter()
            .zip(&stack.placements)
            .zip(&stack.overrides)
            .map(|((line, (center_x, top)), over)| SubtitleLayoutLine {
                kind: match line.kind {
                    LineKind::Original => "orig",
                    LineKind::Translation => "trans",
                },
                cue_id: line.item.id.clone(),
                x: line_start_x(line, line.width, *center_x),
                y: *top,
                w: line.width,
                h: line.height,
                detached: over.is_some(),
            })
            .collect();
        Ok(SubtitleLayoutFrame {
            key,
            width: self.width,
            height: self.height,
            rotation: finite(self.style.get("rotation"), 0.0),
            anchor: stack.anchor,
            lines,
            sequence: None,
        })
    }

    /// R2 第一条字幕实时路径：复用 `active_layouts + stack_layout` 的唯一排版
    /// 结果，把普通单色字形变成 atlas quad。逐词状态只改 run-local uniform，整组
    /// 入场由 `SceneMotion` 在合成期采样；相同 Arc glyph geometry 与 swash mask 命中
    /// TextEngine 限容缓存和 compositor atlas，不再重写字形顶点或光栅整幅 RGBA。
    ///
    /// 当前未覆盖的效果一律返回 [`SubtitleSceneFallback`]，由宿主继续走
    /// [`Self::render_subtitle_frame`]；这使迁移可以逐 pass 扩展而不牺牲像素语义。
    pub fn subtitle_scene_static_fallback(&self) -> Option<SubtitleSceneFallback> {
        self.subtitle_scene_static_fallback_with_target_sampling(false)
    }

    /// 宿主已把真实主画面放进同一可采样 target 时的静态准入判据。
    /// Web/App 透明 overlay 不得调用；只有显式持有 backdrop 的宿主
    /// 才能用它放行 Difference / Exclusion。
    pub fn subtitle_scene_static_fallback_with_backdrop(&self) -> Option<SubtitleSceneFallback> {
        self.subtitle_scene_static_fallback_with_target_sampling(true)
    }

    fn subtitle_scene_static_fallback_with_target_sampling(
        &self,
        allow_target_sampling: bool,
    ) -> Option<SubtitleSceneFallback> {
        // 静态判据：整条轨与每一条逐条覆盖都得过，任一条不行整片回退。
        // 分层文字动画不在这里：它按帧判（`text_motion_active_at`），没有动效
        // cue 活动的帧照常走 glyph scene。
        let includes_original = matches!(self.mode, StudioMode::Original | StudioMode::Bilingual);
        let overrides = match self.look_kind() {
            LineKind::Original => &self.cue_original,
            LineKind::Translation => &self.cue_translation,
        };
        let looks = std::iter::once((&self.track_look, &self.original_style))
            .chain(overrides.values().map(|entry| (&entry.look, &entry.style)));
        for (look, original_style) in looks {
            if matches!(
                look.composite,
                CaptionCompositeMode::Difference | CaptionCompositeMode::Exclusion
            ) && !allow_target_sampling
            {
                return Some(SubtitleSceneFallback::CompositeMode);
            }
            if look.composite != CaptionCompositeMode::Normal
                && !self.group_composite_scene_supported(look)
            {
                return Some(SubtitleSceneFallback::CompositeMode);
            }
            if includes_original && !glyph_uniform_animation_supported(&look.animation) {
                return Some(SubtitleSceneFallback::WordAnimation);
            }
            if includes_original
                && caption_recipe_max_stroke_width(&look.animation, original_style.font_size)
                    > f64::from(element_draw::SCENE_GLYPH_STROKE_WIDTH_LIMIT)
            {
                return Some(SubtitleSceneFallback::WordAnimation);
            }
        }
        None
    }

    /// 非 Normal 模式由外层 retained group 执行；子节点先按 CPU 的
    /// Normal/source-over z 序合入透明层。当前只准入所有子 pass 都有精确 scene
    /// 表达的层型；普通 vector/effect 继续回退。
    fn group_composite_scene_supported(&self, look: &CaptionLook) -> bool {
        if !look.descriptor.is_some_and(|descriptor| {
            matches!(descriptor.layers.as_slice(), [glyphs] if glyphs == "glyphs")
                || matches!(descriptor.layers.as_slice(), [duplicate, glyphs]
                    if duplicate == "glyphDuplicate" && glyphs == "glyphs")
                || matches!(descriptor.layers.as_slice(), [duplicate, scanlines, glyphs]
                    if duplicate == "glyphDuplicate"
                        && scanlines == "scanlines"
                        && glyphs == "glyphs")
                || matches!(descriptor.layers.as_slice(), [particles, glyphs]
                    if particles == "particles" && glyphs == "glyphs")
        }) {
            return false;
        }
        let styles_supported = mode_lines(self.mode, &self.order).into_iter().all(|kind| {
            let (track, overrides) = match kind {
                LineKind::Original => (&self.original_style, &self.cue_original),
                LineKind::Translation => (&self.translation_style, &self.cue_translation),
            };
            std::iter::once(track)
                .chain(overrides.values().map(|entry| &entry.style))
                .all(|style| !style.background_on && !style.underline && !style.effect_on)
        });
        if !styles_supported {
            return false;
        }
        let transition = self.style.get("transition").unwrap_or(&Value::Null);
        let transition_id = transition
            .get("transitionId")
            .or_else(|| transition.get("id"))
            .and_then(Value::as_str)
            .or_else(|| self.style.get("transitionId").and_then(Value::as_str))
            .unwrap_or("none");
        !render_raster::caption_transition(transition_id)
            .is_some_and(|recipe| recipe.channels.iter().any(|channel| channel.prop == "blur"))
    }

    pub fn subtitle_scene_frame(
        &mut self,
        time: f64,
    ) -> std::result::Result<SubtitleSceneFrame, SubtitleSceneFallback> {
        self.subtitle_scene_frame_with_target_sampling(time, false)
    }

    /// 为已经把真实主画面放进同一 GPU target 的宿主生成字幕 scene。
    /// 返回的 Difference / Exclusion 只能交给携带底层纹理且具有
    /// `COPY_SRC` 的 compositor 入口。
    pub fn subtitle_scene_frame_with_backdrop(
        &mut self,
        time: f64,
    ) -> std::result::Result<SubtitleSceneFrame, SubtitleSceneFallback> {
        self.subtitle_scene_frame_with_target_sampling(time, true)
    }

    /// 倒鸭子接管时先画序列层（历史块 / 淡出的上一段 / 当前段），再叠 cue 级的
    /// 译文行；不接管时原样走 cue 级路径。
    fn subtitle_scene_frame_with_target_sampling(
        &mut self,
        time: f64,
        allow_target_sampling: bool,
    ) -> std::result::Result<SubtitleSceneFrame, SubtitleSceneFallback> {
        if self.text_motion_active_at(time) {
            return Err(SubtitleSceneFallback::WordAnimation);
        }
        if self.sequence.is_none() {
            return self.subtitle_scene_frame_classic(time, allow_target_sampling);
        }
        let classic = self.subtitle_scene_frame_classic(time, allow_target_sampling)?;
        if !(0.0..self.duration).contains(&time) {
            return Ok(classic);
        }
        let Some((mut nodes, sequence_key, sequence_next)) = self.caption_sequence_scene(time)?
        else {
            return Ok(classic);
        };
        let key = format!("{sequence_key}|{}", classic.key);
        let next_change = match (sequence_next, classic.scene.next_change) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        };
        nodes.extend(classic.scene.nodes);
        let fingerprint = subtitle_scene_fingerprint(&self.definition_key, &key);
        Ok(SubtitleSceneFrame {
            key,
            scene: element_draw::SceneFrame {
                nodes,
                next_change,
                active_until: classic.scene.active_until,
                fingerprint,
            },
        })
    }

    fn subtitle_scene_frame_classic(
        &mut self,
        time: f64,
        allow_target_sampling: bool,
    ) -> std::result::Result<SubtitleSceneFrame, SubtitleSceneFallback> {
        if let Some(fallback) =
            self.subtitle_scene_static_fallback_with_target_sampling(allow_target_sampling)
        {
            return Err(fallback);
        }
        // CPU 先把整张字幕 source-over 到透明 pixmap，最后才与 backdrop 复合。
        // retained 子节点因此必须保持 Normal，非 Normal 模式只落在外层 group。
        let glyph_composite = element_draw::GlyphCompositeMode::Normal;
        if !(0.0..self.duration).contains(&time) {
            return Ok(SubtitleSceneFrame {
                key: "blank:outside".to_owned(),
                scene: element_draw::SceneFrame {
                    nodes: Vec::new(),
                    next_change: (time < 0.0).then_some(0.0),
                    active_until: None,
                    fingerprint: subtitle_scene_fingerprint(&self.definition_key, "blank:outside"),
                },
            });
        }
        let layouts = self.active_layouts(time);
        if layouts.is_empty() {
            let next_change = self.next_change_after(time, false);
            let key = format!(
                "blank:{}",
                next_change.map_or_else(|| "end".to_owned(), |value| format!("{value:.6}"))
            );
            return Ok(SubtitleSceneFrame {
                scene: element_draw::SceneFrame {
                    nodes: Vec::new(),
                    next_change,
                    active_until: None,
                    fingerprint: subtitle_scene_fingerprint(&self.definition_key, &key),
                },
                key,
            });
        }
        // 这一帧的原文长相：带逐条样式的字幕用它自己的那份。
        let look = self.look_for_layouts(&layouts).clone();
        let scene_composite = match look.composite {
            CaptionCompositeMode::Normal => element_draw::SceneCompositeMode::Normal,
            CaptionCompositeMode::Screen => element_draw::SceneCompositeMode::Screen,
            CaptionCompositeMode::Difference => element_draw::SceneCompositeMode::Difference,
            CaptionCompositeMode::Exclusion => element_draw::SceneCompositeMode::Exclusion,
        };
        let glyph_texture = caption_recipe_glyph_texture(&look.animation);
        let display_start = layouts
            .iter()
            .map(|line| line.item.display_start)
            .fold(f64::INFINITY, f64::min);
        let canvas_scale = f64::from(self.width.min(self.height)) / REFERENCE_SHORT_EDGE
            * finite(self.style.get("scale"), 1.0).max(0.05);
        let (pose, suppressed) = self.transition_pose_at(display_start, time, canvas_scale);
        let key = self.cache_key(&layouts, time, pose, suppressed);
        let stack = self.stack_layout(&layouts, canvas_scale);
        let (center_x, center_y) = stack.anchor;
        let group_tf = group_transform(
            center_x,
            center_y,
            pose.scale_x,
            pose.scale_y,
            finite(self.style.get("rotation"), 0.0),
        );
        let scene_pose = element_draw::ScenePose {
            transform: transform_array(group_tf),
            opacity: pose.opacity as f32,
            blur: pose.blur as f32,
        };
        let scene_motion = pose
            .active
            .then(|| {
                subtitle_scene_motion(
                    &self.style,
                    display_start,
                    canvas_scale,
                    self.fps,
                    stack.anchor,
                    finite(self.style.get("rotation"), 0.0),
                )
            })
            .flatten();
        let background_ops = subtitle_background_ops(&layouts, &stack, &look.animation);
        // recipe 状态只求值一次：除了喂逐词 uniform，textSwap 还决定本帧实际
        // glyph geometry。替字不光栅整幅 RGBA，但必须按项目 fps 的离散 phase
        // 切换受影响字形；把替字签名并入有界 Arc cache 后，相同 phase/seek 会
        // 复用同一份 geometry。
        let word_visuals = subtitle_scene_word_visuals(&layouts, &look.animation);
        let geometry_key =
            subtitle_glyph_geometry_key_with_visuals(&self.definition_key, &layouts, &word_visuals);
        let cached_geometry = self
            .glyph_geometry_cache
            .iter()
            .position(|(cached, _)| *cached == geometry_key)
            .and_then(|index| self.glyph_geometry_cache.remove(index));
        let cached_outline_geometry = self
            .glyph_outline_geometry_cache
            .iter()
            .position(|(cached, _)| *cached == geometry_key)
            .and_then(|index| self.glyph_outline_geometry_cache.remove(index));
        let cached_decoration_geometry = self
            .glyph_decoration_geometry_cache
            .iter()
            .position(|(cached, _)| *cached == geometry_key)
            .and_then(|index| self.glyph_decoration_geometry_cache.remove(index));
        let cached_effect_geometry = self
            .glyph_effect_geometry_cache
            .iter()
            .position(|(cached, _)| *cached == geometry_key)
            .and_then(|index| self.glyph_effect_geometry_cache.remove(index));
        let cached_effect_outline_geometry = self
            .glyph_effect_outline_geometry_cache
            .iter()
            .position(|(cached, _)| *cached == geometry_key)
            .and_then(|index| self.glyph_effect_outline_geometry_cache.remove(index));
        let build_geometry = cached_geometry.is_none();
        let build_outline_geometry = cached_outline_geometry.is_none();
        let build_decoration_geometry = cached_decoration_geometry.is_none();
        let build_effect_geometry = cached_effect_geometry.is_none();
        let build_effect_outline_geometry = cached_effect_outline_geometry.is_none();
        let mut glyphs = Vec::new();
        let mut outline_glyphs = Vec::new();
        let mut decoration_glyphs = Vec::new();
        let mut effect_glyphs = (0..layouts.len()).map(|_| Vec::new()).collect::<Vec<_>>();
        let mut effect_outline_glyphs = (0..layouts.len()).map(|_| Vec::new()).collect::<Vec<_>>();
        let mut uniforms = Vec::new();
        let mut outline_uniforms = Vec::new();
        let mut decoration_uniforms = Vec::new();
        let duplicate_layer_count = caption_recipe_retained_duplicate_layer_count(&look.animation);
        let mut duplicate_uniform_layers = (0..duplicate_layer_count)
            .map(|_| Vec::new())
            .collect::<Vec<_>>();
        let recipe_stroke_layer_count = caption_recipe_retained_stroke_layer_count(&look.animation);
        let mut recipe_stroke_uniform_layers = (0..recipe_stroke_layer_count)
            .map(|_| Vec::new())
            .collect::<Vec<_>>();
        let mut effect_uniforms = (0..layouts.len()).map(|_| Vec::new()).collect::<Vec<_>>();
        let mut word_passes = Vec::new();
        let mut interleave_word_decorations = false;
        let mut word_visuals = word_visuals.into_iter();
        for (layout_index, (layout, (line_center_x, top))) in
            layouts.iter().zip(&stack.placements).enumerate()
        {
            // The classic 19-item word-motion catalogue predates retained glyphs. CPU
            // rasterization applies its block pose after every word pose and before the
            // caption-wide transition. Preserve that exact order in uniforms/DrawOps:
            // geometry remains stable while only these small values change per frame.
            let layout_motion = layout_motion(layout, &look.animation);
            let block_transform = layout_motion
                .as_ref()
                .map_or(Transform::identity(), |frame| {
                    group_transform_for_motion(
                        &frame.block,
                        *line_center_x,
                        *top + layout.height / 2.0,
                        layout.height,
                    )
                });
            let block_opacity = layout_motion
                .as_ref()
                .map_or(1.0, |frame| frame.block.opacity);
            let word_rects = caption_recipe_word_rects(layout, *line_center_x, *top);
            let pill_state = caption_recipe_pill_state(layout, &look.animation);
            let pill_groups = look
                .descriptor
                .filter(|descriptor| descriptor.layers.iter().any(|layer| layer == "pill"))
                .map(|descriptor| {
                    caption_recipe_group_indices(&layout.item.words, descriptor.grouping.as_ref())
                });
            let mut line_top = *top;
            for line in layout.lines.iter() {
                let line_height = line
                    .height
                    .max(layout.style.font_size * layout.style.line_height);
                let mut cursor = line_start_x(layout, line.width, *line_center_x);
                for chunk in &line.chunks {
                    let (part_opacity, part_dx, part_dy) = chunk_part_delta(layout, chunk);
                    let visual = word_visuals
                        .next()
                        .expect("scene word visual 必须与 layout chunk 一一对应");
                    let stable_emoji = (layout.kind == LineKind::Original)
                        .then(|| {
                            let design = look.animation.caption.as_ref()?;
                            let word_index = chunk.word?;
                            caption_recipe_word_emoji(design, &layout.item, word_index)
                        })
                        .flatten()
                        .filter(|emoji| !emoji.is_empty());
                    let opacity = block_opacity
                        * part_opacity
                        * clamp(visual.opacity.unwrap_or(1.0), 0.0, 1.0);
                    let color = visual.color.unwrap_or(layout.style.color);
                    let paint = glyph_uniform_paint(&look.animation, &visual, opacity);
                    let bounce = visual.bottom_em.unwrap_or(0.0) * layout.style.font_size;
                    // 稳定 geometry 已把 glyph 放到未动画的画布坐标。run uniform
                    // 先补 chunk part/bounce，再应用 Designed Caption 的逐词 pose；
                    // compositor 最后才叠 scene_pose。这个顺序与 CPU
                    // `glyph_canvas_transform` 的
                    // `placement -> recipe -> group` 完全相同。
                    let recipe_transform = caption_recipe_transform(
                        layout,
                        chunk,
                        cursor + part_dx,
                        line_top + part_dy,
                        line_height,
                        visual.recipe.as_ref(),
                    );
                    let word_motion_transform = motion_chunk_transform(
                        layout_motion.as_ref(),
                        chunk,
                        cursor,
                        *line_center_x,
                        *top,
                        layout.height,
                        line_top,
                        line_height,
                    );
                    let run_transform =
                        Transform::from_translate(part_dx as f32, (part_dy - bounce) as f32)
                            .post_concat(word_motion_transform)
                            .post_concat(recipe_transform)
                            .post_concat(block_transform);
                    // fragment 在稳定 geometry 的画布坐标上裁剪。CPU 的 mask 先带
                    // part delta、再应用 recipe/group；把 run translate 逆掉后，x/y
                    // part 正好消去，而 bounce 要回补到未动画坐标。
                    let clip = caption_recipe_clip_box(
                        cursor,
                        line_top + bounce,
                        chunk.width,
                        line_height,
                        visual.recipe.as_ref(),
                    )
                    .map(|[x, y, width, height]| {
                        [x as f32, y as f32, (x + width) as f32, (y + height) as f32]
                    });
                    if uniforms.len() >= element_draw::GLYPH_RUN_UNIFORM_LIMIT {
                        return Err(SubtitleSceneFallback::SceneLimit);
                    }
                    let uniform_index = u32::try_from(uniforms.len())
                        .map_err(|_| SubtitleSceneFallback::SceneLimit)?;
                    uniforms.push(element_draw::GlyphRunUniform {
                        transform: transform_array(run_transform),
                        color: glyph_uniform_color(color, opacity),
                        color_opacity: opacity as f32,
                        clip,
                        paint,
                    });
                    outline_uniforms.push(element_draw::GlyphRunUniform {
                        transform: transform_array(run_transform),
                        color: glyph_uniform_color(layout.style.outline_color, opacity),
                        color_opacity: opacity as f32,
                        clip,
                        paint: element_draw::GlyphPaint::Solid,
                    });
                    let emoji_opacity = visual
                        .recipe
                        .as_ref()
                        .and_then(|state| state.emoji.as_deref())
                        .filter(|emoji| !emoji.is_empty())
                        .map_or(0.0, |_| opacity);
                    decoration_uniforms.push(element_draw::GlyphRunUniform {
                        // CPU decoration 接收的是已加 part delta 的 cursor/line_top，
                        // 但不消费 recipe transform 或 bounce。
                        transform: transform_array(Transform::from_translate(
                            part_dx as f32,
                            part_dy as f32,
                        )),
                        color: glyph_uniform_color(SubtitleColor::WHITE, emoji_opacity),
                        color_opacity: emoji_opacity as f32,
                        clip: None,
                        paint: element_draw::GlyphPaint::Solid,
                    });
                    let duplicate_layers = if layout.kind == LineKind::Original {
                        caption_recipe_retained_glyph_duplicate_layers(
                            layout,
                            &look.animation,
                            &visual,
                            opacity,
                        )
                    } else {
                        Vec::new()
                    };
                    let has_duplicate_layers = !duplicate_layers.is_empty();
                    for (layer_index, layer_uniforms) in
                        duplicate_uniform_layers.iter_mut().enumerate()
                    {
                        let (transform, duplicate_color, duplicate_opacity) = duplicate_layers
                            .get(layer_index)
                            .copied()
                            .map_or((run_transform, layout.style.color, 0.0), |duplicate| {
                                let (dx, dy) = glyph_duplicate_canvas_offset(chunk, duplicate);
                                (
                                    Transform::from_translate(dx as f32, dy as f32)
                                        .post_concat(run_transform),
                                    duplicate.color,
                                    duplicate.opacity,
                                )
                            });
                        layer_uniforms.push(element_draw::GlyphRunUniform {
                            transform: transform_array(transform),
                            color: glyph_uniform_color(duplicate_color, duplicate_opacity),
                            color_opacity: duplicate_opacity as f32,
                            clip,
                            paint: element_draw::GlyphPaint::Solid,
                        });
                    }
                    let recipe_strokes = if layout.kind == LineKind::Original {
                        caption_recipe_glyph_stroke_layers(
                            layout,
                            &look.animation,
                            &visual,
                            opacity,
                            true,
                        )
                    } else {
                        Vec::new()
                    };
                    let has_recipe_strokes =
                        layout.kind == LineKind::Original && recipe_stroke_layer_count > 0;
                    for (layer_index, layer_uniforms) in
                        recipe_stroke_uniform_layers.iter_mut().enumerate()
                    {
                        let stroke = recipe_strokes.get(layer_index).copied();
                        let stroke_opacity = stroke.map_or(0.0, |stroke| stroke.opacity);
                        layer_uniforms.push(element_draw::GlyphRunUniform {
                            transform: transform_array(run_transform),
                            color: glyph_uniform_color(
                                stroke.map_or(layout.style.color, |stroke| stroke.color),
                                stroke_opacity,
                            ),
                            color_opacity: stroke_opacity as f32,
                            clip,
                            paint: element_draw::GlyphPaint::DilatedStroke {
                                width: stroke.map_or(0.0, |stroke| stroke.width) as f32,
                            },
                        });
                    }
                    let effect_uniform_index = if layout.style.effect_on {
                        if effect_uniforms[layout_index].len()
                            >= element_draw::GLYPH_RUN_UNIFORM_LIMIT
                        {
                            return Err(SubtitleSceneFallback::SceneLimit);
                        }
                        let index = u32::try_from(effect_uniforms[layout_index].len())
                            .map_err(|_| SubtitleSceneFallback::SceneLimit)?;
                        effect_uniforms[layout_index].push(element_draw::GlyphRunUniform {
                            transform: transform_array(run_transform),
                            color: glyph_uniform_color(
                                layout.style.effect_color,
                                if visual.shadow_off { 0.0 } else { opacity },
                            ),
                            color_opacity: if visual.shadow_off {
                                0.0
                            } else {
                                opacity as f32
                            },
                            clip,
                            paint: element_draw::GlyphPaint::Solid,
                        });
                        Some(index)
                    } else {
                        None
                    };
                    let baseline = glyph_baseline(line_top, line_height, chunk, 0.0);
                    if build_decoration_geometry && let Some(emoji) = stable_emoji.as_deref() {
                        let size = layout.style.font_size * 0.62;
                        let shaped = self.text.shape(emoji, &layout.style.font_name, size, 400);
                        let emoji_x = cursor + chunk.width - layout.style.font_size * 0.08;
                        let emoji_baseline =
                            line_top - layout.style.font_size * 0.52 + shaped.ascent;
                        for glyph in &shaped.glyphs {
                            let transform = Transform::from_translate(
                                (emoji_x + glyph.x) as f32,
                                (emoji_baseline + glyph.y) as f32,
                            );
                            if let Some(mask) =
                                glyph_scene_mask(self.text.glyph_atlas_render(glyph.cache_key))?
                            {
                                decoration_glyphs.push(element_draw::GlyphInstance {
                                    mask,
                                    transform: transform_array(transform),
                                    uniform_index,
                                });
                            }
                        }
                    }
                    let mut before = caption_recipe_rounded_decorations(
                        layout,
                        &look.animation,
                        &visual,
                        chunk.word,
                        cursor + part_dx,
                        chunk.width,
                        line_top + part_dy,
                        line_height,
                        opacity,
                        true,
                    )
                    .into_iter()
                    .map(|decoration| {
                        element_draw::SceneNode::RoundedRect(Arc::new(
                            element_draw::RoundedRectNode {
                                rect: decoration.rect.map(|value| value as f32),
                                radius: decoration.radius as f32,
                                color: subtitle_scene_color(decoration.color, decoration.opacity),
                                pose: scene_pose,
                                motion: scene_motion.clone(),
                            },
                        ))
                    })
                    .collect::<Vec<_>>();
                    interleave_word_decorations |= !before.is_empty();
                    if let Some(plate) = caption_recipe_plate(
                        layout,
                        &look.animation,
                        &visual,
                        chunk,
                        cursor,
                        line_top,
                        line_height,
                        part_opacity,
                        part_dx,
                        part_dy,
                        bounce,
                        &word_rects,
                        pill_state.as_ref(),
                        pill_groups.as_deref(),
                    ) {
                        before.push(element_draw::SceneNode::RoundedRect(Arc::new(
                            element_draw::RoundedRectNode {
                                rect: [
                                    plate.x as f32,
                                    plate.y as f32,
                                    plate.width as f32,
                                    plate.height as f32,
                                ],
                                radius: plate.radius as f32,
                                color: subtitle_scene_color(plate.color, plate.opacity),
                                pose: scene_pose,
                                motion: scene_motion.clone(),
                            },
                        )));
                        interleave_word_decorations = true;
                    } else if visual.recipe.is_none()
                        && let Some(background) = visual.background
                    {
                        let mut frame = FrameOps::default();
                        // 几何与 alpha 都来自 CPU `draw_line_layout` 用的同一对
                        // `classic_word_box` / `classic_word_box_alpha`：块的胀缩
                        // 与块 alpha 在两条渲染链上必须逐字段相同。这里的
                        // `opacity` 已经是 `part_opacity × 词 opacity`，块要的是
                        // `part_opacity × 块 alpha`，所以不能直接复用。
                        let box_rect = classic_word_box(
                            layout.style.font_size,
                            cursor,
                            chunk.width,
                            line_top,
                            line_height,
                            part_dx,
                            part_dy,
                            bounce,
                            &visual,
                        );
                        push_subtitle_word_background(
                            &mut frame,
                            box_rect.x,
                            box_rect.y,
                            box_rect.width,
                            box_rect.height,
                            box_rect.radius,
                            background,
                            block_opacity * part_opacity * classic_word_box_alpha(&visual),
                            word_motion_transform.post_concat(block_transform),
                        );
                        before.push(element_draw::SceneNode::AnimatedVectors {
                            frame: Arc::new(frame),
                            pose: scene_pose,
                            motion: scene_motion.clone(),
                        });
                        interleave_word_decorations = true;
                    }
                    if build_geometry
                        || build_outline_geometry
                        || (effect_uniform_index.is_some()
                            && (build_effect_geometry || build_effect_outline_geometry))
                    {
                        let replacement = visual
                            .recipe
                            .as_ref()
                            .and_then(|state| state.text_swap.as_deref())
                            .map(|text| {
                                self.text.shape(
                                    text,
                                    &chunk.font_name,
                                    chunk.font_size,
                                    chunk.font_weight,
                                )
                            });
                        let shaped = replacement.as_ref().unwrap_or(&chunk.shaped);
                        for (glyph_index, glyph) in shaped.glyphs.iter().enumerate() {
                            let glyph_x =
                                cursor + glyph.x + glyph_index as f64 * layout.style.letter_spacing;
                            let transform = glyph_canvas_transform(
                                chunk,
                                glyph_x,
                                baseline + glyph.y,
                                Transform::identity(),
                                Transform::identity(),
                            );
                            if build_geometry {
                                if let Some(mask) =
                                    glyph_scene_mask(self.text.glyph_atlas_render(glyph.cache_key))?
                                {
                                    glyphs.push(element_draw::GlyphInstance {
                                        mask,
                                        transform: transform_array(transform),
                                        uniform_index,
                                    });
                                }
                            }
                            if build_outline_geometry
                                && layout.style.outline_on
                                && layout.style.outline_width > 0.0
                                && let Some(mask) =
                                    glyph_scene_mask(self.text.glyph_stroke_atlas_render(
                                        glyph.cache_key,
                                        layout.style.outline_width as f32,
                                    ))?
                            {
                                outline_glyphs.push(element_draw::GlyphInstance {
                                    mask,
                                    transform: transform_array(transform),
                                    uniform_index,
                                });
                            }
                            if let Some(effect_uniform_index) = effect_uniform_index {
                                let effect_transform = Transform::from_translate(
                                    layout.style.effect_x as f32,
                                    layout.style.effect_y as f32,
                                )
                                .post_concat(transform);
                                if build_effect_outline_geometry
                                    && layout.style.outline_on
                                    && layout.style.outline_width > 0.0
                                    && let Some(mask) =
                                        glyph_scene_mask(self.text.glyph_stroke_atlas_render(
                                            glyph.cache_key,
                                            layout.style.outline_width as f32,
                                        ))?
                                {
                                    effect_outline_glyphs[layout_index].push(
                                        element_draw::GlyphInstance {
                                            mask,
                                            transform: transform_array(effect_transform),
                                            uniform_index: effect_uniform_index,
                                        },
                                    );
                                }
                                if build_effect_geometry
                                    && let Some(mask) = glyph_scene_effect_mask(
                                        self.text.glyph_atlas_render(glyph.cache_key),
                                    )?
                                {
                                    effect_glyphs[layout_index].push(element_draw::GlyphInstance {
                                        mask,
                                        transform: transform_array(effect_transform),
                                        uniform_index: effect_uniform_index,
                                    });
                                }
                            }
                        }
                    }
                    let effective_underline = visual.underline.unwrap_or(layout.style.underline);
                    let mut after = FrameOps::default();
                    if effective_underline {
                        push_subtitle_underline(
                            &mut after,
                            cursor + part_dx,
                            baseline
                                + layout.style.font_size
                                    * visual.underline_offset_em.unwrap_or(0.10)
                                + part_dy
                                - bounce,
                            chunk.width,
                            layout.style.font_size,
                            color,
                            opacity,
                            block_transform,
                        );
                    }
                    interleave_word_decorations |= effective_underline != layout.style.underline;
                    word_passes.push(SubtitleWordPass {
                        uniform_index,
                        before,
                        after,
                        duplicate: has_duplicate_layers,
                        recipe_stroke: has_recipe_strokes,
                        emoji: stable_emoji.is_some(),
                    });
                    interleave_word_decorations |=
                        has_duplicate_layers || has_recipe_strokes || stable_emoji.is_some();
                    cursor += chunk.width;
                }
                line_top += line_height + line.gap_after;
            }
        }
        debug_assert!(word_visuals.next().is_none());
        let geometry = if let Some((_, geometry)) = cached_geometry {
            self.glyph_geometry_cache
                .push_front((geometry_key.clone(), Arc::clone(&geometry)));
            geometry
        } else {
            let geometry: Arc<[element_draw::GlyphInstance]> = glyphs.into();
            self.glyph_geometry_cache
                .push_front((geometry_key.clone(), Arc::clone(&geometry)));
            while self.glyph_geometry_cache.len() > 12 {
                self.glyph_geometry_cache.pop_back();
            }
            geometry
        };
        let duplicate_geometry = duplicate_glyph_geometry(
            &geometry_key,
            &geometry,
            &mut self.glyph_segment_geometry_cache,
        );
        let decoration_geometry = if let Some((_, geometry)) = cached_decoration_geometry {
            self.glyph_decoration_geometry_cache
                .push_front((geometry_key.clone(), Arc::clone(&geometry)));
            geometry
        } else {
            let geometry: Arc<[element_draw::GlyphInstance]> = decoration_glyphs.into();
            self.glyph_decoration_geometry_cache
                .push_front((geometry_key.clone(), Arc::clone(&geometry)));
            while self.glyph_decoration_geometry_cache.len() > 12 {
                self.glyph_decoration_geometry_cache.pop_back();
            }
            geometry
        };
        let outline_geometry = if let Some((_, geometry)) = cached_outline_geometry {
            self.glyph_outline_geometry_cache
                .push_front((geometry_key.clone(), Arc::clone(&geometry)));
            geometry
        } else {
            let geometry: Arc<[element_draw::GlyphInstance]> = outline_glyphs.into();
            self.glyph_outline_geometry_cache
                .push_front((geometry_key.clone(), Arc::clone(&geometry)));
            while self.glyph_outline_geometry_cache.len() > 12 {
                self.glyph_outline_geometry_cache.pop_back();
            }
            geometry
        };
        let effect_geometry = if let Some((_, geometry)) = cached_effect_geometry {
            self.glyph_effect_geometry_cache
                .push_front((geometry_key.clone(), Arc::clone(&geometry)));
            geometry
        } else {
            let geometry: Arc<[Arc<[element_draw::GlyphInstance]>]> = effect_glyphs
                .into_iter()
                .map(Arc::<[element_draw::GlyphInstance]>::from)
                .collect::<Vec<_>>()
                .into();
            self.glyph_effect_geometry_cache
                .push_front((geometry_key.clone(), Arc::clone(&geometry)));
            while self.glyph_effect_geometry_cache.len() > 12 {
                self.glyph_effect_geometry_cache.pop_back();
            }
            geometry
        };
        let effect_outline_geometry = if let Some((_, geometry)) = cached_effect_outline_geometry {
            self.glyph_effect_outline_geometry_cache
                .push_front((geometry_key.clone(), Arc::clone(&geometry)));
            geometry
        } else {
            let geometry: Arc<[Arc<[element_draw::GlyphInstance]>]> = effect_outline_glyphs
                .into_iter()
                .map(Arc::<[element_draw::GlyphInstance]>::from)
                .collect::<Vec<_>>()
                .into();
            self.glyph_effect_outline_geometry_cache
                .push_front((geometry_key.clone(), Arc::clone(&geometry)));
            while self.glyph_effect_outline_geometry_cache.len() > 12 {
                self.glyph_effect_outline_geometry_cache.pop_back();
            }
            geometry
        };
        let mut nodes = Vec::with_capacity(3 + layouts.len());
        if !background_ops.ops.is_empty() {
            if scene_pose == element_draw::ScenePose::IDENTITY && scene_motion.is_none() {
                nodes.push(element_draw::SceneNode::Vectors(Arc::new(background_ops)));
            } else {
                nodes.push(element_draw::SceneNode::AnimatedVectors {
                    frame: Arc::new(background_ops),
                    pose: scene_pose,
                    motion: scene_motion.clone(),
                });
            }
        }
        for (layout_index, layout) in layouts.iter().enumerate() {
            if !layout.style.effect_on {
                continue;
            }
            let mut layers = Vec::with_capacity(2);
            if !effect_outline_geometry[layout_index].is_empty() {
                layers.push(Arc::new(element_draw::GlyphRun {
                    glyphs: Arc::clone(&effect_outline_geometry[layout_index]),
                    uniforms: effect_uniforms[layout_index].clone(),
                    texture: None,
                    composite: element_draw::GlyphCompositeMode::Normal,
                    pose: scene_pose,
                    motion: scene_motion.clone(),
                }));
            }
            if !effect_geometry[layout_index].is_empty() {
                layers.push(Arc::new(element_draw::GlyphRun {
                    glyphs: Arc::clone(&effect_geometry[layout_index]),
                    uniforms: effect_uniforms[layout_index].clone(),
                    texture: None,
                    composite: element_draw::GlyphCompositeMode::Normal,
                    pose: scene_pose,
                    motion: scene_motion.clone(),
                }));
            }
            if !layers.is_empty() {
                nodes.push(element_draw::SceneNode::BlurredGlyphs(Arc::new(
                    element_draw::GlyphEffect {
                        layers,
                        radius: layout
                            .style
                            .effect_blur
                            .round()
                            .clamp(0.0, f64::from(element_draw::SCENE_BLUR_RADIUS_LIMIT))
                            as u32,
                    },
                )));
            }
        }
        if interleave_word_decorations {
            if word_passes.len() > SUBTITLE_INTERLEAVED_RUN_LIMIT {
                return Err(SubtitleSceneFallback::SceneLimit);
            }
            push_interleaved_word_nodes(
                &mut nodes,
                word_passes,
                &geometry_key,
                &outline_geometry,
                &geometry,
                &duplicate_geometry,
                &decoration_geometry,
                &outline_uniforms,
                &uniforms,
                &duplicate_uniform_layers,
                &recipe_stroke_uniform_layers,
                &decoration_uniforms,
                glyph_texture.as_ref(),
                scene_pose,
                scene_motion.as_ref(),
                glyph_composite,
                &mut self.glyph_segment_geometry_cache,
            );
        } else {
            if !outline_geometry.is_empty() {
                nodes.push(element_draw::SceneNode::Glyphs(Arc::new(
                    element_draw::GlyphRun {
                        glyphs: outline_geometry,
                        uniforms: outline_uniforms,
                        texture: None,
                        composite: glyph_composite,
                        pose: scene_pose,
                        motion: scene_motion.clone(),
                    },
                )));
            }
            if !geometry.is_empty() {
                nodes.push(element_draw::SceneNode::Glyphs(Arc::new(
                    element_draw::GlyphRun {
                        glyphs: geometry,
                        uniforms,
                        texture: glyph_texture,
                        composite: glyph_composite,
                        pose: scene_pose,
                        motion: scene_motion.clone(),
                    },
                )));
            }
            let mut underline_ops = FrameOps::default();
            for pass in word_passes {
                underline_ops.ops.extend(pass.after.ops);
            }
            if !underline_ops.ops.is_empty() {
                nodes.push(element_draw::SceneNode::AnimatedVectors {
                    frame: Arc::new(underline_ops),
                    pose: scene_pose,
                    motion: scene_motion.clone(),
                });
            }
        }
        let nodes = if scene_composite != element_draw::SceneCompositeMode::Normal
            || pose.blur > 0.001
            || scene_motion
                .as_ref()
                .is_some_and(|motion| motion.from.blur > 0.001 || motion.to.blur > 0.001)
        {
            vec![element_draw::SceneNode::BlurredGroup(Arc::new(
                element_draw::BlurredGroup {
                    nodes,
                    radius: pose.blur as f32,
                    motion: scene_motion.clone(),
                    reveal: None,
                    composite: scene_composite,
                },
            ))]
        } else {
            nodes
        };
        let motion_end = scene_motion.as_ref().map(|motion| motion.end);
        // Designed Caption 的 recipe resolver 在项目 fps 网格上产出逐词 uniform。
        // 它不重光栅整幅字幕，但宿主仍须在下一个离散样本重建 uniforms；普通字幕
        // 与已下沉的整组 transition motion 继续只报真实边界。
        let next_change = min_optional_time(
            self.next_change_after(time, self.per_frame_subtitle(false)),
            motion_end,
        );
        let active_until = motion_end
            .map(|end| next_change.unwrap_or(end).min(end))
            .filter(|end| *end > time + 1e-9);
        Ok(SubtitleSceneFrame {
            scene: element_draw::SceneFrame {
                nodes,
                next_change,
                active_until,
                fingerprint: subtitle_scene_fingerprint(&self.definition_key, &key),
            },
            key,
        })
    }

    /// R3 的普通文字元素 retained scene 出口。排版、折行、字形 mask、底板、
    /// 描边与 shadow/glow 全部复用 [`Self::render_text_element`] 的同一组
    /// `LineLayout` / `TextEngine` 结果；这里只把最终执行从整幅 Pixmap 换成
    /// renderer-neutral vector + glyph nodes。
    ///
    /// 元素动画仍由 [`timeline::resolve_text_animation`] 在项目 fps 网格上
    /// 采样：容器姿态只改 [`element_draw::ScenePose`]，级联文字只改 run-local
    /// uniform，字形 mask 不会逐帧重光栅。`next_change` 与 CPU overlay 共用
    /// [`Self::element_next_change`]。
    pub fn text_element_scene_frame_for(
        &mut self,
        element_id: &str,
        time: f64,
    ) -> Result<element_draw::SceneFrame> {
        let element = self
            .elements
            .iter()
            .find(|element| element.id == element_id && element.kind == ElementKind::Text)
            .cloned()
            .with_context(|| format!("text element {element_id} 不存在"))?;
        let time = time.clamp(0.0, self.duration.max(0.0));
        let active = time >= element.start && time < element.end;
        let nodes = if active {
            self.text_element_scene_nodes(&element, time)
                .map_err(|error| anyhow!(error))?
        } else {
            Vec::new()
        };
        let active_elements = active.then_some(element).into_iter().collect::<Vec<_>>();
        let next_change = self.element_next_change(time, &active_elements);
        let key = format!("text:{element_id}:{time:.6}");
        Ok(element_draw::SceneFrame {
            nodes,
            next_change,
            active_until: None,
            fingerprint: subtitle_scene_fingerprint(&self.definition_key, &key),
        })
    }

    pub fn text_element_scene_frame(
        &mut self,
        time: f64,
    ) -> std::result::Result<element_draw::SceneFrame, SubtitleSceneFallback> {
        let time = time.clamp(0.0, self.duration.max(0.0));
        let active = self
            .elements
            .iter()
            .filter(|element| {
                element.kind == ElementKind::Text && time >= element.start && time < element.end
            })
            .cloned()
            .collect::<Vec<_>>();
        let next_change = self.element_next_change(time, &active);
        let mut nodes = Vec::new();
        let mut identity = String::new();
        for element in &active {
            identity.push_str(&element.id);
            identity.push('\u{1f}');
            if element.has_visual_keyframes() {
                let mut element = element.clone();
                element.keyframe_place(time);
                identity.push_str(&format!("{:?}\u{1f}", element.place));
                nodes.extend(self.text_element_scene_nodes(&element, time)?);
            } else {
                nodes.extend(self.text_element_scene_nodes(element, time)?);
            }
        }
        let key = format!("texts:{time:.6}:{identity}");
        Ok(element_draw::SceneFrame {
            nodes,
            next_change,
            active_until: None,
            fingerprint: subtitle_scene_fingerprint(&self.definition_key, &key),
        })
    }

    fn text_element_scene_nodes(
        &mut self,
        element: &TimelineVisualElement,
        time: f64,
    ) -> std::result::Result<Vec<element_draw::SceneNode>, SubtitleSceneFallback> {
        if element.style["textMotion"].is_object() || element.style["wordBackground"].is_object() {
            return Err(SubtitleSceneFallback::WordAnimation);
        }
        let mut style = resolve_line_style(
            &element.style,
            LineKind::Original,
            self.width,
            self.height,
            false,
        );
        let item = TimedItem {
            id: element.id.clone(),
            series_index: 0,
            text: element_display_text(element, time),
            display_start: element.start,
            display_end: element.end,
            words: Vec::new(),
        };
        let wrap_width = element.place.w.map_or_else(
            || f64::from(self.width) * 0.9,
            |width| f64::from(self.width) * width.max(1.0) / 100.0,
        );
        text_element_block_plate(&mut style, element, wrap_width);
        let display_text = transform_text(&item.text, &style.text_transform);
        let animation = timeline::resolve_text_animation(
            element.animation.as_ref(),
            element.start,
            Some(element.end),
            self.duration,
            time,
            self.fps,
            &display_text,
        );
        let interleave_animated_underlines = style.underline && !animation.ranges.is_empty();
        let pose = animation.container;
        let part_ranges = (!animation.ranges.is_empty()).then_some(animation.ranges.as_slice());
        let (lines, width) = layout_text(&mut self.text, &item, &style, wrap_width, part_ranges);
        let lines: Arc<[LayoutLine]> = lines.into();
        let layout = LineLayout {
            kind: LineKind::Original,
            height: layout_lines_height(&lines),
            width,
            align_width: wrap_width,
            text_align: LineTextAlign::from_style(&element.style),
            style,
            item,
            lines,
            current_word: 0,
            render_time: time,
            render_fps: self.fps,
            animation_parts: animation.parts,
            animation_short_edge: f64::from(self.width.min(self.height)),
            preview: false,
            karaoke_words: None,
            guide_below: false,
        };
        let base_x = f64::from(self.width) * element.place.x.unwrap_or(50.0) / 100.0;
        let base_y = f64::from(self.height) * element.place.y.unwrap_or(50.0) / 100.0;
        let short = f64::from(self.width.min(self.height));
        let x = base_x + pose.dx * short;
        let y = base_y + pose.dy * short;
        let scale = element.place.scale.unwrap_or(1.0);
        // 第 122 轮 D2：`scaleY` 是**乘在 `scale` 之上**的纵向倍率（缺席 = 1），
        // 不是「替代 `scale` 的纵向分量」——缺席时两式同值，老文档逐字节不变。
        let scale_y = scale * element.place.scale_y.unwrap_or(1.0);
        let rotation = element.place.rot.unwrap_or(0.0) + pose.rotation;
        let opacity = element.place.opacity.unwrap_or(1.0) * pose.opacity;
        let tile = element.tile.as_ref().filter(|tile| tile.on);
        let gap_x = tile.and_then(|tile| tile.gap_x).unwrap_or(8.0);
        let gap_y = tile.and_then(|tile| tile.gap_y).unwrap_or(10.0);
        let step_x = (layout.width + f64::from(self.width) * gap_x / 100.0).max(1.0);
        let step_y = (layout.height + f64::from(self.height) * gap_y / 100.0).max(1.0);
        let centers = if let Some(tile) = tile {
            let mut centers = Vec::new();
            let cols = (f64::from(self.width) / step_x).ceil() as i32 + 3;
            let rows = (f64::from(self.height) / step_y).ceil() as i32 + 3;
            for row in -rows..=rows {
                let stagger = if tile.stagger.unwrap_or(true) && row.rem_euclid(2) != 0 {
                    step_x / 2.0
                } else {
                    0.0
                };
                for column in -cols..=cols {
                    centers.push((
                        x + f64::from(column) * step_x + stagger,
                        y + f64::from(row) * step_y,
                        rotation + tile.angle.unwrap_or(-30.0),
                    ));
                }
            }
            centers
        } else {
            vec![(x, y, rotation)]
        };

        struct CrispChunkPass {
            outline_glyphs: Vec<element_draw::GlyphInstance>,
            glyphs: Vec<element_draw::GlyphInstance>,
            outline_uniform: element_draw::GlyphRunUniform,
            fill_uniform: element_draw::GlyphRunUniform,
            underline: FrameOps,
        }

        let mut nodes = Vec::new();
        for (center_x, center_y, rotation) in centers {
            let scene_pose = element_draw::ScenePose {
                transform: transform_array(group_transform(
                    center_x,
                    center_y,
                    scale * pose.scale_x,
                    scale_y * pose.scale_y,
                    rotation,
                )),
                opacity: opacity.clamp(0.0, 1.0) as f32,
                blur: pose.blur.max(0.0) as f32,
            };
            let pad_v = layout.style.background_pad_v;
            let top = anchor_block(
                center_y,
                layout.height + pad_v * 2.0,
                element.vertical_align.unwrap_or(VerticalAlign::Center),
            ) + pad_v;
            let mut stamp_nodes = Vec::new();
            if layout.style.background_on {
                let mut background = FrameOps::default();
                for rect in line_background_rects(&layout, center_x, top) {
                    push_subtitle_plate(
                        &mut background,
                        rect,
                        layout.style.background_color,
                        1.0,
                        Transform::identity(),
                    );
                }
                if !background.ops.is_empty() {
                    stamp_nodes.push(element_draw::SceneNode::AnimatedVectors {
                        frame: Arc::new(background),
                        pose: scene_pose,
                        motion: None,
                    });
                }
            }

            let mut glyphs = Vec::new();
            let mut outline_glyphs = Vec::new();
            let mut effect_glyphs = Vec::new();
            let mut effect_outline_glyphs = Vec::new();
            let mut uniforms = Vec::new();
            let mut outline_uniforms = Vec::new();
            let mut effect_uniforms = Vec::new();
            let mut underline_ops = FrameOps::default();
            let mut crisp_chunk_passes = Vec::new();
            let mut line_top = top;
            for line in layout.lines.iter() {
                let line_height = line
                    .height
                    .max(layout.style.font_size * layout.style.line_height);
                let mut cursor = line_start_x(&layout, line.width, center_x);
                for chunk in &line.chunks {
                    if uniforms.len() >= element_draw::GLYPH_RUN_UNIFORM_LIMIT {
                        return Err(SubtitleSceneFallback::SceneLimit);
                    }
                    let (part_opacity, part_dx, part_dy) = chunk_part_delta(&layout, chunk);
                    let uniform_index = u32::try_from(uniforms.len())
                        .map_err(|_| SubtitleSceneFallback::SceneLimit)?;
                    let run_transform = Transform::from_translate(part_dx as f32, part_dy as f32);
                    let fill_uniform = element_draw::GlyphRunUniform {
                        transform: transform_array(run_transform),
                        color: glyph_uniform_color(layout.style.color, part_opacity),
                        color_opacity: part_opacity as f32,
                        clip: None,
                        paint: element_draw::GlyphPaint::Solid,
                    };
                    let outline_uniform = element_draw::GlyphRunUniform {
                        transform: transform_array(run_transform),
                        color: glyph_uniform_color(layout.style.outline_color, part_opacity),
                        color_opacity: part_opacity as f32,
                        clip: None,
                        paint: element_draw::GlyphPaint::Solid,
                    };
                    uniforms.push(fill_uniform);
                    outline_uniforms.push(outline_uniform);
                    if layout.style.effect_on {
                        effect_uniforms.push(element_draw::GlyphRunUniform {
                            transform: transform_array(run_transform),
                            color: glyph_uniform_color(layout.style.effect_color, part_opacity),
                            color_opacity: part_opacity as f32,
                            clip: None,
                            paint: element_draw::GlyphPaint::Solid,
                        });
                    }
                    let crisp_uniform_index = if interleave_animated_underlines {
                        0
                    } else {
                        uniform_index
                    };
                    let mut chunk_glyphs = Vec::new();
                    let mut chunk_outline_glyphs = Vec::new();
                    let baseline = glyph_baseline(line_top, line_height, chunk, 0.0);
                    for (glyph_index, glyph) in chunk.shaped.glyphs.iter().enumerate() {
                        let glyph_x =
                            cursor + glyph.x + glyph_index as f64 * layout.style.letter_spacing;
                        let transform = glyph_canvas_transform(
                            chunk,
                            glyph_x,
                            baseline + glyph.y,
                            Transform::identity(),
                            Transform::identity(),
                        );
                        if let Some(mask) =
                            glyph_scene_mask(self.text.glyph_atlas_render(glyph.cache_key))?
                        {
                            chunk_glyphs.push(element_draw::GlyphInstance {
                                mask,
                                transform: transform_array(transform),
                                uniform_index: crisp_uniform_index,
                            });
                        }
                        if layout.style.outline_on
                            && layout.style.outline_width > 0.0
                            && let Some(mask) =
                                glyph_scene_mask(self.text.glyph_stroke_atlas_render(
                                    glyph.cache_key,
                                    layout.style.outline_width as f32,
                                ))?
                        {
                            chunk_outline_glyphs.push(element_draw::GlyphInstance {
                                mask,
                                transform: transform_array(transform),
                                uniform_index: crisp_uniform_index,
                            });
                        }
                        if layout.style.effect_on {
                            let effect_transform = Transform::from_translate(
                                layout.style.effect_x as f32,
                                layout.style.effect_y as f32,
                            )
                            .post_concat(transform);
                            if let Some(mask) = glyph_scene_effect_mask(
                                self.text.glyph_atlas_render(glyph.cache_key),
                            )? {
                                effect_glyphs.push(element_draw::GlyphInstance {
                                    mask,
                                    transform: transform_array(effect_transform),
                                    uniform_index,
                                });
                            }
                            if layout.style.outline_on
                                && layout.style.outline_width > 0.0
                                && let Some(mask) =
                                    glyph_scene_mask(self.text.glyph_stroke_atlas_render(
                                        glyph.cache_key,
                                        layout.style.outline_width as f32,
                                    ))?
                            {
                                effect_outline_glyphs.push(element_draw::GlyphInstance {
                                    mask,
                                    transform: transform_array(effect_transform),
                                    uniform_index,
                                });
                            }
                        }
                    }
                    let mut chunk_underline = FrameOps::default();
                    if layout.style.underline {
                        push_subtitle_underline(
                            &mut chunk_underline,
                            cursor + part_dx,
                            baseline + layout.style.font_size * 0.10 + part_dy,
                            chunk.width,
                            layout.style.font_size,
                            layout.style.color,
                            part_opacity,
                            Transform::identity(),
                        );
                    }
                    if interleave_animated_underlines {
                        crisp_chunk_passes.push(CrispChunkPass {
                            outline_glyphs: chunk_outline_glyphs,
                            glyphs: chunk_glyphs,
                            outline_uniform,
                            fill_uniform,
                            underline: chunk_underline,
                        });
                    } else {
                        outline_glyphs.extend(chunk_outline_glyphs);
                        glyphs.extend(chunk_glyphs);
                        underline_ops.ops.extend(chunk_underline.ops);
                    }
                    cursor += chunk.width;
                }
                line_top += line_height + line.gap_after;
            }

            if layout.style.effect_on {
                let mut layers = Vec::with_capacity(2);
                if !effect_outline_glyphs.is_empty() {
                    layers.push(Arc::new(element_draw::GlyphRun {
                        glyphs: effect_outline_glyphs.into(),
                        uniforms: effect_uniforms.clone(),
                        texture: None,
                        composite: element_draw::GlyphCompositeMode::Normal,
                        pose: scene_pose,
                        motion: None,
                    }));
                }
                if !effect_glyphs.is_empty() {
                    layers.push(Arc::new(element_draw::GlyphRun {
                        glyphs: effect_glyphs.into(),
                        uniforms: effect_uniforms,
                        texture: None,
                        composite: element_draw::GlyphCompositeMode::Normal,
                        pose: scene_pose,
                        motion: None,
                    }));
                }
                if !layers.is_empty() {
                    stamp_nodes.push(element_draw::SceneNode::BlurredGlyphs(Arc::new(
                        element_draw::GlyphEffect {
                            layers,
                            radius: layout
                                .style
                                .effect_blur
                                .round()
                                .clamp(0.0, f64::from(element_draw::SCENE_BLUR_RADIUS_LIMIT))
                                as u32,
                        },
                    )));
                }
            }
            if interleave_animated_underlines {
                for pass in crisp_chunk_passes {
                    if !pass.outline_glyphs.is_empty() {
                        stamp_nodes.push(element_draw::SceneNode::Glyphs(Arc::new(
                            element_draw::GlyphRun {
                                glyphs: pass.outline_glyphs.into(),
                                uniforms: vec![pass.outline_uniform],
                                texture: None,
                                composite: element_draw::GlyphCompositeMode::Normal,
                                pose: scene_pose,
                                motion: None,
                            },
                        )));
                    }
                    if !pass.glyphs.is_empty() {
                        stamp_nodes.push(element_draw::SceneNode::Glyphs(Arc::new(
                            element_draw::GlyphRun {
                                glyphs: pass.glyphs.into(),
                                uniforms: vec![pass.fill_uniform],
                                texture: None,
                                composite: element_draw::GlyphCompositeMode::Normal,
                                pose: scene_pose,
                                motion: None,
                            },
                        )));
                    }
                    if !pass.underline.ops.is_empty() {
                        stamp_nodes.push(element_draw::SceneNode::AnimatedVectors {
                            frame: Arc::new(pass.underline),
                            pose: scene_pose,
                            motion: None,
                        });
                    }
                }
            } else {
                if !outline_glyphs.is_empty() {
                    stamp_nodes.push(element_draw::SceneNode::Glyphs(Arc::new(
                        element_draw::GlyphRun {
                            glyphs: outline_glyphs.into(),
                            uniforms: outline_uniforms,
                            texture: None,
                            composite: element_draw::GlyphCompositeMode::Normal,
                            pose: scene_pose,
                            motion: None,
                        },
                    )));
                }
                if !glyphs.is_empty() {
                    stamp_nodes.push(element_draw::SceneNode::Glyphs(Arc::new(
                        element_draw::GlyphRun {
                            glyphs: glyphs.into(),
                            uniforms,
                            texture: None,
                            composite: element_draw::GlyphCompositeMode::Normal,
                            pose: scene_pose,
                            motion: None,
                        },
                    )));
                }
                if !underline_ops.ops.is_empty() {
                    stamp_nodes.push(element_draw::SceneNode::AnimatedVectors {
                        frame: Arc::new(underline_ops),
                        pose: scene_pose,
                        motion: None,
                    });
                }
            }
            nodes.extend(stamp_nodes);
            if nodes.len() > element_draw::SCENE_NODE_LIMIT {
                return Err(SubtitleSceneFallback::SceneLimit);
            }
        }
        if pose.blur > 0.001 || pose.reveal.is_some() {
            nodes = vec![element_draw::SceneNode::BlurredGroup(Arc::new(
                element_draw::BlurredGroup {
                    nodes,
                    radius: pose.blur as f32,
                    motion: None,
                    reveal: pose.reveal.map(|reveal| reveal as f32),
                    composite: element_draw::SceneCompositeMode::Normal,
                },
            ))];
        }
        Ok(nodes)
    }

    /// 浏览器合成器的 CPU 字幕层：[`Self::render_subtitle_frame`] 的
    /// straight-alpha 非零子矩形形态。
    ///
    /// glyph scene 覆盖不到的样式（[`SubtitleSceneFallback`]）必须整幅回退 CPU
    /// overlay，桌面宿主走 `render_rgba_frame`，浏览器走这里；两条路同一份排版。
    pub fn render_subtitle_raster_layer(&mut self, time: f64) -> Result<SubtitleRasterLayer> {
        let frame = self.render_subtitle_frame(time)?;
        let Some(bounds) = frame.bounds.clone() else {
            return Ok(SubtitleRasterLayer {
                key: frame.key,
                x: 0,
                y: 0,
                width: 0,
                height: 0,
                rgba: Vec::new(),
                next_change: frame.next_change,
                composite: frame.composite,
            });
        };
        let stride = self.width as usize;
        let (rows, cols) = (bounds.rows, bounds.cols);
        let mut rgba = Vec::with_capacity((rows.end - rows.start) * (cols.end - cols.start) * 4);
        for y in rows.clone() {
            rgba.extend_from_slice(
                &frame.rgba[(y * stride + cols.start) * 4..(y * stride + cols.end) * 4],
            );
        }
        demultiply_rgba_in_place(&mut rgba);
        Ok(SubtitleRasterLayer {
            key: frame.key,
            x: cols.start as u32,
            y: rows.start as u32,
            width: (cols.end - cols.start) as u32,
            height: (rows.end - rows.start) as u32,
            rgba,
            next_change: frame.next_change,
            composite: frame.composite,
        })
    }

    /// 浏览器合成器的模板层：[`Self::template_frame`] 的 straight-alpha 非零子矩形。
    ///
    /// 桌面宿主把同一张 Pixmap 作为 `tplchrome:` 动态资源并进 overlay；浏览器的
    /// GPU 场景没有这类宿主光栅节点，于是和 CPU 字幕层一样单独交付、叠在最上层
    /// （`RESERVED_Z`：模板前景恒在正片、元素与字幕之上）。`None` = 没套模板。
    ///
    /// 键带**这一帧的像素身份**：章节条与进度线逐帧在动，只看场景指纹会把
    /// 变了的画面宣称成没变（与 `tplchrome:` 资源名同一个道理）。
    pub fn render_template_raster_layer(
        &mut self,
        time: f64,
    ) -> Result<Option<SubtitleRasterLayer>> {
        let Some((fingerprint, next_change)) = self
            .chrome
            .as_ref()
            .map(|chrome| (chrome.fingerprint, chrome.next_change(time, self.fps)))
        else {
            return Ok(None);
        };
        let Some(pixmap) = self.template_frame(time)? else {
            return Ok(None);
        };
        let (width, height) = (self.width as usize, self.height as usize);
        let data = pixmap.data();
        let (mut top, mut bottom, mut left, mut right) = (height, 0, width, 0);
        for y in 0..height {
            let row = &data[y * width * 4..(y + 1) * width * 4];
            let Some(first) = row.chunks_exact(4).position(|pixel| pixel[3] != 0) else {
                continue;
            };
            let last = row
                .chunks_exact(4)
                .rposition(|pixel| pixel[3] != 0)
                .unwrap_or(first);
            top = top.min(y);
            bottom = y + 1;
            left = left.min(first);
            right = right.max(last + 1);
        }
        if top >= bottom {
            return Ok(Some(SubtitleRasterLayer {
                key: format!("tplchrome:{fingerprint:016x}:blank"),
                x: 0,
                y: 0,
                width: 0,
                height: 0,
                rgba: Vec::new(),
                next_change,
                composite: CaptionCompositeMode::Normal,
            }));
        }
        let mut rgba = Vec::with_capacity((bottom - top) * (right - left) * 4);
        for y in top..bottom {
            rgba.extend_from_slice(&data[(y * width + left) * 4..(y * width + right) * 4]);
        }
        let stamp = render_raster::drawop::fnv1a64(&rgba);
        demultiply_rgba_in_place(&mut rgba);
        Ok(Some(SubtitleRasterLayer {
            key: format!("tplchrome:{fingerprint:016x}:{left},{top},{right},{bottom}:{stamp:016x}"),
            x: left as u32,
            y: top as u32,
            width: (right - left) as u32,
            height: (bottom - top) as u32,
            rgba,
            next_change,
            composite: CaptionCompositeMode::Normal,
        }))
    }

    /// 一帧字幕透明层。倒鸭子接管时：序列层自绘一幅，再把 cue 级（译文）帧叠上去，
    /// 结果按「序列状态键 | cue 级键」缓存；不接管时原样走 cue 级路径。
    pub fn render_subtitle_frame(&mut self, time: f64) -> Result<RenderedSubtitleFrame> {
        if self.sequence.is_none() || !(0.0..self.duration).contains(&time) {
            return self.render_subtitle_frame_classic(time);
        }
        let Some(plan) = self.ensure_caption_sequence() else {
            return self.render_subtitle_frame_classic(time);
        };
        let (frame, sequence_key, sequence_next) = self.caption_sequence_frame(&plan, time);
        let classic = self.render_subtitle_frame_classic(time)?;
        let key = format!("{sequence_key}|{}", classic.key);
        let next_change = match (sequence_next, classic.next_change) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        };
        if let Some(hit) = self
            .sequence
            .as_ref()
            .and_then(|state| state.cache.iter().find(|cached| cached.key == key))
        {
            return Ok(RenderedSubtitleFrame {
                key,
                rgba: hit.rgba.clone(),
                next_change: hit.next_change,
                bounds: hit.bounds.clone(),
                composite: hit.composite,
            });
        }
        if frame.seq.is_none() {
            return Ok(RenderedSubtitleFrame {
                key,
                rgba: classic.rgba,
                next_change,
                bounds: classic.bounds,
                composite: classic.composite,
            });
        }
        let (width, height) = (self.width as usize, self.height as usize);
        let mut pixmap = Pixmap::new(self.width, self.height)
            .ok_or_else(|| anyhow!("无法创建字幕透明层 {}x{}", self.width, self.height))?;
        let mut drawn = self.draw_caption_sequence(&mut pixmap, &plan, &frame)?;
        if let Some(bounds) = &classic.bounds {
            composite_premultiplied_rgba(pixmap.data_mut(), &classic.rgba, width, bounds);
            drawn.merge_content_box(bounds);
        }
        let bounds = drawn
            .window(width, height)
            .and_then(|window| alpha_bbox_within(pixmap.data(), width, height, &window));
        let rgba = Arc::new(pixmap.take());
        let composite = CaptionCompositeMode::Normal;
        if let Some(state) = self.sequence.as_mut() {
            state.cache.push_back(CachedFrame {
                key: key.clone(),
                rgba: rgba.clone(),
                next_change,
                bounds: bounds.clone(),
                composite,
            });
            while state.cache.len() > SEQUENCE_FRAME_CACHE {
                state.cache.pop_front();
            }
        }
        Ok(RenderedSubtitleFrame {
            key,
            rgba,
            next_change,
            bounds,
            composite,
        })
    }

    fn render_subtitle_frame_classic(&mut self, time: f64) -> Result<RenderedSubtitleFrame> {
        if !(0.0..self.duration).contains(&time) {
            return Ok(RenderedSubtitleFrame {
                key: "blank:outside".to_owned(),
                rgba: self.blank_rgba(),
                next_change: (time < 0.0).then_some(0.0),
                bounds: None,
                composite: CaptionCompositeMode::Normal,
            });
        }
        // ── 先用「哪几条 cue + 各自当前词」拼键查缓存 ────────────────────
        // 这一段只借用 cue 表，不排版、不深拷贝：`active_at` 返回引用，当前词
        // 是一次对 words 的线性扫描。以前这里先跑整个 `active_layouts`
        // （逐行深拷 TimedItem + 深拷已 shaping 的 LayoutLine），命中之后整份丢掉。
        let display_start = {
            let original = active_at(&self.cues, time);
            let translation = active_at(&self.translations, time);
            let mut earliest = f64::INFINITY;
            let mut any = false;
            for kind in mode_lines(self.mode, &self.order) {
                let item = match kind {
                    LineKind::Original => original,
                    LineKind::Translation => translation,
                };
                if let Some(item) = item {
                    earliest = earliest.min(item.display_start);
                    any = true;
                }
            }
            any.then_some(earliest)
        };
        let Some(display_start) = display_start else {
            let next_change = self.next_change_after(time, false);
            return Ok(RenderedSubtitleFrame {
                key: format!(
                    "blank:{}",
                    next_change.map_or_else(|| "end".to_owned(), |value| format!("{value:.6}"))
                ),
                rgba: self.blank_rgba(),
                next_change,
                bounds: None,
                composite: CaptionCompositeMode::Normal,
            });
        };
        let canvas_scale = f64::from(self.width.min(self.height)) / REFERENCE_SHORT_EDGE
            * finite(self.style.get("scale"), 1.0).max(0.05);
        let composite = self.look_at(time).composite;
        let (pose, suppressed) = self.transition_pose_at(display_start, time, canvas_scale);
        let key = {
            let original = active_at(&self.cues, time);
            let translation = active_at(&self.translations, time);
            let items = mode_lines(self.mode, &self.order)
                .into_iter()
                .filter_map(|kind| match kind {
                    LineKind::Original => original,
                    LineKind::Translation => translation,
                })
                .map(|item| (item.id.as_str(), current_word_index(item, time)))
                .collect::<Vec<_>>();
            self.cache_key_of(&items, time, pose, suppressed)
        };
        let next_change = self.next_change_after(time, self.per_frame_subtitle(pose.active));
        if let Some(frame) = self.cache.iter().find(|frame| frame.key == key) {
            // Arc 共享：命中不再复制整幅 RGBA。
            return Ok(RenderedSubtitleFrame {
                key,
                rgba: frame.rgba.clone(),
                next_change: frame.next_change,
                bounds: frame.bounds.clone(),
                composite: frame.composite,
            });
        }

        // ── 未命中才付排版的代价 ──────────────────────────────────────────
        let mut layouts = self.active_layouts(time);
        if layouts.is_empty() {
            // 上面的轻量判空与 `active_layouts` 用的是同一组 `mode_lines` +
            // `active_at`，走到这里说明两者分叉了。保守起见按空白帧返回，且
            // **逐字段复刻**上面那条空白分支——绝不能拿内容键去缓存一张空图。
            let next_change = self.next_change_after(time, false);
            return Ok(RenderedSubtitleFrame {
                key: format!(
                    "blank:{}",
                    next_change.map_or_else(|| "end".to_owned(), |value| format!("{value:.6}"))
                ),
                rgba: self.blank_rgba(),
                next_change,
                bounds: None,
                composite: CaptionCompositeMode::Normal,
            });
        }
        let animation = Arc::clone(&self.look_for_layouts(&layouts).animation);
        let (width, height) = (self.width as usize, self.height as usize);
        let mut pixmap = Pixmap::new(self.width, self.height)
            .ok_or_else(|| anyhow!("无法创建字幕透明层 {}x{}", self.width, self.height))?;
        // 本帧所有落笔的并集。求包围盒时只在它内部扫，省掉整幅 8.3MB 的搜索。
        let mut drawn = DrawBounds::default();
        let stack = self.stack_layout(&layouts, canvas_scale);
        let (x, center_y) = stack.anchor;
        let group_tf = group_transform(
            x,
            center_y,
            pose.scale_x,
            pose.scale_y,
            finite(self.style.get("rotation"), 0.0),
        );
        for plate in subtitle_background_plates(&layouts, &stack) {
            let (plate_opacity, plate_tf) = plate
                .motion_line
                .and_then(|index| {
                    let line = layouts.get(index)?;
                    let frame = layout_motion(line, &animation)?;
                    let (center_x, top) = stack.placements[index];
                    let height = line.height;
                    Some((
                        pose.opacity * frame.block.opacity,
                        group_transform_for_motion(
                            &frame.block,
                            center_x,
                            top + height / 2.0,
                            height,
                        )
                        .post_concat(group_tf),
                    ))
                })
                .unwrap_or((pose.opacity, group_tf));
            drawn.merge(fill_round_rect(
                &mut pixmap,
                plate.rect.x,
                plate.rect.y,
                plate.rect.width,
                plate.rect.height,
                plate.rect.radius,
                plate.color,
                plate_opacity,
                plate_tf,
            ));
        }
        let placements = stack.placements;

        // 绘制顺序保持 `mode_lines` 给出的行序：位置变了，叠放次序不能变。
        let positioned = layouts
            .drain(..)
            .zip(placements)
            .map(|(line, (center_x, top))| (line, center_x, top))
            .collect::<Vec<_>>();
        for (line, center_x, top) in &positioned {
            if !line.style.effect_on
                || line.style.text_motion.is_some()
                || line.style.word_background.is_some()
            {
                continue;
            }
            // Konva blurs only the text shadow/glow. Keep that effect isolated so
            // the glyph fill, outline, highlight plates, and backgrounds stay crisp.
            // 缓冲取自 scratch（归还前已按包围盒清零，等价于新建的全零 Pixmap）。
            let mut effect = match self.effect_scratch.take() {
                Some(scratch) => scratch,
                None => Pixmap::new(self.width, self.height).ok_or_else(|| {
                    anyhow!("无法创建字幕效果透明层 {}x{}", self.width, self.height)
                })?,
            };
            let effect_drawn = draw_line_effect(
                &mut effect,
                &mut self.text,
                line,
                &animation,
                *center_x,
                *top,
                pose.opacity,
                group_tf,
            );
            // 效果层只被 `draw_line_effect` 写过，它的落笔窗口就是非零像素的
            // 超集：不必为了找包围盒把整幅 8.3MB 再读一遍。
            let effect_bounds = effect_drawn
                .window(width, height)
                .and_then(|window| alpha_bbox_within(effect.data(), width, height, &window))
                .map(|bounds| {
                    if line.style.effect_blur > 0.5 {
                        box_blur_rgba_bounded(
                            effect.data_mut(),
                            self.width,
                            self.height,
                            line.style.effect_blur.round() as usize,
                            &bounds,
                        )
                    } else {
                        bounds
                    }
                });
            if let Some(effect_bounds) = effect_bounds {
                // 并进整帧窗口的是**模糊后**的盒子（`box_blur_rgba_bounded` 已经
                // 把扩散半径算进返回值），所以整帧窗口不必再为 glow 留额外边距。
                drawn.merge_content_box(&effect_bounds);
                composite_premultiplied_rgba(
                    pixmap.data_mut(),
                    effect.data(),
                    width,
                    &effect_bounds,
                );
                clear_content_box(effect.data_mut(), width, &effect_bounds);
            }
            self.effect_scratch = Some(effect);
        }
        for (line, center_x, top) in &positioned {
            drawn.merge(draw_line_layout(
                &mut pixmap,
                &mut self.text,
                line,
                &animation,
                *center_x,
                *top,
                pose.opacity,
                group_tf,
            ));
        }

        // 包围盒必须在最后一次写入之后求：转场模糊会把内容再向外扩散。
        // 搜索范围收到本帧的落笔窗口：`drawn` 并了底板、正文与效果层**模糊后**
        // 合成进来的盒子，因此它仍是整帧非零像素的超集。
        let bounds = drawn
            .window(width, height)
            .and_then(|window| alpha_bbox_within(pixmap.data(), width, height, &window))
            .map(|bounds| {
                if pose.blur > 0.5 {
                    box_blur_rgba_bounded(
                        pixmap.data_mut(),
                        self.width,
                        self.height,
                        pose.blur.round() as usize,
                        &bounds,
                    )
                } else {
                    bounds
                }
            });
        let rgba = Arc::new(pixmap.take());
        self.cache.push_front(CachedFrame {
            key: key.clone(),
            rgba: rgba.clone(),
            next_change,
            bounds: bounds.clone(),
            composite,
        });
        // 按字节预算限容（128MB）：1080p 仍是 8 帧，4K 收缩到 4 帧，
        // 避免高分辨率下缓存驻留数百 MB。
        let frame_bytes = self.width as usize * self.height as usize * 4;
        let max_entries = ((128 << 20) / frame_bytes.max(1)).clamp(1, 8);
        while self.cache.len() > max_entries {
            self.cache.pop_back();
        }
        Ok(RenderedSubtitleFrame {
            key,
            rgba,
            next_change,
            bounds,
            composite,
        })
    }

    pub fn render_text_element(
        &mut self,
        element: &TimelineVisualElement,
        time: f64,
    ) -> Result<Pixmap> {
        let mut style = resolve_line_style(
            &element.style,
            LineKind::Original,
            self.width,
            self.height,
            false,
        );
        let item = TimedItem {
            id: element.id.clone(),
            series_index: 0,
            text: element_display_text(element, time),
            display_start: element.start,
            display_end: element.end,
            words: Vec::new(),
        };
        let wrap_width = element.place.w.map_or_else(
            || f64::from(self.width) * 0.9,
            |width| f64::from(self.width) * width.max(1.0) / 100.0,
        );
        text_element_block_plate(&mut style, element, wrap_width);
        let display_text = transform_text(&item.text, &style.text_transform);
        let animation = timeline::resolve_text_animation(
            element.animation.as_ref(),
            element.start,
            Some(element.end),
            self.duration,
            time,
            self.fps,
            &display_text,
        );
        let pose = animation.container;
        let part_ranges = (!animation.ranges.is_empty()).then_some(animation.ranges.as_slice());
        let (lines, width) = layout_text(&mut self.text, &item, &style, wrap_width, part_ranges);
        let lines: Arc<[LayoutLine]> = lines.into();
        let layout = LineLayout {
            kind: LineKind::Original,
            height: layout_lines_height(&lines),
            width,
            align_width: wrap_width,
            text_align: LineTextAlign::from_style(&element.style),
            style,
            item,
            lines,
            current_word: 0,
            render_time: time,
            render_fps: self.fps,
            animation_parts: animation.parts,
            animation_short_edge: f64::from(self.width.min(self.height)),
            preview: false,
            karaoke_words: None,
            guide_below: false,
        };
        let mut pixmap = Pixmap::new(self.width, self.height)
            .ok_or_else(|| anyhow!("无法创建 text element 透明层"))?;
        let base_x = f64::from(self.width) * element.place.x.unwrap_or(50.0) / 100.0;
        let base_y = f64::from(self.height) * element.place.y.unwrap_or(50.0) / 100.0;
        let short = f64::from(self.width.min(self.height));
        let x = base_x + pose.dx * short;
        let y = base_y + pose.dy * short;
        let scale = element.place.scale.unwrap_or(1.0);
        // 第 122 轮 D2：`scaleY` 是**乘在 `scale` 之上**的纵向倍率（缺席 = 1），
        // 不是「替代 `scale` 的纵向分量」——缺席时两式同值，老文档逐字节不变。
        let scale_y = scale * element.place.scale_y.unwrap_or(1.0);
        let rotation = element.place.rot.unwrap_or(0.0) + pose.rotation;
        let opacity = element.place.opacity.unwrap_or(1.0) * pose.opacity;
        let animation = word_animation(&serde_json::json!({
            "wordAnimation": {"animationName": "None"}
        }));
        let tile = element.tile.as_ref().filter(|tile| tile.on);
        let gap_x = tile.and_then(|tile| tile.gap_x).unwrap_or(8.0);
        let gap_y = tile.and_then(|tile| tile.gap_y).unwrap_or(10.0);
        let step_x = (layout.width + f64::from(self.width) * gap_x / 100.0).max(1.0);
        let step_y = (layout.height + f64::from(self.height) * gap_y / 100.0).max(1.0);
        let centers = if let Some(tile) = tile {
            let mut centers = Vec::new();
            let cols = (f64::from(self.width) / step_x).ceil() as i32 + 3;
            let rows = (f64::from(self.height) / step_y).ceil() as i32 + 3;
            for row in -rows..=rows {
                let stagger = if tile.stagger.unwrap_or(true) && row.rem_euclid(2) != 0 {
                    step_x / 2.0
                } else {
                    0.0
                };
                for column in -cols..=cols {
                    centers.push((
                        x + f64::from(column) * step_x + stagger,
                        y + f64::from(row) * step_y,
                        rotation + tile.angle.unwrap_or(-30.0),
                    ));
                }
            }
            centers
        } else {
            vec![(x, y, rotation)]
        };
        for (center_x, center_y, rotation) in centers {
            let transform = group_transform(
                center_x,
                center_y,
                scale * pose.scale_x,
                scale_y * pose.scale_y,
                rotation,
            );
            // 块级垂直锚点：`place.y` 钉住文本块的哪条边。缺席 = center = 现状，
            // 折行时 top 向哪边长由此决定；行内仍逐行向下排，行序永不翻转。
            //
            // 钉的是含内边距的盒子（Mac `stackPlacement` 的单行分支用 `prepared.size`），
            // 所以先按 `height + 2 × pad_v` 挂块，再进 `pad_v` 得到字形顶边。
            let pad_v = layout.style.background_pad_v;
            let top = anchor_block(
                center_y,
                layout.height + pad_v * 2.0,
                element.vertical_align.unwrap_or(VerticalAlign::Center),
            ) + pad_v;
            if layout.style.background_on {
                draw_line_background(&mut pixmap, &layout, center_x, top, opacity, transform);
            }
            if layout.style.effect_on {
                let mut effect = Pixmap::new(self.width, self.height)
                    .ok_or_else(|| anyhow!("无法创建 text element 效果层"))?;
                draw_line_effect(
                    &mut effect,
                    &mut self.text,
                    &layout,
                    &animation,
                    center_x,
                    top,
                    opacity,
                    transform,
                );
                let effect_bounds =
                    alpha_bbox(effect.data(), self.width as usize, self.height as usize).map(
                        |bounds| {
                            if layout.style.effect_blur > 0.5 {
                                box_blur_rgba_bounded(
                                    effect.data_mut(),
                                    self.width,
                                    self.height,
                                    layout.style.effect_blur.round() as usize,
                                    &bounds,
                                )
                            } else {
                                bounds
                            }
                        },
                    );
                if let Some(effect_bounds) = effect_bounds {
                    composite_premultiplied_rgba(
                        pixmap.data_mut(),
                        effect.data(),
                        self.width as usize,
                        &effect_bounds,
                    );
                }
            }
            draw_line_layout(
                &mut pixmap,
                &mut self.text,
                &layout,
                &animation,
                center_x,
                top,
                opacity,
                transform,
            );
        }
        if pose.blur > 0.5 {
            box_blur_rgba_content(
                pixmap.data_mut(),
                self.width,
                self.height,
                pose.blur.round() as usize,
            );
        }
        if let Some(reveal) = pose.reveal {
            apply_horizontal_reveal(&mut pixmap, reveal);
        }
        let _ = time;
        Ok(pixmap)
    }

    /// 同一条诊断每帧都会命中，去重后再进 `warnings()`——一段 5 分钟的导出
    /// 否则会往信封里灌 9000 条一模一样的字符串。
    pub fn warn_once(&mut self, message: String) {
        if !self.warnings.contains(&message) {
            self.warnings.push(message);
        }
    }

    /// 元素盒 + 仿射。实现在 `bcut-timeline-render`（P6a 下沉）——几何全部来自
    /// `timeline`（ADR-E01 的单一来源），舞台选中框、导出像素与 wasm 预览
    /// 因此不可能算成三个盒子。
    ///
    /// 生产路径不再经过这里（三个 `push_*` 各自向下沉层要盒子）；保留是给
    /// `tests.rs` 的几何断言用的。
    pub fn element_frame(
        &self,
        element: &TimelineVisualElement,
        pose: &timeline::AnimationPose,
    ) -> (element_draw::ElementBox, render_raster::drawop::Mat6) {
        element_draw::element_frame(&element_view(element), pose, self.stage())
    }

    /// 下沉层的画布尺寸入参。
    pub fn stage(&self) -> element_draw::Stage {
        element_draw::Stage::new(self.width, self.height)
    }

    /// 下沉层的诊断出口 → `warn_once`。
    ///
    /// 先收进 `Vec` 再上浮而不是直接传 `&mut self` 的闭包：`push_*` 要同时
    /// 借 `builder` 与诊断出口，而诊断出口写的是 `self.warnings`。去重语义
    /// 不变（`warn_once` 仍然是那一处）。
    pub fn drain_element_warnings(&mut self, warnings: Vec<String>) {
        for message in warnings {
            self.warn_once(message);
        }
    }

    /// `kind: "shape"`：注册表的形状配方 + `ShapeProps` → 矢量直出。
    pub fn push_shape_element(
        &mut self,
        builder: &mut FrameBuilder,
        element: &TimelineVisualElement,
        pose: timeline::AnimationPose,
    ) {
        let mut warnings = Vec::new();
        element_draw::push_shape_element(
            builder,
            &element_view(element),
            &pose,
            self.stage(),
            &mut |message| warnings.push(message),
        );
        self.drain_element_warnings(warnings);
    }

    /// `visualizer`：注入的 `VizTrack` 采样 → 配方绘制。
    ///
    /// host 这一侧只剩两件事：把 preflight 派生好的轨取出来，以及把输出时刻
    /// 折算成源媒体时刻（`source_time_for`）。绘制本身在下沉层。
    pub fn push_visualizer_element(
        &mut self,
        builder: &mut FrameBuilder,
        element: &TimelineVisualElement,
        time: f64,
        pose: timeline::AnimationPose,
    ) {
        let track = self.viz_tracks.get(&element.id).cloned();
        let source_time = element
            .visualizer
            .as_ref()
            .and_then(|props| self.source_time_for(props, time));
        let mut warnings = Vec::new();
        element_draw::push_visualizer_element(
            builder,
            &element_view(element),
            time,
            &pose,
            self.stage(),
            track.as_deref(),
            source_time,
            &mut |message| warnings.push(message),
        );
        self.drain_element_warnings(warnings);
    }

    /// 输出时刻 → 该 visualizer 的音频源上的**源媒体时刻**。
    ///
    /// `None` = 这一刻没有该音频源在播（剪掉的空隙、或另一条源占着这段输出）。
    /// 没有投影表时（单测的 `compile_with`）退化为"输出时刻即源时刻"——wasm
    /// 预览当前走的也是这条退化路径（下沉层的 `source_time` 入参文档）。
    pub fn source_time_for(&self, props: &VisualizerProps, time: f64) -> Option<f64> {
        let Some(projection) = self.viz_projection.as_ref() else {
            return Some(time);
        };
        let wanted = visualizer_audio_source(props);
        // `Following`：接缝处取**后一段**的首帧，与"这一帧接下来要显示什么"一致。
        let (src_id, source_time) =
            projection.timeline_to_source(time, timeline::SeamBias::Following)?;
        (src_id == wanted).then_some(source_time)
    }

    /// `kind: "sticker"` 且 `source == "template"`：模板配方 → 矢量直出。
    ///
    /// 返回 `false` = 这是 `asset` 源，归 `render_media_element`（P7b 的分家点，
    /// 判据在下沉层的 `push_sticker_element`——host 不重抄一遍）。
    pub fn push_sticker_element(
        &mut self,
        builder: &mut FrameBuilder,
        element: &TimelineVisualElement,
        pose: timeline::AnimationPose,
    ) -> bool {
        let mut warnings = Vec::new();
        let claimed = element_draw::push_sticker_element(
            builder,
            &element_view(element),
            &pose,
            self.stage(),
            &mut |message| warnings.push(message),
        );
        self.drain_element_warnings(warnings);
        claimed
    }

    /// `kind: "progress"`：进度值 + 目录型配方 → 矢量直出。
    pub fn push_progress_element(
        &mut self,
        builder: &mut FrameBuilder,
        element: &TimelineVisualElement,
        time: f64,
        pose: timeline::AnimationPose,
    ) {
        let mut warnings = Vec::new();
        element_draw::push_progress_element(
            builder,
            &element_view(element),
            time,
            &pose,
            self.stage(),
            &mut |message| warnings.push(message),
        );
        self.drain_element_warnings(warnings);
    }

    /// `kind: "confetti"`：闭式运动核 → 矢量直出（设计稿 §5）。
    pub fn push_confetti_element(
        &mut self,
        builder: &mut FrameBuilder,
        element: &TimelineVisualElement,
        time: f64,
        pose: timeline::AnimationPose,
    ) {
        let mut warnings = Vec::new();
        element_draw::push_confetti_element(
            builder,
            &element_view(element),
            time,
            &pose,
            self.stage(),
            &mut |message| warnings.push(message),
        );
        self.drain_element_warnings(warnings);
    }

    pub fn push_draw_element(
        &mut self,
        builder: &mut FrameBuilder,
        element: &TimelineVisualElement,
        pose: timeline::AnimationPose,
    ) {
        element_draw::push_draw_element(builder, &element_view(element), &pose, self.stage());
    }

    pub fn push_placeholder_element(
        &mut self,
        builder: &mut FrameBuilder,
        element: &TimelineVisualElement,
        pose: timeline::AnimationPose,
    ) -> bool {
        element_draw::push_placeholder_element(builder, &element_view(element), &pose, self.stage())
    }

    /// **动态贴纸的取帧时刻**（P7b）：`StickerProps.loop` 的三个面值第一次被
    /// 真正消费。
    ///
    /// 动态贴纸是 GIF → 带 alpha 的 WebM，在渲染管线里就是一个普通视频层。
    /// 循环用**已经在契约里**的 `sticker.loop` 表达，因此不需要给 `Element` 加字段。
    ///
    /// - `loop`（缺省）：`srcStart + 经过时间` 对**源时长取模**——贴纸时长
    ///   通常远短于它在时间轴上的占位，不取模就会在第一遍播完后定格。
    /// - `once`：播一遍，播完停在末帧（不取模，正是 `VideoReader` 的 EOF 行为）。
    /// - `hold`：定格首帧，把动态贴纸当静态贴纸用。
    ///
    /// 源时长拿不到（0 或负）时退回 `once`——除以 0 只会算出 NaN。
    fn sticker_media_time(&self, element: &TimelineVisualElement, time: f64) -> f64 {
        let loop_mode = element
            .sticker
            .as_ref()
            .map(|sticker| sticker.loop_mode())
            .unwrap_or(timeline::schema::STICKER_LOOP_DEFAULT);
        if loop_mode == timeline::schema::STICKER_LOOP_HOLD {
            return element.src_start.max(0.0);
        }
        let elapsed = (element.src_start + (time - element.start) * element.rate).max(0.0);
        let duration = element
            .src_id
            .as_deref()
            .and_then(|id| self.media.base.media_duration(id))
            .unwrap_or(0.0);
        if !(duration > 0.0) {
            return elapsed;
        }
        if loop_mode == timeline::schema::STICKER_LOOP_LOOP {
            return elapsed.rem_euclid(duration);
        }
        // `once`：播完停末帧。**必须夹取**——`VideoReader` 的"越过片尾冻结末帧"
        // 只在顺序读到 EOF 时成立；直接 `-ss` 到片尾之后，管道一帧都吐不出来，
        // 那是一条硬错误而不是冻结。夹到源的最后一个可解码时刻（按**源**帧率
        // 算，不是合成帧率——8 fps 的贴纸留 1/30 s 余量还是会越过末帧）。
        let last = element
            .src_id
            .as_deref()
            .and_then(|id| self.media.base.video_last_frame_time(id))
            .unwrap_or(duration);
        elapsed.min(last)
    }

    /// Timeline 的媒体时钟。静态图用 -1；视频线性推进；GIF/APNG/WebP image
    /// 在自身时长内循环。Timeline 0.3 没有 BCF `animatedImage.loop` 字段，产品
    /// 导入语义因此固定为循环，正好覆盖 4 秒 B-roll 与动态贴纸的既有体验。
    fn timeline_media_time_ms(&self, element: &TimelineVisualElement, time: f64) -> i64 {
        let Some(source_id) = element.src_id.as_deref() else {
            return -1;
        };
        if !self.media.base.is_time_varying(source_id) {
            return -1;
        }
        if element.kind == ElementKind::Sticker {
            return (self.sticker_media_time(element, time) * 1_000.0).round() as i64;
        }
        let elapsed = (element.src_start + (time - element.start) * element.rate).max(0.0);
        let sampled = if self.media.base.has_animated(source_id) {
            let duration = self.media.base.animated_duration(source_id).unwrap_or(0.0);
            if duration > 0.0 {
                elapsed.rem_euclid(duration)
            } else {
                elapsed
            }
        } else {
            elapsed
        };
        (sampled * 1_000.0).round() as i64
    }

    /// 取帧该用哪个 id：换过色的素材贴纸走**变体**（见
    /// `load_sticker_fill_variants`），其余一律 `None` ＝ 原样用 source id。
    ///
    /// 变体不存在就是「这份源不支持换色」——位图、动图/视频贴纸、wasm 的注入
    /// store 都走这一支，按原色画而不是报错。
    fn recolored_source_id(
        &self,
        element: &TimelineVisualElement,
        source_id: &str,
    ) -> Option<String> {
        let sticker = element.sticker.as_ref()?;
        if sticker.fill_overrides.is_empty() {
            return None;
        }
        let variant = sticker_fill_variant_id(source_id, &sticker.fill_overrides);
        self.media.has_image(&variant).then_some(variant)
    }

    /// 白板源图，按 `target` 给的目标像素降采样过（`None` ＝ 原样）。
    ///
    /// 揭示场逐帧在这张图上跑，所以它有多大直接等于每帧要算多少像素；而它最后
    /// 只会被画进元素盒。缩过的图按 `(源 id, 目标尺寸)` 记住，整条时间轴只缩
    /// 一次。墨线分析的键里本来就带着尺寸（`源 id | 尺寸 | 参数`），跟着换键，
    /// 不会拿大图的分析去套小图。
    fn whiteboard_source_at(
        &mut self,
        source_id: &str,
        source: &Arc<Pixmap>,
        target: Option<(u32, u32)>,
    ) -> Arc<Pixmap> {
        let Some((width, height)) = target else {
            return Arc::clone(source);
        };
        if (width, height) == (source.width(), source.height()) {
            return Arc::clone(source);
        }
        let key = (source_id.to_owned(), width, height);
        if let Some(hit) = self.whiteboard_sources.get(&key) {
            return Arc::clone(hit);
        }
        let scaled = Arc::new(downscaled_pixmap(source, width, height));
        self.whiteboard_sources.insert(key, Arc::clone(&scaled));
        scaled
    }

    /// 白板源图能不能按元素盒缩，以及缩到多少。
    ///
    /// `fx` 在场时不缩：效果的半径是画布短边折出来、落在源图自身分辨率上的
    /// （`apply_media_effects` 的 scale 只看画布），图一小，同一个模糊盖住的比
    /// 例就变了；而且它还参与墨/色分类，动它等于动揭示次序。平铺同理不缩——
    /// 那张图要按格重复，按盒子缩会让每一格都糊。
    fn whiteboard_target_px(
        &self,
        element: &TimelineVisualElement,
        natural_width: u32,
        natural_height: u32,
        box_width: f64,
        box_height: f64,
    ) -> Option<(u32, u32)> {
        if element.fx.is_some() || element.tile.as_ref().is_some_and(|tile| tile.on) {
            return None;
        }
        // 取两轴里更大的那个比例：`contain` 会留边、`cover` 会裁掉一侧，按大的
        // 来意味着宁可多算几个像素，也不会把要显示的部分算糊。
        let ratio = (box_width / f64::from(natural_width.max(1)))
            .max(box_height / f64::from(natural_height.max(1)));
        shrink_target_px(natural_width, natural_height, ratio)
    }

    /// 白板手绘：源图 → 「画到 `time` 为止」的一帧（设计稿 §4）。
    ///
    /// 分析按 `源 id | 尺寸 | 参数` 记忆化；`draw` 缺席时先做一次无 `beats` 的
    /// 分析拿自然时长（同样进缓存），再按最终 `draw` 归一化 `beats`。
    fn whiteboard_reveal(
        &mut self,
        element: &TimelineVisualElement,
        source_id: &str,
        source: &Pixmap,
        time: f64,
    ) -> Pixmap {
        use render_raster::source::{whiteboard_analyze, whiteboard_frame};
        const CACHE_LIMIT: usize = 24;
        let props = element.whiteboard.clone().unwrap_or_default();
        let size = format!("{}x{}", source.width(), source.height());
        let analysis_for = |params: render_raster::source::WhiteboardParams,
                            cache: &mut HashMap<
            String,
            Arc<render_raster::source::WhiteboardAnalysis>,
        >| {
            // 0.9：`pace` / `strict` / `end` / 生效画时都进键；锚点拍已由宿主解析成秒。
            let key = format!(
                "{source_id}|{size}|{}|{}|{}|{:.4}|{}",
                params.ink_first,
                params.pace.as_str(),
                params.strict,
                params.draw_seconds,
                params
                    .beats
                    .iter()
                    .map(|b| {
                        format!(
                            "{:.4}-{:?}:{:?}",
                            b.at,
                            b.end.map(|e| (e * 1e4).round() / 1e4),
                            b.rect
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(";")
            );
            if let Some(hit) = cache.get(&key) {
                return Arc::clone(hit);
            }
            if cache.len() >= CACHE_LIMIT {
                cache.clear();
            }
            let analysis = Arc::new(whiteboard_analyze(source, &params));
            cache.insert(key, Arc::clone(&analysis));
            analysis
        };
        let duration = element.end - element.start;
        let base = analysis_for(
            element_draw::whiteboard_params(&props, 1.0).beats_cleared(),
            &mut self.whiteboard_cache,
        );
        let draw =
            element_draw::whiteboard_draw_seconds(&props, duration, base.natural_draw_seconds());
        let params = element_draw::whiteboard_params(&props, draw);
        let analysis = if params.needs_second_pass() {
            analysis_for(params, &mut self.whiteboard_cache)
        } else {
            base
        };
        let progress = ((time - element.start) / draw).clamp(0.0, 1.0);
        let paper = element_draw::whiteboard_paper(&props)
            .and_then(|c| tiny_skia::Color::from_rgba(c[0], c[1], c[2], c[3]));
        whiteboard_frame(
            &analysis,
            source,
            progress,
            element_draw::whiteboard_hand(&props),
            paper,
        )
    }

    /// Whiteboard GPU scene 的唯一 CPU 像素阶段：在源图天然尺寸上执行静态效果与
    /// 揭示场。fit / contain 背景 / mask / tile / transition / pose blur 全部留给
    /// [`element_draw::external_media_scene_nodes_at`]，不能先在 CPU 铺成整张画布再上传。
    fn whiteboard_source_frame(
        &mut self,
        element: &TimelineVisualElement,
        source_id: &str,
        source: &Arc<Pixmap>,
        time: f64,
    ) -> Result<Pixmap> {
        if element.fx.is_none() {
            return Ok(self.whiteboard_reveal(element, source_id, source, time));
        }
        // CPU reference 的顺序是 source effects → reveal。效果会改变白板的墨/色
        // 分类，不能为了省一次处理把它挪到 reveal 后的 GPU texture pass。
        let mut filtered = Pixmap::from_vec(
            source.data().to_vec(),
            IntSize::from_wh(source.width(), source.height()).context("白板源尺寸非法")?,
        )
        .context("白板源 RGBA 尺寸非法")?;
        apply_media_effects(
            &mut filtered,
            element.fx.as_ref(),
            f64::from(self.width.min(self.height)) / REFERENCE_SHORT_EDGE,
        );
        Ok(self.whiteboard_reveal(element, source_id, &filtered, time))
    }

    pub fn render_media_element(
        &mut self,
        element: &TimelineVisualElement,
        time: f64,
        pose: timeline::AnimationPose,
    ) -> Result<Option<Pixmap>> {
        let Some(source_id) = element.src_id.as_deref() else {
            if element.kind == ElementKind::Sticker {
                self.warn_once(format!(
                    "元素 {} 的 sticker source=asset 缺少 srcId：资产贴纸必须注册进 \
                     timeline sources（模板贴纸请改用 source=template + templateId）",
                    element.id
                ));
            }
            return Ok(None);
        };
        // 静态图恒为 -1；视频与动图共用正数毫秒时钟，差异只在上游折时。
        let media_ms = self.timeline_media_time_ms(element, time);
        let recolored = self.recolored_source_id(element, source_id);
        let source_id = recolored.as_deref().unwrap_or(source_id);
        let source = self.media.source_frame(source_id, media_ms)?;
        let canvas_width = f64::from(self.width);
        let canvas_height = f64::from(self.height);
        let tiled = element.tile.as_ref().is_some_and(|tile| tile.on);
        // 盒子只用源的**宽高比**，而揭示场与效果都不改尺寸——所以同一段算式拿源
        // 尺寸先算一遍是合法的，白板据此决定要不要先把源缩到盒子大小。
        let media_box = |natural_width: f64, natural_height: f64| match (tiled, element.mode) {
            (false, VisualMode::Fullscreen) => (
                canvas_width,
                canvas_height,
                canvas_width / 2.0,
                canvas_height / 2.0,
            ),
            (_, VisualMode::Pip) | (true, VisualMode::Fullscreen) => {
                // B-roll 的历史缺省是 34%；sticker 是 0.2 的新元素，走 core 的
                // 统一缺省（`DEFAULT_ELEMENT_W`），与舞台盒同宽。
                let defaults = timeline::geometry::default_place(element.kind, None);
                let default_w = match element.kind {
                    ElementKind::Sticker => timeline::geometry::DEFAULT_ELEMENT_W,
                    ElementKind::Placeholder => defaults.w,
                    _ => 34.0,
                };
                let width = canvas_width * element.place.w.unwrap_or(default_w).max(1.0) / 100.0;
                let height = if element.kind == ElementKind::Placeholder {
                    canvas_height * defaults.h.unwrap_or(24.0) / 100.0
                } else {
                    width * natural_height / natural_width
                };
                (
                    width,
                    height,
                    canvas_width * element.place.x.unwrap_or(50.0) / 100.0,
                    canvas_height * element.place.y.unwrap_or(50.0) / 100.0,
                )
            }
        };
        let filtered = if element.kind == ElementKind::Whiteboard {
            // 白板手绘（Timeline 0.8）：源图经时间场揭示成「画到 t 为止」的一帧，
            // 之后与 image 共用盒子 / 遮罩 / 转场 / 仿射。分析按源 id + props 记忆化。
            // 揭示是逐帧的、成本跟着源图像素走，所以先把源缩到元素盒的大小。
            let (box_width, box_height, _, _) = media_box(
                f64::from(source.width().max(1)),
                f64::from(source.height().max(1)),
            );
            let target = self.whiteboard_target_px(
                element,
                source.width(),
                source.height(),
                box_width,
                box_height,
            );
            let source = self.whiteboard_source_at(source_id, &source, target);
            self.whiteboard_source_frame(element, source_id, &source, time)?
        } else {
            let mut filtered = Pixmap::from_vec(
                source.data().to_vec(),
                IntSize::from_wh(source.width(), source.height()).context("媒体元素尺寸非法")?,
            )
            .context("媒体元素 RGBA 尺寸非法")?;
            apply_media_effects(
                &mut filtered,
                element.fx.as_ref(),
                f64::from(self.width.min(self.height)) / REFERENCE_SHORT_EDGE,
            );
            filtered
        };
        let natural_width = f64::from(filtered.width().max(1));
        let natural_height = f64::from(filtered.height().max(1));
        let (box_width, box_height, center_x, center_y) = media_box(natural_width, natural_height);
        let local_width = box_width.round().max(1.0) as u32;
        let local_height = box_height.round().max(1.0) as u32;
        let transition = element
            .transitions
            .as_ref()
            .map(|v| v.sample(time - element.start, element.end - element.start))
            .unwrap_or_default();
        let pose = transition.compose_in_place(
            pose,
            f64::from(local_width),
            canvas_width.min(canvas_height),
            &element.place,
        );
        // 背景板只有「全屏 + contain」且元素有底（`bg`）才预填；其余情形局部画布在
        // `draw_fit_pixmap` 之前是全透明的。合成替身没有底，留边与透明像素都露出下层。
        let backdrop = element.bg.filter(|_| element.mode == VisualMode::Fullscreen && element.fit == Fit::Contain);
        let has_backdrop = backdrop.is_some();
        // 恒等直通：盒子与源同尺寸时 `draw_fit_pixmap` 的 scale 恰为 1、偏移恰为 0，
        // 贴到全透明画布上是逐字节拷贝（`tests/identity_media_pass_through.rs` 实测
        // 位精确），于是直接接管 `filtered`，省掉一次 8.3 MB 清零分配和一次全幅
        // Bilinear 重采样。恒等 PIP（`detach_main_video` 归一化后的主画面）每帧都走这条。
        let mut local = if !has_backdrop
            && local_width == filtered.width()
            && local_height == filtered.height()
        {
            filtered
        } else {
            let mut local = Pixmap::new(local_width, local_height)
                .ok_or_else(|| anyhow!("无法创建媒体元素局部画布"))?;
            if let Some(bg) = backdrop {
                match bg {
                    Background::Black => local.fill(tiny_skia::Color::BLACK),
                    Background::Color([r, g, b]) => {
                        local.fill(tiny_skia::Color::from_rgba8(r, g, b, 255));
                    }
                    Background::Blur => {
                        draw_fit_pixmap(&mut local, &filtered, Fit::Cover, 1.0);
                        box_blur_rgba(
                            local.data_mut(),
                            local_width,
                            local_height,
                            ((local_width.min(local_height) as f64) * 0.04)
                                .round()
                                .max(1.0) as usize,
                        );
                        adjust_brightness(local.data_mut(), -0.15);
                    }
                }
            }
            draw_fit_pixmap(&mut local, &filtered, element.fit, 1.0);
            local
        };
        if transition.iris < 1.0 {
            let half_x = f64::from(local_width) / 2.0;
            let half_y = f64::from(local_height) / 2.0;
            let radius = half_x.hypot(half_y) * transition.iris;
            for (i, pixel) in local.data_mut().chunks_exact_mut(4).enumerate() {
                let x = (i % local_width as usize) as f64 + 0.5 - half_x;
                let y = (i / local_width as usize) as f64 + 0.5 - half_y;
                let coverage = (radius - x.hypot(y) + 0.5).clamp(0.0, 1.0);
                for channel in pixel {
                    *channel = (f64::from(*channel) * coverage).round() as u8;
                }
            }
        }

        // 局部画布上的遮罩栈：`mask.shape@1` → `mask.progress@1`。顺序与
        // uniform 都来自 `timeline::lower_element_effects`（Timeline 0.1
        // 的持久字段 → 效果配方），长度参数是画布短边的比例。
        let canvas_short_edge = f64::from(self.width.min(self.height));
        for lowered in timeline::lower_element_effects(
            None,
            element.mask.as_ref(),
            Some(&element.place),
            pose.reveal,
            element.mode == VisualMode::Pip || tiled,
        ) {
            render_raster::effects::apply_filter_in_place(
                &lowered.effect,
                &lowered.uniforms,
                &mut local,
                canvas_short_edge,
            )?;
        }
        let short = canvas_width.min(canvas_height);
        let dx = pose.dx * short;
        let dy = pose.dy * short;
        let opacity = (element.place.opacity.unwrap_or(1.0) * pose.opacity).clamp(0.0, 1.0);
        if opacity <= 0.001 {
            return Ok(Some(
                Pixmap::new(self.width, self.height)
                    .ok_or_else(|| anyhow!("无法创建媒体元素合成层"))?,
            ));
        }
        // 镜像是几何（ADR-E01）：只进仿射的 `post_scale`，不参与盒子尺寸与
        // 平铺点阵的换算。缺席 = (1, 1) ⇒ 旧文档逐字节不变。
        let (flip_x, flip_y) = element.place.flip_signs();
        let uniform_scale = element.place.scale.unwrap_or(1.0) * pose.scale_x;
        // 第 122 轮 D2：`place.scaleY` 是**乘在 `scale` 之上**的纵向倍率（缺席 = 1），
        // 不是「替代 `scale` 的纵向分量」。写回路径 `stage_drag::place_resize` 把
        // 「盒子原样不动」算成 `scaleY = 1`，若这里回落成 `scale`，`scale ≠ 1` 的
        // 元素一拖边就会被压回自然高。`scaleY` 缺席时两式同值，老文档逐字节不变。
        let vertical_scale = element.place.scale.unwrap_or(1.0)
            * element.place.scale_y.unwrap_or(1.0)
            * pose.scale_y;
        let mut field;
        if let Some(tile) = element.tile.as_ref().filter(|tile| tile.on) {
            field = Pixmap::new(self.width, self.height)
                .ok_or_else(|| anyhow!("无法创建媒体元素合成层"))?;
            let rotation =
                tile.angle.unwrap_or(-30.0) + element.place.rot.unwrap_or(0.0) + pose.rotation;
            let points =
                tile_stamp_points(self.width, self.height, local_width, local_height, tile);
            for (point_x, point_y) in points {
                let radians = rotation.to_radians();
                let scaled_x = point_x * uniform_scale;
                let scaled_y = point_y * vertical_scale;
                let rotated_x = scaled_x * radians.cos() - scaled_y * radians.sin();
                let rotated_y = scaled_x * radians.sin() + scaled_y * radians.cos();
                let transform = Transform::from_translate(
                    -(local_width as f32) / 2.0,
                    -(local_height as f32) / 2.0,
                )
                .post_scale(
                    (uniform_scale * flip_x) as f32,
                    (vertical_scale * flip_y) as f32,
                )
                .post_rotate(rotation as f32)
                .post_translate(
                    (canvas_width / 2.0 + dx + rotated_x) as f32,
                    (canvas_height / 2.0 + dy + rotated_y) as f32,
                );
                field.draw_pixmap(
                    0,
                    0,
                    local.as_ref(),
                    &PixmapPaint {
                        quality: FilterQuality::Bilinear,
                        ..Default::default()
                    },
                    transform,
                    None,
                );
            }
        } else {
            let transform = Transform::from_translate(
                -(local_width as f32) / 2.0,
                -(local_height as f32) / 2.0,
            )
            .post_scale(
                (uniform_scale * flip_x) as f32,
                (vertical_scale * flip_y) as f32,
            )
            .post_rotate((element.place.rot.unwrap_or(0.0) + pose.rotation) as f32)
            .post_translate((center_x + dx) as f32, (center_y + dy) as f32);
            // 恒等接管：局部画布满幅、仿射恒等时，往全透明合成层上 SrcOver 一次就是
            // 逐字节拷贝（同上，实测位精确）——直接把局部画布当合成层，再省一次
            // 8.3 MB 清零分配和一次全幅 Bilinear。判据用 `Transform::is_identity()`
            // 而不是逐条枚举 scale / rot / x / y，漏一种情形就会静默改画面。
            if transform.is_identity() && local_width == self.width && local_height == self.height {
                field = local;
            } else {
                field = Pixmap::new(self.width, self.height)
                    .ok_or_else(|| anyhow!("无法创建媒体元素合成层"))?;
                field.draw_pixmap(
                    0,
                    0,
                    local.as_ref(),
                    &PixmapPaint {
                        quality: FilterQuality::Bilinear,
                        ..Default::default()
                    },
                    transform,
                    None,
                );
            }
        }
        if pose.blur > 0.5 {
            // 阶段 4A 唯一一条**真正的 Filter pass**（设计 §6.1）：姿态模糊作用
            // 在画布尺寸的合成层上，尺寸与半径换算都不需要改，因此可以位精确地
            // 表达成 FramePlan。元素的局部缓冲不走这条路——`fx.blur` 烘在天然
            // 尺寸的源图上，改成 Filter pass 会换分辨率、换像素（阶段 4B 的活）。
            //
            // 输入 surface 声明为 `External`：直接把已经画好的 `field` 当输入，
            // 不经 `draw_pixmap` blit——blit 有可能改字节。
            let radius_px = (pose.blur * f64::from(self.width.min(self.height))
                / REFERENCE_SHORT_EDGE)
                .round()
                .max(1.0);
            let short_edge = f64::from(self.width.min(self.height));
            let mut plan = render_raster::FramePlan::single_draw(
                self.width,
                self.height,
                FrameOps::default(),
                self.capability,
            );
            plan.surfaces = vec![
                render_raster::SurfacePlan::external(
                    render_raster::SurfaceId(0),
                    self.width,
                    self.height,
                ),
                render_raster::SurfacePlan::canvas(
                    render_raster::SurfaceId(1),
                    self.width,
                    self.height,
                ),
            ];
            plan.passes = vec![render_raster::RenderPass::Filter {
                input: render_raster::SurfaceId(0),
                output: render_raster::SurfaceId(1),
                effect: render_raster::effects::EffectRef::new("filter.blur", 1),
                uniforms: render_raster::effects::UniformMap::new().with(
                    "radius",
                    render_raster::effects::UniformValue::Scalar(radius_px / short_edge),
                ),
            }];
            plan.output = render_raster::SurfaceId(1);
            let external = std::collections::BTreeMap::from([(0u32, Arc::new(field))]);
            field = render_raster::execute_plan_with_inputs(
                &plan,
                &mut self.executor,
                &mut self.media,
                None,
                &external,
            )?;
        }
        multiply_premultiplied_alpha(field.data_mut(), opacity);
        Ok(Some(field))
    }

    pub fn render_overlay_frame(&mut self, time: f64) -> Result<RenderedOverlayFrame> {
        let subtitle = self.render_subtitle_frame(time)?;
        self.render_drawop_overlay_frame(time, Some(subtitle))
    }

    pub fn render_elements_overlay_frame(&mut self, time: f64) -> Result<RenderedOverlayFrame> {
        self.render_drawop_overlay_frame(time, None)
    }

    /// R1 的元素层场景出口：数组顺序就是 timeline z 序，shape/template sticker
    /// 保持 DrawOp，visualizer/progress 变成 ShaderQuad。每个元素只求值一次：
    /// 同一结果既给 SceneNode，也把 CPU reference 合入整帧指纹；`next_change`
    /// 与 [`Self::build_overlay_ops`] 共用 [`Self::element_next_change`]，因此 GPU
    /// 执行层不会发明第二份身份或时间模型。
    ///
    /// text/image/video/asset sticker 与模板 chrome 仍需要 host 光栅/媒体纹理，
    /// 在 R2/R4 接入前整帧明确报错，让 App 无感回退现有 CPU overlay。
    pub fn element_scene_frame(&mut self, time: f64) -> Result<element_draw::SceneFrame> {
        if self.chrome.is_some() {
            bail!("compositor-scene-unsupported: 模板层尚未进入 R1 GPU 场景");
        }
        let blocked = self.host_rasterized_elements();
        if !blocked.is_empty() {
            bail!(
                "compositor-scene-unsupported: 这些元素仍需要 host 光栅化：{}",
                blocked.join(", ")
            );
        }

        let time = time.clamp(0.0, self.duration.max(0.0));
        self.media.dynamic.clear();
        let active = self
            .elements
            .iter()
            .filter(|element| {
                let t = self.sample_time_for(&element.id, time);
                t >= element.start && t < element.end
            })
            .cloned()
            .collect::<Vec<_>>();
        let next_change = self.element_next_change(time, &active);
        let mut reference = FrameBuilder::default();
        reference.push(DrawOp::Clear {
            color: [0.0, 0.0, 0.0, 0.0],
        });
        let mut nodes = Vec::with_capacity(active.len());
        for mut element in active {
            let time = self.sample_time_for(&element.id, time);
            element.keyframe_place(time);
            let pose = timeline::resolve_animation_pose(
                element.animation.as_ref(),
                element.start,
                Some(element.end),
                self.duration,
                time,
                self.fps,
            );
            let track = self.viz_tracks.get(&element.id).cloned();
            let source_time = element
                .visualizer
                .as_ref()
                .and_then(|props| self.source_time_for(props, time));
            let mut warnings = Vec::new();
            let evaluated = element_draw::evaluate_scene_element(
                &element_view(&element),
                time,
                &pose,
                self.stage(),
                track.as_deref(),
                source_time,
                &mut |message| warnings.push(message),
            )?;
            self.drain_element_warnings(warnings);
            if let Some(evaluated) = evaluated {
                evaluated.append_reference_to(&mut reference)?;
                if let Some(node) = evaluated.node {
                    nodes.push(node);
                }
            }
        }
        let reference = reference.finish();
        Ok(element_draw::SceneFrame {
            nodes,
            next_change,
            active_until: None,
            fingerprint: render_raster::fingerprint(&reference),
        })
    }

    /// R5 离屏 GPU 导出的完整 renderer-neutral overlay scene。
    ///
    /// timeline 元素按投影后的声明序绘制，字幕叠在视频等普通元素之上；水印已由
    /// [`Self::parse_projected_timeline_elements`] 稳定提升到末尾。普通 text 走
    /// retained glyph scene，shape/template sticker/visualizer/progress 走 R1
    /// 求值层。外部 image/video/asset sticker 使用元素级 `TextureNode`，模板 chrome
    /// 使用 host 光栅后的全画布纹理；二者都保持在同一节点数组的全局 z 序中。
    pub fn compositor_scene_frame(&mut self, time: f64) -> Result<element_draw::SceneFrame> {
        self.compositor_scene_frame_with(time, SceneIdentity::Full)
    }

    /// 同上，但由调用方决定要不要算 [`SceneIdentity`]。
    pub fn compositor_scene_frame_with(
        &mut self,
        time: f64,
        scene_identity: SceneIdentity,
    ) -> Result<element_draw::SceneFrame> {
        let want_identity = scene_identity != SceneIdentity::Skip;
        self.compositor_scene_support()?;
        let time = time.clamp(0.0, self.duration.max(0.0));
        self.media.dynamic.clear();

        let mut nodes = Vec::new();
        let mut next_change = None;
        let mut active_until = None;
        let mut identity = Vec::new();

        let active = self
            .elements
            .iter()
            .filter(|element| {
                let t = self.sample_time_for(&element.id, time);
                t >= element.start && t < element.end
            })
            .cloned()
            .collect::<Vec<_>>();
        next_change = min_optional_time(next_change, self.element_next_change(time, &active));
        let mut reference = FrameBuilder::default();
        reference.push(DrawOp::Clear {
            color: [0.0, 0.0, 0.0, 0.0],
        });
        for mut element in active {
            // 采样时刻必须在这里就换掉：悬停试穿把某一件单独钉在它自己的本地
            // 钟上，姿态、源时间与元素求值都得用这个钟，只换文字分支等于让
            // 彩纸永远停在局部 0 秒（GPU 合成路径上舞台就是空的）。
            let time = self.sample_time_for(&element.id, time);
            element.keyframe_place(time);
            if element.kind == ElementKind::Text {
                let scene_nodes = match self.text_element_scene_nodes(&element, time) {
                    Ok(scene_nodes) => scene_nodes,
                    // 带分层文字动画的文字元素：CPU 光栅（`render_text_element`，与
                    // DrawOp 参考同一张图）裁成纹理节点，留在元素数组里保持 z 序。
                    #[cfg(feature = "host")]
                    Err(SubtitleSceneFallback::WordAnimation)
                        if text_element_has_motion(&element) =>
                    {
                        let pixmap = self.render_text_element(&element, time)?;
                        // 静止段（入场结束到退场开始、没有循环）整段一张图：身份与
                        // 采样钟都取段起点，不混进 `time`，上屏去重才认得出来。
                        let clock = match text_element_motion_phase(&element, time, self.fps) {
                            TextElementMotionPhase::Changing => time,
                            TextElementMotionPhase::Still { anchor, .. } => anchor,
                        };
                        let structural = structural_pixel_hash(&[
                            b"text-motion",
                            &text_element_scene_fingerprint(&self.definition_key, &element, clock)
                                .to_le_bytes(),
                            element_display_text(&element, time).as_bytes(),
                        ]);
                        if let Some(fingerprint) = self.compositor_raster_texture_node(
                            format!("text-motion:{}", element.id),
                            pixmap.data(),
                            None,
                            (clock * 1_000.0).round() as i64,
                            scene_identity,
                            structural,
                            &mut nodes,
                        )? {
                            identity.extend_from_slice(&fingerprint.to_le_bytes());
                        }
                        continue;
                    }
                    Err(fallback) => bail!("compositor-scene-unsupported: {fallback}"),
                };
                if want_identity {
                    identity.extend_from_slice(
                        &text_element_scene_fingerprint(&self.definition_key, &element, time)
                            .to_le_bytes(),
                    );
                }
                nodes.extend(scene_nodes);
                continue;
            }
            let pose = timeline::resolve_animation_pose(
                element.animation.as_ref(),
                element.start,
                Some(element.end),
                self.duration,
                time,
                self.fps,
            );
            if element.kind == ElementKind::Whiteboard {
                // 白板手绘的揭示场在 CPU 上逐帧光栅化（`render_media_element` 里做
                // 盒子 / 遮罩 / 转场 / 揭示），进 GPU 场景时是一张全画布纹理，与
                // 模板 chrome 同一种节点，但留在元素数组里保持 z 序。不加这一支
                // 会掉进 `evaluate_scene_element` 的 `false` 分支被静默丢掉，
                // 导出 / App 预览就看不到白板件。
                #[cfg(feature = "host")]
                {
                    if let Some(fingerprint) = self.compositor_whiteboard_node(
                        &element,
                        time,
                        pose,
                        scene_identity,
                        &mut nodes,
                    )? {
                        identity.extend_from_slice(&fingerprint.to_le_bytes());
                    }
                    continue;
                }
                #[cfg(not(feature = "host"))]
                bail!(
                    "compositor-scene-unsupported: 元素 {} 需要 host 光栅化白板",
                    element.id
                );
            }
            if is_external_media_element(&element) {
                #[cfg(feature = "host")]
                {
                    let (media_nodes, fingerprint) =
                        self.compositor_media_nodes(&element, time, &pose, scene_identity)?;
                    if let Some(fingerprint) = fingerprint {
                        identity.extend_from_slice(&fingerprint.to_le_bytes());
                    }
                    nodes.extend(media_nodes);
                    continue;
                }
                #[cfg(not(feature = "host"))]
                bail!(
                    "compositor-scene-unsupported: 元素 {} 需要 host 外部纹理",
                    element.id
                );
            }
            let track = self.viz_tracks.get(&element.id).cloned();
            let source_time = element
                .visualizer
                .as_ref()
                .and_then(|props| self.source_time_for(props, time));
            let mut warnings = Vec::new();
            let evaluated = element_draw::evaluate_scene_element(
                &element_view(&element),
                time,
                &pose,
                self.stage(),
                track.as_deref(),
                source_time,
                &mut |message| warnings.push(message),
            )?;
            self.drain_element_warnings(warnings);
            if let Some(evaluated) = evaluated {
                evaluated.append_reference_to(&mut reference)?;
                if let Some(node) = evaluated.node {
                    nodes.push(node);
                }
            }
        }
        if self.includes.subtitles {
            match self.subtitle_scene_frame_with_target_sampling(time, true) {
                Ok(subtitle) => {
                    if want_identity {
                        identity.extend_from_slice(&subtitle.scene.fingerprint.to_le_bytes());
                    }
                    next_change = min_optional_time(next_change, subtitle.scene.next_change);
                    active_until = min_optional_time(active_until, subtitle.scene.active_until);
                    nodes.extend(subtitle.scene.nodes);
                }
                // 本帧活动 cue 带分层文字动画：只有**字幕层**走共享 CPU 光栅
                // （`render_subtitle_frame`，自带帧键缓存与 `next_change`），按非零
                // alpha 包围盒裁成一张 1:1 纹理，放在原字幕节点的位置；元素、媒体、
                // 模板照旧是 GPU 节点。非 Normal 复合仍需要 backdrop 语义，不在此列。
                #[cfg(feature = "host")]
                Err(SubtitleSceneFallback::WordAnimation) if self.text_motion_active_at(time) => {
                    let frame = self.render_subtitle_frame(time)?;
                    if frame.composite != CaptionCompositeMode::Normal {
                        bail!(
                            "compositor-scene-unsupported: {} ({:?} composite)",
                            SubtitleSceneFallback::WordAnimation,
                            frame.composite
                        );
                    }
                    next_change = min_optional_time(next_change, frame.next_change);
                    let structural = structural_pixel_hash(&[
                        b"subtitle-motion",
                        self.definition_key.as_bytes(),
                        frame.key.as_bytes(),
                    ]);
                    let texture = format!(
                        "subtitle-motion:{:016x}",
                        render_raster::drawop::fnv1a64(self.definition_key.as_bytes())
                    );
                    if let Some(fingerprint) = self.compositor_raster_texture_node(
                        texture,
                        &frame.rgba,
                        Some(frame.bounds.as_ref()),
                        // 帧键在动的帧里已带帧号、静止时是 `@settled`：内容变化全由
                        // `structural` / 像素承载，采样钟固定，静止段身份才不逐帧变。
                        0,
                        scene_identity,
                        structural,
                        &mut nodes,
                    )? {
                        identity.extend_from_slice(&fingerprint.to_le_bytes());
                    }
                }
                Err(fallback) => bail!("compositor-scene-unsupported: {fallback}"),
            }
        }
        // 场景纹理节点是 host 专属（`external-media-scene`）；wasm-safe 只走 DrawMedia 路径。
        #[cfg(feature = "host")]
        if let Some((boundary, fingerprint)) = self
            .chrome
            .as_ref()
            .map(|chrome| (chrome.next_change(time, self.fps), chrome.fingerprint))
        {
            next_change = min_optional_time(next_change, boundary);
            if let Some(pixmap) = self.template_frame(time)? {
                let pixmap = Arc::new(pixmap);
                let texture = format!("template-chrome:{fingerprint:016x}");
                let media_ms = (time * 1_000.0).round() as i64;
                let node = element_draw::TextureNode {
                    texture: texture.clone(),
                    media_ms,
                    source_width: self.width,
                    source_height: self.height,
                    rect: [0.0, 0.0, self.width as f32, self.height as f32],
                    transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                    opacity: 1.0,
                    radius: 0.0,
                    mask_shape: element_draw::TextureMaskShape::RoundedRect,
                    mask_feather: 0.0,
                    source_effects: Arc::from([]),
                    reveal: 1.0,
                    iris: 1.0,
                    fit: element_draw::TextureFit::Cover,
                    background: element_draw::TextureBackground::Transparent,
                };
                match scene_identity {
                    SceneIdentity::Full => identity.extend_from_slice(
                        &texture_scene_fingerprint(&node, pixmap.data()).to_le_bytes(),
                    ),
                    // chrome 光栅由 (场景指纹, 画布, 字体) 唯一决定；采样钟已在
                    // 节点元数据里，不必重复混入。
                    SceneIdentity::Structural => {
                        let pixel_hash = structural_pixel_hash(&[
                            b"template-chrome",
                            &fingerprint.to_le_bytes(),
                            &self.width.to_le_bytes(),
                            &self.height.to_le_bytes(),
                            self.original_style.font_name.as_bytes(),
                        ]);
                        identity.extend_from_slice(
                            &texture_scene_fingerprint_with_pixel_hash(&node, pixel_hash)
                                .to_le_bytes(),
                        );
                    }
                    SceneIdentity::Skip => {}
                }
                self.media.dynamic.insert(texture, pixmap);
                nodes.push(element_draw::SceneNode::Texture(Arc::new(node)));
            }
        }
        let reference = reference.finish();
        if want_identity {
            identity.extend_from_slice(&render_raster::fingerprint(&reference).to_le_bytes());
        }
        Ok(element_draw::SceneFrame {
            nodes,
            next_change,
            active_until,
            fingerprint: if want_identity {
                render_raster::drawop::fnv1a64(&identity)
            } else {
                0
            },
        })
    }

    /// 一幅整画布 premultiplied CPU 光栅（字幕层 / 带文字动画的文字元素）→ 一个
    /// 1:1 的 [`element_draw::TextureNode`]：按非零 alpha 包围盒（`bounds`
    /// 为 `None` 时现算；`Some(None)` = 已知整帧透明）裁出
    /// [`motion_texture_window`]，像素注入 `dynamic`，节点矩形落在整数坐标、
    /// 与源尺寸相等、变换恒等——线性采样器在这种映射下逐纹素取值，与 CPU 参考
    /// 的 DrawMedia source-over 同像素。
    ///
    /// 槽名由调用方给**稳定**的名字（字幕层按计划定义键，文字元素按元素 id）：
    /// 离屏导出的外部纹理按槽名常驻，逐帧换名会让长片导出无限堆显存。内容变化
    /// 由身份（`structural` = 帧键代理，`Full` = 真像素）与调用方给的 `media_ms`
    /// 承载：`media_ms` 进身份，所以它在静止段必须保持不变（不要直接填 `time`）。
    /// 返回本节点的 scene 身份（`Skip` 或整帧透明时 `None`）。
    #[cfg(feature = "host")]
    #[allow(clippy::too_many_arguments)]
    fn compositor_raster_texture_node(
        &mut self,
        texture: String,
        rgba: &[u8],
        bounds: Option<Option<&ContentBox>>,
        media_ms: i64,
        scene_identity: SceneIdentity,
        structural: u64,
        nodes: &mut Vec<element_draw::SceneNode>,
    ) -> Result<Option<u64>> {
        let (width, height) = (self.width as usize, self.height as usize);
        let computed;
        let bounds = match bounds {
            Some(bounds) => bounds,
            None => {
                computed = alpha_bbox(rgba, width, height);
                computed.as_ref()
            }
        };
        let Some(bounds) = bounds else {
            return Ok(None);
        };
        let (x, y, w, h) = motion_texture_window(bounds, width, height);
        let mut pixmap =
            Pixmap::new(w as u32, h as u32).ok_or_else(|| anyhow!("无法创建光栅纹理 {w}x{h}"))?;
        let data = pixmap.data_mut();
        for row in 0..h {
            let source = ((y + row) * width + x) * 4;
            data[row * w * 4..(row + 1) * w * 4].copy_from_slice(&rgba[source..source + w * 4]);
        }
        let node = element_draw::TextureNode {
            texture: texture.clone(),
            media_ms,
            source_width: w as u32,
            source_height: h as u32,
            rect: [x as f32, y as f32, w as f32, h as f32],
            transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            opacity: 1.0,
            radius: 0.0,
            mask_shape: element_draw::TextureMaskShape::RoundedRect,
            mask_feather: 0.0,
            source_effects: Arc::from([]),
            reveal: 1.0,
            iris: 1.0,
            fit: element_draw::TextureFit::Cover,
            background: element_draw::TextureBackground::Transparent,
        };
        let fingerprint = match scene_identity {
            SceneIdentity::Full => Some(texture_scene_fingerprint(&node, pixmap.data())),
            SceneIdentity::Structural => {
                Some(texture_scene_fingerprint_with_pixel_hash(&node, structural))
            }
            SceneIdentity::Skip => None,
        };
        self.media.dynamic.insert(texture, Arc::new(pixmap));
        nodes.push(element_draw::SceneNode::Texture(Arc::new(node)));
        Ok(fingerprint)
    }

    /// 为一个可见 native 媒体元素解码源帧并冻结 TextureNode。像素按元素级槽
    /// 注入 `dynamic`，随后离屏 host 可通过 [`Self::compositor_texture_frame`]
    /// 取走；这样同一 `srcId` 的两个独立媒体钟不会覆盖彼此。
    /// 白板件 → 天然尺寸揭示纹理 + 普通 external-media scene。CPU 只做白板
    /// 时间场的 threshold；fit / mask / tile / transition / pose blur 由 GPU 节点
    /// 完成，不再先光栅一张整画布纹理。纹理名按元素 id 固定，`media_ms` 用项目
    /// 帧区分；结构指纹只混入 (定义键, 元素 id, 采样帧, 源尺寸)，与像素无关。
    #[cfg(feature = "host")]
    fn compositor_whiteboard_node(
        &mut self,
        element: &TimelineVisualElement,
        time: f64,
        pose: timeline::AnimationPose,
        scene_identity: SceneIdentity,
        nodes: &mut Vec<element_draw::SceneNode>,
    ) -> Result<Option<u64>> {
        let source_id = element.src_id.as_deref().with_context(|| {
            format!(
                "compositor-scene-unsupported: 白板元素 {} 缺少 srcId",
                element.id
            )
        })?;
        let source = self.media.base.frame(source_id, -1)?;
        let texture = format!("whiteboard:{}", element.id);
        // 揭示场按**元素盒的实际像素**跑，不按源图天然尺寸：这张图最后是画进那
        // 个盒子的，源图多大与每帧该算多少像素无关。几何只读宽高比，所以先拿自
        // 然尺寸探一遍盒子、再按那个尺寸缩源，两遍不会得到两个盒子。
        let target = {
            let mut probe_view = external_media_view(element, &texture, time);
            probe_view.kind = ElementKind::Image;
            probe_view.fx = None;
            element_draw::external_media_scene_nodes_at(
                &probe_view,
                (((time * self.fps).floor() / self.fps) * 1_000.0).round() as i64,
                &pose,
                self.stage(),
                element_draw::ExternalMediaMetadata::image(source.width(), source.height()),
                &mut |_| {},
            )
            .and_then(|probe| scene_texture_target_px(&probe, source.width(), source.height()))
            .and_then(|(width, height)| {
                self.whiteboard_target_px(
                    element,
                    source.width(),
                    source.height(),
                    f64::from(width),
                    f64::from(height),
                )
            })
        };
        let source = self.whiteboard_source_at(source_id, &source, target);
        let pixmap = Arc::new(self.whiteboard_source_frame(element, source_id, &source, time)?);
        let media_ms = (((time * self.fps).floor() / self.fps) * 1_000.0).round() as i64;
        let mut view = external_media_view(element, &texture, time);
        // The injected pixels already contain the whiteboard reveal. Geometry is exactly
        // the image path; presenting it as Whiteboard here would let Web claim ownership
        // without running the host reveal stage.
        view.kind = ElementKind::Image;
        // Effects were applied before reveal because they participate in ink/color
        // classification. Re-applying them in the texture pass would be both wrong and slow.
        view.fx = None;
        let mut warnings = Vec::new();
        let scene_nodes = element_draw::external_media_scene_nodes_at(
            &view,
            media_ms,
            &pose,
            self.stage(),
            element_draw::ExternalMediaMetadata::image(pixmap.width(), pixmap.height()),
            &mut |message| warnings.push(message),
        );
        let detail = warnings.join("；");
        self.drain_element_warnings(warnings);
        let scene_nodes = scene_nodes.ok_or_else(|| {
            anyhow!(
                "compositor-scene-unsupported: 白板元素 {} 无法进入外部纹理 scene{}",
                element.id,
                if detail.is_empty() {
                    String::new()
                } else {
                    format!("：{detail}")
                }
            )
        })?;
        debug_assert!(scene_nodes.iter().all(texture_scene_node_is_supported));
        let fingerprint = match scene_identity {
            SceneIdentity::Full => Some(texture_scene_nodes_fingerprint(
                &scene_nodes,
                render_raster::drawop::fnv1a64(pixmap.data()),
            )),
            SceneIdentity::Structural => Some(texture_scene_nodes_fingerprint(
                &scene_nodes,
                structural_pixel_hash(&[
                    b"whiteboard",
                    self.definition_key.as_bytes(),
                    element.id.as_bytes(),
                    &media_ms.to_le_bytes(),
                    &pixmap.width().to_le_bytes(),
                    &pixmap.height().to_le_bytes(),
                ]),
            )),
            SceneIdentity::Skip => None,
        };
        self.media.dynamic.insert(texture, pixmap);
        nodes.extend(scene_nodes);
        Ok(fingerprint)
    }

    #[cfg(feature = "host")]
    fn compositor_media_nodes(
        &mut self,
        element: &TimelineVisualElement,
        time: f64,
        pose: &timeline::AnimationPose,
        scene_identity: SceneIdentity,
    ) -> Result<(Vec<element_draw::SceneNode>, Option<u64>)> {
        let source_id = element.src_id.as_deref().with_context(|| {
            format!(
                "compositor-scene-unsupported: 元素 {} 的外部纹理缺少 srcId",
                element.id
            )
        })?;
        let time_varying = self.media.base.is_time_varying(source_id);
        let media_ms = self.timeline_media_time_ms(element, time);
        // GPU 合成路径与 CPU overlay 必须取同一张图，换色也不例外。
        let recolored = self.recolored_source_id(element, source_id);
        let source_id = recolored.as_deref().unwrap_or(source_id);
        let texture = format!("timeline-media:{}", element.id);
        // 矢量动图（Lottie / 动画 SVG）按**元素盒的实际像素尺寸**光栅，不按原件
        // 尺寸：纹理最后是画进那个盒子的，原件多大与要算多少像素无关。1024² 的
        // 原件画进 461² 的贴纸盒，多出来的四倍像素要逐层分配、合成、上传，最后
        // 被 GPU 缩掉——`bars_bottom` 声波满画幅都只要 3 ms/帧的工程里，这一笔
        // 能占掉四分之三的导出时间。
        //
        // 先用自然尺寸走一遍**纯几何**量出占多少像素：几何只读宽高比
        // （`external_media_scene_nodes_at` 里 `height = width × h / w`），等比
        // 缩放出来的节点逐字段相同，两遍不会得到两个盒子。
        //
        // 带 `fx` 的元素除外：效果链的半径是**画布短边**折出来的、落在纹理自身
        // 分辨率上（`lower_texture_effects(element.fx, short)`），纹理一变小，同
        // 一个模糊半径盖住的比例就变了。省那点光栅不值得改已有成片的像素。
        let target = element
            .fx
            .is_none()
            .then(|| self.media.base.vector_natural_size(source_id))
            .flatten()
            .and_then(|(natural_width, natural_height)| {
                let probe = element_draw::external_media_scene_nodes_at(
                    &external_media_view(element, &texture, time),
                    media_ms,
                    pose,
                    self.stage(),
                    element_draw::ExternalMediaMetadata::video(natural_width, natural_height),
                    &mut |_| {},
                )?;
                scene_texture_target_px(&probe, natural_width, natural_height)
            });
        let pixmap = self
            .media
            .base
            .animated_frame_for_target(source_id, media_ms, target)
            .unwrap_or_else(|| self.media.base.frame(source_id, media_ms))?;
        let metadata = if time_varying {
            element_draw::ExternalMediaMetadata::video(pixmap.width(), pixmap.height())
        } else {
            element_draw::ExternalMediaMetadata::image(pixmap.width(), pixmap.height())
        };
        let mut warnings = Vec::new();
        let nodes = element_draw::external_media_scene_nodes_at(
            &external_media_view(element, &texture, time),
            media_ms,
            pose,
            self.stage(),
            metadata,
            &mut |message| warnings.push(message),
        );
        let detail = warnings.join("；");
        self.drain_element_warnings(warnings);
        let nodes = nodes.ok_or_else(|| {
            anyhow!(
                "compositor-scene-unsupported: 元素 {} 无法进入外部纹理 scene{}",
                element.id,
                if detail.is_empty() {
                    String::new()
                } else {
                    format!("：{detail}")
                }
            )
        })?;
        debug_assert!(nodes.iter().all(texture_scene_node_is_supported));
        // Full 要把**整帧解码像素**过一遍 FNV-1a：720p 实测 3.3 ms/帧，1080p/4K
        // 成十倍地涨。Structural 用「取帧参数」代替像素：同一 `MediaStore` 内
        // `(源 id, media_ms)` 唯一决定这张图，换色源 id 也在其中。见 [`SceneIdentity`]。
        let fingerprint = match scene_identity {
            SceneIdentity::Full => Some(texture_scene_nodes_fingerprint(
                &nodes,
                render_raster::drawop::fnv1a64(pixmap.data()),
            )),
            SceneIdentity::Structural => Some(texture_scene_nodes_fingerprint(
                &nodes,
                structural_pixel_hash(&[
                    texture.as_bytes(),
                    source_id.as_bytes(),
                    &media_ms.to_le_bytes(),
                    &pixmap.width().to_le_bytes(),
                    &pixmap.height().to_le_bytes(),
                ]),
            )),
            SceneIdentity::Skip => None,
        };
        self.media.dynamic.insert(texture, pixmap);
        Ok((nodes, fingerprint))
    }

    /// 离屏 compositor 在提交 scene 前取走当前可见纹理。这里只暴露已解码的
    /// premultiplied RGBA，不泄漏 `MediaStore` 或平台 decoder 状态。
    #[cfg(feature = "host")]
    pub fn compositor_texture_frame(
        &mut self,
        texture: &str,
        media_ms: i64,
    ) -> Result<Arc<Pixmap>> {
        self.media.frame(texture, media_ms)
    }

    /// 静态检查当前计划是否能完整进入 [`Self::compositor_scene_frame`]。
    pub fn compositor_scene_support(&self) -> Result<()> {
        if self.includes.subtitles
            && let Some(fallback) = self.subtitle_scene_static_fallback_with_target_sampling(true)
        {
            bail!("compositor-scene-unsupported: {fallback}");
        }
        Ok(())
    }

    /// 元素边界与逐帧窗口的唯一调度口径。CPU overlay 与 SceneFrame 共用，
    /// 避免为了求 `next_change` 先完整录一次 DrawOp 再把元素求值第二遍。
    fn element_next_change(&self, time: f64, active: &[TimelineVisualElement]) -> Option<f64> {
        let mut next_change = None;
        for element in &self.elements {
            for boundary in [element.start, element.end] {
                if boundary > time + 1e-9 {
                    next_change =
                        Some(next_change.map_or(boundary, |current: f64| current.min(boundary)));
                }
            }
        }
        for element in active {
            let time_varying_media = element
                .src_id
                .as_deref()
                .is_some_and(|id| self.media.base.is_time_varying(id));
            let whiteboard_drawing = element.kind == ElementKind::Whiteboard
                && element
                    .whiteboard
                    .as_ref()
                    .and_then(|props| props.draw)
                    .is_none_or(|draw| {
                        let duration = (element.end - element.start).max(0.0);
                        time + 1e-9 < element.start + draw.min(duration)
                    });
            let text_motion = (element.kind == ElementKind::Text
                && text_element_has_motion(element))
            .then(|| text_element_motion_phase(element, time, self.fps));
            if let Some(TextElementMotionPhase::Still { until, .. }) = text_motion
                && until > time + 1e-9
            {
                next_change = Some(next_change.map_or(until, |current: f64| current.min(until)));
            }
            if element.animation.is_some()
                || element.has_visual_keyframes()
                || matches!(
                    element.kind,
                    ElementKind::Video
                        | ElementKind::Visualizer
                        | ElementKind::Progress
                        | ElementKind::Confetti
                )
                // 带分层文字动画的文字元素只在动的帧逐帧光栅（入场 / 循环 / 退场）；
                // 静止段走下面的 `Still` 分支，直接跳到下一个边界。
                || text_motion == Some(TextElementMotionPhase::Changing)
                // 白板只在 draw 窗内逐帧揭示（手也在动）；显式 draw 结束后的
                // hold 段复用最后一张 source texture，不再空转到元素 end。
                || whiteboard_drawing
                || time_varying_media
            {
                let frame_boundary = ((time * self.fps).floor() + 1.0) / self.fps;
                next_change =
                    Some(next_change.map_or(frame_boundary, |current| current.min(frame_boundary)));
            }
            if let Some(counter) = &element.counter {
                let value = counter.value_at(element.start, element.end, time);
                let boundary = match counter.mode {
                    timeline::schema::CounterMode::Countup => {
                        element.start + value as f64 + 1.0
                    }
                    timeline::schema::CounterMode::Countdown => {
                        element.end - value.saturating_sub(1) as f64
                    }
                };
                if boundary > time + 1e-9 && boundary < element.end - 1e-9 {
                    next_change =
                        Some(next_change.map_or(boundary, |current| current.min(boundary)));
                }
            }
        }
        next_change
    }

    pub fn render_drawop_overlay_frame(
        &mut self,
        time: f64,
        subtitle: Option<RenderedSubtitleFrame>,
    ) -> Result<RenderedOverlayFrame> {
        self.render_drawop_layer(time, subtitle, OverlayParts::ALL)
    }

    /// [`Self::render_drawop_overlay_frame`] 的实体，另由调用方挑时间轴元素 / 模板
    /// 前景画不画。只有 CPU 导出的分层（[`Self::render_export_overlay`]）要拆开画；
    /// 其余入口恒为 [`OverlayParts::ALL`]，指令流与拆分前逐字节相同。
    fn render_drawop_layer(
        &mut self,
        time: f64,
        subtitle: Option<RenderedSubtitleFrame>,
        parts: OverlayParts,
    ) -> Result<RenderedOverlayFrame> {
        let (frame_ops, next_change) = self.build_overlay_ops(time, subtitle.as_ref(), parts)?;
        // 整图身份仍取 **DrawOp 原语指纹**：overlay 是一张折叠计划，指令流与
        // 输出 surface 一一对应，换成 surface 指纹只会让 `X-Bcut-DrawOp-Fingerprint`
        // 的历史取值再失效一次（客户端只做等值比较，换值没有收益）。
        let draw_op_fingerprint = render_raster::fingerprint(&frame_ops);
        // 折叠 FramePlan：执行器对这个形状直接调 `rasterize_with_media`，
        // 与旧路径同一个函数调用、逐字节相同。
        let plan = render_raster::FramePlan::single_draw(
            self.width,
            self.height,
            frame_ops,
            self.capability,
        );
        debug_assert!(plan.is_folded());
        let pixmap = render_raster::execute_plan(&plan, &mut self.executor, &mut self.media, None)?;
        Ok(RenderedOverlayFrame {
            // 字幕层的内容键原样上浮，供 serve 与几何侧车配对；整图身份另由
            // `draw_op_fingerprint` 表示，两者不可互相顶替。
            subtitle_key: subtitle.map(|subtitle| subtitle.key),
            draw_op_fingerprint,
            rgba: pixmap.data().to_vec(),
            next_change,
        })
    }

    /// 组装一帧 overlay 的 **DrawOp 指令流**（不光栅化）。
    ///
    /// [`Self::render_drawop_overlay_frame`] 与
    /// [`Self::element_drawop_fingerprint`] 共用这一个组装器——指纹出口与真正
    /// 上屏/导出的那一帧**同源**是硬要求：一旦分家，跨引擎门禁比的就不再是
    /// 同一条指令流（元素方案 §9.1 的 wasm 对拍同理）。
    fn build_overlay_ops(
        &mut self,
        time: f64,
        subtitle: Option<&RenderedSubtitleFrame>,
        parts: OverlayParts,
    ) -> Result<(FrameOps, Option<f64>)> {
        self.media.dynamic.clear();
        let mut builder = FrameBuilder::default();
        builder.push(DrawOp::Clear {
            color: [0.0, 0.0, 0.0, 0.0],
        });

        let active = self
            .elements
            .iter()
            .filter(|element| {
                let t = self.sample_time_for(&element.id, time);
                parts.elements && t >= element.start && t < element.end
            })
            .cloned()
            .collect::<Vec<_>>();
        let mut next_change = subtitle.and_then(|subtitle| subtitle.next_change);
        if let Some(boundary) = self.element_next_change(time, &active) {
            next_change = Some(next_change.map_or(boundary, |current| current.min(boundary)));
        }
        for mut element in active {
            let time = self.sample_time_for(&element.id, time);
            element.keyframe_place(time);
            let pose = timeline::resolve_animation_pose(
                element.animation.as_ref(),
                element.start,
                Some(element.end),
                self.duration,
                time,
                self.fps,
            );
            match element.kind {
                ElementKind::Text => {
                    let pixmap = self.render_text_element(&element, time)?;
                    let asset_name = dynamic_raster_asset_name("text", &element.id, pixmap.data());
                    self.media
                        .dynamic
                        .insert(asset_name.clone(), Arc::new(pixmap));
                    let asset = builder.string_id(&asset_name);
                    builder.push(DrawOp::DrawMedia {
                        asset,
                        media_ms: -1,
                        src: [0.0; 4],
                        tf: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                    });
                }
                // shape / visualizer / progress 是**矢量直出**：不经离屏 Pixmap，
                // 直接把 FillRect/FillPath/StrokePath 录进同一条指令流，
                // 因此天然进 DrawOp 指纹、天然可下沉进 wasm（设计 §9.1）。
                ElementKind::Shape => self.push_shape_element(&mut builder, &element, pose),
                ElementKind::Visualizer => {
                    self.push_visualizer_element(&mut builder, &element, time, pose);
                }
                ElementKind::Progress => {
                    self.push_progress_element(&mut builder, &element, time, pose);
                }
                ElementKind::Confetti => {
                    self.push_confetti_element(&mut builder, &element, time, pose);
                }
                ElementKind::Draw => self.push_draw_element(&mut builder, &element, pose),
                ElementKind::Placeholder
                    if self.push_placeholder_element(&mut builder, &element, pose) => {}
                // sticker 是唯一**按 props 分家**的 kind（P7b）：`template` 源
                // 与 shape 同路（矢量直出、进 wasm），`asset` 源与 image / video
                // 同路（离屏光栅化 + `DrawMedia`）。落到下面那条 fallthrough 的
                // 只可能是 `asset`。
                ElementKind::Sticker if self.push_sticker_element(&mut builder, &element, pose) => {
                }
                ElementKind::Image
                | ElementKind::Video
                | ElementKind::Sticker
                | ElementKind::Placeholder
                | ElementKind::Whiteboard => {
                    if let Some(pixmap) = self.render_media_element(&element, time, pose)? {
                        let asset_name =
                            dynamic_raster_asset_name("media", &element.id, pixmap.data());
                        self.media
                            .dynamic
                            .insert(asset_name.clone(), Arc::new(pixmap));
                        let asset = builder.string_id(&asset_name);
                        builder.push(DrawOp::DrawMedia {
                            asset,
                            media_ms: -1,
                            src: [0.0; 4],
                            tf: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                        });
                    }
                }
                ElementKind::Audio => {}
            }
        }
        if let Some(subtitle) = subtitle {
            let subtitle_asset_name =
                dynamic_raster_asset_name("subtitle", "layer", subtitle.rgba.as_slice());
            let subtitle_pixmap = Pixmap::from_vec(
                (*subtitle.rgba).clone(),
                IntSize::from_wh(self.width, self.height).context("subtitle layer 尺寸非法")?,
            )
            .context("subtitle layer RGBA 尺寸非法")?;
            self.media
                .dynamic
                .insert(subtitle_asset_name.clone(), Arc::new(subtitle_pixmap));
            let subtitle_asset = builder.string_id(&subtitle_asset_name);
            builder.push(DrawOp::DrawMedia {
                asset: subtitle_asset,
                media_ms: -1,
                src: [0.0; 4],
                tf: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            });
        }
        // 模板装饰层最后画：`RESERVED_Z` 的语义就是「前景恒在正片与元素之上」。
        //
        // 形态照抄上面的字幕层（离屏 Pixmap → 动态资源 → 一条 DrawMedia），而不是
        // 把装饰的 FrameOps 并进 builder：两份指令流各有自己的 path/string/paint
        // 内插表，合并要整套重映射 id，为一层前景不值得。
        if let Some((boundary, fingerprint)) = self
            .chrome
            .as_ref()
            .filter(|_| parts.chrome)
            .map(|chrome| (chrome.next_change(time, self.fps), chrome.fingerprint))
        {
            if let Some(boundary) = boundary {
                next_change = Some(next_change.map_or(boundary, |current| current.min(boundary)));
            }
            if let Some(pixmap) = self.template_frame(time)? {
                // 资源名带**这一帧的像素身份**：DrawOp 指纹只看指令流，名字不变
                // 就等于宣称画面没变。字幕层用 `subtitle.key` 解决同一个问题。
                let stamp = render_raster::drawop::fnv1a64(pixmap.data());
                let name = format!("tplchrome:{fingerprint}:{stamp:016x}");
                self.media.dynamic.insert(name.clone(), Arc::new(pixmap));
                let asset = builder.string_id(&name);
                builder.push(DrawOp::DrawMedia {
                    asset,
                    media_ms: -1,
                    src: [0.0; 4],
                    tf: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                });
            }
        }
        let frame_ops: FrameOps = builder.finish();
        Ok((frame_ops, next_change))
    }

    /// 当前 timeline 上**需要 host 光栅化**的元素 id（按声明序）。
    ///
    /// 判据与 `bcut-wasm` 的 `Preview::host_rasterized_elements` 逐条相同：
    /// text / image / video 恒需要；sticker 按 `source` 分家——`template` 是
    /// 矢量直出，其余（`asset`）走离屏 Pixmap；audio / shape / visualizer /
    /// progress 不需要。
    ///
    /// 这里过滤的是**已经过 `includes.allows()` 的** `self.elements`，与 wasm
    /// 侧一致：被 include 过滤掉的元素本来就不会进指令流。
    pub fn host_rasterized_elements(&self) -> Vec<&str> {
        self.elements
            .iter()
            .filter(|element| match element.kind {
                ElementKind::Text
                | ElementKind::Image
                | ElementKind::Video
                | ElementKind::Whiteboard => true,
                ElementKind::Sticker => {
                    element.sticker.as_ref().map(|props| props.source.as_str())
                        != Some(timeline::schema::STICKER_SOURCE_TEMPLATE)
                }
                ElementKind::Placeholder => element.src_id.is_some(),
                ElementKind::Audio
                | ElementKind::Shape
                | ElementKind::Visualizer
                | ElementKind::Progress
                | ElementKind::Confetti
                | ElementKind::Draw => false,
            })
            .map(|element| element.id.as_str())
            .collect()
    }

    /// 当前 `t` 的**元素层 DrawOp 指纹**（十六进制 16 位）。
    ///
    /// 与 `bcut-wasm` 的 `fingerprintAt`、CLI `studio export` 的
    /// `X-Bcut-DrawOp-Fingerprint` 同一个函数（`render_raster::fingerprint`）、
    /// 同一条指令流（[`Self::build_overlay_ops`]，`subtitle = None` 分支），
    /// 因此三端逐位可比——这是 M4 退出条件 5 矢量四类那一段的门禁出口。
    ///
    /// **不含字幕层**：字幕层的 `DrawMedia` 只在
    /// [`Self::render_overlay_frame`] 那条路上录入。含 host 光栅化元素时本方法
    /// **主动报错**而不是给一个假的跨引擎可比值——wasm 没有这些元素的宿主
    /// 光栅结果，无法生成同一条指令流。与
    /// [`RenderedOverlayFrame::draw_op_fingerprint`]（整幅 overlay 的像素身份，
    /// 含字幕层）是两个数，不可互相顶替。
    pub fn element_drawop_fingerprint(&mut self, time: f64) -> Result<String> {
        // 模板层是 host 光栅化的一张 Pixmap；wasm 没有这份宿主结果，带装饰时
        // 主动报错，而不是给一个跨引擎比不了的数。
        if self.chrome.is_some() {
            bail!(
                "element_drawop_fingerprint 只在纯矢量元素的 timeline 上与导出指纹可比；\
                 本项目套用了模板层（host 光栅化）"
            );
        }
        let blocked = self.host_rasterized_elements();
        if !blocked.is_empty() {
            let ids = blocked.join(", ");
            bail!(
                "element_drawop_fingerprint 只在纯矢量元素的 timeline 上与导出指纹可比；这些元素需要 host 光栅化：{ids}"
            );
        }
        let (frame_ops, _) = self.build_overlay_ops(time, None, OverlayParts::ALL)?;
        Ok(format!("{:016x}", render_raster::fingerprint(&frame_ops)))
    }

    /// 测试用：导出走 `composite_bgra` 的 fast path，此入口保留 DrawOp 全路径。
    pub fn render_rgba(&mut self, time: f64) -> Result<Vec<u8>> {
        Ok(self.render_overlay_frame(time)?.rgba)
    }

    /// App v2 预览的取帧入口：与 [`Self::render_png`] 走**同一次**
    /// `render_overlay_frame`，只是把 PNG 编码那一步省掉——GPUI 直接上传
    /// premultiplied RGBA，再编码一次 PNG 纯属浪费。
    ///
    /// 两个入口同帧同像素是契约（主方案 M1-R3「同一内核同一输入应当同像素」），
    /// 由 `render_png_is_the_encoded_form_of_render_rgba_frame` 守着。
    /// 三个身份各司其职，不可互相顶替：`subtitle_key` 是字幕层内容键
    /// （`X-Bcut-Overlay-Key`），`draw_op_fingerprint` 是整幅 overlay 的像素身份
    /// （`X-Bcut-DrawOp-Fingerprint`），`next_change` 是下一次内容变化的时刻
    /// （`X-Bcut-Overlay-Next`）。
    pub fn render_rgba_frame(&mut self, time: f64) -> Result<OverlayRgbaFrame> {
        let frame = self.render_overlay_frame(time)?;
        Ok(OverlayRgbaFrame {
            width: self.width,
            height: self.height,
            subtitle_key: frame.subtitle_key.unwrap_or_default(),
            draw_op_fingerprint: frame.draw_op_fingerprint,
            rgba: frame.rgba,
            next_change: frame.next_change,
        })
    }

    pub fn render_png(&mut self, time: f64) -> Result<OverlayFrame> {
        let frame = self.render_overlay_frame(time)?;
        let size = IntSize::from_wh(self.width, self.height).context("overlay 尺寸必须大于零")?;
        let pixmap = Pixmap::from_vec(frame.rgba, size).context("overlay RGBA 缓冲区尺寸无效")?;
        Ok(OverlayFrame {
            // 走 `render_overlay_frame` 就一定有字幕层；`unwrap_or_default` 只是
            // 类型上的收口，不是可达分支。
            subtitle_key: frame.subtitle_key.unwrap_or_default(),
            draw_op_fingerprint: frame.draw_op_fingerprint,
            png: pixmap.encode_png().context("编码字幕 overlay PNG")?,
            next_change: frame.next_change,
        })
    }

    /// 导出路径（`--render-backend cpu`，以及 GPU 场景整帧回退）的分层 overlay
    /// 与全体变化边界。叠放顺序与 GPU 场景（[`Self::compositor_scene_frame_with`]）
    /// 一致：时间轴元素 → 字幕 → 模板前景。
    ///
    /// 字幕层单独成层、保留自己的混合模式，所以 Designed Caption 的复合模式读到的
    /// 底色是「主画面 + 元素」（与 GPU 的 target sampling 同一语义），又不会作用到
    /// 模板前景上。字幕这一刻为空、或上面没有任何元素 / 模板时，与字幕先后无关，
    /// 沿用「字幕一层 + 元素与模板折成一层」的形状：纯字幕、纯元素的帧逐位不变，
    /// 也省一次整幅光栅。
    pub fn render_export_overlay(
        &mut self,
        time: f64,
    ) -> Result<(Vec<ExportOverlayLayer>, Option<f64>)> {
        // 装饰层与元素层共用 `build_overlay_ops`，所以「要不要出这一层」的判据
        // 必须把装饰算进去：只看元素会让纯模板项目（一条元素都没有）在导出里
        // 丢掉整个前景。
        let elements_active = self
            .elements
            .iter()
            .any(|element| time >= element.start && time < element.end);
        let chrome_active = self
            .chrome
            .as_ref()
            .is_some_and(|chrome| chrome.active(time));
        let subtitle = self.render_subtitle_frame(time)?;
        let mut next_change = subtitle.next_change;
        for element in &self.elements {
            for boundary in [element.start, element.end] {
                if boundary > time + 1e-9 {
                    next_change =
                        Some(next_change.map_or(boundary, |current| current.min(boundary)));
                }
            }
        }
        if let Some(boundary) = self
            .chrome
            .as_ref()
            .and_then(|chrome| chrome.next_change(time, self.fps))
        {
            next_change = Some(next_change.map_or(boundary, |current| current.min(boundary)));
        }
        let has_subtitle = subtitle.bounds.is_some();
        let content = subtitle
            .bounds
            .map_or(OverlayContent::Empty, OverlayContent::Bounds);
        let subtitle_layer = ExportOverlayLayer {
            rgba: subtitle.rgba,
            content,
            composite: subtitle.composite,
        };
        let mut layers = Vec::with_capacity(3);
        let push_drawop = |plan: &mut Self,
                               layers: &mut Vec<ExportOverlayLayer>,
                               next_change: &mut Option<f64>,
                               parts: OverlayParts|
         -> Result<()> {
            let frame = plan.render_drawop_layer(time, None, parts)?;
            if let Some(boundary) = frame.next_change {
                *next_change = Some(next_change.map_or(boundary, |current| current.min(boundary)));
            }
            layers.push(ExportOverlayLayer {
                rgba: Arc::new(frame.rgba),
                content: OverlayContent::Unknown,
                composite: CaptionCompositeMode::Normal,
            });
            Ok(())
        };
        if !has_subtitle || !(elements_active || chrome_active) {
            layers.push(subtitle_layer);
            if elements_active || chrome_active {
                push_drawop(self, &mut layers, &mut next_change, OverlayParts::ALL)?;
            }
        } else {
            if elements_active {
                push_drawop(self, &mut layers, &mut next_change, OverlayParts::ELEMENTS)?;
            }
            layers.push(subtitle_layer);
            if chrome_active {
                push_drawop(self, &mut layers, &mut next_change, OverlayParts::CHROME)?;
            }
        }
        Ok((layers, next_change))
    }

    /// 保证 `self.composited` 覆盖 `time`。overlay 在 `[time, next_change)`
    /// 内逐像素不变（`next_change` 契约，Studio 预览端同样依赖），区间内的
    /// 后续帧零渲染成本；补丁窗回跳时间时自然缓存失效重渲。
    pub fn ensure_composited(&mut self, time: f64) -> Result<()> {
        if let Some(cached) = &self.composited
            && time >= cached.start
            && time < cached.end
        {
            return Ok(());
        }
        let (layers, next_change) = self.render_export_overlay(time)?;
        let end = next_change.unwrap_or(f64::INFINITY).max(time);
        let width = self.width as usize;
        let height = self.height as usize;
        let frames = layers
            .into_iter()
            .filter_map(|layer| {
                // 字幕层在渲染时就求出了包围盒；只有 DrawOp 全路径需要现扫。
                let bounds = match layer.content {
                    OverlayContent::Unknown => alpha_bbox(&layer.rgba, width, height),
                    OverlayContent::Empty => None,
                    OverlayContent::Bounds(bounds) => Some(bounds),
                }?;
                Some(CompositedFrame {
                    rgba: layer.rgba,
                    bounds,
                    composite: layer.composite,
                })
            })
            .collect();
        self.composited = Some(CompositedOverlay {
            start: time,
            end,
            frames,
        });
        Ok(())
    }

    /// 该输出时刻的 overlay 是否整帧透明——透明时 `composite_bgra` 完全不
    /// 触碰目标缓冲。
    pub fn overlay_is_blank(&mut self, time: f64) -> Result<bool> {
        self.ensure_composited(time)?;
        Ok(self
            .composited
            .as_ref()
            .is_none_or(|composited| composited.frames.is_empty()))
    }

    pub fn composite_bgra(&mut self, pixels: &mut [u8], stride: usize, time: f64) -> Result<()> {
        let width = self.width as usize;
        let height = self.height as usize;
        if pixels.len() < stride.saturating_mul(height) || stride < width * 4 {
            bail!("原生媒体后端提供了无效的 BGRA 帧缓冲区");
        }
        apply_main_transform_bgra(pixels, stride, self.width, self.height, self.main.as_ref())?;
        self.ensure_composited(time)?;
        let Some(frames) = self
            .composited
            .as_ref()
            .map(|composited| &composited.frames)
        else {
            return Ok(());
        };
        for frame in frames {
            // 只遍历非零 alpha 包围盒；盒外像素 alpha 恒为 0，混合是恒等操作。
            let (rows, cols) = (frame.bounds.rows.clone(), frame.bounds.cols.clone());
            for y in rows {
                let overlay = &frame.rgba[(y * width + cols.start) * 4..(y * width + cols.end) * 4];
                let out = &mut pixels[y * stride + cols.start * 4..y * stride + cols.end * 4];
                for (source, target) in overlay.chunks_exact(4).zip(out.chunks_exact_mut(4)) {
                    composite_caption_pixel_bgra(target, source, frame.composite);
                }
            }
        }
        Ok(())
    }

    /// GPU overlay 合成前只处理主画面的缩放/位置/透明度。导出宿主随后把这张
    /// BGRA 底图交给平台纹理直达或离屏 target sampling 路径；实时预览不走这条入口。
    /// 主画面层是否整段导出都恒等于「一张不透明纯黑底」。
    ///
    /// 媒体被「元素化」搬到时间轴之后（`main.detached`）就是这个形状：底图恒黑，
    /// 画面全部由时间轴元素画。此时源帧的每一个像素都到不了输出，导出可以整条
    /// 跳过「解码源帧 → 缩放拷进画布 → [`Self::prepare_video_bgra`] 填黑 →
    /// BGRA→RGBA swizzle → 上传 GPU」，改让合成器把目标清掉再叠 scene。
    ///
    /// `main.place` 不随时间变化，所以调用方只需在导出开始时问一次。
    pub fn base_frame_is_uniform_black(&self) -> bool {
        main_transform_is_uniform_black(self.main.as_ref())
    }

    pub fn base_frame_is_identity(&self) -> bool {
        main_transform_is_identity(self.main.as_ref(), self.width, self.height)
    }

    pub fn prepare_video_bgra(&self, pixels: &mut [u8], stride: usize) -> Result<()> {
        let width = self.width as usize;
        let height = self.height as usize;
        if pixels.len() < stride.saturating_mul(height) || stride < width * 4 {
            bail!("原生媒体后端提供了无效的 BGRA 帧缓冲区");
        }
        apply_main_transform_bgra(pixels, stride, self.width, self.height, self.main.as_ref())
    }
}

/// 一张 DrawOp overlay 里画哪些部分（字幕另由调用方决定给不给）。
#[derive(Debug, Clone, Copy)]
struct OverlayParts {
    /// 时间轴元素。
    elements: bool,
    /// 模板前景（chrome）。
    chrome: bool,
}

impl OverlayParts {
    const ALL: Self = Self {
        elements: true,
        chrome: true,
    };
    const ELEMENTS: Self = Self {
        elements: true,
        chrome: false,
    };
    const CHROME: Self = Self {
        elements: false,
        chrome: true,
    };
}

/// 把一整张 premultiplied RGBA normal overlay source-over 到不透明 BGRA 视频。
/// 保留给 normal-only host/reference 使用；需要读取 backdrop 的模式必须走合成器的
/// 显式纹理入口或 [`OverlayRenderPlan::composite_bgra`]。
pub fn composite_normal_rgba_bgra(
    pixels: &mut [u8],
    stride: usize,
    width: u32,
    height: u32,
    overlay: &[u8],
) -> Result<()> {
    let width = width as usize;
    let height = height as usize;
    let row_bytes = width.saturating_mul(4);
    if pixels.len() < stride.saturating_mul(height)
        || stride < row_bytes
        || overlay.len() != row_bytes.saturating_mul(height)
    {
        bail!("GPU overlay 或 BGRA 视频帧缓冲区尺寸无效");
    }
    for row in 0..height {
        let source = &overlay[row * row_bytes..(row + 1) * row_bytes];
        let target = &mut pixels[row * stride..row * stride + row_bytes];
        for (source, target) in source.chunks_exact(4).zip(target.chunks_exact_mut(4)) {
            composite_caption_pixel_bgra(target, source, CaptionCompositeMode::Normal);
        }
    }
    Ok(())
}

fn glyph_scene_mask(
    mask: GlyphAtlasRender,
) -> std::result::Result<Option<Arc<element_draw::GlyphMask>>, SubtitleSceneFallback> {
    let mask = match mask {
        GlyphAtlasRender::Mask(mask) => element_draw::GlyphMask::new(
            element_draw::GlyphKey(mask.key),
            mask.width,
            mask.height,
            mask.left,
            mask.top,
            mask.alpha,
        ),
        GlyphAtlasRender::Color(image) => element_draw::GlyphMask::new_color(
            element_draw::GlyphKey(image.key),
            image.width,
            image.height,
            image.left,
            image.top,
            image.rgba,
        ),
        GlyphAtlasRender::Empty => return Ok(None),
        GlyphAtlasRender::Unsupported => return Err(SubtitleSceneFallback::InvalidMask),
    };
    Ok(Some(Arc::new(
        mask.ok_or(SubtitleSceneFallback::InvalidMask)?,
    )))
}

/// CPU effect 层对彩色位图字形不画描边/阴影/发光；只有正文层保留 RGBA。
fn glyph_scene_effect_mask(
    mask: GlyphAtlasRender,
) -> std::result::Result<Option<Arc<element_draw::GlyphMask>>, SubtitleSceneFallback> {
    match mask {
        GlyphAtlasRender::Color(_) => Ok(None),
        other => glyph_scene_mask(other),
    }
}

/// 把一枚预乘 RGBA 字幕像素合到不透明 BGRA 视频像素。非 normal 模式按
/// Core Graphics/W3C 的 separable blend 公式，先在非预乘色域求 blend，
/// 再用源 alpha 做 source-over；这一步必须看到真实视频像素，不能在透明
/// overlay 上预先“烘焙”。
pub fn composite_caption_pixel_bgra(
    target: &mut [u8],
    source: &[u8],
    composite: CaptionCompositeMode,
) {
    let alpha = u32::from(source[3]);
    if alpha == 0 {
        return;
    }
    let inverse = 255 - alpha;
    for (source_index, target_index) in [(0, 2), (1, 1), (2, 0)] {
        let source_premultiplied = u32::from(source[source_index]);
        let backdrop = u32::from(target[target_index]);
        let value = match composite {
            CaptionCompositeMode::Normal => source_premultiplied + backdrop * inverse / 255,
            CaptionCompositeMode::Difference
            | CaptionCompositeMode::Exclusion
            | CaptionCompositeMode::Screen => {
                let source_color = ((source_premultiplied * 255 + alpha / 2) / alpha).min(255);
                let blended = match composite {
                    CaptionCompositeMode::Difference => backdrop.abs_diff(source_color),
                    CaptionCompositeMode::Exclusion => {
                        backdrop + source_color - 2 * backdrop * source_color / 255
                    }
                    CaptionCompositeMode::Screen => {
                        backdrop + source_color - backdrop * source_color / 255
                    }
                    CaptionCompositeMode::Normal => unreachable!(),
                };
                (blended * alpha + backdrop * inverse + 127) / 255
            }
        };
        target[target_index] = value.min(255) as u8;
    }
    target[3] = 255;
}

/// 该时刻「当前词」的下标。空白词不能当当前词——它没有可高亮的字形，
/// 落在空白上会让整行看起来没有活动词。先向前找最近的非空白词，找不到再向后。
///
/// 缓存键与实际渲染都用它，必须是同一个函数：两处各写一遍就是两种「现在念到
/// 哪个词」的意见，缓存会开始返回配不上这一帧的图。
pub fn current_word_index(item: &TimedItem, time: f64) -> usize {
    let current = item
        .words
        .iter()
        .position(|word| time < word.end)
        .unwrap_or_else(|| item.words.len().saturating_sub(1));
    (0..=current)
        .rev()
        .find(|&index| {
            item.words
                .get(index)
                .is_some_and(|word| !word.text.trim().is_empty())
        })
        .or_else(|| {
            (current + 1..item.words.len()).find(|&index| !item.words[index].text.trim().is_empty())
        })
        .unwrap_or(current)
}

/// `definition_key + subtitle_key` 的确定性 64-bit 投影。字幕 key 只描述当前
/// cue/词/动画帧；字体、样式、画布等计划定义必须同时进入 SceneFrame 身份，
/// 否则两个不同项目会错误复用 retained scene。
pub fn subtitle_scene_fingerprint(definition_key: &str, key: &str) -> u64 {
    definition_key
        .as_bytes()
        .iter()
        .chain(std::iter::once(&0xff))
        .chain(key.as_bytes())
        .fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x100_0000_01b3)
        })
}

/// 文本元素在 GPU SceneFrame 身份里的贡献。
///
/// `definition_key` 只覆盖**磁盘投影文档** + 画布/fps/模式/includes；App 舞台
/// 拖拽时的预览直接改内存 `OverlayRenderPlan` 上的 `place`，磁盘真相不动。
/// 身份若只由 `definition_key + id + time` 组成，它对文本几何完全不敏感，
/// 每一帧预览都会被 SceneFrame 去重守卫整帧丢掉——选框在动、glyph 却要等
/// 松手提交才跳过去。所以这里把所有能改变文本 scene 节点的元素字段一并折
/// 进 key：时间窗、几何 `Place`（x/y/w/scale/scaleY/rot/opacity/radius/镜像）、
/// 垂直锚点、平铺、文案与计数、样式和动画。
///
/// 全部字段走 `Debug` / 定长格式化：没有 HashMap 迭代序，也没有指针地址
/// （`serde_json::Value` 的 object 是有序 `Map`），因此同一份元素重复求值必
/// 然得到同一个值，去重守卫对"什么都没动"的帧仍然成立。
fn text_element_scene_fingerprint(
    definition_key: &str,
    element: &TimelineVisualElement,
    time: f64,
) -> u64 {
    let key = format!(
        "text:{id}:{time:.6}:{start:?}:{end:?}:{place:?}:{valign:?}:{tile:?}:{animation:?}:{text:?}:{counter:?}:{style}",
        id = element.id,
        start = element.start,
        end = element.end,
        place = element.place,
        valign = element.vertical_align,
        tile = element.tile,
        animation = element.animation,
        text = element.text,
        counter = element.counter,
        style = element.style,
    );
    subtitle_scene_fingerprint(definition_key, &key)
}

fn subtitle_scene_motion(
    style: &Value,
    display_start: f64,
    canvas_scale: f64,
    fps: f64,
    anchor: (f64, f64),
    rotation: f64,
) -> Option<element_draw::SceneMotion> {
    let transition = style.get("transition").unwrap_or(&Value::Null);
    let id = transition
        .get("transitionId")
        .or_else(|| transition.get("id"))
        .and_then(Value::as_str)
        .or_else(|| style.get("transitionId").and_then(Value::as_str))
        .unwrap_or("none");
    let recipe = render_raster::caption_transition(id)?;
    let duration = transition_duration(style);
    if !duration.is_finite() || duration <= 0.0 {
        return None;
    }
    let fps = fps.max(1.0);
    let start = (display_start * fps).round() / fps;
    let end = start + duration;
    let from = transition_pose(style, start, start, canvas_scale, fps);
    Some(element_draw::SceneMotion {
        start,
        end,
        from: element_draw::ScenePose {
            transform: transform_array(group_transform(
                anchor.0,
                anchor.1,
                from.scale_x,
                from.scale_y,
                rotation,
            )),
            opacity: from.opacity as f32,
            blur: from.blur as f32,
        },
        to: element_draw::ScenePose {
            transform: transform_array(group_transform(anchor.0, anchor.1, 1.0, 1.0, rotation)),
            opacity: 1.0,
            blur: 0.0,
        },
        curve: recipe.curve.clone(),
        solver: if recipe.solver == "newton6-bisect10-1e-6" {
            element_draw::SceneCurveSolver::Caption
        } else {
            element_draw::SceneCurveSolver::Standard
        },
    })
}

fn is_external_media_element(element: &TimelineVisualElement) -> bool {
    matches!(element.kind, ElementKind::Image | ElementKind::Video)
        || element.kind == ElementKind::Placeholder && element.src_id.is_some()
        || element.kind == ElementKind::Sticker
            && element
                .sticker
                .as_ref()
                .is_some_and(|props| props.source == timeline::schema::STICKER_SOURCE_ASSET)
}

fn element_display_text(element: &TimelineVisualElement, time: f64) -> String {
    element
        .counter
        .as_ref()
        .map(|counter| counter.text_at(element.start, element.end, time))
        .unwrap_or_else(|| element.text.clone().unwrap_or_default())
}

/// TextureNode 的 renderer-neutral 身份。像素只折成一个 hash，避免把一整张源帧
/// 复制进 scene identity 临时缓冲；几何、采样钟与 fit/background 仍逐字段冻结。
#[cfg(feature = "host")]
fn texture_scene_fingerprint(node: &element_draw::TextureNode, rgba: &[u8]) -> u64 {
    texture_scene_fingerprint_with_pixel_hash(node, render_raster::drawop::fnv1a64(rgba))
}

#[cfg(feature = "host")]
fn texture_scene_fingerprint_with_pixel_hash(
    node: &element_draw::TextureNode,
    pixel_hash: u64,
) -> u64 {
    let mut bytes = Vec::with_capacity(node.texture.len() + 96 + node.source_effects.len() * 12);
    bytes.extend_from_slice(node.texture.as_bytes());
    bytes.push(0);
    bytes.extend_from_slice(&node.media_ms.to_le_bytes());
    bytes.extend_from_slice(&node.source_width.to_le_bytes());
    bytes.extend_from_slice(&node.source_height.to_le_bytes());
    for value in node.rect.into_iter().chain(node.transform) {
        bytes.extend_from_slice(&value.to_bits().to_le_bytes());
    }
    bytes.extend_from_slice(&node.opacity.to_bits().to_le_bytes());
    bytes.extend_from_slice(&node.radius.to_bits().to_le_bytes());
    bytes.push(match node.mask_shape {
        element_draw::TextureMaskShape::RoundedRect => 0,
        element_draw::TextureMaskShape::Ellipse => 1,
    });
    bytes.extend_from_slice(&node.mask_feather.to_bits().to_le_bytes());
    bytes.extend_from_slice(&(node.source_effects.len() as u32).to_le_bytes());
    for effect in node.source_effects.iter() {
        match *effect {
            element_draw::TextureEffect::ColorAdjust {
                grayscale,
                brightness,
            } => {
                bytes.push(0);
                bytes.extend_from_slice(&grayscale.to_bits().to_le_bytes());
                bytes.extend_from_slice(&brightness.to_bits().to_le_bytes());
            }
            element_draw::TextureEffect::Grayscale(amount) => {
                bytes.push(1);
                bytes.extend_from_slice(&amount.to_bits().to_le_bytes());
            }
            element_draw::TextureEffect::Brightness(amount) => {
                bytes.push(2);
                bytes.extend_from_slice(&amount.to_bits().to_le_bytes());
            }
            element_draw::TextureEffect::Contrast(amount) => {
                bytes.push(3);
                bytes.extend_from_slice(&amount.to_bits().to_le_bytes());
            }
            element_draw::TextureEffect::Saturation(amount) => {
                bytes.push(4);
                bytes.extend_from_slice(&amount.to_bits().to_le_bytes());
            }
            element_draw::TextureEffect::Sepia(amount) => {
                bytes.push(5);
                bytes.extend_from_slice(&amount.to_bits().to_le_bytes());
            }
            element_draw::TextureEffect::HueRotate(degrees) => {
                bytes.push(6);
                bytes.extend_from_slice(&degrees.to_bits().to_le_bytes());
            }
            element_draw::TextureEffect::Invert(amount) => {
                bytes.push(7);
                bytes.extend_from_slice(&amount.to_bits().to_le_bytes());
            }
            element_draw::TextureEffect::Blur(radius) => {
                bytes.push(8);
                bytes.extend_from_slice(&radius.to_le_bytes());
            }
            element_draw::TextureEffect::Sharpen(amount) => {
                bytes.push(9);
                bytes.extend_from_slice(&amount.to_bits().to_le_bytes());
            }
            element_draw::TextureEffect::Noise(amount) => {
                bytes.push(10);
                bytes.extend_from_slice(&amount.to_bits().to_le_bytes());
            }
            element_draw::TextureEffect::Vignette(amount) => {
                bytes.push(11);
                bytes.extend_from_slice(&amount.to_bits().to_le_bytes());
            }
        }
    }
    bytes.extend_from_slice(&node.reveal.to_bits().to_le_bytes());
    bytes.extend_from_slice(&node.iris.to_bits().to_le_bytes());
    bytes.push(match node.fit {
        element_draw::TextureFit::Cover => 0,
        element_draw::TextureFit::Contain => 1,
    });
    bytes.push(match node.background {
        element_draw::TextureBackground::Transparent => 0,
        element_draw::TextureBackground::Black => 1,
        element_draw::TextureBackground::Blur => 2,
        element_draw::TextureBackground::Color(_) => 3,
    });
    if let element_draw::TextureBackground::Color(rgb) = node.background {
        bytes.extend_from_slice(&rgb);
    }
    bytes.extend_from_slice(&pixel_hash.to_le_bytes());
    render_raster::drawop::fnv1a64(&bytes)
}

/// [`SceneIdentity::Structural`] 的像素代理：把决定一张纹理内容的几段字节拼起来
/// 哈希（段间放 0 分隔，避免「ab|c」与「a|bc」相撞）。
#[cfg(feature = "host")]
fn structural_pixel_hash(parts: &[&[u8]]) -> u64 {
    let mut bytes = Vec::with_capacity(parts.iter().map(|part| part.len() + 1).sum());
    for part in parts {
        bytes.extend_from_slice(part);
        bytes.push(0);
    }
    render_raster::drawop::fnv1a64(&bytes)
}

/// 把媒体元素的一组 scene 节点与它们共用的像素哈希（真像素或结构代理）合成一个身份。
#[cfg(feature = "host")]
fn texture_scene_nodes_fingerprint(nodes: &[element_draw::SceneNode], pixel_hash: u64) -> u64 {
    let mut node_fingerprints = nodes
        .iter()
        .map(|node| texture_scene_node_fingerprint(node, pixel_hash));
    let Some(first) = node_fingerprints.next() else {
        return pixel_hash;
    };
    let Some(second) = node_fingerprints.next() else {
        return first;
    };
    let mut bytes = Vec::with_capacity(nodes.len() * 8);
    bytes.extend_from_slice(&first.to_le_bytes());
    bytes.extend_from_slice(&second.to_le_bytes());
    for fingerprint in node_fingerprints {
        bytes.extend_from_slice(&fingerprint.to_le_bytes());
    }
    render_raster::drawop::fnv1a64(&bytes)
}

#[cfg(feature = "host")]
fn texture_scene_node_is_supported(node: &element_draw::SceneNode) -> bool {
    match node {
        element_draw::SceneNode::Texture(_) => true,
        element_draw::SceneNode::BlurredGroup(group) => {
            group.motion.is_none()
                && group.composite == element_draw::SceneCompositeMode::Normal
                && group.nodes.iter().all(texture_scene_node_is_supported)
        }
        _ => false,
    }
}

#[cfg(feature = "host")]
fn texture_scene_node_fingerprint(node: &element_draw::SceneNode, pixel_hash: u64) -> u64 {
    match node {
        element_draw::SceneNode::Texture(node) => {
            texture_scene_fingerprint_with_pixel_hash(node, pixel_hash)
        }
        element_draw::SceneNode::BlurredGroup(group) => {
            debug_assert!(group.motion.is_none());
            let mut bytes = Vec::with_capacity(5 + group.nodes.len() * 8);
            bytes.push(1);
            bytes.extend_from_slice(&group.radius.to_bits().to_le_bytes());
            bytes.push(match group.composite {
                element_draw::SceneCompositeMode::Normal => 0,
                element_draw::SceneCompositeMode::Screen => 1,
                element_draw::SceneCompositeMode::Difference => 2,
                element_draw::SceneCompositeMode::Exclusion => 3,
            });
            for child in &group.nodes {
                bytes.extend_from_slice(
                    &texture_scene_node_fingerprint(child, pixel_hash).to_le_bytes(),
                );
            }
            render_raster::drawop::fnv1a64(&bytes)
        }
        _ => unreachable!("外部媒体场景只允许 TextureNode / BlurredGroup"),
    }
}

/// 一条带分层文字动画的字幕在编译期冻结的量。`text_motion_state` 每帧被缓存键
/// 与 `next_change` 各调一次，词起点与字素数只取决于这条字幕与计划帧率，
/// 不该每帧重新分配、重新数一遍。
#[derive(Debug, Clone)]
struct TextMotionItem {
    /// 词起点（显示钟偏移，已吸到帧）；与 `text_motion_starts` 同一口径。
    starts: Arc<[f64]>,
    /// 字素数（至少 1），喂 `boundary_windows` / `changing_at`。
    units: usize,
    /// 译文行的 KTV 扫字跟着原文唱：与这条译文同时段的原文真实词 `(起, 止)`
    /// （项目秒）。原文行与不带 `karaoke` 的行为 `None`。
    karaoke_words: Option<Arc<[(f64, f64)]>>,
}

/// 按下标对齐 `items` 的动效表：这一条最终样式（整条轨叠逐条覆盖）带
/// `textMotion` 或 `wordBackground` 才是 `Some`。`fps` 与计划一致取 `max(1.0)`。
fn text_motion_items(
    items: &[TimedItem],
    kind: LineKind,
    base: &LineStyle,
    overrides: &HashMap<String, Arc<CueOverride>>,
    originals: &[TimedItem],
    fps: f64,
) -> Vec<Option<TextMotionItem>> {
    let fps = fps.max(1.0);
    items
        .iter()
        .map(|item| {
            let style = overrides.get(&item.id).map_or(base, |entry| &entry.style);
            (style.text_motion.is_some() || style.word_background.is_some()).then(|| {
                TextMotionItem {
                    starts: text_motion_starts(item, kind, fps).into(),
                    units: item.text.graphemes(true).count().max(1),
                    karaoke_words: (kind == LineKind::Translation
                        && style
                            .text_motion
                            .as_ref()
                            .is_some_and(|m| m.spec.karaoke.is_some()))
                    .then(|| karaoke_words_for(item, originals))
                    .flatten(),
                }
            })
        })
        .collect()
}

/// 译文没有自己的词时间：KTV 扫字借同时段的原文真实词。时段取这条译文的
/// 句级起止（派生词铺满 `start..end`），中点落在里面的原文词都算（相邻句贴着
/// 边界开唱的词不算）；派生占位词不算。一个都没有就不扫。
fn karaoke_words_for(item: &TimedItem, originals: &[TimedItem]) -> Option<Arc<[(f64, f64)]>> {
    let start = item.words.first().map_or(item.display_start, |w| w.start);
    let end = item.words.last().map_or(item.display_end, |w| w.end);
    let slack = 0.05;
    let words = originals
        .iter()
        .filter(|cue| cue.display_end >= start - slack && cue.display_start <= end + slack)
        .flat_map(|cue| cue.words.iter())
        .filter(|w| !w.id.starts_with("derived-"))
        .filter(|w| {
            let middle = (w.start + w.end.max(w.start)) / 2.0;
            middle >= start - slack && middle <= end + slack
        })
        .map(|w| (w.start, w.end.max(w.start)))
        .collect::<Vec<_>>();
    (!words.is_empty()).then(|| words.into())
}

/// KTV 预告下一句的最长间隔（秒）：再远就是间奏，下一句等它自己出场。
const KARAOKE_NEXT_LINE_MAX_GAP: f64 = 8.0;

/// [`active_at`] 的下标版：同一条 `partition_point` 判据。
fn active_index(items: &[TimedItem], time: f64) -> Option<usize> {
    let next = items.partition_point(|item| item.display_start <= time);
    next.checked_sub(1)
        .filter(|&index| time < items[index].display_end)
}

/// 文字元素的样式是否带分层文字动画 / 逐词底块（与 `text_element_scene_nodes`
/// 的回退判据同一口径）。
fn text_element_has_motion(element: &TimelineVisualElement) -> bool {
    element.style["textMotion"].is_object() || element.style["wordBackground"].is_object()
}

/// 带分层文字动画的文字元素在某一时刻的调度相位。
#[derive(Debug, Clone, Copy, PartialEq)]
enum TextElementMotionPhase {
    /// 这一帧在动（入场 / 退场 / 循环，或元素另带 `animation`）：逐帧重建。
    Changing,
    /// 静止段：整段同一张图。`anchor` 是段起点（项目秒），拿来当身份与采样钟；
    /// `until` 是下一个会变的时刻（退场开始的前半帧，没有退场就是元素 end）。
    Still { anchor: f64, until: f64 },
}

/// 与 `text_motion_raster` 采样同一口径：局部钟吸到帧、时长 = `end − start`、
/// 文字元素没有词时间（starts 为空，词强调不触发）、units = 显示文字的字素数。
/// 只有 `wordBackground`（没有 `textMotion`）时底块不随时间变，整段静止。
fn text_element_motion_phase(
    element: &TimelineVisualElement,
    time: f64,
    fps: f64,
) -> TextElementMotionPhase {
    if element.animation.is_some() || element.has_visual_keyframes() {
        return TextElementMotionPhase::Changing;
    }
    let fps = fps.max(1.0);
    let motion = element
        .style
        .get("textMotion")
        .filter(|value| value.is_object())
        .and_then(|value| {
            serde_json::from_value::<motion::text_motion::TextMotion>(value.clone()).ok()
        })
        .and_then(|motion| motion.compile().ok());
    let Some(motion) = motion else {
        return TextElementMotionPhase::Still {
            anchor: element.start,
            until: element.end,
        };
    };
    let duration = element.end - element.start;
    let local = ((time - element.start) * fps).round() / fps;
    let units = element_display_text(element, time)
        .graphemes(true)
        .count()
        .max(1);
    if motion.changing_at(local, duration, fps, units, &[]) {
        return TextElementMotionPhase::Changing;
    }
    let (enter, exit) = motion.boundary_windows(duration, fps, units);
    // 没有退场时 `exit == duration`，那半帧边界落在 end 前却什么都不变。
    let exit_at = element.start + exit - 0.5 / fps;
    TextElementMotionPhase::Still {
        anchor: element.start + enter,
        until: if exit < duration - 1e-9 && exit_at > time + 1e-9 {
            exit_at.min(element.end)
        } else {
            element.end
        },
    }
}

/// CPU 光栅层进 GPU 场景时裁出的纹理窗：一定盖住非零 alpha 包围盒，宽高向上取整到
/// 64 像素的倍数（不超画布；贴边时窗口往回挪）。窗口外本就全透明，所以任何盖住
/// 包围盒的窗都与整幅逐像素等价；取整只是让逐帧微动的包围盒复用同一尺寸的
/// GPU 纹理槽，不必每帧重建纹理与绑定。
#[cfg(feature = "host")]
fn motion_texture_window(
    bounds: &ContentBox,
    width: usize,
    height: usize,
) -> (usize, usize, usize, usize) {
    const BUCKET: usize = 64;
    let span = |len: usize, limit: usize| {
        len.max(1)
            .div_ceil(BUCKET)
            .saturating_mul(BUCKET)
            .min(limit)
    };
    let (w, h) = (
        span(bounds.cols.len(), width),
        span(bounds.rows.len(), height),
    );
    (
        bounds.cols.start.min(width - w),
        bounds.rows.start.min(height - h),
        w,
        h,
    )
}

fn min_optional_time(left: Option<f64>, right: Option<f64>) -> Option<f64> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left.min(right)),
        (Some(value), None) | (None, Some(value)) => Some(value),
        (None, None) => None,
    }
}

/// 字幕底板的唯一几何结果。CPU 光栅与 GPU scene 都消费这份 plate 列表，
/// 不在 DrawOp 侧重算折行、shared plate 或脱离堆栈的行。
fn subtitle_background_plates(layouts: &[LineLayout], stack: &StackLayout) -> Vec<SubtitlePlate> {
    let mut plates = Vec::new();
    if stack.shared_background
        && let Some(plate_line) = stack.plate_line.and_then(|index| layouts.get(index))
        && has_real_background(plate_line)
        && let Some((span_top, span_bottom)) = stack.span
    {
        // `span` 是字形范围，板向外扩一圈；三条边距都取自 `plate_line`，
        // 与 Mac `max(裸宽) + bg.padH × 2` 同构。
        let pad_h = plate_line.style.background_pad_h;
        let pad_v = plate_line.style.background_pad_v;
        let width = (layouts
            .iter()
            .zip(&stack.overrides)
            .filter(|(_, over)| over.is_none())
            .map(|(line, _)| line.width)
            .fold(0.0, f64::max)
            + pad_h * 2.0)
            .max(plate_line.style.background_min_width);
        plates.push(SubtitlePlate {
            rect: SubtitlePlateRect {
                x: stack.anchor.0 - width / 2.0,
                y: span_top - pad_v,
                width,
                height: span_bottom - span_top + pad_v * 2.0,
                radius: plate_line.style.background_radius,
            },
            color: plate_line.style.background_color,
            motion_line: if layouts.len() == 1 { Some(0) } else { None },
        });
    }

    for (index, layout) in layouts.iter().enumerate() {
        let floating = stack.overrides.get(index).is_some_and(Option::is_some);
        if !layout.style.background_on || (!floating && stack.shared_background) {
            continue;
        }
        let Some((center_x, top)) = stack.placements.get(index).copied() else {
            continue;
        };
        plates.extend(
            line_background_rects(layout, center_x, top)
                .into_iter()
                .map(|rect| SubtitlePlate {
                    rect,
                    color: layout.style.background_color,
                    motion_line: Some(index),
                }),
        );
    }
    plates
}

/// 把唯一 plate 几何编码成 renderer-neutral DrawOp；不引入第二套布局规则。
fn subtitle_background_ops(
    layouts: &[LineLayout],
    stack: &StackLayout,
    animation: &WordAnimation,
) -> FrameOps {
    let mut frame = FrameOps::default();
    for plate in subtitle_background_plates(layouts, stack) {
        let (opacity, transform) = plate
            .motion_line
            .and_then(|index| {
                let layout = layouts.get(index)?;
                let motion = layout_motion(layout, animation)?;
                let (center_x, top) = stack.placements.get(index).copied()?;
                Some((
                    motion.block.opacity,
                    group_transform_for_motion(
                        &motion.block,
                        center_x,
                        top + layout.height / 2.0,
                        layout.height,
                    ),
                ))
            })
            .unwrap_or((1.0, Transform::identity()));
        push_subtitle_plate(&mut frame, plate.rect, plate.color, opacity, transform);
    }
    frame
}

fn push_subtitle_plate(
    frame: &mut FrameOps,
    rect: SubtitlePlateRect,
    color: SubtitleColor,
    opacity: f64,
    transform: Transform,
) {
    frame.ops.push(DrawOp::FillRect {
        x: rect.x as f32,
        y: rect.y as f32,
        w: rect.width as f32,
        h: rect.height as f32,
        radius: rect.radius as f32,
        color: subtitle_scene_color(color, opacity),
        tf: transform_array(transform),
    });
}

const SUBTITLE_INTERLEAVED_RUN_LIMIT: usize = 128;

struct SubtitleWordPass {
    uniform_index: u32,
    /// CPU `draw_line_layout` 在本 chunk 字形之前落的经典逐词底板或 Designed
    /// Caption 程序化底板；已经带好 scene pose/motion，可直接按绘制顺序插入。
    before: Vec<element_draw::SceneNode>,
    /// CPU `draw_line_layout` 在本 chunk 字形之后落的普通/逐词下划线。
    after: FrameOps,
    /// 当前 chunk 是否需要 descriptor 声明的 `glyphDuplicate` 层。数组本身为保持
    /// uniform index 对齐也包含翻译行的透明项；只有该位为真才装配节点。
    duplicate: bool,
    /// neon glow / weight shift 的固定描边层。未活动阶段仍提交透明 uniform，
    /// 所以节点与 alpha-mask geometry 跨帧保持同一身份。
    recipe_stroke: bool,
    /// 当前 chunk 是否有稳定 emoji 几何。即使本帧效果未活动也保持该节点，透明度
    /// 由 decoration uniform 置零，后续帧不会重新 shape / 光栅。
    emoji: bool,
}

fn push_subtitle_word_background(
    frame: &mut FrameOps,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    radius: f64,
    color: SubtitleColor,
    opacity: f64,
    transform: Transform,
) {
    frame.ops.push(DrawOp::FillRect {
        x: x as f32,
        y: y as f32,
        w: width as f32,
        h: height as f32,
        radius: radius as f32,
        color: subtitle_scene_color(color, opacity),
        tf: transform_array(transform),
    });
}

/// `GlyphRender::ColorBitmap` 在 CPU reference 中不进入 echo/duplicate 分支。
/// 大多数字幕都是 alpha mask，此时直接复用正文 Arc；混合彩色字形时才构造并
/// 限容缓存一份过滤后的稳定 geometry。
fn duplicate_glyph_geometry(
    geometry_key: &str,
    geometry: &Arc<[element_draw::GlyphInstance]>,
    geometry_cache: &mut VecDeque<(String, Arc<[element_draw::GlyphInstance]>)>,
) -> Arc<[element_draw::GlyphInstance]> {
    if geometry.iter().all(|glyph| !glyph.mask.pixels.is_color()) {
        return Arc::clone(geometry);
    }
    let cache_key = format!("{geometry_key}:duplicate-alpha");
    let duplicate = geometry_cache
        .iter()
        .position(|(key, _)| key == &cache_key)
        .and_then(|index| geometry_cache.remove(index))
        .map(|(_, geometry)| geometry)
        .unwrap_or_else(|| {
            geometry
                .iter()
                .filter(|glyph| !glyph.mask.pixels.is_color())
                .cloned()
                .collect::<Vec<_>>()
                .into()
        });
    geometry_cache.push_front((cache_key, Arc::clone(&duplicate)));
    while geometry_cache.len() > 48 {
        geometry_cache.pop_back();
    }
    duplicate
}

#[allow(clippy::too_many_arguments)]
fn compact_glyph_segment(
    geometry: &Arc<[element_draw::GlyphInstance]>,
    uniforms: &[element_draw::GlyphRunUniform],
    uniform_indices: &[u32],
    texture: Option<&Arc<element_draw::GlyphTexture>>,
    pose: element_draw::ScenePose,
    motion: Option<&element_draw::SceneMotion>,
    composite: element_draw::GlyphCompositeMode,
    cache_key: &str,
    geometry_cache: &mut VecDeque<(String, Arc<[element_draw::GlyphInstance]>)>,
) -> Option<element_draw::GlyphRun> {
    let is_complete_run = uniform_indices.len() == uniforms.len()
        && uniform_indices
            .iter()
            .enumerate()
            .all(|(index, uniform)| *uniform as usize == index);
    if is_complete_run {
        return (!geometry.is_empty()).then(|| element_draw::GlyphRun {
            glyphs: Arc::clone(geometry),
            uniforms: uniforms.to_vec(),
            texture: texture.cloned(),
            composite,
            pose,
            motion: motion.cloned(),
        });
    }
    let mut remap = vec![u32::MAX; uniforms.len()];
    let mut compact_uniforms = Vec::with_capacity(uniform_indices.len());
    for &global_index in uniform_indices {
        let slot = remap.get_mut(global_index as usize)?;
        if *slot != u32::MAX {
            continue;
        }
        *slot = u32::try_from(compact_uniforms.len()).ok()?;
        compact_uniforms.push(*uniforms.get(global_index as usize)?);
    }
    let compact_geometry = geometry_cache
        .iter()
        .position(|(key, _)| key == cache_key)
        .and_then(|index| geometry_cache.remove(index))
        .map(|(_, geometry)| geometry)
        .unwrap_or_else(|| {
            geometry
                .iter()
                .filter_map(|glyph| {
                    let local_index = *remap.get(glyph.uniform_index as usize)?;
                    (local_index != u32::MAX).then(|| {
                        let mut glyph = glyph.clone();
                        glyph.uniform_index = local_index;
                        glyph
                    })
                })
                .collect::<Vec<_>>()
                .into()
        });
    if compact_geometry.is_empty() {
        return None;
    }
    geometry_cache.push_front((cache_key.to_owned(), Arc::clone(&compact_geometry)));
    while geometry_cache.len() > 48 {
        geometry_cache.pop_back();
    }
    Some(element_draw::GlyphRun {
        glyphs: compact_geometry,
        uniforms: compact_uniforms,
        texture: texture.cloned(),
        composite,
        pose,
        motion: motion.cloned(),
    })
}

#[allow(clippy::too_many_arguments)]
fn push_glyph_fill_segment(
    nodes: &mut Vec<element_draw::SceneNode>,
    uniform_indices: &[u32],
    geometry_key: &str,
    layer_key: &str,
    geometry: &Arc<[element_draw::GlyphInstance]>,
    uniforms: &[element_draw::GlyphRunUniform],
    texture: Option<&Arc<element_draw::GlyphTexture>>,
    pose: element_draw::ScenePose,
    motion: Option<&element_draw::SceneMotion>,
    composite: element_draw::GlyphCompositeMode,
    geometry_cache: &mut VecDeque<(String, Arc<[element_draw::GlyphInstance]>)>,
) {
    let segment = uniform_indices
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",");
    if let Some(run) = compact_glyph_segment(
        geometry,
        uniforms,
        uniform_indices,
        texture,
        pose,
        motion,
        composite,
        &format!("{geometry_key}:{layer_key}:{segment}"),
        geometry_cache,
    ) {
        nodes.push(element_draw::SceneNode::Glyphs(Arc::new(run)));
    }
}

#[allow(clippy::too_many_arguments)]
fn push_glyph_segment(
    nodes: &mut Vec<element_draw::SceneNode>,
    uniform_indices: &[u32],
    geometry_key: &str,
    outline_geometry: &Arc<[element_draw::GlyphInstance]>,
    geometry: &Arc<[element_draw::GlyphInstance]>,
    outline_uniforms: &[element_draw::GlyphRunUniform],
    uniforms: &[element_draw::GlyphRunUniform],
    texture: Option<&Arc<element_draw::GlyphTexture>>,
    pose: element_draw::ScenePose,
    motion: Option<&element_draw::SceneMotion>,
    composite: element_draw::GlyphCompositeMode,
    geometry_cache: &mut VecDeque<(String, Arc<[element_draw::GlyphInstance]>)>,
) {
    if uniform_indices.is_empty() {
        return;
    }
    let segment = uniform_indices
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",");
    if let Some(run) = compact_glyph_segment(
        outline_geometry,
        outline_uniforms,
        uniform_indices,
        None,
        pose,
        motion,
        composite,
        &format!("{geometry_key}:outline:{segment}"),
        geometry_cache,
    ) {
        nodes.push(element_draw::SceneNode::Glyphs(Arc::new(run)));
    }
    push_glyph_fill_segment(
        nodes,
        uniform_indices,
        geometry_key,
        "fill",
        geometry,
        uniforms,
        texture,
        pose,
        motion,
        composite,
        geometry_cache,
    );
}

fn push_word_vector_node(
    nodes: &mut Vec<element_draw::SceneNode>,
    frame: FrameOps,
    pose: element_draw::ScenePose,
    motion: Option<&element_draw::SceneMotion>,
) {
    if frame.ops.is_empty() {
        return;
    }
    nodes.push(element_draw::SceneNode::AnimatedVectors {
        frame: Arc::new(frame),
        pose,
        motion: motion.cloned(),
    });
}

#[allow(clippy::too_many_arguments)]
fn push_interleaved_word_nodes(
    nodes: &mut Vec<element_draw::SceneNode>,
    passes: Vec<SubtitleWordPass>,
    geometry_key: &str,
    outline_geometry: &Arc<[element_draw::GlyphInstance]>,
    geometry: &Arc<[element_draw::GlyphInstance]>,
    duplicate_geometry: &Arc<[element_draw::GlyphInstance]>,
    decoration_geometry: &Arc<[element_draw::GlyphInstance]>,
    outline_uniforms: &[element_draw::GlyphRunUniform],
    uniforms: &[element_draw::GlyphRunUniform],
    duplicate_uniform_layers: &[Vec<element_draw::GlyphRunUniform>],
    recipe_stroke_uniform_layers: &[Vec<element_draw::GlyphRunUniform>],
    decoration_uniforms: &[element_draw::GlyphRunUniform],
    texture: Option<&Arc<element_draw::GlyphTexture>>,
    pose: element_draw::ScenePose,
    motion: Option<&element_draw::SceneMotion>,
    composite: element_draw::GlyphCompositeMode,
    geometry_cache: &mut VecDeque<(String, Arc<[element_draw::GlyphInstance]>)>,
) {
    let mut pending = Vec::new();
    for SubtitleWordPass {
        uniform_index,
        before,
        after,
        duplicate,
        recipe_stroke,
        emoji,
    } in passes
    {
        if !before.is_empty() || duplicate || recipe_stroke || emoji {
            push_glyph_segment(
                nodes,
                &pending,
                geometry_key,
                outline_geometry,
                geometry,
                outline_uniforms,
                uniforms,
                texture,
                pose,
                motion,
                composite,
                geometry_cache,
            );
            pending.clear();
            // CPU `draw_caption_recipe_decorations` 在 plate、duplicate、outline 与
            // 正文之前执行；emoji 必须留在同一个逐词 z 槽，而不是按类型汇总到
            // 全部正文之前或之后。
            if emoji {
                push_glyph_fill_segment(
                    nodes,
                    &[uniform_index],
                    geometry_key,
                    "decoration-emoji",
                    decoration_geometry,
                    decoration_uniforms,
                    None,
                    pose,
                    motion,
                    composite,
                    geometry_cache,
                );
            }
            nodes.extend(before);
            if duplicate {
                let duplicate_layer_key = if Arc::ptr_eq(duplicate_geometry, geometry) {
                    "fill"
                } else {
                    "duplicate"
                };
                for layer_uniforms in duplicate_uniform_layers {
                    push_glyph_fill_segment(
                        nodes,
                        &[uniform_index],
                        geometry_key,
                        duplicate_layer_key,
                        duplicate_geometry,
                        layer_uniforms,
                        None,
                        pose,
                        motion,
                        composite,
                        geometry_cache,
                    );
                }
            }
            if recipe_stroke {
                for layer_uniforms in recipe_stroke_uniform_layers {
                    push_glyph_fill_segment(
                        nodes,
                        &[uniform_index],
                        geometry_key,
                        "recipe-stroke",
                        duplicate_geometry,
                        layer_uniforms,
                        None,
                        pose,
                        motion,
                        composite,
                        geometry_cache,
                    );
                }
            }
        }
        pending.push(uniform_index);
        if !after.ops.is_empty() {
            push_glyph_segment(
                nodes,
                &pending,
                geometry_key,
                outline_geometry,
                geometry,
                outline_uniforms,
                uniforms,
                texture,
                pose,
                motion,
                composite,
                geometry_cache,
            );
            pending.clear();
            push_word_vector_node(nodes, after, pose, motion);
        }
    }
    push_glyph_segment(
        nodes,
        &pending,
        geometry_key,
        outline_geometry,
        geometry,
        outline_uniforms,
        uniforms,
        texture,
        pose,
        motion,
        composite,
        geometry_cache,
    );
}

/// CPU `draw_line_layout` 的下划线口径：默认 0.10em 基线偏移、至少 1px 的
/// 0.06em 线高与 0.03em 圆角。经典逐词 Paint 可覆盖 offset，并与对应 chunk
/// 字形按 CPU 顺序交错；Designed Caption 的 plate/duplicate 已走各自 retained
/// 节点，其余 recipe 装饰仍类型化回退。
fn push_subtitle_underline(
    frame: &mut FrameOps,
    x: f64,
    y: f64,
    width: f64,
    font_size: f64,
    color: SubtitleColor,
    opacity: f64,
    transform: Transform,
) {
    frame.ops.push(DrawOp::FillRect {
        x: x as f32,
        y: y as f32,
        w: width as f32,
        h: (font_size * 0.06).max(1.0) as f32,
        radius: (font_size * 0.03) as f32,
        color: subtitle_scene_color(color, opacity),
        tf: transform_array(transform),
    });
}

fn subtitle_scene_color(color: SubtitleColor, opacity: f64) -> [f32; 4] {
    [
        f32::from(color.r) / 255.0,
        f32::from(color.g) / 255.0,
        f32::from(color.b) / 255.0,
        (((255 - color.a) as f64 / 255.0) * opacity).clamp(0.0, 1.0) as f32,
    ]
}

/// scene 的稳定几何只认计划定义与当前可见行；逐词状态、入场 pose 和颜色均由
/// run uniform 承担。Designed Caption 的分组布局会在同一 cue id 内替换可见词，
/// 因而还要编码实际行/词签名；普通整句字幕的签名跨逐词边界不变。双语模式把
/// kind 一并编码，防止相同 id 的原文/译文相撞。textSwap 的逐帧替字签名由
/// [`subtitle_glyph_geometry_key_with_visuals`] 追加，不能混进这个静态布局键。
pub fn subtitle_glyph_geometry_key(definition_key: &str, layouts: &[LineLayout]) -> String {
    let lines = layouts
        .iter()
        .map(|layout| {
            let kind = match layout.kind {
                LineKind::Original => 'o',
                LineKind::Translation => 't',
            };
            let visible = layout
                .lines
                .iter()
                .map(|line| {
                    line.chunks
                        .iter()
                        .map(|chunk| {
                            chunk
                                .word
                                .map_or_else(|| "-".to_owned(), |word| word.to_string())
                        })
                        .collect::<Vec<_>>()
                        .join(",")
                })
                .collect::<Vec<_>>()
                .join("/");
            format!("{kind}:{}:{visible}", layout.item.id)
        })
        .collect::<Vec<_>>()
        .join("|");
    format!("{definition_key}:{lines}")
}

fn subtitle_scene_word_visuals(
    layouts: &[LineLayout],
    animation: &WordAnimation,
) -> Vec<WordVisual> {
    let mut visuals = Vec::new();
    for layout in layouts {
        for line in layout.lines.iter() {
            for chunk in &line.chunks {
                let visual = if layout.kind == LineKind::Original
                    && !animation.name.eq_ignore_ascii_case("none")
                {
                    chunk
                        .word
                        .and_then(|index| {
                            layout.item.words.get(index).map(|_| {
                                word_visual(
                                    animation,
                                    &layout.item,
                                    index,
                                    layout.current_word,
                                    layout.render_time,
                                    layout.render_fps,
                                )
                            })
                        })
                        .unwrap_or_default()
                } else {
                    WordVisual::default()
                };
                visuals.push(visual);
            }
        }
    }
    visuals
}

fn subtitle_glyph_geometry_key_with_visuals(
    definition_key: &str,
    layouts: &[LineLayout],
    visuals: &[WordVisual],
) -> String {
    let key = subtitle_glyph_geometry_key(definition_key, layouts);
    let mut swaps = Vec::new();
    for (index, text) in visuals.iter().enumerate().filter_map(|(index, visual)| {
        visual
            .recipe
            .as_ref()
            .and_then(|state| state.text_swap.as_deref())
            .map(|text| (index, text))
    }) {
        swaps.extend_from_slice(&(index as u64).to_le_bytes());
        swaps.extend_from_slice(&(text.len() as u64).to_le_bytes());
        swaps.extend_from_slice(text.as_bytes());
    }
    if swaps.is_empty() {
        key
    } else {
        format!("{key}:swap:{:016x}", render_raster::drawop::fnv1a64(&swaps))
    }
}

/// glyph uniform + 有序 vector/procedural pass 当前能完整表达的经典逐词状态：
/// 颜色、不透明度、垂直 bounce、Highlight/Custom 底板与 Paint 下划线；Designed
/// Caption 准入单 glyph、repeat-linear gradient + glyph，以及程序化 highlight/pill
/// 底板、echo/RGB glyph duplicate + glyph、尾置 metadata-only glyphDuplicate 的
/// editorial colorMix、retained emoji + glyph，以及在项目 fps 网格切换局部字形
/// geometry 的 textSwap、固定 quad 的扫描线/确定性粒子，以及带内容身份的单纹理
/// repeat fill；除该规范纹理外必须无资产，全部 operator/channel 都要有精确 scene
/// 表达。其余多层 glyph 继续显式回退，不能按 style id 猜能力。
pub fn glyph_uniform_animation_supported(animation: &WordAnimation) -> bool {
    let Some(design) = animation.caption.as_ref() else {
        return [&animation.spoken, &animation.active, &animation.unspoken]
            .into_iter()
            .all(|visual| visual.recipe.is_none());
    };
    let Some(descriptor) = caption_recipe_design_descriptor(design) else {
        return false;
    };
    let layers_supported = matches!(descriptor.layers.as_slice(), [glyphs] if glyphs == "glyphs")
        || matches!(descriptor.layers.as_slice(), [gradient, glyphs]
            if gradient == "gradientFill" && glyphs == "glyphs")
        || matches!(descriptor.layers.as_slice(), [texture, glyphs]
            if texture == "textureFill" && glyphs == "glyphs")
        || matches!(descriptor.layers.as_slice(), [plate, glyphs]
            if matches!(plate.as_str(), "highlightPlate" | "pill") && glyphs == "glyphs")
        || matches!(descriptor.layers.as_slice(), [duplicate, glyphs]
            if duplicate == "glyphDuplicate" && glyphs == "glyphs")
        || matches!(descriptor.layers.as_slice(), [glyphs, duplicate]
            if glyphs == "glyphs" && duplicate == "glyphDuplicate")
        || matches!(descriptor.layers.as_slice(), [glyphs, emoji]
            if glyphs == "glyphs" && emoji == "emoji")
        || matches!(descriptor.layers.as_slice(), [duplicate, scanlines, glyphs]
            if duplicate == "glyphDuplicate"
                && scanlines == "scanlines"
                && glyphs == "glyphs")
        || matches!(descriptor.layers.as_slice(), [particles, glyphs]
            if particles == "particles" && glyphs == "glyphs");
    let uses_texture = descriptor.layers.iter().any(|layer| layer == "textureFill");
    let assets_supported = if uses_texture {
        !descriptor.assets.is_empty() && caption_recipe_glyph_texture_available(animation)
    } else {
        descriptor.assets.is_empty()
    };
    layers_supported
        && assets_supported
        && descriptor.events.iter().all(|event| {
            matches!(
                event.op.as_str(),
                "transform"
                    | "glyphMask"
                    | "clip"
                    | "plate"
                    | "duplicate"
                    | "decoration"
                    | "textSwap"
                    | "glow"
                    | "weight"
            ) && event.channels.iter().all(|channel| {
                matches!(
                    channel.as_str(),
                    "opacity"
                        | "dx"
                        | "dy"
                        | "scaleX"
                        | "scaleY"
                        | "rotation"
                        | "colorMix"
                        | "clipL"
                        | "clipR"
                        | "clipT"
                        | "clipB"
                        | "fillProgress"
                        | "plateX"
                        | "plateW"
                        | "plateH"
                        | "plateR"
                        | "echo"
                        | "rgbSplit"
                        | "burst"
                        | "emojiPop"
                        | "scramble"
                        | "glowGain"
                        | "weightAxis"
                )
            })
        })
}

fn glyph_uniform_paint(
    animation: &WordAnimation,
    visual: &WordVisual,
    opacity: f64,
) -> element_draw::GlyphPaint {
    if caption_recipe_uses_texture_fill(animation) {
        return element_draw::GlyphPaint::RepeatTexture;
    }
    let Some(gradient) = caption_recipe_repeat_linear_gradient(animation, visual) else {
        return element_draw::GlyphPaint::Solid;
    };
    element_draw::GlyphPaint::RepeatLinearGradient {
        start: [gradient.start[0] as f32, gradient.start[1] as f32],
        end: [gradient.end[0] as f32, gradient.end[1] as f32],
        first: glyph_uniform_color(gradient.first, opacity),
        middle: glyph_uniform_color(gradient.middle, opacity),
    }
}

fn glyph_uniform_color(color: SubtitleColor, opacity: f64) -> [f32; 4] {
    [
        f32::from(color.r) / 255.0,
        f32::from(color.g) / 255.0,
        f32::from(color.b) / 255.0,
        (((255 - color.a) as f64 / 255.0) * opacity).clamp(0.0, 1.0) as f32,
    ]
}

fn transform_array(transform: Transform) -> [f32; 6] {
    [
        transform.sx,
        transform.ky,
        transform.kx,
        transform.sy,
        transform.tx,
        transform.ty,
    ]
}

/// 非零 alpha 的行/列包围盒（半开区间；实现在 `render_raster::effects`）。
pub fn alpha_bbox(rgba: &[u8], width: usize, height: usize) -> Option<ContentBox> {
    render_raster::effects::alpha_bbox(rgba, width, height)
}

/// [`alpha_bbox`] 的限定窗口版本：`window` 必须是非零像素的超集，此时结果与
/// 全帧扫描逐字段相同。字幕路径的窗口来自 [`DrawBounds`]（跟着落笔走）。
pub fn alpha_bbox_within(
    rgba: &[u8],
    width: usize,
    height: usize,
    window: &ContentBox,
) -> Option<ContentBox> {
    render_raster::effects::alpha_bbox_within(rgba, width, height, window)
}

/// 字幕堆栈摆放的一次解算结果，见 [`OverlayRenderPlan::stack_layout`]。
pub struct StackLayout {
    /// 全局锚点（画布像素），转场缩放与整组旋转都绕它。
    pub anchor: (f64, f64),
    /// 每行的位置覆盖（与 `layouts` 同序）。
    pub overrides: Vec<Option<(f64, f64)>>,
    /// 共享底板取哪一行的样式（`layouts` 下标）。
    pub plate_line: Option<usize>,
    pub shared_background: bool,
    /// 每行的 `(字形中心 x, 字形顶 y)`（与 `layouts` 同序）。
    pub placements: Vec<(f64, f64)>,
    /// 仍在堆栈里的行的纵向跨度。
    pub span: Option<(f64, f64)>,
}

/// 几何侧车的一条行，见 [`OverlayRenderPlan::subtitle_layout`]。
#[derive(Debug, Clone, PartialEq)]
pub struct SubtitleLayoutLine {
    pub kind: &'static str,
    pub cue_id: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub detached: bool,
}

/// 几何侧车的一帧，见 [`OverlayRenderPlan::subtitle_layout`]。
#[derive(Debug, Clone, PartialEq)]
pub struct SubtitleLayoutFrame {
    pub key: String,
    pub width: u32,
    pub height: u32,
    pub rotation: f64,
    pub anchor: (f64, f64),
    pub lines: Vec<SubtitleLayoutLine>,
    /// 倒鸭子接管原文轨时的行几何（§3.2 舞台拾取、§3.3 编辑态）；`None` = 没有序列层。
    pub sequence: Option<SequenceLayout>,
}

/// 序列层这一帧的一行：画布像素四角 + 写盘要用的段局部坐标。
#[derive(Debug, Clone, PartialEq)]
pub struct SequenceLayoutRow {
    /// 行键 = 行首词 id。
    pub key: String,
    pub cue_id: String,
    /// 首词起点（点行 → 播放头跳到这里）。
    pub onset: f64,
    pub pinned: bool,
    pub rot_deg: f64,
    /// 段局部世界坐标，540 短边单位（`captionSequences.pins[key].center` 的口径）。
    pub local_center: [f64; 2],
    /// 画布像素，顺时针：左上、右上、右下、左下。
    pub quad: [[f64; 2]; 4],
    /// 这一帧画了它（历史行淡着也算画了；编辑态全部为真）。
    pub visible: bool,
}

/// 序列层这一帧的几何与统计。
#[derive(Debug, Clone, PartialEq)]
pub struct SequenceLayout {
    /// 当前段下标 / 段键（播放头落在任何段之前时都是 `None`）。
    pub seq_index: Option<usize>,
    pub seq_key: Option<String>,
    pub seq_count: usize,
    /// 全轨行数。
    pub row_total: usize,
    pub pinned_total: usize,
    pub editing: bool,
    /// 画布 1 像素 = 多少世界像素（编辑态相机角度为零，位移只需除以缩放）。
    pub world_per_px: f64,
    /// 540 短边单位 1 = 多少世界像素。
    pub unit_px: f64,
    pub diagnostics: Vec<String>,
    /// 当前段的行（编辑态全出；播放态只出画了的）。
    pub rows: Vec<SequenceLayoutRow>,
}

/// 编辑态（§3.3「调整布局」）：镜头改成总览、整段每一行都实显；`drag` 是正在拖的行
/// 与它此刻的**段局部中心**（540 短边单位，与 `captionSequences.pins[].center` 同口径）。
/// 松手写盘的就是同一个值，所以钉住之后覆盖层与计划重合，撤掉覆盖不会闪。
#[derive(Debug, Clone, PartialEq)]
pub struct CaptionSequenceEdit {
    pub seq: usize,
    pub drag: Option<(String, [f64; 2])>,
}

/// 一条字幕行在输出时间轴上的可见窗与内容键，见
/// [`OverlayRenderPlan::subtitle_spans`]。
#[derive(Debug, Clone, PartialEq)]
pub struct SubtitleSpan {
    pub start: f64,
    pub end: f64,
    pub key: String,
}

/// 倒鸭子在 `OverlayRenderPlan` 上的运行态：字体口径与说话人投影编译期定好，
/// 计划、区域 clip mask 与最近几帧在第一次采样时才建。
#[derive(Debug)]
pub struct SequenceState {
    pub font_name: String,
    pub font_weight: u16,
    pub font_px: f64,
    /// cue id → 说话人（读 cue 的 `sp`），换人断段用。
    pub speakers: HashMap<String, String>,
    pub plan: Option<Arc<CaptionSequencePlan>>,
    pub clip: Option<PixmapMask>,
    pub cache: VecDeque<CachedFrame>,
    /// 编辑态覆盖（`None` = 正常播放取景）。
    pub edit: Option<CaptionSequenceEdit>,
}

/// 序列层 CPU 帧缓存条数：来回 seek 一两帧够用，别把整段动画都攒着。
const SEQUENCE_FRAME_CACHE: usize = 4;

/// 540 短边参考单位在这块画布上的像素数（`captionSequences` 的坐标口径）。
/// 序列层描边：宽度（em，单侧）与颜色。GPU 的 stroke mask 与 CPU 的 `stroke_path` 同值。
const SEQ_OUTLINE_EM: f64 = 0.045;
const SEQ_OUTLINE_COLOR: SubtitleColor = SubtitleColor {
    r: 18,
    g: 18,
    b: 20,
    a: 0,
};
/// GPU 字形光栅字号上限（px）：再大就让采样放大一点，换 atlas 装得下。
const SEQ_RASTER_FONT_CAP: f64 = 144.0;

pub fn caption_sequence_unit_px(width: u32, height: u32) -> f64 {
    (f64::from(width.min(height)) / REFERENCE_SHORT_EDGE).max(1e-6)
}

impl OverlayRenderPlan {
    /// 这份计划是否由倒鸭子接管原文轨。
    pub fn caption_sequence_active(&self) -> bool {
        self.sequence.is_some()
    }

    /// 懒建序列计划：cue 词表 + 说话人 + 主角词覆盖 → `compile_caption_sequence`。
    /// 测宽走 `TextEngine::shape`，与实际画字同一口径。
    pub fn ensure_caption_sequence(&mut self) -> Option<Arc<CaptionSequencePlan>> {
        let state = self.sequence.as_ref()?;
        if let Some(plan) = &state.plan {
            return Some(Arc::clone(plan));
        }
        let caption = self.track_look.animation.caption.as_ref()?;
        let descriptor = self.track_look.descriptor?;
        let roles = caption
            .overrides
            .iter()
            .filter_map(|(id, word)| match word.role.as_str() {
                "hero" => Some((id.clone(), SeqRole::Hero)),
                "emphasis" => Some((id.clone(), SeqRole::Emphasis)),
                _ => None,
            })
            .collect();
        let intent = &caption.sequences;
        let unit_px = caption_sequence_unit_px(self.width, self.height);
        let cues = self
            .cues
            .iter()
            .filter(|item| !item.words.is_empty())
            .map(|item| CaptionSequenceCue {
                id: item.id.clone(),
                start: item
                    .words
                    .first()
                    .map_or(item.display_start, |word| word.start),
                end: item.words.last().map_or(item.display_end, |word| word.end),
                speaker: state.speakers.get(&item.id).cloned(),
                break_before: item
                    .words
                    .first()
                    .is_some_and(|word| intent.break_before.iter().any(|id| *id == word.id)),
                words: item.words.clone(),
            })
            .collect();
        let pins = intent
            .pins
            .iter()
            .map(|(key, pin)| {
                (
                    key.clone(),
                    SeqPin {
                        center: [pin.center[0] * unit_px, pin.center[1] * unit_px],
                        rot_deg: pin.rot_deg,
                    },
                )
            })
            .collect();
        let input = CaptionSequenceInput {
            cues,
            roles,
            duration: self.duration,
            pins,
            seq_seeds: intent.seeds.clone(),
        };
        let env = CaptionSequenceEnv {
            width: self.width,
            height: self.height,
            font_px: state.font_px,
            bilingual: self.mode == StudioMode::Bilingual && !self.translations.is_empty(),
            seed: caption.seed.unwrap_or(CAPTION_SEQUENCE_DEFAULT_SEED),
            intensity: caption.intensity * 100.0,
            speed: caption.speed,
            tokens: descriptor.sequence_layout_tokens(self.width, self.height),
            options: CaptionSequenceOptions::from_value(caption_sequence_option_value(caption)),
        };
        let (font_name, font_weight) = (state.font_name.clone(), state.font_weight);
        let text = &mut self.text;
        let mut measure =
            |sample: &str, px: f64| text.shape(sample, &font_name, px, font_weight).width;
        let plan = Arc::new(compile_caption_sequence(&input, &env, &mut measure));
        let state = self.sequence.as_mut()?;
        state.plan = Some(Arc::clone(&plan));
        Some(plan)
    }

    /// 进入 / 退出编辑态（§3.3）。编辑态帧的键与播放帧不同，缓存自然分开。
    pub fn set_caption_sequence_edit(&mut self, edit: Option<CaptionSequenceEdit>) {
        let Some(state) = self.sequence.as_mut() else {
            return;
        };
        if state.edit != edit {
            state.edit = edit;
            self.composited = None;
        }
    }

    pub fn caption_sequence_edit(&self) -> Option<&CaptionSequenceEdit> {
        self.sequence.as_ref().and_then(|state| state.edit.as_ref())
    }

    /// 这一帧的序列采样 + 键 + 下一次变化：播放态按时间采样；编辑态给总览帧，键里带
    /// 段号与拖拽位移。
    fn caption_sequence_frame(
        &self,
        plan: &CaptionSequencePlan,
        time: f64,
    ) -> (SeqFrame, String, Option<f64>) {
        match self.caption_sequence_edit() {
            Some(edit) => {
                let frame = plan.overview_frame(edit.seq);
                let key = match &edit.drag {
                    Some((key, center)) => {
                        format!(
                            "dz:edit:{}:{key}:{:.2}:{:.2}",
                            edit.seq, center[0], center[1]
                        )
                    }
                    None => format!("dz:edit:{}", edit.seq),
                };
                (frame, key, None)
            }
            None => {
                let frame = plan.sample(time);
                let (key, next) = self.caption_sequence_key(plan, &frame, time);
                (frame, key, next)
            }
        }
    }

    /// 拖拽预览：正在拖的那一行挪到覆盖给的段局部中心（540 单位），其余按计划。返回世界坐标。
    fn caption_sequence_drag_center(
        plan: &CaptionSequencePlan,
        edit: Option<&CaptionSequenceEdit>,
        unit_px: f64,
        block: &SeqBlock,
    ) -> Option<[f64; 2]> {
        let edit = edit?;
        let (key, local) = edit.drag.as_ref()?;
        if *key != block.key {
            return None;
        }
        let seq = plan.sequences.get(edit.seq)?;
        Some([
            seq.origin[0] + local[0] * unit_px,
            seq.origin[1] + local[1] * unit_px,
        ])
    }

    /// 几何侧车里的序列层（§3.2 / §3.3）。
    fn caption_sequence_layout(
        &self,
        plan: &CaptionSequencePlan,
        frame: &SeqFrame,
    ) -> SequenceLayout {
        let edit = self.caption_sequence_edit();
        let unit_px = caption_sequence_unit_px(self.width, self.height);
        let mut layout = SequenceLayout {
            seq_index: frame.seq,
            seq_key: frame.seq.map(|i| plan.sequences[i].key.clone()),
            seq_count: plan.sequences.len(),
            row_total: plan.sequences.iter().map(|s| s.blocks.len()).sum(),
            pinned_total: plan
                .sequences
                .iter()
                .flat_map(|s| s.blocks.iter())
                .filter(|b| b.pinned)
                .count(),
            editing: edit.is_some(),
            world_per_px: 1.0,
            unit_px,
            diagnostics: plan.diagnostics.clone(),
            rows: Vec::new(),
        };
        let (Some(si), Some(camera)) = (frame.seq, frame.camera) else {
            return layout;
        };
        layout.world_per_px = 1.0 / camera.zoom.max(1e-9);
        let seq = &plan.sequences[si];
        let drag = edit
            .and_then(|e| e.drag.as_ref())
            .and_then(|(key, _)| seq.blocks.iter().find(|b| b.key == *key))
            .and_then(|block| {
                Self::caption_sequence_drag_center(plan, edit, unit_px, block)
                    .map(|center| (block.key.as_str(), center))
            });
        let quads = plan.row_quads(si, &camera, drag);
        for (idx, (block, quad)) in seq.blocks.iter().zip(quads).enumerate() {
            let visible = frame.blocks.iter().any(|b| b.idx == idx && b.opacity > 0.0);
            if !visible && edit.is_none() {
                continue;
            }
            layout.rows.push(SequenceLayoutRow {
                key: block.key.clone(),
                cue_id: block.cue_id.clone(),
                onset: block.first_t,
                pinned: block.pinned,
                rot_deg: block.rot_deg,
                local_center: [
                    block.local_center[0] / unit_px,
                    block.local_center[1] / unit_px,
                ],
                quad,
                visible,
            });
        }
        layout
    }

    /// 序列层的缓存键与下一次状态变化。镜头在飞 / 词在入场时按帧编号成键，并把下一
    /// 个半帧边界算进 next_change；静止时把离散状态（段、块、词可见与否、说话中）
    /// 哈希成键，跨帧命中缓存。
    fn caption_sequence_key(
        &self,
        plan: &CaptionSequencePlan,
        frame: &SeqFrame,
        time: f64,
    ) -> (String, Option<f64>) {
        let epsilon = 1.0 / (self.fps * 100.0);
        let mut next = plan.next_event_after(time);
        let key = if frame.animating {
            let bucket = (time * self.fps).round();
            let mut boundary = (bucket + 0.5) / self.fps;
            if boundary <= time + epsilon {
                boundary = (bucket + 1.5) / self.fps;
            }
            next = Some(next.map_or(boundary, |current| current.min(boundary)));
            format!("dz@{}", bucket as i64)
        } else {
            let mut state = String::new();
            match frame.seq {
                Some(index) => state.push_str(&index.to_string()),
                None => state.push('-'),
            }
            if let Some((index, alpha)) = frame.fading {
                state.push_str(&format!("|f{index}:{alpha:.3}"));
            }
            for block in &frame.blocks {
                state.push_str(&format!(
                    "|b{}:{}:{:.3}",
                    block.idx, block.rank, block.opacity
                ));
                for word in &block.words {
                    state.push(match (word.opacity > 0.0, word.speaking) {
                        (false, _) => '.',
                        (true, true) => 's',
                        (true, false) => 'v',
                    });
                }
            }
            format!("dz:{:016x}", render_raster::drawop::fnv1a64(state.as_bytes()))
        };
        (
            key,
            next.filter(|boundary| *boundary <= self.duration + epsilon),
        )
    }

    /// 本帧要画的块：淡出中的上一段（历史口径、乘淡出 alpha）在前，当前段按
    /// rank 降序（历史块先画、当前块最后压在上面）。返回 `(段, 块, 逐词状态, alpha)`。
    /// 透明底（叠在视频上）时给序列层加一圈深色描边——视频画面花，纯填充的字读不清；
    /// 舞台模式铺了底色就不描。
    pub(crate) fn caption_sequence_outlined(plan: &CaptionSequencePlan) -> bool {
        !(plan.presentation == SeqPresentationMode::Stage
            && plan.background.is_some_and(|color| color.a != 255))
    }

    /// GPU 字形的光栅倍率：atlas 里的 mask 按**屏幕上的字号**光栅，而不是按世界字号
    /// 光栅再让镜头放大（那样一放大就糊）。倍率取变换的实际缩放，向上量化到 2^(1/4)
    /// 一档（镜头变焦途中不至于每帧换一套 mask），光栅字号封顶 [`SEQ_RASTER_FONT_CAP`]
    /// ——一帧的字形要装进 2048² 的 atlas。
    fn caption_sequence_raster_scale(transform: Transform, font: f64) -> f64 {
        let scale = f64::from(transform.sx.hypot(transform.ky)).max(1e-6);
        let step = (scale.log2() * 4.0).ceil() / 4.0;
        let quantized = 2f64.powf(step).clamp(0.25, 16.0);
        quantized
            .min(SEQ_RASTER_FONT_CAP / font.max(1e-6))
            .max(0.25)
    }

    /// 这一行落不落在字幕区域里（行盒四角过变换后的包围盒与视口求交，四周留一行高
    /// 的余量给入场缩放与描边）。区域外的历史行不出字形：GPU 省 atlas，CPU 省填充。
    fn caption_sequence_block_visible(
        block: &SeqBlock,
        transform: Transform,
        viewport: [f64; 4],
    ) -> bool {
        let margin = block.h as f32;
        let width = block.w.max(block.text_w) as f32;
        let mut corners = [
            tiny_skia::Point::from_xy(-margin, -margin),
            tiny_skia::Point::from_xy(width + margin, -margin),
            tiny_skia::Point::from_xy(width + margin, block.h as f32 + margin),
            tiny_skia::Point::from_xy(-margin, block.h as f32 + margin),
        ];
        transform.map_points(&mut corners);
        let (mut x0, mut y0, mut x1, mut y1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
        for point in corners {
            x0 = x0.min(point.x);
            y0 = y0.min(point.y);
            x1 = x1.max(point.x);
            y1 = y1.max(point.y);
        }
        let [vx, vy, vw, vh] = viewport.map(|value| value as f32);
        x1 >= vx && x0 <= vx + vw && y1 >= vy && y0 <= vy + vh
    }

    pub(crate) fn caption_sequence_draw_list(
        plan: &CaptionSequencePlan,
        frame: &SeqFrame,
    ) -> Vec<(usize, usize, Vec<SeqFrameWord>, f64)> {
        let mut list = Vec::new();
        if let Some((previous, alpha)) = frame.fading {
            let sequence = &plan.sequences[previous];
            let count = sequence.blocks.len();
            for (index, block) in sequence.blocks.iter().enumerate() {
                let rank = count - 1 - index;
                if rank > plan.history_blocks {
                    continue;
                }
                let block_alpha = if rank == 0 { 1.0 } else { plan.history_opacity };
                let words = block
                    .words
                    .iter()
                    .map(|word| SeqFrameWord {
                        opacity: 1.0,
                        scale: 1.0,
                        pivot_x: word.x,
                        speaking: false,
                    })
                    .collect();
                list.push((previous, index, words, alpha * block_alpha));
            }
        }
        if let Some(current) = frame.seq {
            let mut blocks: Vec<&SeqFrameBlock> = frame.blocks.iter().collect();
            blocks.sort_by(|a, b| b.rank.cmp(&a.rank));
            for block in blocks {
                list.push((current, block.idx, block.words.clone(), block.opacity));
            }
        }
        list
    }

    /// 词色：行的底色档（逐句换色）打底；强调 / 主角 / 正在念的词取一档**不同于行
    /// 底色**的强调色，保证它在彩色行里仍然跳得出来。
    pub(crate) fn caption_sequence_word_color(
        palette: [SubtitleColor; 3],
        tone: u8,
        word: &SeqWord,
        state: &SeqFrameWord,
    ) -> SubtitleColor {
        let tone = usize::from(tone.min(2));
        let other = |slot: usize| if slot == tone { 3 - slot } else { slot };
        if state.speaking {
            return palette[other(1)];
        }
        match word.role {
            SeqRole::Hero => palette[other(2)],
            SeqRole::Emphasis => palette[other(1)],
            SeqRole::Normal => palette[tone],
        }
    }

    fn caption_sequence_palette(&self) -> [SubtitleColor; 3] {
        self.track_look
            .animation
            .caption
            .as_ref()
            .map_or([SubtitleColor::WHITE; 3], |caption| {
                [caption.primary, caption.accent, caption.secondary]
            })
    }

    /// GPU 路：序列层压成一个 `GlyphRun`（一词一个 uniform，全部裁在字幕区域），
    /// 舞台模式再在前面垫一块背景。返回 `(节点, 键, 下一次变化)`；无序列则 `None`。
    fn caption_sequence_scene(
        &mut self,
        time: f64,
    ) -> std::result::Result<
        Option<(Vec<element_draw::SceneNode>, String, Option<f64>)>,
        SubtitleSceneFallback,
    > {
        let Some(plan) = self.ensure_caption_sequence() else {
            return Ok(None);
        };
        let (frame, key, next_change) = self.caption_sequence_frame(&plan, time);
        let Some(camera) = frame.camera else {
            return Ok(Some((Vec::new(), key, next_change)));
        };
        let camera_transform = plan.camera_transform(&camera);
        let edit = self.caption_sequence_edit().cloned();
        let unit_px = caption_sequence_unit_px(self.width, self.height);
        let palette = self.caption_sequence_palette();
        let (font_name, font_weight) = match self.sequence.as_ref() {
            Some(state) => (state.font_name.clone(), state.font_weight),
            None => return Ok(None),
        };
        let [vx, vy, vw, vh] = plan.viewport;
        let clip = Some([vx as f32, vy as f32, (vx + vw) as f32, (vy + vh) as f32]);
        let mut nodes = Vec::new();
        if plan.presentation == SeqPresentationMode::Stage {
            if let Some(background) = plan.background.filter(|color| color.a != 255) {
                let [r, g, b, a] = glyph_uniform_color(background, 1.0);
                nodes.push(element_draw::SceneNode::RoundedRect(Arc::new(
                    element_draw::RoundedRectNode {
                        rect: [vx as f32, vy as f32, vw as f32, vh as f32],
                        radius: 0.0,
                        color: [r, g, b, a],
                        pose: element_draw::ScenePose::IDENTITY,
                        motion: None,
                    },
                )));
            }
        }
        let mut glyphs = Vec::new();
        let mut uniforms = Vec::new();
        let outlined = Self::caption_sequence_outlined(&plan);
        let mut outline_glyphs = Vec::new();
        let mut outline_uniforms = Vec::new();
        for (sequence_index, block_index, states, alpha) in
            Self::caption_sequence_draw_list(&plan, &frame)
        {
            let block = &plan.sequences[sequence_index].blocks[block_index];
            let block_transform =
                match Self::caption_sequence_drag_center(&plan, edit.as_ref(), unit_px, block) {
                    Some(center) => block.transform_at(center),
                    None => block.transform(),
                }
                .post_concat(camera_transform);
            if !Self::caption_sequence_block_visible(block, block_transform, plan.viewport) {
                continue;
            }
            for (word, state) in block.words.iter().zip(&states) {
                let opacity = alpha * state.opacity;
                if opacity <= 0.001 {
                    continue;
                }
                if uniforms.len() >= element_draw::GLYPH_RUN_UNIFORM_LIMIT {
                    return Err(SubtitleSceneFallback::SceneLimit);
                }
                let uniform_index =
                    u32::try_from(uniforms.len()).map_err(|_| SubtitleSceneFallback::SceneLimit)?;
                let color = Self::caption_sequence_word_color(palette, block.tone, word, state);
                uniforms.push(element_draw::GlyphRunUniform {
                    transform: transform_array(Transform::identity()),
                    color: glyph_uniform_color(color, opacity),
                    color_opacity: opacity as f32,
                    clip,
                    paint: element_draw::GlyphPaint::Solid,
                });
                if outlined {
                    outline_uniforms.push(element_draw::GlyphRunUniform {
                        transform: transform_array(Transform::identity()),
                        color: glyph_uniform_color(SEQ_OUTLINE_COLOR, opacity * opacity),
                        color_opacity: (opacity * opacity) as f32,
                        clip,
                        paint: element_draw::GlyphPaint::Solid,
                    });
                }
                // 按屏幕字号光栅：整形与 mask 都在 `font × raster` 下取，再用 1 / raster
                // 缩回块内坐标——镜头把这一行放多大，atlas 里就有多大的字。
                let raster = Self::caption_sequence_raster_scale(block_transform, word.font);
                let shaped =
                    self.text
                        .shape(&word.text, &font_name, word.font * raster, font_weight);
                let baseline =
                    (word.h * raster - (shaped.ascent + shaped.descent)) / 2.0 + shaped.ascent;
                let word_transform = word
                    .pop_transform(state.scale, state.pivot_x)
                    .post_concat(block_transform);
                let inverse = (1.0 / raster) as f32;
                let outline_width =
                    ((SEQ_OUTLINE_EM * word.font * raster * 2.0).round() / 2.0).max(1.0) as f32;
                for glyph in &shaped.glyphs {
                    let transform =
                        Transform::from_translate(glyph.x as f32, (baseline + glyph.y) as f32)
                            .post_scale(inverse, inverse)
                            .post_translate(word.x as f32, word.y as f32)
                            .post_concat(word_transform);
                    if outlined
                        && let Some(mask) = glyph_scene_mask(
                            self.text
                                .glyph_stroke_atlas_render(glyph.cache_key, outline_width),
                        )?
                    {
                        outline_glyphs.push(element_draw::GlyphInstance {
                            mask,
                            transform: transform_array(transform),
                            uniform_index,
                        });
                    }
                    let Some(mask) =
                        glyph_scene_mask(self.text.glyph_atlas_render(glyph.cache_key))?
                    else {
                        continue;
                    };
                    glyphs.push(element_draw::GlyphInstance {
                        mask,
                        transform: transform_array(transform),
                        uniform_index,
                    });
                }
            }
        }
        if !outline_glyphs.is_empty() {
            nodes.push(element_draw::SceneNode::Glyphs(Arc::new(
                element_draw::GlyphRun {
                    glyphs: outline_glyphs.into(),
                    uniforms: outline_uniforms,
                    texture: None,
                    composite: element_draw::GlyphCompositeMode::Normal,
                    pose: element_draw::ScenePose::IDENTITY,
                    motion: None,
                },
            )));
        }
        if !glyphs.is_empty() {
            nodes.push(element_draw::SceneNode::Glyphs(Arc::new(
                element_draw::GlyphRun {
                    glyphs: glyphs.into(),
                    uniforms,
                    texture: None,
                    composite: element_draw::GlyphCompositeMode::Normal,
                    pose: element_draw::ScenePose::IDENTITY,
                    motion: None,
                },
            )));
        }
        Ok(Some((nodes, key, next_change)))
    }

    /// CPU 路：把序列层画进 `pixmap`（裁在字幕区域），返回落笔包围。
    fn draw_caption_sequence(
        &mut self,
        pixmap: &mut Pixmap,
        plan: &CaptionSequencePlan,
        frame: &SeqFrame,
    ) -> Result<DrawBounds> {
        let mut drawn = DrawBounds::default();
        let Some(camera) = frame.camera else {
            return Ok(drawn);
        };
        let camera_transform = plan.camera_transform(&camera);
        let palette = self.caption_sequence_palette();
        let [vx, vy, vw, vh] = plan.viewport;
        let viewport = tiny_skia::Rect::from_xywh(vx as f32, vy as f32, vw as f32, vh as f32)
            .ok_or_else(|| anyhow!("倒鸭子字幕区域退化：{:?}", plan.viewport))?;
        let Some(state) = self.sequence.as_mut() else {
            return Ok(drawn);
        };
        let edit = state.edit.clone();
        let unit_px = caption_sequence_unit_px(pixmap.width(), pixmap.height());
        let (font_name, font_weight) = (state.font_name.clone(), state.font_weight);
        let clip = match state.clip.take() {
            Some(mask) => mask,
            None => {
                let mut mask = PixmapMask::new(pixmap.width(), pixmap.height())
                    .ok_or_else(|| anyhow!("无法创建倒鸭子区域 mask"))?;
                mask.fill_path(
                    &PathBuilder::from_rect(viewport),
                    FillRule::Winding,
                    true,
                    Transform::identity(),
                );
                mask
            }
        };
        if plan.presentation == SeqPresentationMode::Stage {
            if let Some(background) = plan.background.filter(|color| color.a != 255) {
                pixmap.fill_rect(
                    viewport,
                    &paint(background, 1.0),
                    Transform::identity(),
                    None,
                );
                drawn.union(vx, vy, vx + vw, vy + vh);
            }
        }
        let text = &mut self.text;
        let outlined = Self::caption_sequence_outlined(plan);
        let draw_list = Self::caption_sequence_draw_list(plan, frame);
        // 两遍：先把整层的描边铺完，再填字——否则后一个字的描边会压在前一个字的填充上
        for outline_pass in [true, false] {
            if outline_pass && !outlined {
                continue;
            }
            for (sequence_index, block_index, states, alpha) in &draw_list {
                let (sequence_index, block_index, alpha) = (*sequence_index, *block_index, *alpha);
                let block = &plan.sequences[sequence_index].blocks[block_index];
                let block_transform =
                    match Self::caption_sequence_drag_center(plan, edit.as_ref(), unit_px, block) {
                        Some(center) => block.transform_at(center),
                        None => block.transform(),
                    }
                    .post_concat(camera_transform);
                if !Self::caption_sequence_block_visible(block, block_transform, plan.viewport) {
                    continue;
                }
                for (word, state) in block.words.iter().zip(states) {
                    let opacity = alpha * state.opacity;
                    if opacity <= 0.001 {
                        continue;
                    }
                    let color = Self::caption_sequence_word_color(palette, block.tone, word, state);
                    let fill = if outline_pass {
                        paint(SEQ_OUTLINE_COLOR, opacity * opacity)
                    } else {
                        paint(color, opacity)
                    };
                    let stroke = tiny_skia::Stroke {
                        width: (SEQ_OUTLINE_EM * word.font * 2.0) as f32,
                        line_join: tiny_skia::LineJoin::Round,
                        ..tiny_skia::Stroke::default()
                    };
                    let shaped = text.shape(&word.text, &font_name, word.font, font_weight);
                    let baseline =
                        word.y + (word.h - (shaped.ascent + shaped.descent)) / 2.0 + shaped.ascent;
                    let word_transform = word
                        .pop_transform(state.scale, state.pivot_x)
                        .post_concat(block_transform);
                    for glyph in &shaped.glyphs {
                        let local = Transform::from_translate(
                            (word.x + glyph.x) as f32,
                            (baseline + glyph.y) as f32,
                        )
                        .post_concat(word_transform);
                        match text.glyph_render(glyph.cache_key) {
                            GlyphRender::Outline(path) if outline_pass => {
                                pixmap.stroke_path(&path, &fill, &stroke, local, Some(&clip));
                                drawn.add_stroked(&path, local, stroke.width);
                            }
                            GlyphRender::Outline(path) => {
                                pixmap.fill_path(
                                    &path,
                                    &fill,
                                    FillRule::Winding,
                                    local,
                                    Some(&clip),
                                );
                                drawn.add_filled(&path, local);
                            }
                            GlyphRender::ColorBitmap { .. } if outline_pass => {}
                            GlyphRender::ColorBitmap {
                                width,
                                height,
                                rgba,
                                left,
                                top,
                            } => {
                                let Some(bitmap) = PixmapRef::from_bytes(&rgba, width, height)
                                else {
                                    continue;
                                };
                                let placement = Transform::from_translate(left as f32, -top as f32)
                                    .post_concat(local);
                                pixmap.draw_pixmap(
                                    0,
                                    0,
                                    bitmap,
                                    &PixmapPaint {
                                        opacity: opacity as f32,
                                        quality: FilterQuality::Bilinear,
                                        blend_mode: tiny_skia::BlendMode::SourceOver,
                                    },
                                    placement,
                                    Some(&clip),
                                );
                                drawn.add_pixmap(width, height, placement);
                            }
                            GlyphRender::Empty => {}
                        }
                    }
                }
            }
        }
        // 区域外的落笔被 mask 裁掉了，包围盒也收到区域内。
        if let Some([left, top, right, bottom]) = drawn.rect {
            drawn.rect = Some([
                left.max(vx),
                top.max(vy),
                right.min(vx + vw),
                bottom.min(vy + vh),
            ]);
        }
        // mask 归还给运行态，别每帧重建整幅。
        if let Some(state) = self.sequence.as_mut() {
            state.clip = Some(clip);
        }
        Ok(drawn)
    }
}
