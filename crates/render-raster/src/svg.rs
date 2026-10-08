//! SVG 光栅化（`svg` feature）：host（`media`）与浏览器预览（`wasm-safe` + `svg`）共用的那一份。
//!
//! 只认字节、不做 I/O：内嵌位图只认 data URI，`href` 指向磁盘的一律不读。不开 `media` 时
//! resvg 不带 `text`，SVG 里的 `<text>` 不画；开了 `media` 也一样画不出字——解析选项的
//! 字体库是空的（`Options::default()`）。两侧因此逐像素同一份结果。

use anyhow::{Result, anyhow, bail};
use tiny_skia::Pixmap;

/// SVG 贴纸（静态与动画）的解析选项：内嵌位图只认 data URI，`href` 指向磁盘的
/// 一律不读——渲染期不做 I/O，相对路径也不该跟着进程的工作目录走。
pub fn svg_options() -> resvg::usvg::Options<'static> {
    let mut options = resvg::usvg::Options::default();
    options.image_href_resolver.resolve_string = Box::new(|_, _| None);
    options
}

/// 字节看起来是不是一份 SVG（跳过 BOM 与前导空白后以 `<svg` / `<?xml` 开头）。
pub fn looks_like_svg(bytes: &[u8]) -> bool {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    let start = bytes
        .iter()
        .position(|b| !b.is_ascii_whitespace())
        .unwrap_or(bytes.len());
    let head = &bytes[start..];
    head.starts_with(b"<svg") || head.starts_with(b"<?xml")
}

/// 按 SVG 的天然尺寸（`width`/`height`，向上取整）光栅化。
pub fn decode_svg_natural(bytes: &[u8]) -> Result<Pixmap> {
    let tree = resvg::usvg::Tree::from_data(bytes, &svg_options())?;
    let size = tree.size();
    let (w, h) = (size.width().ceil() as u32, size.height().ceil() as u32);
    let mut pm = Pixmap::new(w.max(1), h.max(1)).ok_or_else(|| anyhow!("空 SVG"))?;
    resvg::render(&tree, tiny_skia::Transform::identity(), &mut pm.as_mut());
    Ok(pm)
}

/// 按**目标长边**光栅化 SVG——矢量原件的 `width`/`height` 不是分辨率上限。
///
/// [`decode_svg_natural`] 走的是 resvg 的天然尺寸：一枚 `width="128"` 的贴纸原件不管
/// 显示多大都只光栅出 128 px，再放大就是糊的。这里在 render 时加一个等比 `Transform`，
/// 而不是先出天然尺寸再 resample。等比缩放：长边落到 `long_edge`，短边按原比例取整（至少 1 px）。
pub fn decode_svg_at_long_edge(bytes: &[u8], long_edge: u32) -> Result<Pixmap> {
    let tree = resvg::usvg::Tree::from_data(bytes, &svg_options())?;
    let size = tree.size();
    let (w, h) = (f64::from(size.width()), f64::from(size.height()));
    if w <= 0.0 || h <= 0.0 {
        bail!("空 SVG");
    }
    let scale = f64::from(long_edge.max(1)) / w.max(h);
    let out_w = (w * scale).round().max(1.0) as u32;
    let out_h = (h * scale).round().max(1.0) as u32;
    let mut pm = Pixmap::new(out_w, out_h).ok_or_else(|| anyhow!("空 SVG"))?;
    resvg::render(
        &tree,
        tiny_skia::Transform::from_scale(scale as f32, scale as f32),
        &mut pm.as_mut(),
    );
    Ok(pm)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SQUARE: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="20"><rect width="10" height="20" fill="#ff0000"/></svg>"##;

    #[test]
    fn long_edge_scales_both_sides() {
        let pm = decode_svg_at_long_edge(SQUARE.as_bytes(), 40).unwrap();
        assert_eq!((pm.width(), pm.height()), (20, 40));
        let px = pm.pixel(10, 20).unwrap();
        assert_eq!(
            (px.red(), px.green(), px.blue(), px.alpha()),
            (255, 0, 0, 255)
        );
    }

    #[test]
    fn natural_size_and_sniffing() {
        let pm = decode_svg_natural(SQUARE.as_bytes()).unwrap();
        assert_eq!((pm.width(), pm.height()), (10, 20));
        assert!(looks_like_svg(b"\xEF\xBB\xBF  <svg/>"));
        assert!(looks_like_svg(b"<?xml version=\"1.0\"?><svg/>"));
        assert!(!looks_like_svg(b"\x89PNG"));
    }
}
