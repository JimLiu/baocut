//! `transition.crossfade@1`：两张画面按 progress 线性混合。

use super::{coverage_to_alpha, lerp_premul_u8};

pub fn crossfade(from: &[u8], to: &[u8], out: &mut [u8], progress: f64) {
    let a = coverage_to_alpha(progress);
    // 端点走整幅拷贝：`lerp_premul_u8` 在 a = 0/255 上本来就恒等，这条捷径
    // 只是把「逐字节等于输入」写成显然的形态（也顺手省掉一遍逐通道算术）。
    if a == 0 {
        out.copy_from_slice(from);
        return;
    }
    if a == 255 {
        out.copy_from_slice(to);
        return;
    }
    for index in 0..out.len() {
        out[index] = lerp_premul_u8(from[index], to[index], a);
    }
}
