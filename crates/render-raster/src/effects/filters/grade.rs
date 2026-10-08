//! `filter.grade@1`：lift / gamma / gain + 饱和度 + 色温 + 高光肩部。
//!
//! 反预乘到 f64 运算，`pow` / `exp` 走 `libm`（native 与 wasm 同一份实现）。
//! 全不透明像素的色调曲线查 256 项表——表项与逐像素算法是同一个函数、同一个
//! 输入值（`p / 255`），查表与直算逐位相同。

#[derive(Clone, Copy, Debug)]
pub struct Grade {
    pub lift: f64,
    pub gamma: f64,
    pub gain: f64,
    pub saturation: f64,
    pub tint: f64,
    pub shoulder: f64,
}

impl Grade {
    fn is_identity(&self) -> bool {
        self.lift == 0.0
            && self.gamma == 1.0
            && self.gain == 1.0
            && self.saturation == 1.0
            && self.tint == 0.0
            && self.shoulder == 0.0
    }

    /// 逐通道的色调曲线：gamma → gain / lift → shoulder。
    fn tone(&self, c: f64) -> f64 {
        let mut v = if self.gamma == 1.0 {
            c
        } else {
            libm::pow(c.max(0.0), 1.0 / self.gamma)
        };
        v = v * self.gain + self.lift * (1.0 - v);
        if self.shoulder > 0.0 {
            let knee = 1.0 - 0.6 * self.shoulder;
            if v > knee {
                let span = 1.0 - knee;
                v = knee + span * (1.0 - libm::exp(-(v - knee) / span));
            }
        }
        v
    }

    /// 色温乘子：暖端 (1, 0.78, 0.52)、冷端 (0.62, 0.8, 1)，按 Rec.709 亮度归一，
    /// 只偏色不改明暗。
    fn tint_mul(&self) -> [f64; 3] {
        let t = self.tint.clamp(-1.0, 1.0);
        let target = if t >= 0.0 {
            [1.0, 0.78, 0.52]
        } else {
            [0.62, 0.8, 1.0]
        };
        let a = t.abs();
        let m = [
            1.0 + (target[0] - 1.0) * a,
            1.0 + (target[1] - 1.0) * a,
            1.0 + (target[2] - 1.0) * a,
        ];
        let luma = 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
        [m[0] / luma, m[1] / luma, m[2] / luma]
    }
}

pub fn grade(data: &mut [u8], params: Grade) {
    if params.is_identity() {
        return;
    }
    let lut: Vec<f64> = (0..256u32)
        .map(|i| params.tone(f64::from(i) / 255.0))
        .collect();
    let tint = params.tint_mul();
    let saturation = params.saturation;
    for px in data.chunks_exact_mut(4) {
        let alpha = px[3];
        if alpha == 0 {
            continue;
        }
        let a = f64::from(alpha);
        let mut rgb = [0.0f64; 3];
        for (slot, channel) in rgb.iter_mut().zip(px.iter()) {
            *slot = if alpha == 255 {
                lut[usize::from(*channel)]
            } else {
                params.tone(f64::from(*channel) / a)
            };
        }
        if saturation != 1.0 {
            let luma = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
            for c in &mut rgb {
                *c = luma + (*c - luma) * saturation;
            }
        }
        for (c, m) in rgb.iter_mut().zip(tint) {
            *c *= m;
        }
        for (channel, value) in px.iter_mut().zip(rgb) {
            *channel = (value.clamp(0.0, 1.0) * a).round() as u8;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const IDENTITY: Grade = Grade {
        lift: 0.0,
        gamma: 1.0,
        gain: 1.0,
        saturation: 1.0,
        tint: 0.0,
        shoulder: 0.0,
    };

    #[test]
    fn identity_is_bytewise_noop() {
        let mut data: Vec<u8> = (0..=255u8).flat_map(|v| [v / 2, v / 3, v / 4, v]).collect();
        let before = data.clone();
        grade(&mut data, IDENTITY);
        assert_eq!(data, before);
    }

    #[test]
    fn warm_tint_pushes_red_up_and_blue_down_on_gray() {
        let mut data = [128u8, 128, 128, 255];
        grade(
            &mut data,
            Grade {
                tint: 1.0,
                ..IDENTITY
            },
        );
        assert!(data[0] > 128 && data[2] < 128, "{data:?}");
        let mut cold = [128u8, 128, 128, 255];
        grade(
            &mut cold,
            Grade {
                tint: -1.0,
                ..IDENTITY
            },
        );
        assert!(cold[0] < 128 && cold[2] > 128, "{cold:?}");
    }

    #[test]
    fn shoulder_rolls_off_boosted_highlights_instead_of_clipping() {
        let boosted = |shoulder: f64| {
            let mut data = [200u8, 230, 250, 255];
            grade(
                &mut data,
                Grade {
                    gain: 1.6,
                    shoulder,
                    ..IDENTITY
                },
            );
            data
        };
        let hard = boosted(0.0);
        let soft = boosted(1.0);
        assert_eq!(hard[..3], [255, 255, 255]);
        assert!(
            soft[0] < soft[1] && soft[1] < soft[2] && soft[2] < 255,
            "{soft:?}"
        );
    }

    #[test]
    fn lut_and_direct_paths_agree_for_opaque_pixels() {
        let params = Grade {
            lift: 0.05,
            gamma: 1.3,
            gain: 1.2,
            saturation: 0.8,
            tint: 0.4,
            shoulder: 0.5,
        };
        for v in 0..=255u8 {
            let mut data = [v, v / 2, 255 - v, 255];
            grade(&mut data, params);
            let expect: Vec<u8> = [v, v / 2, 255 - v]
                .iter()
                .map(|c| params.tone(f64::from(*c) / 255.0))
                .collect::<Vec<_>>()
                .chunks(3)
                .flat_map(|rgb| {
                    let luma = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
                    let tint = params.tint_mul();
                    (0..3)
                        .map(|i| {
                            ((luma + (rgb[i] - luma) * params.saturation) * tint[i]).clamp(0.0, 1.0)
                                * 255.0
                        })
                        .map(|x| x.round() as u8)
                        .collect::<Vec<_>>()
                })
                .collect();
            assert_eq!(&data[..3], &expect[..]);
        }
    }
}
