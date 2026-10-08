//! Bounded, premultiplied-u8 kernels for cutout/footage effects.
use std::collections::VecDeque;

fn pixel(data: &[u8], w: usize, h: usize, x: isize, y: isize) -> [u8; 4] {
    if x < 0 || y < 0 || x >= w as isize || y >= h as isize {
        return [0; 4];
    }
    let i = (y as usize * w + x as usize) * 4;
    data[i..i + 4].try_into().unwrap()
}

// Fixed operation order avoids platform libm differences at pixel-rounding boundaries.
fn direction(degrees: f64) -> (f64, f64) {
    let x = degrees * std::f64::consts::PI / 180.0;
    let (mut sine, mut cosine, mut st, mut ct) = (x, 1.0, x, 1.0);
    for n in 1..=13 {
        st *= -x * x / ((2 * n) * (2 * n + 1)) as f64;
        ct *= -x * x / ((2 * n - 1) * (2 * n)) as f64;
        sine += st;
        cosine += ct;
    }
    (cosine, sine)
}

pub fn rgb_split(data: &mut [u8], w: usize, h: usize, distance: f64, degrees: f64) {
    let (cosine, sine) = direction(degrees);
    let (dx, dy) = (
        (distance * cosine).round() as isize,
        (distance * sine).round() as isize,
    );
    if dx == 0 && dy == 0 {
        return;
    }
    let original = data.to_vec();
    for y in 0..h {
        for x in 0..w {
            let a = pixel(&original, w, h, x as isize - dx, y as isize - dy);
            let b = pixel(&original, w, h, x as isize, y as isize);
            let c = pixel(&original, w, h, x as isize + dx, y as isize + dy);
            let i = (y * w + x) * 4;
            data[i..i + 4].copy_from_slice(&[a[0], b[1], c[2], a[3].max(b[3]).max(c[3])]);
        }
    }
}

pub fn directional_blur(data: &mut [u8], w: usize, h: usize, distance: f64, degrees: f64) {
    if distance <= 0.0 {
        return;
    }
    let (cosine, sine) = direction(degrees);
    let offsets: Vec<_> = (-8..=8)
        .map(|i| {
            let d = distance * i as f64 / 8.0;
            ((d * cosine).round() as isize, (d * sine).round() as isize)
        })
        .collect();
    let original = data.to_vec();
    for y in 0..h {
        for x in 0..w {
            let mut sum = [0u32; 4];
            for &(dx, dy) in &offsets {
                let p = pixel(&original, w, h, x as isize + dx, y as isize + dy);
                for c in 0..4 {
                    sum[c] += u32::from(p[c]);
                }
            }
            let i = (y * w + x) * 4;
            for c in 0..4 {
                data[i + c] = ((sum[c] + 8) / 17) as u8;
            }
        }
    }
}

fn max_line(input: &[u8], output: &mut [u8], radius: usize) {
    let mut queue = VecDeque::<usize>::new();
    let mut right = 0;
    for (x, out) in output.iter_mut().enumerate() {
        let end = x.saturating_add(radius).min(input.len() - 1);
        while right <= end {
            while queue.back().is_some_and(|i| input[*i] <= input[right]) {
                queue.pop_back();
            }
            queue.push_back(right);
            right += 1;
        }
        let start = x.saturating_sub(radius);
        while queue.front().is_some_and(|i| *i < start) {
            queue.pop_front();
        }
        *out = input[*queue.front().unwrap()];
    }
}

/// Square-radius dilation, then colored coverage composited behind the original.
/// Two monotonic-window passes keep runtime linear in the image size.
pub fn outline(data: &mut [u8], w: usize, h: usize, radius: usize, color: [f64; 4]) {
    if radius == 0 || color[3] <= 0.0 {
        return;
    }
    let radius = radius.min(w.max(h));
    let alpha: Vec<_> = data.chunks_exact(4).map(|p| p[3]).collect();
    let mut horizontal = vec![0; w * h];
    for y in 0..h {
        max_line(
            &alpha[y * w..(y + 1) * w],
            &mut horizontal[y * w..(y + 1) * w],
            radius,
        );
    }
    let mut column = vec![0; h];
    let mut expanded = vec![0; h];
    let rgb = [color[0], color[1], color[2]].map(|c| (c.clamp(0.0, 1.0) * 255.0).round() as u32);
    let ca = (color[3].clamp(0.0, 1.0) * 255.0).round() as u32;
    for x in 0..w {
        for y in 0..h {
            column[y] = horizontal[y * w + x];
        }
        max_line(&column, &mut expanded, radius);
        for (y, coverage) in expanded.iter().enumerate() {
            let i = (y * w + x) * 4;
            let original_alpha = u32::from(data[i + 3]);
            let behind = (u32::from(*coverage) * ca + 127) / 255;
            let visible = (behind * (255 - original_alpha) + 127) / 255;
            for c in 0..3 {
                data[i + c] =
                    (u32::from(data[i + c]) + (rgb[c] * visible + 127) / 255).min(255) as u8;
            }
            data[i + 3] = (original_alpha + visible).min(255) as u8;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn outline_dilates_alpha_without_darkening_the_original() {
        let mut p = vec![0; 7 * 7 * 4];
        let i = (3 * 7 + 3) * 4;
        p[i..i + 4].copy_from_slice(&[200, 0, 0, 255]);
        outline(&mut p, 7, 7, 1, [1.0, 1.0, 1.0, 1.0]);
        assert_eq!(&p[i..i + 4], &[200, 0, 0, 255]);
        assert_eq!(p.chunks_exact(4).filter(|p| p[3] > 0).count(), 9);
    }
    #[test]
    fn split_and_blur_preserve_premultiplication_and_zero_is_identity() {
        let mut p = vec![0; 9 * 5 * 4];
        let i = (2 * 9 + 4) * 4;
        p[i..i + 4].copy_from_slice(&[128, 64, 32, 128]);
        let mut zero = p.clone();
        rgb_split(&mut zero, 9, 5, 0.0, 45.0);
        directional_blur(&mut zero, 9, 5, 0.0, 45.0);
        assert_eq!(zero, p);
        rgb_split(&mut p, 9, 5, 2.0, 0.0);
        assert_eq!(p[(2 * 9 + 6) * 4], 128);
        directional_blur(&mut p, 9, 5, 3.0, 30.0);
        assert!(
            p.chunks_exact(4)
                .all(|p| p[0] <= p[3] && p[1] <= p[3] && p[2] <= p[3])
        );
    }
}
