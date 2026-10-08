//! The bcut-resvg patches (README.md), checked against the upstream 0.45.1 crate.

fn tree(svg: &str) -> usvg::Tree {
    usvg::Tree::from_str(svg, &usvg::Options::default()).expect("parse")
}

fn patched(svg: &str) -> tiny_skia::Pixmap {
    let tree = tree(svg);
    let size = tree.size().to_int_size();
    let mut pm = tiny_skia::Pixmap::new(size.width(), size.height()).unwrap();
    resvg::render(&tree, tiny_skia::Transform::identity(), &mut pm.as_mut());
    pm
}

fn upstream(svg: &str) -> tiny_skia::Pixmap {
    let tree = tree(svg);
    let size = tree.size().to_int_size();
    let mut pm = tiny_skia::Pixmap::new(size.width(), size.height()).unwrap();
    upstream::render(&tree, tiny_skia::Transform::identity(), &mut pm.as_mut());
    pm
}

fn alpha(pm: &tiny_skia::Pixmap, x: u32, y: u32) -> u8 {
    pm.pixel(x, y).unwrap().alpha()
}

/// Nothing here reaches the layer clamp or `feDisplacementMap`, so every patch is a no-op and the
/// bytes must match.
#[test]
fn ordinary_documents_match_upstream() {
    let docs = [
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90">
            <rect x="10" y="10" width="80" height="50" rx="8" fill="#e44"/>
            <circle cx="120" cy="45" r="30" fill="#48f" stroke="#123" stroke-width="3"/></svg>"##,
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90">
            <defs><linearGradient id="g"><stop offset="0" stop-color="#fa0"/><stop offset="1" stop-color="#08f"/></linearGradient></defs>
            <g transform="rotate(12 80 45) scale(1.1)" opacity="0.7"><rect x="20" y="15" width="120" height="60" fill="url(#g)"/></g></svg>"##,
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90">
            <defs><filter id="b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4"/></filter></defs>
            <g filter="url(#b)"><rect x="40" y="20" width="80" height="50" fill="#2a6"/></g></svg>"##,
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90">
            <defs><filter id="s"><feDropShadow dx="3" dy="4" stdDeviation="2" flood-color="#000" flood-opacity="0.5"/></filter>
            <clipPath id="c"><circle cx="80" cy="45" r="36"/></clipPath>
            <mask id="m"><rect width="160" height="90" fill="#fff"/><rect x="70" y="0" width="20" height="90" fill="#000"/></mask></defs>
            <g clip-path="url(#c)"><rect width="160" height="90" fill="#f5c"/></g>
            <g mask="url(#m)" filter="url(#s)"><rect x="20" y="20" width="120" height="30" fill="#35d"/></g></svg>"##,
        // Sigmas under 2 take the IIR path, whose passes are reordered.
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90">
            <defs><filter id="i"><feGaussianBlur stdDeviation="1.3 0.7"/></filter>
            <filter id="j"><feGaussianBlur stdDeviation="0 1.9"/></filter></defs>
            <g filter="url(#i)"><rect x="20" y="10" width="70" height="40" fill="#e4a"/><circle cx="110" cy="55" r="25" fill="#3cf"/></g>
            <g filter="url(#j)"><rect x="60" y="60" width="80" height="20" fill="#185"/></g></svg>"##,
        // Sigmas of 2 and up take the box path, whose vertical pass is reordered; the thin
        // strip makes the box radius exceed the region height.
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90">
            <defs><filter id="k"><feGaussianBlur stdDeviation="3 9"/></filter>
            <filter id="l" x="0" y="0" width="1" height="1"><feGaussianBlur stdDeviation="2 20"/></filter></defs>
            <g filter="url(#k)"><rect x="30" y="15" width="50" height="45" fill="#fb3"/><circle cx="115" cy="40" r="18" fill="#62e" fill-opacity="0.6"/></g>
            <g filter="url(#l)"><rect x="10" y="80" width="140" height="6" fill="#0a9"/></g></svg>"##,
    ];
    for (i, svg) in docs.iter().enumerate() {
        assert!(
            patched(svg).data() == upstream(svg).data(),
            "document {i} differs from upstream"
        );
    }
}

/// Three isolated layers whose content starts far off-canvas to the left. Upstream clamps each
/// nested layer with the canvas-space rect, so the innermost one ends before the canvas begins
/// and the visible part of the rect disappears.
#[test]
fn nested_layers_keep_visible_content() {
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <g opacity="0.9"><g opacity="0.9"><g opacity="0.9">
          <rect x="-1000" y="0" width="1100" height="100" fill="#f00"/>
        </g></g></g></svg>"##;
    let flat = r##"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <rect x="0" y="0" width="100" height="100" fill="#f00" fill-opacity="0.729"/></svg>"##;

    let up = upstream(svg);
    assert_eq!(
        alpha(&up, 50, 50),
        0,
        "upstream no longer drops it; recheck the patch"
    );

    let ours = patched(svg);
    let want = patched(flat);
    for x in [0, 50, 99] {
        let (a, b) = (alpha(&ours, x, 50), alpha(&want, x, 50));
        assert!(a.abs_diff(b) <= 1, "x={x}: alpha {a}, want {b}");
    }
}

/// A displacement filter whose region is wider than the layer clamp: upstream hands
/// `feDisplacementMap` a layer-sized source and a region-sized noise map and asserts.
#[test]
fn oversized_displacement_filter_does_not_panic() {
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <defs><filter id="d" filterUnits="userSpaceOnUse" x="-400" y="0" width="600" height="100">
          <feTurbulence baseFrequency="0.05" seed="1" result="t"/>
          <feDisplacementMap in="SourceGraphic" in2="t" scale="6" xChannelSelector="R" yChannelSelector="G"/></filter></defs>
        <g filter="url(#d)"><rect x="10" y="10" width="80" height="80" fill="#08f"/></g></svg>"##;

    let up = std::panic::catch_unwind(|| upstream(svg));
    assert!(up.is_err(), "upstream no longer panics; recheck the patch");

    let ours = patched(svg);
    assert!(
        alpha(&ours, 50, 50) > 200,
        "the displaced rect should still cover the centre"
    );
}

/// `feDisplacementMap` moves a pixel by `scale * (C - 0.5)` user units, reading the map without
/// premultiplied alpha. A flat map with R = 255 and G = 128 shifts content left by `scale / 2`.
/// Upstream squares `scale` (the content leaves the region) and reads the half-transparent map
/// premultiplied (R and G halve, so the offsets point up and nearly nowhere horizontally).
#[test]
fn displacement_map_moves_by_half_scale() {
    let doc = |opacity: &str, transform: &str| {
        format!(
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40">
            <defs><filter id="d" filterUnits="userSpaceOnUse" x="0" y="0" width="100" height="40" color-interpolation-filters="sRGB">
              <feFlood flood-color="rgb(255,128,128)" flood-opacity="{opacity}" result="m"/>
              <feDisplacementMap in="SourceGraphic" in2="m" scale="20" xChannelSelector="R" yChannelSelector="G"/></filter></defs>
            <g transform="{transform}"><g filter="url(#d)"><rect x="40" y="0" width="20" height="40" fill="#08f"/></g></g></svg>"##
        )
    };
    let covered = |pm: &tiny_skia::Pixmap| -> Vec<u32> {
        (0..100).filter(|&x| alpha(pm, x, 20) > 128).collect()
    };
    let moved: Vec<u32> = (30..50).collect();

    let opaque = doc("1", "");
    assert_eq!(covered(&patched(&opaque)), moved, "opaque map");
    assert!(
        covered(&upstream(&opaque)).is_empty(),
        "upstream no longer squares scale; recheck the patch"
    );

    let half = doc("0.5", "");
    assert_eq!(covered(&patched(&half)), moved, "half-transparent map");
    assert_ne!(
        covered(&upstream(&half)),
        moved,
        "upstream now matches; recheck the patch"
    );

    // Under scale(2) the rect covers device 40..80 and moves 10 user = 20 device pixels.
    let scaled = doc("1", "scale(2) translate(-20 0)");
    assert_eq!(
        covered(&patched(&scaled)),
        (20..60).collect::<Vec<u32>>(),
        "scaled group"
    );
}
