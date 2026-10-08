//! Pixel-format bridges shared by native preview hosts.
//!
//! tiny-skia produces premultiplied RGBA8. GPUI's native image path consumes straight-alpha
//! BGRA8, so both channel order and alpha representation must change before upload.

/// Convert a full premultiplied RGBA8 buffer to straight-alpha BGRA8.
///
/// The demultiplication mirrors tiny-skia's rounding (`c / (a / 255) + 0.5`) so a render
/// converted for native preview stays pixel-identical to the encoded kernel PNG.
pub fn premultiplied_rgba_to_straight_bgra(rgba: &[u8]) -> Vec<u8> {
    let mut output = vec![0u8; rgba.len()];
    convert_premultiplied_rgba_to_straight_bgra(rgba, &mut output);
    output
}

/// Convert only when the buffer contains a visible pixel.
///
/// Blank frames allocate nothing. For a visible subtitle frame, the first alpha scan also
/// identifies the leading transparent span, so the conversion loop starts at the first pixel
/// that can contribute to the image instead of scanning that span a second time.
pub fn visible_premultiplied_rgba_to_straight_bgra(rgba: &[u8]) -> Option<Vec<u8>> {
    let first_visible = rgba.chunks_exact(4).position(|pixel| pixel[3] != 0)? * 4;
    let mut output = vec![0u8; rgba.len()];
    convert_premultiplied_rgba_to_straight_bgra(
        &rgba[first_visible..],
        &mut output[first_visible..],
    );
    Some(output)
}

fn convert_premultiplied_rgba_to_straight_bgra(rgba: &[u8], output: &mut [u8]) {
    for (source, target) in rgba.chunks_exact(4).zip(output.chunks_exact_mut(4)) {
        let alpha = source[3];
        match alpha {
            0 => target.copy_from_slice(&[0, 0, 0, 0]),
            255 => {
                target[0] = source[2];
                target[1] = source[1];
                target[2] = source[0];
                target[3] = 255;
            }
            _ => {
                let scale = f64::from(alpha) / 255.0;
                let demultiply = |value: u8| ((f64::from(value) / scale) + 0.5).min(255.0) as u8;
                target[0] = demultiply(source[2]);
                target[1] = demultiply(source[1]);
                target[2] = demultiply(source[0]);
                target[3] = alpha;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blank_buffers_allocate_nothing_and_visible_conversion_matches_the_full_bridge() {
        let mut rgba = vec![0u8; 20];
        assert!(visible_premultiplied_rgba_to_straight_bgra(&rgba).is_none());

        rgba[8..12].copy_from_slice(&[64, 32, 16, 128]);
        assert_eq!(
            visible_premultiplied_rgba_to_straight_bgra(&rgba).unwrap(),
            premultiplied_rgba_to_straight_bgra(&rgba)
        );
    }

    #[test]
    fn opaque_and_translucent_pixels_keep_the_native_preview_rounding() {
        assert_eq!(
            premultiplied_rgba_to_straight_bgra(&[10, 20, 30, 255]),
            [30, 20, 10, 255]
        );
        assert_eq!(
            premultiplied_rgba_to_straight_bgra(&[128, 128, 128, 128]),
            [255, 255, 255, 128]
        );
    }
}
