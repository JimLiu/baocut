//! 按时刻出帧：物理按固定 1/120 秒步长从角色时钟的 0 秒重放（往前 seek 接着走，往回 seek 从最近的快照接着走），
//! 所以同一个时刻不论怎么 seek、预览还是导出，画出来都一样。开头先按第 0 秒的参数预走 0.5 秒，弹簧和身体不会
//! 从静止猛地弹起。

use std::sync::Arc;

use crate::character::{Character, CharacterState};
use crate::rig::{Params, TICK};
use crate::track::Track;
use crate::{idle::Idle, smooth};

/// 开头预走多久（秒）。
const PRE_ROLL: f64 = 0.5;
/// 动作轨结束后过渡到待机动作用多久（秒）。
const FADE_OUT: f64 = 0.5;
/// 每走多少步存一份快照（10 秒）：往回 seek 最多重放这么多步。
const CHECKPOINT: u64 = 1200;
/// `mouthOpen` 在参数里的序号。
const MOUTH_OPEN: usize = 9;

/// 一个条目上的角色：角色、动作轨与它们跨帧的状态。
pub struct Player {
    character: Character,
    track: Option<Arc<Track>>,
    seed: u64,
    /// 重放从角色时钟的哪一秒开始（≤ 0，按步长取整）：条目开头早于动作轨时是负的。
    origin: f64,
    idle: Idle,
    /// 已经走了多少步（第 0 步是预走的起点）；deformed：网格是按哪一步形变的。
    tick: u64,
    deformed: Option<u64>,
    /// 第 k 份是第 (k + 1) × CHECKPOINT 步走完时的状态。
    checkpoints: Vec<(CharacterState, Idle)>,
}

impl Player {
    /// `start` 是要画的最早的角色时钟（秒）：条目开头对应动作轨的第几秒。重放从 `min(start, 0)` 开始，所以
    /// 不早于 0 的条目画出来只看时刻，与 `start` 无关（拆开的两段在接缝处一样）。
    pub fn new(character: impl Into<Character>, track: Option<Arc<Track>>, seed: u64, start: f64) -> Player {
        let origin = if start.is_finite() && start < 0.0 {
            (start / TICK).floor() * TICK
        } else {
            0.0
        };
        let mut p = Player {
            character: character.into(),
            track,
            seed,
            origin,
            idle: Idle::new(seed),
            tick: 0,
            deformed: None,
            checkpoints: Vec::new(),
        };
        p.restart();
        p
    }

    /// 角色的画布尺寸（模型像素）。
    pub fn canvas(&self) -> [u32; 2] {
        self.character.canvas()
    }

    /// 当前一步的参数（动作轨与待机合起来的）。
    pub fn params(&self) -> &Params {
        self.character.params()
    }

    fn restart(&mut self) {
        self.character.reset();
        self.idle = Idle::new(self.seed);
        self.tick = 0;
        self.deformed = None;
        self.apply_inputs(0);
    }

    /// 第 `k` 步那一刻的参数：`params` 里有的取动作轨，没有的取待机，再加上 `offsets`；动作轨开始前、结束后渐渐
    /// 交给待机。
    fn apply_inputs(&mut self, k: u64) {
        let clock = k as f64 * TICK;
        let t = self.origin + (clock - PRE_ROLL).max(0.0);
        let fade = match &self.track {
            Some(_) if t < 0.0 => 1.0 - smooth(-FADE_OUT, 0.0, t),
            Some(tr) => smooth(tr.duration(), tr.duration() + FADE_OUT, t),
            None => 1.0,
        };
        // 完全交给待机时不再读动作轨（结果与没有动作轨逐位相同）
        let track = self.track.as_deref().filter(|_| fade < 1.0);
        // 配音让嘴张多大：待机据此在说话时不开始小动作、眼睛回看镜头、停顿后眨眼
        let voice = track.and_then(|tr| tr.param(MOUTH_OPEN, t)).map_or(0.0, |v| v * (1.0 - fade));
        let idle = self.idle.step(clock, TICK, voice);
        let mut p = Params::default();
        for i in 0..Params::NAMES.len() {
            let mut v = match track.and_then(|tr| tr.param(i, t)) {
                Some(v) => v + (idle.get(i) - v) * fade,
                None => idle.get(i),
            };
            if let Some(o) = track.and_then(|tr| tr.offset(i, t)) {
                v += o * (1.0 - fade);
            }
            p.set(i, v);
        }
        let puppet = match &mut self.character {
            Character::Layered(puppet) => puppet,
            Character::Mesh(m) => {
                // mesh-avatar 一次只显示一张表情，自己缓动过去（见 MeshPuppet::set_inputs）
                let expressions: Vec<(&str, f64)> = track
                    .map(|tr| tr.expressions(t).map(|(id, v)| (id, v * (1.0 - fade))).collect())
                    .unwrap_or_default();
                m.set_inputs(p, &expressions);
                return;
            }
        };
        puppet.params = p;
        puppet.expr.clear();
        if let Some(tr) = track {
            for (id, v) in tr.expressions(t) {
                let v = v * (1.0 - fade);
                // 笑既是参数也是表情：两路取大的（和 LivLiv 的 Player 一样）
                if id == "smile" {
                    let s = puppet.params.smile.max(v);
                    puppet.set_expression(id, s);
                } else {
                    puppet.set_expression(id, v);
                }
            }
            // 动作轨的权重就是显示的权重：笑不再缓动（别的表情本来就不缓动）。笑落后另一张表情零点几秒，换表情时
            // 两张补丁一起不透明，笑的嘴角、眉毛露在下一张外面
            puppet.smile_shown = puppet.params.smile;
        }
    }

    /// 把状态走到角色时钟的 `t` 秒（不画）。
    pub fn seek(&mut self, t: f64) {
        let t = if t.is_finite() { t } else { 0.0 };
        let target = (((t - self.origin).max(0.0) + PRE_ROLL) / TICK).round() as u64;
        if target < self.tick {
            // 从不晚于目标的最近一份快照接着走；没有就从头
            match (target / CHECKPOINT)
                .checked_sub(1)
                .and_then(|k| self.checkpoints.get(k as usize).map(|c| (k, c)))
            {
                Some((k, (state, idle))) => {
                    self.character.load(state);
                    self.idle = idle.clone();
                    self.tick = (k + 1) * CHECKPOINT;
                    self.deformed = None;
                }
                None => self.restart(),
            }
        }
        while self.tick < target {
            self.tick += 1;
            self.apply_inputs(self.tick);
            self.character.update(TICK, false);
            if self.tick % CHECKPOINT == 0 && self.checkpoints.len() as u64 == self.tick / CHECKPOINT - 1 {
                self.checkpoints.push((self.character.save(), self.idle.clone()));
            }
        }
        if self.deformed != Some(self.tick) {
            self.character.update(0.0, true);
            self.deformed = Some(self.tick);
        }
    }

    /// 画角色时钟 `t` 秒的一帧到 `w`×`h` 的预乘 RGBA8 缓冲。
    pub fn render(&mut self, t: f64, w: u32, h: u32, out: &mut [u8]) {
        self.seek(t);
        self.character.render(w, h, out);
    }

    /// 角色时钟 `t` 秒的 `moveX` `moveY` 在缓冲里的平移，见 [`crate::Puppet::shift`]。
    pub fn shift(&mut self, t: f64, w: u32, h: u32, frame_bottom: f64) -> [f64; 2] {
        self.seek(t);
        self.character.shift(w, h, frame_bottom)
    }

    /// 同 [`Player::render`]，平移由宿主给，见 [`crate::Puppet::render_shifted`]。
    pub fn render_shifted(&mut self, t: f64, w: u32, h: u32, shift: [f64; 2], out: &mut [u8]) {
        self.seek(t);
        self.character.render_shifted(w, h, shift, out);
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn mouth_open_index_matches_the_names() {
        assert_eq!(crate::rig::Params::index("mouthOpen"), Some(super::MOUTH_OPEN));
    }
}
