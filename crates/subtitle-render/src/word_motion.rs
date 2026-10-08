//! Subtitle motion tracks shared by panel previews, playback and export.
/// 一条轨落在整行还是逐词上（原型 `track.group`）。
///
/// 与 [`Track::block_scaling`] 是两件事：这个说**谁拿自己的时间窗**，那个说**变形
/// 相对谁**。`stomp` 已经是 `Block` 了却还标着 `block_scaling`，正是两者不同义的证据。
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Scope {
    /// 每个词一个时间窗。
    Word,
    /// 整行一个时间窗。
    Block,
}

/// `YG`：这一条拿不拿样式上的 `animationColor`，拿去当字色还是块色。
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ColourParam {
    /// 当字色用（只有 `colourHighlight`）。
    TextColour,
    /// 当块色用（`boxHighlight` / `stack`）。
    BoxColour,
}

/// 一帧里的颜色通道。`alpha` 是不透明度；后三样是「换成这条样式的强调色」。
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Colour {
    /// `colour.a`。缺席时归一化补 1。
    pub alpha: Option<f64>,
    /// `colour.useCustom`。
    pub use_custom: bool,
    /// `colour.useSecondary`。
    pub use_secondary: bool,
    /// `colour.mixSecondary`。只有 `1` 与 `1e-9` 两种取值（后者＝几乎不混＝不换）。
    pub mix_secondary: Option<f64>,
}

impl Colour {
    /// 这一帧写没写换色（原型 `hasSwap`）。
    fn has_swap(self) -> bool {
        self.use_custom || self.use_secondary || self.mix_secondary.is_some()
    }

    /// 换不换色。`mixSecondary` 优先于两个布尔开关，> 0.5 才算换。
    fn swaps(self) -> bool {
        let flag = self.use_custom || self.use_secondary;
        if !flag && self.mix_secondary.is_none() {
            return false;
        }
        self.mix_secondary.unwrap_or(if flag { 1.0 } else { 0.0 }) > 0.5
    }
}

/// 一帧里的底块（原型 `keyframe.box`）。
///
/// 这 19 条用到的字段就是这三个：块自己的缩放、块自己的 alpha、圆角。其余
/// (`underText` / `trackActiveElement` / `useCustomColour` / `translate` / `rotation`)
/// 在这 19 条里是恒定值，落进核心只会变成永远为真的死字段。
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize)]
pub struct Chip {
    /// `box.scale.x`（这 19 条里 x 恒等于 y）。
    pub scale: f64,
    /// `box.colour.a`。**独立于词的 opacity**——落到词上会把字一起淡掉。
    pub alpha: f64,
    /// `box.cornerRounding`：**占字号的倍数**（`.5` → `.5em`），不是占盒子短边的
    /// 几分之几。依据见原型 `boxOf()` 的注释与 `model-subanim.test.js:98`。
    pub corner_rounding: f64,
}

/// 一条轨上的一帧。缺席的通道由 [`Track::normalized`] 按 `DEFAULTS` 补齐——这是
/// 本模块关键帧的读法（「没写＝回默认」），与 CSS `@keyframes` 的读法相反。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Keyframe {
    /// 0–1 的时刻。
    pub time: f64,
    /// 从上一帧到这一帧的缓动名（空串＝线性）。
    pub easing: &'static str,
    /// `translate {x, y}`：**元素自己尺寸的倍数**（`-0.2` = 往上挪自己的 20%）。
    pub translate: Option<[f64; 2]>,
    /// `scale`。这 19 条里 x 恒等于 y，所以只存一个数。
    pub scale: Option<f64>,
    /// `rotation {x, y, z}`，度。投影由绘制端负责。
    pub rotation: Option<[f64; 3]>,
    /// `colour`。
    pub colour: Option<Colour>,
    /// `box`。缺席＝这一帧没有块（归一化**不给它补默认值**）。
    pub chip: Option<Chip>,
}

impl Keyframe {
    /// 只写时刻的空帧（`{time: t}`）。
    const fn at(time: f64) -> Self {
        Self {
            time,
            easing: "",
            translate: None,
            scale: None,
            rotation: None,
            colour: None,
            chip: None,
        }
    }

    const fn ease(mut self, easing: &'static str) -> Self {
        self.easing = easing;
        self
    }

    const fn alpha(mut self, alpha: f64) -> Self {
        self.colour = Some(Colour {
            alpha: Some(alpha),
            use_custom: false,
            use_secondary: false,
            mix_secondary: None,
        });
        self
    }

    const fn colour(mut self, colour: Colour) -> Self {
        self.colour = Some(colour);
        self
    }

    const fn dy(mut self, y: f64) -> Self {
        self.translate = Some([0.0, y]);
        self
    }

    const fn scale(mut self, scale: f64) -> Self {
        self.scale = Some(scale);
        self
    }

    const fn rotation(mut self, x: f64, y: f64, z: f64) -> Self {
        self.rotation = Some([x, y, z]);
        self
    }

    const fn chip(mut self, scale: f64, alpha: f64, corner_rounding: f64) -> Self {
        self.chip = Some(Chip {
            scale,
            alpha,
            corner_rounding,
        });
        self
    }
}

/// 换色那一档的两种写法。
const CUSTOM: Colour = Colour {
    alpha: None,
    use_custom: true,
    use_secondary: false,
    mix_secondary: None,
};
const SECONDARY: Colour = Colour {
    alpha: None,
    use_custom: false,
    use_secondary: true,
    mix_secondary: None,
};
const fn mix(value: f64) -> Colour {
    Colour {
        alpha: None,
        use_custom: true,
        use_secondary: false,
        mix_secondary: Some(value),
    }
}

/// 一条轨。`kf` 是轨在动画注册表里的键。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Track {
    pub kf: &'static str,
    pub scope: Scope,
    /// 逐词变形**相对整行**算：`dropIn` 的 `scale 1.5` 因此
    /// 是「从画面外侧落进来」，不是「原地胀一下」。
    pub block_scaling: bool,
    /// 这个词是**居中单独放大**的，不是排在行里的第 n 个。
    pub centre_elements: bool,
    pub keyframes: &'static [Keyframe],
}

/// 一条动效的全部轨（原型 `ANIMS[i]`）。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AnimTracks {
    /// 目录 id，与 the editor animation catalogue 同名同序。
    pub catalog_id: &'static str,
    pub colour_param: Option<ColourParam>,
    /// `qG`：时长按**整条 cue** 算（不在表里的按词窗口均分）。与 `scope` 是两件事。
    pub block_timing: bool,
    pub tracks: &'static [Track],
}

const fn word_track(kf: &'static str, keyframes: &'static [Keyframe]) -> Track {
    Track {
        kf,
        scope: Scope::Word,
        block_scaling: false,
        centre_elements: false,
        keyframes,
    }
}

const fn block_track(kf: &'static str, keyframes: &'static [Keyframe]) -> Track {
    Track {
        kf,
        scope: Scope::Block,
        block_scaling: false,
        centre_elements: false,
        keyframes,
    }
}

const fn anim(catalog_id: &'static str, tracks: &'static [Track]) -> AnimTracks {
    AnimTracks {
        catalog_id,
        colour_param: None,
        block_timing: false,
        tracks,
    }
}

const fn tinted(mut anim: AnimTracks, param: ColourParam) -> AnimTracks {
    anim.colour_param = Some(param);
    anim
}

const fn cue_timed(mut anim: AnimTracks) -> AnimTracks {
    anim.block_timing = true;
    anim
}

// ---------------------------------------------------------------------------
// 19 条轨，原样
// ---------------------------------------------------------------------------

const BOX_HIGHLIGHT_V2: [Keyframe; 3] = [
    Keyframe::at(0.0).chip(0.9, 0.75, 0.5).ease("sinInOut"),
    Keyframe::at(0.7).chip(1.1, 1.0, 0.5).ease("sinInOut"),
    Keyframe::at(1.0).chip(1.0, 1.0, 0.5).ease("sinInOut"),
];
const FLIP_CLOCK: [Keyframe; 2] = [
    Keyframe::at(0.0)
        .rotation(-90.0, 0.0, 0.0)
        .alpha(0.0)
        .ease("expoOut"),
    Keyframe::at(1.0)
        .rotation(0.0, 0.0, 0.0)
        .alpha(1.0)
        .ease("expoOut"),
];
const HIGHLIGHT: [Keyframe; 4] = [
    Keyframe::at(0.0).alpha(0.5),
    Keyframe::at(0.01).alpha(1.0).ease("squareIn"),
    Keyframe::at(0.99).alpha(1.0).ease("squareIn"),
    Keyframe::at(1.0).alpha(0.5).ease("squareOut"),
];
const KARAOKE_V2: [Keyframe; 3] = [
    Keyframe::at(0.0).alpha(0.5),
    Keyframe::at(0.1).alpha(1.0).ease("sinIn"),
    Keyframe::at(1.0).alpha(1.0).ease("squareIn"),
];
const IMPACT: [Keyframe; 4] = [
    Keyframe::at(0.0).alpha(0.0),
    Keyframe::at(0.01).alpha(1.0).ease("squareIn"),
    Keyframe::at(0.99).alpha(0.0).ease("squareIn"),
    Keyframe::at(1.0).alpha(0.0).ease("squareOut"),
];
const REVEAL: [Keyframe; 3] = [
    Keyframe::at(0.0).alpha(0.0),
    Keyframe::at(0.01).alpha(1.0).ease("squareInOut"),
    Keyframe::at(1.0).alpha(1.0).ease("squareInOut"),
];
const FLOAT_IN_COL: [Keyframe; 3] = [
    Keyframe::at(0.0).alpha(0.0),
    Keyframe::at(0.46),
    Keyframe::at(1.0),
];
const FLOAT_IN_TOP: [Keyframe; 2] = [
    Keyframe::at(0.0).dy(-0.2),
    Keyframe::at(1.0).ease("cubicOut"),
];
const FLOAT_IN_BOTTOM: [Keyframe; 2] = [
    Keyframe::at(0.0).dy(0.2),
    Keyframe::at(1.0).ease("cubicOut"),
];
const SCALE_IN: [Keyframe; 2] = [
    Keyframe::at(0.0).scale(0.0).alpha(0.0).ease("expoOut"),
    Keyframe::at(0.65).scale(1.0).alpha(1.0).ease("expoOut"),
];
const DROP_IN: [Keyframe; 2] = [
    Keyframe::at(0.0)
        .dy(-0.1)
        .scale(1.5)
        .alpha(0.0)
        .ease("expoOut"),
    Keyframe::at(0.8)
        .dy(0.0)
        .scale(1.0)
        .alpha(1.0)
        .ease("expoOut"),
];
const IMPACT_POP: [Keyframe; 5] = [
    Keyframe::at(0.0).alpha(0.0),
    Keyframe::at(0.01).alpha(0.5).scale(0.88).ease("squareIn"),
    Keyframe::at(0.98).alpha(1.0).scale(1.0).ease("quadOut"),
    Keyframe::at(0.99).alpha(1.0).ease("quadOut"),
    Keyframe::at(1.0).alpha(0.0).ease("squareOut"),
];
const COLOUR_HIGHLIGHT_V3: [Keyframe; 4] = [
    Keyframe::at(0.0).colour(mix(1e-9)),
    Keyframe::at(0.1).colour(mix(1.0)),
    Keyframe::at(0.9).colour(mix(1.0)),
    Keyframe::at(1.0).colour(mix(1e-9)),
];
const ROTATE_FLIP_CLOCK: [Keyframe; 2] = [
    Keyframe::at(0.0)
        .rotation(-90.0, 0.0, 10.0)
        .alpha(0.0)
        .ease("expoOut"),
    Keyframe::at(1.0)
        .rotation(0.0, 0.0, 10.0)
        .alpha(1.0)
        .ease("expoOut"),
];
const RANDOM_ROTATE: [Keyframe; 3] = [
    Keyframe::at(0.0).rotation(0.0, 0.0, 6.0),
    Keyframe::at(0.22).rotation(0.0, 0.0, 9.0).ease("sinout"),
    Keyframe::at(1.0).rotation(0.0, 0.0, 9.0),
];
const COLOUR_HIGHLIGHT: [Keyframe; 4] = [
    Keyframe::at(0.0),
    Keyframe::at(0.01).colour(SECONDARY).ease("squareIn"),
    Keyframe::at(0.99).colour(SECONDARY).ease("squareIn"),
    Keyframe::at(1.0).ease("squareOut"),
];
const BG_HIGHLIGHT: [Keyframe; 2] = [
    Keyframe::at(0.0).chip(0.92, 1.0, 0.2).ease("sinInOut"),
    Keyframe::at(1.0).chip(0.92, 1.0, 0.2).ease("sinInOut"),
];
const STOMP: [Keyframe; 2] = [
    Keyframe::at(0.0).scale(2.5).alpha(0.0).ease("sinOut"),
    Keyframe::at(1.0).scale(1.0).alpha(1.0).ease("expoOut"),
];
const BOUNCE: [Keyframe; 3] = [
    Keyframe::at(0.0).dy(0.0).alpha(0.0),
    Keyframe::at(0.5).dy(-0.2).alpha(1.0),
    Keyframe::at(1.0).dy(0.0).alpha(1.0),
];
const PAINT: [Keyframe; 3] = [
    Keyframe::at(0.0),
    Keyframe::at(0.01).colour(CUSTOM).ease("squareIn"),
    Keyframe::at(1.0).colour(CUSTOM),
];

const T_BOX_HIGHLIGHT: [Track; 1] = [word_track("boxHighlightV2", &BOX_HIGHLIGHT_V2)];
const T_FLIP_CLOCK: [Track; 1] = [block_track("flipClock", &FLIP_CLOCK)];
const T_HIGHLIGHT: [Track; 1] = [word_track("highlight", &HIGHLIGHT)];
const T_KARAOKE: [Track; 1] = [word_track("karaokeV2", &KARAOKE_V2)];
const T_IMPACT: [Track; 1] = [Track {
    centre_elements: true,
    ..word_track("impact", &IMPACT)
}];
const T_REVEAL: [Track; 1] = [word_track("reveal", &REVEAL)];
const T_FLOAT_IN_TOP: [Track; 2] = [
    word_track("composedFloatIn_col", &FLOAT_IN_COL),
    word_track("composedFloatIn_top", &FLOAT_IN_TOP),
];
const T_FLOAT_IN_BOTTOM: [Track; 2] = [
    word_track("composedFloatIn_col", &FLOAT_IN_COL),
    word_track("composedFloatIn_bottom", &FLOAT_IN_BOTTOM),
];
const T_SCALE_IN: [Track; 1] = [block_track("scaleIn", &SCALE_IN)];
const T_DROP_IN: [Track; 1] = [Track {
    block_scaling: true,
    ..word_track("dropIn", &DROP_IN)
}];
const T_IMPACT_POP: [Track; 1] = [Track {
    block_scaling: true,
    centre_elements: true,
    ..word_track("impactPop", &IMPACT_POP)
}];
const T_COLOUR_HIGHLIGHT: [Track; 1] = [word_track("colourHighlightV3", &COLOUR_HIGHLIGHT_V3)];
const T_ROTATE_FLIP_CLOCK: [Track; 1] = [block_track("rotateFlipClock", &ROTATE_FLIP_CLOCK)];
const T_ROTATE_HIGHLIGHT: [Track; 2] = [
    block_track("randomRotate", &RANDOM_ROTATE),
    word_track("colourHighlight", &COLOUR_HIGHLIGHT),
];
const T_STACK: [Track; 1] = [word_track("bgHighlight", &BG_HIGHLIGHT)];
const T_STOMP: [Track; 1] = [Track {
    block_scaling: true,
    ..block_track("stomp", &STOMP)
}];
const T_BOUNCE: [Track; 1] = [word_track("bounce", &BOUNCE)];
const T_PAINT: [Track; 1] = [word_track("paint", &PAINT)];

/// 19 条动效的轨表。**顺序与 the editor animation catalogue 逐格相同**
/// （门禁 `the_track_table_lines_up_with_the_catalogue` 钉住），因此
/// `WORD_ANIM_TRACKS[demo as usize]` 就是那一格的轨。
pub static WORD_ANIM_TRACKS: [AnimTracks; 19] = [
    anim("none", &[]),
    tinted(
        anim("boxHighlight", &T_BOX_HIGHLIGHT),
        ColourParam::BoxColour,
    ),
    cue_timed(anim("flipClock", &T_FLIP_CLOCK)),
    anim("highlight", &T_HIGHLIGHT),
    anim("karaoke", &T_KARAOKE),
    anim("impact", &T_IMPACT),
    anim("reveal", &T_REVEAL),
    anim("floatInTop", &T_FLOAT_IN_TOP),
    anim("floatInBottom", &T_FLOAT_IN_BOTTOM),
    anim("scaleIn", &T_SCALE_IN),
    anim("dropIn", &T_DROP_IN),
    anim("impactPop", &T_IMPACT_POP),
    tinted(
        anim("colourHighlight", &T_COLOUR_HIGHLIGHT),
        ColourParam::TextColour,
    ),
    cue_timed(anim("rotateFlipClock", &T_ROTATE_FLIP_CLOCK)),
    anim("rotateHighlight", &T_ROTATE_HIGHLIGHT),
    tinted(anim("stack", &T_STACK), ColourParam::BoxColour),
    cue_timed(anim("stomp", &T_STOMP)),
    anim("bounce", &T_BOUNCE),
    anim("paint", &T_PAINT),
];

// ---------------------------------------------------------------------------
// 归一化与取样（原型 `normalize` / `ease01` / `tween` / `sampleAt`）
// ---------------------------------------------------------------------------

/// 一条轨用到的通道并集。归一化按它逐帧补默认值。
#[derive(Clone, Copy, Debug, Default)]
struct Used {
    translate: bool,
    scale: bool,
    rotation: bool,
    colour: bool,
}

impl Track {
    fn used(self) -> Used {
        let mut used = Used::default();
        for kf in self.keyframes {
            used.translate |= kf.translate.is_some();
            used.scale |= kf.scale.is_some();
            used.rotation |= kf.rotation.is_some();
            used.colour |= kf.colour.is_some();
        }
        used
    }

    /// 这条轨碰不碰 transform（原型 `moving`）。
    pub fn moving(self) -> bool {
        let used = self.used();
        used.translate || used.scale || used.rotation
    }

    /// 第 `i` 帧补齐缺席通道后的样子。
    ///
    /// **「没写＝回默认」**，不是 CSS `@keyframes` 的「没写＝不参与插值」。
    /// `composedFloatIn_top` 的末帧什么都没写，词当然要落回 `y = 0`。
    /// 唯一的例外是 `box`：没写块就是**没有块**，不给它补一个空块。
    fn normalized(self, index: usize) -> Keyframe {
        let used = self.used();
        let swaps = self
            .keyframes
            .iter()
            .any(|kf| kf.colour.is_some_and(Colour::has_swap));
        let mut kf = self.keyframes[index];
        if used.translate && kf.translate.is_none() {
            kf.translate = Some([0.0, 0.0]);
        }
        if used.scale && kf.scale.is_none() {
            kf.scale = Some(1.0);
        }
        if used.rotation && kf.rotation.is_none() {
            kf.rotation = Some([0.0, 0.0, 0.0]);
        }
        if used.colour && kf.colour.is_none() {
            kf.colour = Some(Colour::default());
        }
        if let Some(colour) = &mut kf.colour {
            if colour.alpha.is_none() {
                colour.alpha = Some(1.0);
            }
            // 换色也要「回默认」：轨里只要有一帧换色，没换的那几帧就得显式写回本色。
            if swaps && !colour.has_swap() {
                colour.mix_secondary = Some(0.0);
            }
        }
        kf
    }
}

/// 段内进度（原型 `ease01`）。`square*` 是阶跃，其余按线性取样——静帧不必解贝塞尔，
/// 差别落在小数点后。
fn ease01(name: &str, p: f64) -> f64 {
    match name {
        "squareIn" | "squareInOut" => 0.0,
        "squareOut" => 1.0,
        _ => p,
    }
}

fn lerp(a: f64, b: f64, p: f64) -> f64 {
    a + (b - a) * p
}

/// 两帧之间插一帧（原型 `tween`）。只插数值；颜色开关、圆角这些离散的取**起始帧**的。
fn tween(a: Keyframe, b: Keyframe, p: f64) -> Keyframe {
    let mut out = Keyframe::at(lerp(a.time, b.time, p));
    if a.translate.is_some() || b.translate.is_some() {
        let x = a.translate.unwrap_or([0.0, 0.0]);
        let y = b.translate.unwrap_or([0.0, 0.0]);
        out.translate = Some([lerp(x[0], y[0], p), lerp(x[1], y[1], p)]);
    }
    if a.scale.is_some() || b.scale.is_some() {
        out.scale = Some(lerp(a.scale.unwrap_or(1.0), b.scale.unwrap_or(1.0), p));
    }
    if a.rotation.is_some() || b.rotation.is_some() {
        let x = a.rotation.unwrap_or([0.0; 3]);
        let y = b.rotation.unwrap_or([0.0; 3]);
        out.rotation = Some([
            lerp(x[0], y[0], p),
            lerp(x[1], y[1], p),
            lerp(x[2], y[2], p),
        ]);
    }
    if a.colour.is_some() || b.colour.is_some() {
        // 换色开关取起始帧的；只有 alpha 连续。
        let mut colour = a.colour.unwrap_or_default();
        let start = a.colour.and_then(|c| c.alpha);
        let end = b.colour.and_then(|c| c.alpha);
        if start.is_some() || end.is_some() {
            colour.alpha = Some(lerp(start.unwrap_or(1.0), end.unwrap_or(1.0), p));
        }
        out.colour = Some(colour);
    }
    // 块按数插：`scale` 与 `colour.a` 连续（`boxHighlightV2` 那下胀缩靠它们），
    // 圆角离散，取起始帧的。
    if let Some(base) = a.chip.or(b.chip) {
        let start = a.chip.unwrap_or(base);
        let end = b.chip.unwrap_or(base);
        out.chip = Some(Chip {
            scale: lerp(start.scale, end.scale, p),
            alpha: lerp(start.alpha, end.alpha, p),
            corner_rounding: base.corner_rounding,
        });
    }
    out
}

/// 这条轨在时刻 `t`（0–1）的那一帧。超出首末帧就取首末帧（CSS 的 `both`）。
pub fn sample_at(track: Track, t: f64) -> Keyframe {
    let last = track.keyframes.len() - 1;
    if t <= track.keyframes[0].time {
        return track.normalized(0);
    }
    if t >= track.keyframes[last].time {
        return track.normalized(last);
    }
    for index in 0..last {
        let a = track.normalized(index);
        let b = track.normalized(index + 1);
        if t > b.time {
            continue;
        }
        let span = b.time - a.time;
        let p = if span > 0.0 { (t - a.time) / span } else { 1.0 };
        return tween(a, b, ease01(a.easing, p));
    }
    track.normalized(last)
}

/// 一帧上能被面板消费的那几位。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sample {
    /// 换成这条样式的强调色。
    pub tinted: bool,
    /// 不透明度。
    pub opacity: f64,
    /// 纵向位移，**元素自己尺寸的倍数**（`-0.2` = 往上挪自己的 20%）。
    pub dy: f64,
    /// 缩放倍数。
    pub scale: f64,
    /// 绕 x 轴旋转（度）。非零时配 `perspective(6em)`。
    pub rotate_x_deg: f64,
    /// 绕 z 轴旋转（度）。平面内的倾斜，不配透视。
    pub rotate_z_deg: f64,
    /// 底块。
    pub chip: Option<Chip>,
}

impl Default for Sample {
    fn default() -> Self {
        Self {
            tinted: false,
            opacity: 1.0,
            dy: 0.0,
            scale: 1.0,
            rotate_x_deg: 0.0,
            rotate_z_deg: 0.0,
            chip: None,
        }
    }
}

impl Sample {
    /// 把一帧盖到这份取样上。同一条动效的多条轨按顺序叠（原型 `Object.assign`），
    /// 后来的轨只覆盖它**自己写了**的通道。
    fn apply(&mut self, kf: Keyframe) {
        if let Some(translate) = kf.translate {
            self.dy = translate[1];
        }
        if let Some(scale) = kf.scale {
            self.scale = scale;
        }
        if let Some(rotation) = kf.rotation {
            self.rotate_x_deg = rotation[0];
            self.rotate_z_deg = rotation[2];
        }
        if let Some(colour) = kf.colour {
            if let Some(alpha) = colour.alpha {
                self.opacity = alpha;
            }
            if colour.has_swap() {
                self.tinted = colour.swaps();
            }
        }
        if let Some(chip) = kf.chip {
            self.chip = Some(chip);
        }
    }
}

/// 第 `index` 个词在「当前词是 `current`」这一帧的样子（原型 `frame()`）。
///
/// `phase` 是当前词自己窗口内的 0–1：还没轮到的词取轨的**首帧**、念过的取**末帧**、
/// 正在念的取 `phase`。底块只画在当前词上。
pub fn sample_word(anim: &AnimTracks, index: usize, current: usize, phase: f64) -> Sample {
    let mut out = Sample::default();
    for track in anim.tracks.iter().filter(|t| t.scope == Scope::Word) {
        let t = if index > current {
            0.0
        } else if index == current {
            phase
        } else {
            1.0
        };
        let kf = sample_at(*track, t);
        if kf.chip.is_some() && index != current {
            continue;
        }
        out.apply(kf);
    }
    out
}

/// 整行那一档在这一帧的样子（原型 `lineFrame()`）。
///
/// `current <= 1` 当作**还在进场**——签名帧因此画的是「正在进来」那一刻；停在落位
/// 那一帧的话它与「无」长得一模一样。
pub fn sample_block(anim: &AnimTracks, current: usize, phase: f64) -> Sample {
    let mut out = Sample::default();
    for track in anim.tracks.iter().filter(|t| t.scope == Scope::Block) {
        let t = if current <= 1 { phase } else { 1.0 };
        out.apply(sample_at(*track, t));
    }
    out
}

impl AnimTracks {
    /// 这一条有没有整行 / 逐词那一档。
    pub fn has_scope(&self, scope: Scope) -> bool {
        self.tracks.iter().any(|track| track.scope == scope)
    }

    /// 有没有轨（原型 `moves`）。
    pub fn moves(&self) -> bool {
        !self.tracks.is_empty()
    }

    /// 逐词变形是不是相对整行算的（原型 `blockScaled`）。
    pub fn block_scaled(&self) -> bool {
        self.tracks
            .iter()
            .any(|track| track.scope == Scope::Word && track.block_scaling)
    }

    /// 入场方向箭头（原型 `dir`）：**从轨上读**，不另写一份。位移为负＝从上面来。
    pub fn direction(&self) -> Option<&'static str> {
        let y = self
            .tracks
            .iter()
            .filter(|track| track.scope == Scope::Word)
            .fold(0.0, |acc, track| match track.keyframes[0].translate {
                Some([_, y]) if y != 0.0 => y,
                _ => acc,
            });
        if y < 0.0 {
            Some("↓")
        } else if y > 0.0 {
            Some("↑")
        } else {
            None
        }
    }
}

/// 缓动名 → CSS 曲线（原型 `EASING`）。取样用不到它（`ease01` 已经收口），
/// 留给要真跑动画的表面。
pub fn easing_curve(name: &str) -> Option<&'static str> {
    Some(match name {
        "sinIn" => "cubic-bezier(0.12, 0, 0.39, 0)",
        "sinOut" | "sinout" => "cubic-bezier(0.61, 1, 0.88, 1)",
        "sinInOut" => "cubic-bezier(0.37, 0, 0.63, 1)",
        "expoOut" => "cubic-bezier(0.16, 1, 0.3, 1)",
        "cubicOut" => "cubic-bezier(0.33, 1, 0.68, 1)",
        "quadOut" => "cubic-bezier(0.5, 1, 0.89, 1)",
        "squareIn" | "squareInOut" => "steps(1, end)",
        "squareOut" => "steps(1, start)",
        _ => return None,
    })
}

/// Continuous sampling uses analytic easing, not CSS bezier approximations or
/// the legacy 35% signature samples above.
pub fn continuous_ease(name: &str, p: f64) -> f64 {
    let p = p.clamp(0.0, 1.0);
    match name {
        "sinIn" => 1.0 - (p * std::f64::consts::FRAC_PI_2).cos(),
        "sinOut" | "sinout" => (p * std::f64::consts::FRAC_PI_2).sin(),
        "sinInOut" => (1.0 - (p * std::f64::consts::PI).cos()) / 2.0,
        "expoOut" => {
            if p >= 1.0 {
                1.0
            } else {
                1.0 - 2.0_f64.powf(-10.0 * p)
            }
        }
        "cubicOut" => 1.0 - (1.0 - p).powi(3),
        "quadOut" => 1.0 - (1.0 - p).powi(2),
        // Step easings: hold the start, jump to the end, or round at the midpoint.
        "squareIn" => 0.0,
        "squareOut" => 1.0,
        "squareInOut" => p.round(),
        _ => p,
    }
}

pub fn continuous_at(track: Track, t: f64) -> Keyframe {
    let last = track.keyframes.len() - 1;
    if t <= track.keyframes[0].time {
        return track.normalized(0);
    }
    if t >= track.keyframes[last].time {
        return track.normalized(last);
    }
    for index in 0..last {
        let a = track.normalized(index);
        let b = track.normalized(index + 1);
        if t < b.time {
            // A segment uses the easing of its end keyframe `b`.
            // squareInOut rounds track time, not segment progress.
            return tween(
                a,
                b,
                continuous_ease(
                    b.easing,
                    if b.easing == "squareInOut" {
                        t
                    } else {
                        (t - a.time) / (b.time - a.time)
                    },
                ),
            );
        }
    }
    track.normalized(last)
}

/// Renderer-neutral pose; the Canvas and native painters consume these numbers.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pose {
    pub opacity: f64,
    pub scale: f64,
    pub dy: f64,
    pub rx: f64,
    pub ry: f64,
    pub rz: f64,
    pub tint: bool,
    pub chip: Option<Chip>,
    pub centered: bool,
    pub block_scaled: bool,
}

impl Default for Pose {
    fn default() -> Self {
        Self {
            opacity: 1.0,
            scale: 1.0,
            dy: 0.0,
            rx: 0.0,
            ry: 0.0,
            rz: 0.0,
            tint: false,
            chip: None,
            centered: false,
            block_scaled: false,
        }
    }
}

impl Pose {
    fn apply(&mut self, frame: Keyframe, track: Track, series: u32, random: f64) {
        if let Some([_, y]) = frame.translate {
            self.dy = y;
        }
        if let Some(scale) = frame.scale {
            self.scale = scale;
        }
        if let Some([x, y, z]) = frame.rotation {
            self.rx = x;
            self.ry = y;
            self.rz = z;
            // Flip all axes first, then add offsetWindow.
            let window = match track.kf {
                "rotateFlipClock" => 5.0,
                "randomRotate" => 3.0,
                _ => 0.0,
            };
            if window > 0.0 {
                let direction = if series % 2 == 0 { 1.0 } else { -1.0 };
                self.rx = x * direction;
                self.ry = y * direction
                    + if track.kf == "randomRotate" {
                        random * 0.5
                    } else {
                        0.0
                    };
                self.rz = z * direction + (random * 2.0 - 1.0) * window;
            }
        }
        if let Some(colour) = frame.colour {
            if let Some(alpha) = colour.alpha {
                self.opacity = alpha;
            }
            if colour.has_swap() {
                self.tint = colour.swaps();
            }
        }
        if frame.chip.is_some() {
            self.chip = frame.chip;
        }
        self.centered |= track.centre_elements;
        self.block_scaled |= track.block_scaling;
    }
}

/// Top-left 2×2 of the Rx · Ry · Rz rotation matrix, scaled by `pose.scale`.
pub fn projected_matrix(pose: &Pose) -> [f64; 4] {
    let (sx, cx) = pose.rx.to_radians().sin_cos();
    let (sy, cy) = pose.ry.to_radians().sin_cos();
    let (sz, cz) = pose.rz.to_radians().sin_cos();
    [
        cy * cz,
        cx * sz + sx * sy * cz,
        -cy * sz,
        cx * cz - sx * sy * sz,
    ]
    .map(|v| v * pose.scale)
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct MotionFrame {
    pub block: Pose,
    pub words: Vec<Pose>,
}

pub fn by_id(id: &str) -> Option<&'static AnimTracks> {
    WORD_ANIM_TRACKS.iter().find(|a| a.catalog_id == id)
}

/// Timing is separate from `group`: only flipClock/stomp use
/// min(cue duration * .7, 1s); scaleIn/rotateFlipClock still use duration/words.
/// Word start/end comes from alignment; callers supply actual, nonuniform times.
pub fn motion_frame(
    id: &str,
    elapsed: f64,
    duration: f64,
    words: &[(f64, f64)],
    series: u32,
) -> MotionFrame {
    motion_frame_seeded(id, elapsed, duration, words, series, series)
}

/// Seed for std::seed_seq → MT19937, taken from the first four item-id bytes.
pub fn item_seed(id: &str) -> u32 {
    let mut bytes = *b"1234";
    for (out, byte) in bytes.iter_mut().zip(id.bytes()) {
        *out = byte;
    }
    // The first three char values are sign-extended (signed `char`).
    (bytes[0] as i8 as u32)
        | ((bytes[1] as i8 as u32) << 8)
        | ((bytes[2] as i8 as u32) << 16)
        | (u32::from(bytes[3]) << 24)
}

/// First uniform float from a one-value seed_seq / MT19937 path.
pub fn seeded_unit(seed: u32) -> f64 {
    let mut state = [0x8b8b8b8b_u32; 624];
    let mix = |x: u32| x ^ (x >> 27);
    let r1 = 1664525_u32.wrapping_mul(mix(state[0] ^ state[306] ^ state[623]));
    let r2 = r1.wrapping_add(1);
    state[306] = state[306].wrapping_add(r1);
    state[317] = state[317].wrapping_add(r2);
    state[0] = r2;
    for k in 1..624 {
        let r1 = 1664525_u32.wrapping_mul(mix(state[k] ^ state[(k + 306) % 624] ^ state[k - 1]));
        let r2 = r1
            .wrapping_add(k as u32)
            .wrapping_add(if k == 1 { seed } else { 0 });
        state[(k + 306) % 624] = state[(k + 306) % 624].wrapping_add(r1);
        state[(k + 317) % 624] = state[(k + 317) % 624].wrapping_add(r2);
        state[k] = r2;
    }
    for k in 624..1248 {
        let j = k % 624;
        let r3 = 1566083941_u32.wrapping_mul(mix(state[j]
            .wrapping_add(state[(k + 306) % 624])
            .wrapping_add(state[(k - 1) % 624])));
        let r4 = r3.wrapping_sub(j as u32);
        state[(k + 306) % 624] ^= r3;
        state[(k + 317) % 624] ^= r4;
        state[j] = r4;
    }
    let mut y = state[397]
        ^ (((state[0] & 0x80000000) | (state[1] & 0x7fffffff)) >> 1)
        ^ if state[1] & 1 != 0 { 0x9908b0df } else { 0 };
    y ^= y >> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >> 18;
    f64::from(y as f32 * 2.3283064e-10_f32)
}

pub fn motion_frame_seeded(
    id: &str,
    elapsed: f64,
    duration: f64,
    words: &[(f64, f64)],
    series: u32,
    seed: u32,
) -> MotionFrame {
    let mut result = MotionFrame {
        block: Pose::default(),
        words: vec![Pose::default(); words.len()],
    };
    let Some(anim) = by_id(id) else {
        return result;
    };
    let duration = duration.max(0.001);
    let length = if matches!(id, "flipClock" | "stomp") {
        (duration * 0.7).min(1.0)
    } else {
        duration / words.len().max(1) as f64
    };
    let current = words.iter().rposition(|(start, _)| elapsed >= *start);
    let random = if matches!(id, "rotateFlipClock" | "rotateHighlight") {
        seeded_unit(seed)
    } else {
        0.5
    };
    for track in anim.tracks {
        if track.scope == Scope::Block {
            result.block.apply(
                continuous_at(*track, elapsed / length),
                *track,
                series,
                random,
            );
        } else {
            for (index, (start, end)) in words.iter().enumerate() {
                let t = ((elapsed - start) / (end - start).max(0.001)).clamp(0.0, 1.0);
                let mut sample = continuous_at(*track, t);
                if sample.chip.is_some() && (current != Some(index) || elapsed >= *end) {
                    sample.chip = None;
                }
                result.words[index].apply(sample, *track, series, random);
            }
        }
    }
    result
}

/// Panel sample sentence: four words, 0.5 seconds each, then a 0.5s rest.
pub fn demo_frame(id: &str, seconds: f64) -> MotionFrame {
    let seconds = if seconds.is_finite() {
        seconds.max(0.0)
    } else {
        0.675
    };
    motion_frame(
        id,
        seconds % 2.5,
        2.0,
        &[(0.0, 0.5), (0.5, 1.0), (1.0, 1.5), (1.5, 2.0)],
        (seconds / 2.5).floor() as u32,
    )
}

#[cfg(test)]
mod continuous_tests {
    use super::*;
    /// 演示帧、种子与投影矩阵的固定点。
    #[test]
    fn demo_frame_seed_and_projection_match_fixed_points() {
        assert!(demo_frame("rotateFlipClock", 2.6).block.rx > 0.0);
        assert_eq!(item_seed(""), 0x34333231);
        assert_eq!(item_seed("abcdef"), 0x64636261);
        let projected = projected_matrix(&Pose {
            rx: -45.0,
            rz: 30.0,
            ..Pose::default()
        });
        // X is applied before Z; column-major XY coefficients.
        for (actual, expected) in projected.into_iter().zip([
            0.8660253882408142,
            0.3535533845424652,
            -0.5,
            0.6123723983764648,
        ]) {
            assert!((actual - expected).abs() < 2e-6);
        }
    }
    #[test]
    fn continuous_prototype_and_native_frames_match_at_boundaries_and_between_them() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let script = "global.window={};require('./designs/baocut/app/model-subanim.js');require('./designs/baocut/app/model-subcanvas.js');console.log(JSON.stringify(window.BC_SA.ANIMS.flatMap(a=>Array.from({length:101},(_,i)=>window.BC_SC.frame(a.k,i/20)))));";
        let output = std::process::Command::new("node")
            .args(["-e", script])
            .current_dir(root)
            .output()
            .expect("node is required for cross-surface motion parity");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let javascript: Vec<serde_json::Value> = serde_json::from_slice(&output.stdout).unwrap();
        fn compare(a: &serde_json::Value, b: &serde_json::Value, path: &str) {
            match (a, b) {
                (serde_json::Value::Number(a), serde_json::Value::Number(b)) => assert!(
                    (a.as_f64().unwrap() - b.as_f64().unwrap()).abs() < 1e-8,
                    "{path}: {a} != {b}"
                ),
                (serde_json::Value::Object(a), serde_json::Value::Object(b)) => {
                    for (key, value) in a {
                        compare(value, &b[key], &format!("{path}.{key}"));
                    }
                }
                (serde_json::Value::Array(a), serde_json::Value::Array(b)) => {
                    assert_eq!(a.len(), b.len());
                    for (i, (a, b)) in a.iter().zip(b).enumerate() {
                        compare(a, b, &format!("{path}[{i}]"));
                    }
                }
                _ => assert_eq!(a, b, "{path}"),
            }
        }
        for (anim_index, anim) in WORD_ANIM_TRACKS.iter().enumerate() {
            for index in 0..101 {
                let rust =
                    serde_json::to_value(demo_frame(anim.catalog_id, index as f64 / 20.0)).unwrap();
                compare(
                    &rust,
                    &javascript[anim_index * 101 + index],
                    &format!("{} at {}", anim.catalog_id, index as f64 / 20.0),
                );
            }
        }
    }
    #[test]
    fn flip_uses_continuous_easing_and_never_restarts_on_each_word() {
        let early = demo_frame("flipClock", 0.1).block;
        assert!((early.opacity - 0.5).abs() < 1e-8);
        assert!((early.rx + 45.0).abs() < 1e-8);
        assert_eq!(demo_frame("flipClock", 1.1).block.rx, 0.0);
    }
    #[test]
    fn centered_words_and_alternating_angles_survive_sampling() {
        assert!(
            demo_frame("impactPop", 0.7)
                .words
                .iter()
                .all(|p| p.centered)
        );
        let a = demo_frame("rotateFlipClock", 0.7).block.rz;
        let b = demo_frame("rotateFlipClock", 3.2).block.rz;
        assert!((5.0..=15.0).contains(&a));
        assert!((-15.0..=-5.0).contains(&b));
    }
    #[test]
    fn nonuniform_alignment_uses_word_windows_and_stops_chips_in_gaps() {
        let times = [(0.0, 0.1), (0.3, 1.0)];
        assert!(
            motion_frame("boxHighlight", 0.2, 1.0, &times, 0)
                .words
                .iter()
                .all(|p| p.chip.is_none())
        );
        assert!(
            motion_frame("boxHighlight", 0.4, 1.0, &times, 0).words[1]
                .chip
                .is_some()
        );
    }
}
