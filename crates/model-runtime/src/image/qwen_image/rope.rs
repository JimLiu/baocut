//! DiT 的三轴 RoPE（frame / height / width），复刻 `QwenImage21Rope` 的文生图情形：
//! 文本 token 三轴同位置递增；目标图块的 frame 轴冻结在文本之后，
//! height / width 以 0 为中心铺网格（负下标就是真实的负位置，不是回绕）。
//!
//! 旋转方式是相邻两维一组的复数乘法（diffusers `use_real=False`），不是 rotate-half。

/// 每个轴的维度（实数维），配置里是 `[16, 56, 56]`，合计 = head_dim 128。
pub const AXES_DIM: [usize; 3] = [16, 56, 56];
const THETA: f64 = 10000.0;

/// 返回 `(cos, sin)`，形状都是 `[seq_len, head_dim/2]`，按行主序平铺。
/// 序列布局：`text_len` 个文本 token，接着 `h * w` 个行主序图像 token。
pub fn dit_rope_tables(text_len: usize, h: usize, w: usize) -> (Vec<f32>, Vec<f32>) {
    let half: usize = AXES_DIM.iter().sum::<usize>() / 2;
    let n = text_len + h * w;
    let mut cos = Vec::with_capacity(n * half);
    let mut sin = Vec::with_capacity(n * half);
    let inv: Vec<Vec<f64>> = AXES_DIM
        .iter()
        .map(|&d| (0..d / 2).map(|i| 1.0 / THETA.powf((2 * i) as f64 / d as f64)).collect())
        .collect();
    let mut push = |pos: [i64; 3]| {
        for (axis, freqs) in inv.iter().enumerate() {
            for f in freqs {
                let a = pos[axis] as f64 * f;
                cos.push(a.cos() as f32);
                sin.push(a.sin() as f32);
            }
        }
    };
    for p in 0..text_len as i64 {
        push([p, p, p]);
    }
    let frame = text_len as i64;
    let h0 = -((h - h / 2) as i64);
    let w0 = -((w - w / 2) as i64);
    for y in 0..h as i64 {
        for x in 0..w as i64 {
            push([frame, h0 + y, w0 + x]);
        }
    }
    (cos, sin)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grid_is_centered() {
        let (c, s) = dit_rope_tables(3, 4, 2);
        assert_eq!(c.len(), (3 + 8) * 64);
        // 文本第 0 个 token 位置 0：cos=1、sin=0
        assert!(c[..64].iter().all(|v| (*v - 1.0).abs() < 1e-6));
        assert!(s[..64].iter().all(|v| v.abs() < 1e-6));
        // 第一个图像 token：height = -2、width = -1；height 轴首个频率为 1 => sin(-2)
        let row = 3 * 64;
        assert!((s[row + 8] - (-2.0f32).sin()).abs() < 1e-6);
        assert!((s[row + 8 + 28] - (-1.0f32).sin()).abs() < 1e-6);
        // frame 轴冻结在 text_len
        assert!((s[row] - 3.0f32.sin()).abs() < 1e-6);
    }
}
