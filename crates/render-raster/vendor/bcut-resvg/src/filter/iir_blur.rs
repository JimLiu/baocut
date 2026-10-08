// Copyright 2020 the Resvg Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT

// An IIR blur.
//
// Based on http://www.getreuer.info/home/gaussianiir
//
// Licensed under 'Simplified BSD License'.
//
//
// Implements the fast Gaussian convolution algorithm of Alvarez and Mazorra,
// where the Gaussian is approximated by a cascade of first-order infinite
// impulsive response (IIR) filters.  Boundaries are handled with half-sample
// symmetric extension.
//
// Gaussian convolution is approached as approximating the heat equation and
// each timestep is performed with an efficient recursive computation.  Using
// more steps yields a more accurate approximation of the Gaussian.  A
// reasonable default value for `numsteps` is 4.
//
// Reference:
// Alvarez, Mazorra, "Signal and Image Restoration using Shock Filters and
// Anisotropic Diffusion," SIAM J. on Numerical Analysis, vol. 31, no. 2,
// pp. 590-605, 1994.

// TODO: Blurs right and bottom sides twice for some reason.

use super::ImageRefMut;

struct BlurData {
    width: usize,
    height: usize,
    sigma_x: f64,
    sigma_y: f64,
    steps: usize,
}

/// Applies an IIR blur.
///
/// Input image pixels should have a **premultiplied alpha**.
///
/// A negative or zero `sigma_x`/`sigma_y` will disable the blur along that axis.
///
/// # Allocations
///
/// This method will allocate an `f64` buffer with four lanes per `src` pixel.
pub fn apply(sigma_x: f64, sigma_y: f64, src: ImageRefMut) {
    let d = BlurData {
        width: src.width as usize,
        height: src.height as usize,
        sigma_x,
        sigma_y,
        steps: 4,
    };

    // bcut-resvg: upstream blurs one channel at a time through a single-lane buffer.
    // The four channels never read each other, so running them side by side in one
    // interleaved buffer performs the same operations in the same order per channel
    // (bit-identical output) while giving the serial row recurrences four independent
    // chains to overlap and letting the column sweep below stay contiguous.
    let mut buf: Vec<[f64; 4]> = src
        .data
        .iter()
        .map(|p| {
            [
                p.r as f64 / 255.0,
                p.g as f64 / 255.0,
                p.b as f64 / 255.0,
                p.a as f64 / 255.0,
            ]
        })
        .collect();

    gaussianiir2d(&d, &mut buf);

    for (p, v) in src.data.iter_mut().zip(&buf) {
        p.r = (v[0] * 255.0) as u8;
        p.g = (v[1] * 255.0) as u8;
        p.b = (v[2] * 255.0) as u8;
        p.a = (v[3] * 255.0) as u8;
    }
}

#[inline(always)]
fn step(v: &mut [f64; 4], dnu: f64, from: &[f64; 4]) {
    for c in 0..4 {
        v[c] += dnu * from[c];
    }
}

fn gaussianiir2d(d: &BlurData, buf: &mut [[f64; 4]]) {
    let w = d.width;
    if w == 0 || d.height == 0 {
        return;
    }

    // Filter horizontally along each row.
    let (lambda_x, dnu_x) = if d.sigma_x > 0.0 {
        let (lambda, dnu) = gen_coefficients(d.sigma_x, d.steps);

        for row in buf.chunks_exact_mut(w) {
            for _ in 0..d.steps {
                // Filter rightwards.
                for x in 1..w {
                    let prev = row[x - 1];
                    step(&mut row[x], dnu, &prev);
                }

                // Filter leftwards.
                for x in (1..w).rev() {
                    let next = row[x];
                    step(&mut row[x - 1], dnu, &next);
                }
            }
        }

        (lambda, dnu)
    } else {
        (1.0, 1.0)
    };

    // Filter vertically along each column.
    let (lambda_y, dnu_y) = if d.sigma_y > 0.0 {
        let (lambda, dnu) = gen_coefficients(d.sigma_y, d.steps);
        // bcut-resvg: upstream walks one column at a time, striding a whole row per
        // sample, which misses the cache on every access. Columns never read each
        // other, so sweeping all of them together row by row performs exactly the
        // same operations in the same order per column: the output is bit-identical.
        for _ in 0..d.steps {
            // Filter downwards.
            for y in 1..d.height {
                let (above, rest) = buf.split_at_mut(y * w);
                let above = &above[(y - 1) * w..];
                for (v, a) in rest[..w].iter_mut().zip(above) {
                    step(v, dnu, a);
                }
            }

            // Filter upwards.
            for y in (1..d.height).rev() {
                let (above, rest) = buf.split_at_mut(y * w);
                let above = &mut above[(y - 1) * w..];
                for (a, v) in above.iter_mut().zip(&rest[..w]) {
                    step(a, dnu, v);
                }
            }
        }

        (lambda, dnu)
    } else {
        (1.0, 1.0)
    };

    let post_scale =
        ((dnu_x * dnu_y).sqrt() / (lambda_x * lambda_y).sqrt()).powi(2 * d.steps as i32);
    for v in buf.iter_mut() {
        for c in v.iter_mut() {
            *c *= post_scale;
        }
    }
}

fn gen_coefficients(sigma: f64, steps: usize) -> (f64, f64) {
    let lambda = (sigma * sigma) / (2.0 * steps as f64);
    let dnu = (1.0 + 2.0 * lambda - (1.0 + 4.0 * lambda).sqrt()) / (2.0 * lambda);
    (lambda, dnu)
}
