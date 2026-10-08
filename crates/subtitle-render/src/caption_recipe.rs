// Mac `CaptionProgramCompiler` + `CaptionFrameResolver` 的跨平台纯函数移植。
//
// 16 个 recipe 描述子直接编译自 Mac 规范资源；这里把 cue、用户设计参数与
// captionEmphasis 编译为任意时刻的逐词 channel 状态。绘制层只消费
// `CaptionRecipeResolvedWord`，不再为每个配方另写一套时间逻辑。

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionRecipeDescriptor {
    pub id: String,
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub layout: String,
    #[serde(default)]
    pub layout_tokens: HashMap<String, CaptionRecipeLayoutToken>,
    #[serde(default)]
    pub family: String,
    #[serde(default)]
    pub layers: Vec<String>,
    #[serde(default)]
    pub glow_layers: Option<usize>,
    #[serde(default)]
    pub glyph_duplicate_layers: Option<usize>,
    #[serde(default)]
    pub composite: String,
    #[serde(default)]
    pub grouping: Option<CaptionRecipeGrouping>,
    #[serde(default)]
    pub visibility: Option<CaptionRecipeVisibility>,
    #[serde(default)]
    pub events: Vec<CaptionRecipeEvent>,
    #[serde(default)]
    pub assets: Vec<CaptionRecipeAsset>,
    #[serde(default)]
    pub fonts: Vec<CaptionRecipeFont>,
    /// 能力门（倒鸭子设计稿 §5.2）：`scope: "sequence"` 的配方由跨句序列编译器
    /// （`compiler: "typography-world"`）接管整条原文轨，而不是逐 cue 的 channel
    /// 事件。不认识 `compiler` 的客户端不列这份样式，把已保存的项目当普通字幕画。
    #[serde(default)]
    pub execution: Option<CaptionRecipeExecution>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionRecipeExecution {
    pub scope: String,
    pub compiler: String,
    #[serde(default)]
    pub version: u32,
}

impl CaptionRecipeDescriptor {
    /// 这份配方是否由本内核认得的跨句序列编译器执行。
    pub fn is_sequence(&self) -> bool {
        self.execution.as_ref().is_some_and(|execution| {
            execution.scope == CAPTION_SEQUENCE_SCOPE
                && execution.compiler == CAPTION_SEQUENCE_COMPILER
        })
    }

    /// 序列配方在这一画幅下的排版 token；描述符没写的槽位取内核默认。
    pub fn sequence_layout_tokens(&self, frame_width: u32, frame_height: u32) -> SeqLayoutTokens {
        let fallback = caption_sequence_layout_tokens(frame_width, frame_height);
        caption_recipe_layout_token(self, frame_width, frame_height).map_or(fallback, |token| {
            SeqLayoutTokens {
                viewport: token.viewport.unwrap_or(fallback.viewport),
                density: token.density.unwrap_or(fallback.density),
                fit: token.fit.unwrap_or(fallback.fit),
            }
        })
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionRecipeLayoutToken {
    pub width: f64,
    pub font_scale: f64,
    pub min_font_size: f64,
    pub max_height: f64,
    pub band_gap: f64,
    /// 序列配方的字幕区域（画幅比例 `[x, y, w, h]`）、疏密与贴合（§7.1）。
    #[serde(default)]
    pub viewport: Option<[f64; 4]>,
    #[serde(default)]
    pub density: Option<f64>,
    #[serde(default)]
    pub fit: Option<f64>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct CaptionRecipeFont {
    pub role: String,
    pub family: String,
    #[serde(default)]
    pub weights: Vec<u16>,
    #[serde(default)]
    pub fallback: Vec<String>,
    #[serde(default)]
    pub substitution: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionRecipeVisibility {
    #[serde(default = "caption_recipe_default_hold")]
    pub hold: f64,
    #[serde(default = "caption_recipe_default_gap")]
    pub gap_before_next: f64,
    #[serde(default = "caption_recipe_default_hard_kill")]
    pub hard_kill_after: f64,
}

pub fn caption_recipe_default_hold() -> f64 {
    0.5
}

pub fn caption_recipe_default_gap() -> f64 {
    0.05
}

pub fn caption_recipe_default_hard_kill() -> f64 {
    0.45
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct CaptionRecipeAsset {
    pub file: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionRecipeGrouping {
    #[serde(default = "caption_recipe_default_max_words")]
    pub max_words: usize,
    #[serde(default = "caption_recipe_default_pause")]
    pub pause_threshold: f64,
    #[serde(default)]
    pub punctuation: bool,
}

pub fn caption_recipe_default_max_words() -> usize {
    8
}

pub fn caption_recipe_default_pause() -> f64 {
    0.5
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionRecipeEvent {
    #[serde(default)]
    pub trigger: String,
    #[serde(default, rename = "operator")]
    pub op: String,
    #[serde(default)]
    pub channels: Vec<String>,
    #[serde(default)]
    pub easing: String,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub delay: Option<f64>,
    #[serde(default)]
    pub attack: Option<f64>,
    #[serde(default)]
    pub release: Option<f64>,
    #[serde(default)]
    pub roles: Option<Vec<String>>,
    #[serde(default)]
    pub fixed: bool,
    #[serde(default)]
    pub by_role: bool,
    #[serde(default)]
    pub alternate: bool,
    #[serde(default)]
    pub jitter: Option<CaptionRecipeJitter>,
    #[serde(default)]
    pub keyframes: HashMap<String, Vec<CaptionRecipeKey>>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct CaptionRecipeJitter {
    #[serde(default)]
    pub step: f64,
    #[serde(default)]
    pub amplitude: f64,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct CaptionRecipeKey {
    #[serde(default)]
    pub offset: f64,
    #[serde(default)]
    pub value: f64,
    #[serde(default)]
    pub ease: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct CaptionRecipeResolvedWord {
    pub role: String,
    pub color: Option<SubtitleColor>,
    pub emoji: Option<String>,
    pub opacity: f64,
    pub dx: f64,
    pub dy: f64,
    pub scale_x: f64,
    pub scale_y: f64,
    pub rotation: f64,
    pub clip_l: f64,
    pub clip_r: f64,
    pub clip_t: f64,
    pub clip_b: f64,
    pub color_mix: f64,
    pub weight_axis: f64,
    pub fill_progress: f64,
    pub plate_x: f64,
    pub plate_progress: f64,
    pub plate_height: f64,
    pub plate_radius: f64,
    pub glow_gain: f64,
    pub rgb_split: f64,
    pub echo: f64,
    pub scramble: f64,
    pub burst: f64,
    pub emoji_pop: f64,
    pub text_swap: Option<String>,
    pub particles: Vec<CaptionRecipeParticle>,
}

impl CaptionRecipeResolvedWord {
    pub fn identity(role: String, color: Option<SubtitleColor>, emoji: Option<String>) -> Self {
        Self {
            role,
            color,
            emoji,
            opacity: 1.0,
            scale_x: 1.0,
            scale_y: 1.0,
            plate_height: 1.0,
            plate_radius: 0.25,
            ..Self::default()
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct CaptionRecipeParticle {
    pub dx: f64,
    pub dy: f64,
    pub radius: f64,
    pub opacity: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct CaptionRecipeParticleTemplate {
    pub angle: f64,
    pub distance: f64,
    pub radius: f64,
    pub lag: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct CaptionRecipeGroup {
    pub index: usize,
    pub start: f64,
    pub end: f64,
    pub visible_until: f64,
}

pub const CAPTION_RECIPE_FILES: &[&[u8]] = &[
    include_bytes!("../assets/captions/styles/caption-blend-difference-v1.json"),
    include_bytes!("../assets/captions/styles/caption-clip-wipe-v1.json"),
    include_bytes!("../assets/captions/styles/caption-daoyazi-v1.json"),
    include_bytes!("../assets/captions/styles/caption-editorial-emphasis-v1.json"),
    include_bytes!("../assets/captions/styles/caption-emoji-pop-v1.json"),
    include_bytes!("../assets/captions/styles/caption-glitch-rgb-v1.json"),
    include_bytes!("../assets/captions/styles/caption-gradient-fill-v1.json"),
    include_bytes!("../assets/captions/styles/caption-highlight-v1.json"),
    include_bytes!("../assets/captions/styles/caption-kinetic-slam-v1.json"),
    include_bytes!("../assets/captions/styles/caption-matrix-decode-v1.json"),
    include_bytes!("../assets/captions/styles/caption-neon-accent-v1.json"),
    include_bytes!("../assets/captions/styles/caption-neon-glow-v1.json"),
    include_bytes!("../assets/captions/styles/caption-parallax-layers-v1.json"),
    include_bytes!("../assets/captions/styles/caption-particle-burst-v1.json"),
    include_bytes!("../assets/captions/styles/caption-pill-karaoke-v1.json"),
    include_bytes!("../assets/captions/styles/caption-texture-v1.json"),
    include_bytes!("../assets/captions/styles/caption-weight-shift-v1.json"),
];

pub const CAPTION_TEXTURE_FILES: &[(&str, &[u8])] = &[
    (
        "concrete.png",
        include_bytes!("../assets/captions/textures/concrete.png"),
    ),
    (
        "lava.png",
        include_bytes!("../assets/captions/textures/lava.png"),
    ),
    (
        "marble.png",
        include_bytes!("../assets/captions/textures/marble.png"),
    ),
    (
        "metal.png",
        include_bytes!("../assets/captions/textures/metal.png"),
    ),
    (
        "rock.png",
        include_bytes!("../assets/captions/textures/rock.png"),
    ),
    (
        "wood.png",
        include_bytes!("../assets/captions/textures/wood.png"),
    ),
];

pub fn caption_recipe_descriptors() -> &'static [CaptionRecipeDescriptor] {
    static DESCRIPTORS: std::sync::OnceLock<Vec<CaptionRecipeDescriptor>> =
        std::sync::OnceLock::new();
    DESCRIPTORS.get_or_init(|| {
        CAPTION_RECIPE_FILES
            .iter()
            .map(|bytes| {
                serde_json::from_slice(bytes)
                    .expect("Mac bundled Designed Caption descriptor must be valid")
            })
            .collect()
    })
}

pub fn caption_recipe_descriptor(id: &str) -> Option<&'static CaptionRecipeDescriptor> {
    caption_recipe_descriptors()
        .iter()
        .find(|descriptor| descriptor.id == id)
}

pub fn caption_recipe_design_descriptor(
    design: &DesignedCaption,
) -> Option<&'static CaptionRecipeDescriptor> {
    (design.content == "orig")
        .then(|| caption_recipe_descriptor(&design.style_id))
        .flatten()
        .filter(|descriptor| descriptor.version == design.style_version)
}

pub fn caption_recipe_layout_token(
    descriptor: &CaptionRecipeDescriptor,
    frame_width: u32,
    frame_height: u32,
) -> Option<&CaptionRecipeLayoutToken> {
    let ratio = f64::from(frame_width) / f64::from(frame_height.max(1));
    let key = if frame_width == 0 || frame_height == 0 || ratio > 1.2 {
        "wide"
    } else if ratio < 0.8 {
        "vertical"
    } else {
        "square"
    };
    descriptor.layout_tokens.get(key)
}

pub fn caption_recipe_roles(
    design: &DesignedCaption,
    item: &TimedItem,
    descriptor: &CaptionRecipeDescriptor,
) -> Vec<String> {
    let mut roles = item
        .words
        .iter()
        .map(|word| {
            design
                .overrides
                .get(&word.id)
                .map_or_else(|| "normal".to_owned(), |value| value.role.clone())
        })
        .collect::<Vec<_>>();
    if matches!(descriptor.layout.as_str(), "dualBand" | "editorialBlock") {
        let group_indices = caption_recipe_group_indices(&item.words, descriptor.grouping.as_ref());
        for group in 0..=group_indices.iter().copied().max().unwrap_or(0) {
            let candidates = group_indices
                .iter()
                .enumerate()
                .filter(|(_, index)| **index == group)
                .map(|(index, _)| index)
                .collect::<Vec<_>>();
            if candidates
                .iter()
                .any(|index| matches!(roles[*index].as_str(), "emphasis" | "hero"))
            {
                continue;
            }
            if let Some(candidate) = candidates.into_iter().max_by(|left, right| {
                item.words[*left]
                    .text
                    .chars()
                    .count()
                    .cmp(&item.words[*right].text.chars().count())
                    .then_with(|| right.cmp(left))
            }) {
                roles[candidate] = "emphasis".to_owned();
            }
        }
    }
    roles
}

pub fn caption_recipe_visible_group(
    design: &DesignedCaption,
    item: &TimedItem,
    raw_time: f64,
    fps: f64,
) -> Option<CaptionRecipeGroup> {
    let descriptor = caption_recipe_design_descriptor(design)?;
    let indices = caption_recipe_group_indices(&item.words, descriptor.grouping.as_ref());
    let groups = caption_recipe_groups(&item.words, &indices, descriptor.visibility.as_ref());
    let time = (raw_time * fps.max(1.0)).round() / fps.max(1.0);
    groups
        .into_iter()
        .rev()
        .find(|group| time >= group.start && time <= group.visible_until)
}

pub fn caption_recipe_owns_layout(descriptor: &CaptionRecipeDescriptor, item: &TimedItem) -> bool {
    if matches!(
        descriptor.layout.as_str(),
        "fullScreenWord" | "dualBand" | "editorialBlock"
    ) {
        return true;
    }
    let indices = caption_recipe_group_indices(&item.words, descriptor.grouping.as_ref());
    caption_recipe_groups(&item.words, &indices, descriptor.visibility.as_ref()).len() > 1
}

pub fn resolve_caption_recipe_word(
    design: &DesignedCaption,
    item: &TimedItem,
    word_index: usize,
    raw_time: f64,
    fps: f64,
) -> Option<CaptionRecipeResolvedWord> {
    let descriptor = caption_recipe_design_descriptor(design)?;
    let word = item.words.get(word_index)?;
    let override_value = design.overrides.get(&word.id);
    let group_indices = caption_recipe_group_indices(&item.words, descriptor.grouping.as_ref());
    let roles = caption_recipe_roles(design, item, descriptor);

    let groups = caption_recipe_groups(&item.words, &group_indices, descriptor.visibility.as_ref());
    let time = (raw_time * fps.max(1.0)).round() / fps.max(1.0);
    let visible = groups
        .iter()
        .rev()
        .find(|group| time >= group.start && time <= group.visible_until);
    let role = roles[word_index].clone();
    let mut resolved = CaptionRecipeResolvedWord::identity(
        role.clone(),
        override_value.and_then(|value| value.color),
        override_value.and_then(|value| value.emoji.clone()),
    );
    let Some(group) = visible.filter(|group| group.index == group_indices[word_index]) else {
        resolved.opacity = 0.0;
        return Some(resolved);
    };

    let intensity = (design.intensity * 2.0).clamp(0.0, 2.0);
    for (event_index, event) in descriptor.events.iter().enumerate() {
        if event
            .roles
            .as_ref()
            .is_some_and(|roles| !roles.iter().any(|candidate| candidate == &role))
        {
            continue;
        }
        if event.trigger == "emphasis.active" && !matches!(role.as_str(), "emphasis" | "hero") {
            continue;
        }
        let progress = caption_recipe_progress(event, word, group, time, design.speed);
        for channel in &event.channels {
            let Some(keys) = event.keyframes.get(channel) else {
                continue;
            };
            let Some(sampled) = caption_recipe_sample(keys, progress, &event.easing) else {
                continue;
            };
            let identity = caption_recipe_channel_identity(channel);
            let role_gain = match role.as_str() {
                "hero" => 1.8,
                "emphasis" => 1.35,
                _ => 1.0,
            };
            let mut gain = if event.fixed { 1.0 } else { intensity };
            if event.by_role {
                gain *= role_gain;
            }
            if event.alternate && word_index % 2 == 1 {
                gain *= -1.0;
            }
            let mut value = identity + (sampled - identity) * gain;
            if let Some(jitter) = &event.jitter
                && progress > 0.0
            {
                let step = (jitter.step / design.speed.max(0.001)).max(0.001);
                let bin = (time / step).floor() as i64;
                let seed = caption_recipe_word_seed(design, &item.id, word)
                    ^ (event_index as u64).wrapping_mul(1_009)
                    ^ u64::from_ne_bytes(bin.to_ne_bytes());
                value += caption_recipe_noise(seed) * jitter.amplitude * gain * progress;
            }
            if value.is_finite() {
                caption_recipe_apply(channel, value, &mut resolved);
            }
        }
    }

    let word_seed = caption_recipe_word_seed(design, &item.id, word);
    if resolved.scramble > 0.001 {
        resolved.text_swap = Some(caption_recipe_scrambled(
            &word.text,
            word_seed,
            (resolved.scramble.min(1.0) * 22.0) as usize,
        ));
    }
    if resolved.burst > 0.001 {
        let count = design
            .number_option("particleCount")
            .unwrap_or(16.0)
            .clamp(0.0, 24.0) as usize;
        resolved.particles = caption_recipe_particle_templates(word_seed, count)
            .into_iter()
            .filter_map(|template| caption_recipe_resolve_particle(template, resolved.burst))
            .collect();
    }
    if resolved.emoji_pop > 0.001 {
        resolved.emoji = caption_recipe_word_emoji(design, item, word_index);
    }
    Some(resolved)
}

pub fn caption_recipe_group_indices(
    words: &[Word],
    policy: Option<&CaptionRecipeGrouping>,
) -> Vec<usize> {
    let Some(policy) = policy else {
        return vec![0; words.len()];
    };
    let mut result = vec![0; words.len()];
    let mut group = 0;
    let mut count = 0;
    for index in 0..words.len() {
        result[index] = group;
        count += 1;
        if index + 1 >= words.len() {
            continue;
        }
        let pause = words[index + 1].start - words[index].end;
        let punctuation = policy.punctuation
            && words[index]
                .text
                .chars()
                .last()
                .is_some_and(|value| ".,!?;:，。！？；：".contains(value));
        if count >= policy.max_words.max(1) || pause >= policy.pause_threshold || punctuation {
            group += 1;
            count = 0;
        }
    }
    result
}

pub fn caption_recipe_groups(
    words: &[Word],
    indices: &[usize],
    visibility: Option<&CaptionRecipeVisibility>,
) -> Vec<CaptionRecipeGroup> {
    let hold = visibility.map_or(0.5, |value| value.hold);
    let gap = visibility.map_or(0.05, |value| value.gap_before_next);
    let hard_kill = visibility.map_or(0.45, |value| value.hard_kill_after);
    let mut groups = Vec::new();
    for group_index in 0..=indices.iter().copied().max().unwrap_or(0) {
        let Some(first) = indices.iter().position(|index| *index == group_index) else {
            continue;
        };
        let last = indices
            .iter()
            .rposition(|index| *index == group_index)
            .unwrap_or(first);
        let next_start = indices
            .iter()
            .position(|index| *index > group_index)
            .map(|index| words[index].start);
        let visible_until = (words[last].end + hold).min(
            next_start
                .map(|start| words[last].end.max(start - gap))
                .unwrap_or(words[last].end + hard_kill),
        );
        groups.push(CaptionRecipeGroup {
            index: group_index,
            start: words[first].start,
            end: words[last].end,
            visible_until,
        });
    }
    groups
}

pub fn caption_recipe_progress(
    event: &CaptionRecipeEvent,
    word: &Word,
    group: &CaptionRecipeGroup,
    time: f64,
    speed: f64,
) -> f64 {
    let speed = speed.max(0.001);
    match event.trigger.as_str() {
        "group.enter" => {
            let duration = (event.duration.unwrap_or(group.end - group.start) / speed).max(0.0001);
            clamp(
                (time - group.start - event.delay.unwrap_or(0.0) / speed) / duration,
                0.0,
                1.0,
            )
        }
        "group.exit" => {
            let duration = (event.duration.unwrap_or(0.2) / speed).max(0.0001);
            clamp(
                (time - (group.visible_until - duration)) / duration,
                0.0,
                1.0,
            )
        }
        "word.enter" => {
            let duration = (event.duration.unwrap_or(word.end - word.start) / speed).max(0.0001);
            clamp(
                (time - word.start - event.delay.unwrap_or(0.0) / speed) / duration,
                0.0,
                1.0,
            )
        }
        "word.active" | "emphasis.active" => {
            let attack = (event.attack.unwrap_or(0.10) / speed).max(0.0001);
            let release = (event.release.unwrap_or(0.14) / speed).max(0.0001);
            if time <= word.start {
                0.0
            } else if time < word.start + attack {
                (time - word.start) / attack
            } else if time <= word.end {
                1.0
            } else if time < word.end + release {
                1.0 - (time - word.end) / release
            } else {
                0.0
            }
        }
        "word.leave" => {
            let duration = (event.duration.unwrap_or(0.15) / speed).max(0.0001);
            clamp(
                (time - word.end - event.delay.unwrap_or(0.0) / speed) / duration,
                0.0,
                1.0,
            )
        }
        _ => 0.0,
    }
}

pub fn caption_recipe_sample(
    keys: &[CaptionRecipeKey],
    progress: f64,
    fallback: &str,
) -> Option<f64> {
    let first = keys.first()?;
    if keys.len() == 1 || progress <= first.offset {
        return Some(first.value);
    }
    let last = keys.last()?;
    if progress >= last.offset {
        return Some(last.value);
    }
    let index = keys
        .windows(2)
        .position(|pair| pair[1].offset > progress)
        .unwrap_or(keys.len() - 2);
    let (left, right) = (&keys[index], &keys[index + 1]);
    let span = right.offset - left.offset;
    if span <= 1e-12 {
        return Some(right.value);
    }
    let phase = (progress - left.offset) / span;
    let name = left.ease.as_deref().unwrap_or_else(|| match fallback {
        "easeIn" => "easeInCubic",
        "easeOut" => "easeOutCubic",
        "easeInOut" => "easeInOutCubic",
        "backOut" => "easeOutBack",
        "step" => "hold",
        "linear" => "linear",
        _ => "linear",
    });
    let eased = caption_recipe_ease(name, phase);
    Some(left.value + (right.value - left.value) * eased)
}

pub fn caption_recipe_ease(name: &str, value: f64) -> f64 {
    let value = value.clamp(0.0, 1.0);
    match name {
        "linear" => value,
        "hold" => f64::from(value >= 1.0),
        "easeInCubic" => value * value * value,
        "easeOutCubic" => {
            let shifted = value - 1.0;
            shifted * shifted * shifted + 1.0
        }
        "easeInOutCubic" if value < 0.5 => 4.0 * value * value * value,
        "easeInOutCubic" => (value - 1.0) * (2.0 * value - 2.0) * (2.0 * value - 2.0) + 1.0,
        "easeOutBack" => {
            let c1 = 1.70158;
            let c3 = c1 + 1.0;
            let shifted = value - 1.0;
            1.0 + c3 * shifted * shifted * shifted + c1 * shifted * shifted
        }
        _ => value,
    }
}

pub fn caption_recipe_channel_identity(channel: &str) -> f64 {
    match channel {
        "opacity" | "scaleX" | "scaleY" | "plateH" => 1.0,
        _ => 0.0,
    }
}

pub fn caption_recipe_apply(channel: &str, value: f64, word: &mut CaptionRecipeResolvedWord) {
    match channel {
        "opacity" => word.opacity = value,
        "dx" => word.dx = value,
        "dy" => word.dy = value,
        "scaleX" => word.scale_x = value,
        "scaleY" => word.scale_y = value,
        "rotation" => word.rotation = value,
        "clipL" => word.clip_l = value,
        "clipR" => word.clip_r = value,
        "clipT" => word.clip_t = value,
        "clipB" => word.clip_b = value,
        "colorMix" => word.color_mix = value,
        "weightAxis" => word.weight_axis = value,
        "fillProgress" => word.fill_progress = value,
        "plateX" => word.plate_x = value,
        "plateW" => word.plate_progress = value,
        "plateH" => word.plate_height = value,
        "plateR" => word.plate_radius = value,
        "glowGain" => word.glow_gain = value,
        "rgbSplit" => word.rgb_split = value,
        "echo" => word.echo = value,
        "scramble" => word.scramble = value,
        "burst" => word.burst = value,
        "emojiPop" => word.emoji_pop = value,
        _ => {}
    }
}

pub fn caption_recipe_word_seed(design: &DesignedCaption, cue_id: &str, word: &Word) -> u64 {
    let base = design
        .seed
        .unwrap_or_else(|| caption_recipe_stable_seed(&format!("{}|{cue_id}", design.style_id)));
    caption_recipe_stable_seed(&format!("{base}|{}|{cue_id}|{}", design.style_id, word.id))
}

pub fn caption_recipe_stable_seed(value: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

pub fn caption_recipe_seeded_unit(seed: u64, phase: usize) -> f64 {
    let mut value = seed.wrapping_add((phase as u64).wrapping_mul(0x9e3779b97f4a7c15));
    value ^= value >> 30;
    value = value.wrapping_mul(0xbf58476d1ce4e5b9);
    value ^= value >> 27;
    value = value.wrapping_mul(0x94d049bb133111eb);
    value ^= value >> 31;
    (value & 0xffff) as f64 / 0xffff as f64
}

pub fn caption_recipe_noise(seed: u64) -> f64 {
    // Mac `AnimNoise.value(seed:at: 0.5)`：lattice=8，因此正好采第 4 个格点。
    let mut hash = seed
        .wrapping_mul(0x9E3779B1)
        .wrapping_add(4_u64.wrapping_mul(0x85EBCA77));
    hash ^= hash >> 33;
    hash = hash.wrapping_mul(0xFF51AFD7ED558CCD);
    hash ^= hash >> 33;
    hash = hash.wrapping_mul(0xC4CEB9FE1A85EC53);
    hash ^= hash >> 33;
    (hash % 20_001) as f64 / 10_000.0 - 1.0
}

pub fn caption_recipe_particle_templates(
    seed: u64,
    count: usize,
) -> Vec<CaptionRecipeParticleTemplate> {
    (0..count.min(24))
        .map(|index| {
            let angle = caption_recipe_seeded_unit(seed, index * 4);
            let radius = caption_recipe_seeded_unit(seed, index * 4 + 1);
            let size = caption_recipe_seeded_unit(seed, index * 4 + 2);
            let lag = caption_recipe_seeded_unit(seed, index * 4 + 3);
            CaptionRecipeParticleTemplate {
                angle: -std::f64::consts::PI * (0.08 + angle * 0.84),
                distance: 0.30 + radius * 0.95,
                radius: 0.035 + size * 0.045,
                lag: lag * 0.24,
            }
        })
        .collect()
}

pub fn caption_recipe_resolve_particle(
    template: CaptionRecipeParticleTemplate,
    progress: f64,
) -> Option<CaptionRecipeParticle> {
    let phase = ((progress - template.lag) / (1.0 - template.lag).max(0.0001)).clamp(0.0, 1.0);
    if !(0.0..1.0).contains(&phase) {
        return None;
    }
    Some(CaptionRecipeParticle {
        dx: template.angle.cos() * template.distance * phase,
        dy: template.angle.sin() * template.distance * phase + phase * phase * 0.38,
        radius: template.radius,
        opacity: (1.0 - phase) * (1.0 - phase),
    })
}

pub fn caption_recipe_scrambled(text: &str, seed: u64, phase: usize) -> String {
    const LATIN: &[char] = &[
        'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R',
        'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
        '#', '%', '&', '@', '$', '?',
    ];
    const CJK: &[char] = &[
        '天', '地', '玄', '黄', '宇', '宙', '洪', '荒', '日', '月', '盈', '昃', '辰', '宿', '列',
        '张', '寒', '来', '暑', '往', '秋', '收', '冬', '藏',
    ];
    const KANA: &[char] = &[
        'ア', 'イ', 'ウ', 'エ', 'オ', 'カ', 'キ', 'ク', 'ケ', 'コ', 'サ', 'シ', 'ス', 'セ', 'ソ',
        'タ', 'チ', 'ツ', 'テ', 'ト', 'ナ', 'ニ', 'ヌ', 'ネ', 'ノ',
    ];
    const HANGUL: &[char] = &[
        '가', '나', '다', '라', '마', '바', '사', '아', '자', '차', '카', '타', '파', '하', '거',
        '너', '더', '러', '머', '버', '서', '어', '저', '처', '커', '터', '퍼', '허',
    ];
    text.chars()
        .enumerate()
        .map(|(index, character)| {
            if character.is_whitespace() {
                return character;
            }
            let scalar = character as u32;
            let alphabet = if (0x3040..=0x30ff).contains(&scalar) {
                KANA
            } else if (0xac00..=0xd7af).contains(&scalar) {
                HANGUL
            } else if (0x3400..=0x9fff).contains(&scalar) {
                CJK
            } else if character.is_alphanumeric() {
                LATIN
            } else {
                return character;
            };
            let roll = caption_recipe_seeded_unit(seed, phase * 97 + index);
            alphabet[((roll * alphabet.len() as f64) as usize).min(alphabet.len() - 1)]
        })
        .collect()
}

pub fn caption_recipe_default_emoji(text: &str) -> &'static str {
    let lower = text.to_lowercase();
    for (needles, emoji) in [
        (&["love", "heart", "爱", "喜欢", "心"][..], "❤️"),
        (&["idea", "think", "想法", "创意", "灵感"][..], "💡"),
        (&["money", "price", "钱", "收入", "赚钱"][..], "💸"),
        (&["fire", "hot", "火", "热", "燃"][..], "🔥"),
        (&["win", "success", "赢", "成功", "冠军"][..], "🏆"),
        (&["laugh", "funny", "笑", "好笑", "开心"][..], "😂"),
        (&["warning", "careful", "警告", "注意", "小心"][..], "⚠️"),
        (&["rocket", "launch", "火箭", "发布", "起飞"][..], "🚀"),
        (&["music", "song", "音乐", "歌曲", "唱"][..], "🎵"),
        (&["food", "eat", "美食", "吃", "饭"][..], "🍜"),
    ] {
        if needles
            .iter()
            .any(|needle| lower.contains(needle) || text.contains(needle))
        {
            return emoji;
        }
    }
    "✨"
}

/// 返回一个词在本配方中**可能**画出的稳定 emoji 文本。用户覆盖在所有 Designed
/// Caption 中都优先；只有描述子真的声明 `emojiPop` 时，缺省词才补语义 emoji。
///
/// CPU resolver 只在效果活动时把缺省 emoji 写进逐帧状态；retained scene 则需要
/// 提前光栅并缓存同一字形，再用透明 uniform 控制未活动帧。因此两条路径必须共用
/// 这个选择函数，不能各猜一次默认值。
pub fn caption_recipe_word_emoji(
    design: &DesignedCaption,
    item: &TimedItem,
    word_index: usize,
) -> Option<String> {
    let word = item.words.get(word_index)?;
    if let Some(emoji) = design
        .overrides
        .get(&word.id)
        .and_then(|value| value.emoji.clone())
    {
        return Some(emoji);
    }
    let has_emoji_pop = caption_recipe_design_descriptor(design).is_some_and(|descriptor| {
        descriptor
            .events
            .iter()
            .any(|event| event.channels.iter().any(|channel| channel == "emojiPop"))
    });
    has_emoji_pop.then(|| caption_recipe_default_emoji(&word.text).to_owned())
}

#[cfg(test)]
mod caption_recipe_tests {
    use super::*;

    fn design(style_id: &str) -> DesignedCaption {
        DesignedCaption {
            style_id: style_id.to_owned(),
            style_version: 1,
            content: "orig".to_owned(),
            primary: SubtitleColor::WHITE,
            accent: parse_css_color("#FFD43B").unwrap(),
            secondary: parse_css_color("#59BAF2").unwrap(),
            intensity: 0.6,
            speed: 1.0,
            seed: Some(42),
            options: Vec::new(),
            overrides: HashMap::new(),
            sequences: CaptionSequenceIntent::default(),
        }
    }

    fn item() -> TimedItem {
        TimedItem {
            id: "cue-1".to_owned(),
            series_index: 0,
            text: "hello world".to_owned(),
            display_start: 0.5,
            display_end: 2.0,
            words: vec![
                Word {
                    id: "w1".to_owned(),
                    text: "hello".to_owned(),
                    start: 0.5,
                    end: 1.0,
                },
                Word {
                    id: "w2".to_owned(),
                    text: "world".to_owned(),
                    start: 1.0,
                    end: 1.5,
                },
            ],
        }
    }

    #[test]
    fn all_mac_recipe_descriptors_decode_in_registry_order() {
        let descriptors = caption_recipe_descriptors();
        assert_eq!(descriptors.len(), 17);
        assert_eq!(descriptors[0].id, "caption-blend-difference");
        assert_eq!(descriptors[2].id, "caption-daoyazi");
        assert_eq!(descriptors[16].id, "caption-weight-shift");
        assert!(descriptors.iter().all(|descriptor| descriptor.version == 1));
        // 跨句序列配方没有逐词事件表，画面由 `execution` 指向的编译器接管。
        assert!(
            descriptors
                .iter()
                .all(|descriptor| { !descriptor.events.is_empty() || descriptor.is_sequence() })
        );
        assert_eq!(
            descriptors
                .iter()
                .filter(|descriptor| descriptor.is_sequence())
                .map(|descriptor| descriptor.id.as_str())
                .collect::<Vec<_>>(),
            ["caption-daoyazi"]
        );
    }

    #[test]
    fn clip_wipe_uses_the_authored_enter_and_active_channels() {
        let resolved =
            resolve_caption_recipe_word(&design("caption-clip-wipe"), &item(), 0, 0.55, 60.0)
                .unwrap();
        assert!(resolved.opacity > 0.0 && resolved.opacity < 1.0);
        assert!(resolved.clip_r > 0.0);
        assert!(resolved.dx < 0.0);
        assert!(resolved.color_mix > 0.0);
    }

    #[test]
    fn particle_and_emoji_recipes_are_seeded_and_role_gated() {
        let mut particle = design("caption-particle-burst");
        particle.overrides.insert(
            "w1".to_owned(),
            CaptionWordOverride {
                role: "hero".to_owned(),
                color: None,
                emoji: None,
            },
        );
        let first = resolve_caption_recipe_word(&particle, &item(), 0, 0.8, 60.0).unwrap();
        let second = resolve_caption_recipe_word(&particle, &item(), 0, 0.8, 60.0).unwrap();
        assert!(!first.particles.is_empty());
        assert_eq!(first.particles, second.particles);

        let mut emoji = design("caption-emoji-pop");
        emoji.overrides = particle.overrides;
        let resolved = resolve_caption_recipe_word(&emoji, &item(), 0, 0.7, 60.0).unwrap();
        assert_eq!(resolved.emoji.as_deref(), Some("✨"));
    }

    #[test]
    fn repeated_text_scramble_is_seek_safe() {
        let first =
            resolve_caption_recipe_word(&design("caption-matrix-decode"), &item(), 0, 0.6, 60.0)
                .unwrap();
        let second =
            resolve_caption_recipe_word(&design("caption-matrix-decode"), &item(), 0, 0.6, 60.0)
                .unwrap();
        assert_eq!(first.text_swap, second.text_swap);
        assert_ne!(first.text_swap.as_deref(), Some("hello"));
    }

    #[test]
    fn dual_band_promotes_one_word_without_persisting_an_override() {
        let resolved =
            resolve_caption_recipe_word(&design("caption-parallax-layers"), &item(), 0, 0.8, 60.0)
                .unwrap();
        assert_eq!(resolved.role, "emphasis");
    }
}
