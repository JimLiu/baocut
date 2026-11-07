//! 按时刻出帧：物理按固定 1/120 秒步长从条目开头重放（往前 seek 接着走，往回 seek 从头再走），所以同一个时刻
//! 不论怎么 seek、预览还是导出，画出来都一样。开头先按第 0 秒的参数预走 0.5 秒，弹簧和身体不会从静止猛地弹起。

use std::sync::Arc;

use crate::rig::{Params, Puppet, TICK};
use crate::track::Track;
use crate::{idle::Idle, smooth};

/// 开头预走多久（秒）。
const PRE_ROLL: f64 = 0.5;
/// 动作轨结束后过渡到待机动作用多久（秒）。
const FADE_OUT: f64 = 0.5;

/// 一个条目上的角色：角色、动作轨与它们跨帧的状态。
pub struct Player {
    puppet: Puppet,
    track: Option<Arc<Track>>,
    seed: u64,
    idle: Idle,
    /// 已经走了多少步（第 0 步是预走的起点）；deformed：网格是按哪一步形变的。
    tick: u64,
    deformed: Option<u64>,
}

impl Player {
    pub fn new(puppet: Puppet, track: Option<Arc<Track>>, seed: u64) -> Player {
        let mut p = Player {
            puppet,
            track,
            seed,
            idle: Idle::new(seed),
            tick: 0,
            deformed: None,
        };
        p.restart();
        p
    }

    pub fn puppet(&self) -> &Puppet {
        &self.puppet
    }

    fn restart(&mut self) {
        self.puppet.reset();
        self.idle = Idle::new(self.seed);
        self.tick = 0;
        self.deformed = None;
        self.apply_inputs(0);
    }

    /// 第 `k` 步那一刻的参数：动作轨有的取动作轨，没有的取待机；动作轨结束后渐渐交给待机。
    fn apply_inputs(&mut self, k: u64) {
        let clock = k as f64 * TICK;
        let t = (clock - PRE_ROLL).max(0.0);
        let idle = *self.idle.step(clock, TICK);
        let mut p = Params::default();
        let (fade, track) = match &self.track {
            Some(tr) => (smooth(tr.duration(), tr.duration() + FADE_OUT, t), Some(tr.as_ref())),
            None => (1.0, None),
        };
        for i in 0..Params::NAMES.len() {
            let v = match track.and_then(|tr| tr.param(i, t)) {
                Some(v) => v + (idle.get(i) - v) * fade,
                None => idle.get(i),
            };
            p.set(i, v);
        }
        self.puppet.params = p;
        self.puppet.expr.clear();
        if let Some(tr) = track {
            for (id, v) in tr.expressions(t) {
                let v = v * (1.0 - fade);
                // 笑既是参数也是表情：两路取大的（和 LivLiv 的 Player 一样）
                if id == "smile" {
                    let s = self.puppet.params.smile.max(v);
                    self.puppet.set_expression(id, s);
                } else {
                    self.puppet.set_expression(id, v);
                }
            }
        }
    }

    /// 把状态走到条目内 `t` 秒（不画）。
    pub fn seek(&mut self, t: f64) {
        let target = ((t.max(0.0) + PRE_ROLL) / TICK).round() as u64;
        if target < self.tick {
            self.restart();
        }
        while self.tick < target {
            self.tick += 1;
            self.apply_inputs(self.tick);
            self.puppet.update(TICK, false);
        }
        if self.deformed != Some(self.tick) {
            self.puppet.update(0.0, true);
            self.deformed = Some(self.tick);
        }
    }

    /// 画条目内 `t` 秒的一帧到 `w`×`h` 的预乘 RGBA8 缓冲。
    pub fn render(&mut self, t: f64, w: u32, h: u32, out: &mut [u8]) {
        self.seek(t);
        self.puppet.render(w, h, out);
    }
}
