use super::*;
use ops::indexing::{IndexMutOp, IndexOp};

fn near(x: &Array, want: &[f32]) {
    let got = x.as_dtype(Dtype::Float32).unwrap().as_slice::<f32>();
    assert_eq!(got.len(), want.len());
    for (a, b) in got.iter().zip(want) {
        assert!((a - b).abs() < 1e-4, "{got:?} != {want:?}");
    }
}

#[test]
fn checkpoint_boolean_masks_load_as_device_byte_tensors() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("mask.safetensors");
    let mut header = r#"{"mask":{"dtype":"BOOL","shape":[3],"data_offsets":[0,3]}}"#.as_bytes().to_vec();
    while !header.len().is_multiple_of(8) {
        header.push(b' ');
    }
    let mut bytes = (header.len() as u64).to_le_bytes().to_vec();
    bytes.extend(header);
    bytes.extend([1, 0, 1]);
    std::fs::write(&path, bytes).unwrap();
    let weights = Array::load_safetensors(&path).unwrap();
    assert_eq!(weights["mask"].dtype(), Dtype::Bool);
    near(&weights["mask"], &[1., 0., 1.]);
}

#[test]
fn channel_last_grouped_convolution_matches_scalar_reference() {
    let x = Array::from_slice(&[1., 10., 2., 20., 3., 30.], &[1, 3, 2]);
    let w = Array::from_slice(&[1., 2., 3., 4.], &[2, 2, 1]);
    near(&ops::conv1d(&x, &w, 1, 0, 1, 2).unwrap(), &[5., 110., 8., 180.]);
}

#[test]
fn asymmetric_conv2d_stride_preserves_channel_last_layout() {
    let x = Array::from_slice(&(1..=12).map(|i| i as f32).collect::<Vec<_>>(), &[1, 3, 4, 1]);
    let w = Array::from_slice(&[1., 2., 3., 4.], &[1, 2, 2, 1]);
    let y = ops::conv2d(&x, &w, (2, 1), (1, 0), None, None).unwrap();
    assert_eq!(y.shape(), [1, 2, 3, 1]);
    near(&y, &[11., 18., 25., 84., 94., 104.]);
}

#[test]
fn transposed_convolution_overlap_add_and_channels_match_reference() {
    let x = Array::from_slice(&[1., 2., 3.], &[1, 3, 1]);
    let w = Array::from_slice(&[1., 2., 3.], &[1, 3, 1]);
    near(
        &ops::conv_transpose1d(&x, &w, 2, 0, 1, 0, 1).unwrap(),
        &[1., 2., 5., 4., 9., 6., 9.],
    );
}

#[test]
fn codec_edge_and_constant_padding_keep_samples_in_order() {
    let x = Array::from_slice(&[1., 2., 3.], &[1, 3, 1]);
    near(
        &ops::pad(&x, &[(0, 0), (2, 1), (0, 0)], None, ops::PadMode::Edge).unwrap(),
        &[1., 1., 1., 2., 3., 3.],
    );
    near(&ops::pad(&x, &[(0, 0), (0, 2), (0, 0)], None, None).unwrap(), &[1., 2., 3., 0., 0.]);
}

#[test]
fn embedding_indices_preserve_batch_sequence_and_empty_slices() {
    let x = Array::from_slice(&[1., 2., 3., 4., 5., 6.], &[3, 2]);
    let ids = Array::from_slice(&[2, 0], &[1, 2]);
    let y = x.index(&ids);
    assert_eq!(y.shape(), [1, 2, 2]);
    near(&y, &[5., 6., 1., 2.]);
    assert_eq!(y.index((.., 0..0, ..)).shape(), [1, 0, 2]);
    let transposed = x.t();
    let ids = Array::from_slice(&[1, 0], &[2]);
    near(&transposed.index(&ids), &[2., 4., 6., 1., 3., 5.]);
    near(&transposed.take_axis(&ids, 1).unwrap(), &[3., 1., 4., 2.]);
}

#[test]
fn kv_update_keeps_prefix_and_does_not_modify_previous_view() {
    let mut cache = ops::zeros::<f32>(&[1, 1, 4, 2]).unwrap();
    let old = cache.clone();
    let values = Array::from_slice(&[1., 2., 3., 4.], &[1, 1, 2, 2]);
    cache.index_mut((.., .., 1..3, ..), &values);
    near(&cache, &[0., 0., 1., 2., 3., 4., 0., 0.]);
    near(&old, &[0.; 8]);
}

#[test]
fn attention_matmul_accepts_transposed_multihead_views() {
    let x = Array::from_slice(&(1..=8).map(|i| i as f32).collect::<Vec<_>>(), &[1, 2, 2, 2]);
    let q = x.transpose_axes(&[0, 2, 1, 3]).unwrap();
    let k = q.swap_axes(-1, -2).unwrap();
    near(&ops::matmul(&q, &k).unwrap(), &[5., 17., 17., 61., 25., 53., 53., 113.]);
}

#[test]
fn gqa_causal_prefill_cannot_see_future_values() {
    let q = ops::zeros::<f32>(&[1, 4, 3, 2]).unwrap();
    let k = ops::zeros::<f32>(&[1, 2, 3, 2]).unwrap();
    let v = Array::from_slice(&[1., 2., 3., 4., 5., 6., 10., 20., 30., 40., 50., 60.], &[1, 2, 3, 2]);
    let y = fast::scaled_dot_product_attention(&q, &k, &v, 1., Some(fast::ScaledDotProductAttentionMask::Causal), None).unwrap();
    near(
        &y,
        &[
            1., 2., 2., 3., 3., 4., 1., 2., 2., 3., 3., 4., 10., 20., 20., 30., 30., 40., 10., 20., 20., 30., 30., 40.,
        ],
    );
}

#[test]
fn rope_incremental_offset_equals_full_sequence() {
    let x = Array::from_slice(&(0..24).map(|i| i as f32 / 10.).collect::<Vec<_>>(), &[1, 2, 3, 4]);
    for traditional in [false, true] {
        let full = fast::rope(&x, 4, traditional, 10000., 1., 0, None).unwrap();
        let last = fast::rope(x.index((.., .., 2..3, ..)), 4, traditional, 10000., 1., 2, None).unwrap();
        near(&last, &full.index((.., .., 2..3, ..)).as_slice::<f32>());
    }
}

// GELU 走的是合成图里的实现：只有门面落到 candle 时它才吃这里的 `Array`。
#[cfg(not(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")))]
#[test]
fn normalization_uses_population_variance_and_gelu_accepts_negative_values() {
    let x = Array::from_slice(&[-2., 0., 2.], &[1, 3]);
    near(&x.var_axis(-1, true, 0).unwrap(), &[8. / 3.]);
    let y = crate::synthesize::index_tts2::mlx::layers::act::gelu_tanh(&x).unwrap();
    near(&y, &[-0.0454023, 0., 1.9545977]);
}

#[test]
fn affine_quantized_weights_are_unpacked_once_with_signed_bias() {
    let w = Array::from_slice(&[0x03020100u32], &[1, 1]);
    let s = Array::from_slice(&[0.5], &[1, 1]);
    let b = Array::from_slice(&[-1.], &[1, 1]);
    near(&dequantize(&w, &s, &b, 4, 8).unwrap(), &[-1., -0.5, 0., 0.5]);
}

#[test]
fn seeded_flow_noise_is_finite_reproducible_and_nonconstant() {
    let key = random::key(42).unwrap();
    let a = random::normal::<f32>(&[100], None, None, &key).unwrap();
    let b = random::normal::<f32>(&[100], None, None, &key).unwrap();
    near(&a, &b.as_slice::<f32>());
    let v = a.as_slice::<f32>();
    assert!(v.iter().all(|v| v.is_finite()));
    assert!(v.iter().any(|v| *v < 0.) && v.iter().any(|v| *v > 0.));
}

#[test]
fn round_matches_mlx_for_integers_and_decimals() {
    let x = Array::from_slice(&[-1.6, -0.4, 0.4, 1.6, 2.5, 3.5, -2.5, 2.25], &[8]);
    near(&ops::round(&x, None).unwrap(), &[-2., 0., 0., 2., 2., 4., -2., 2.]);
    near(&ops::round(&x, 1).unwrap(), &[-1.6, -0.4, 0.4, 1.6, 2.5, 3.5, -2.5, 2.2]);
}

#[test]
fn max_axis_matches_mlx_keep_dims_semantics() {
    let x = Array::from_slice(&[1., 5., -2., 3., 0., 4.], &[2, 3]);
    let row = x.max_axis(-1, false).unwrap();
    assert_eq!(row.shape(), vec![2]);
    near(&row, &[5., 4.]);
    let col = x.max_axis(0, true).unwrap();
    assert_eq!(col.shape(), vec![1, 3]);
    near(&col, &[3., 5., 4.]);
    assert_eq!(x.max_axis(1, None).unwrap().shape(), vec![2]);
}

#[test]
fn dequantize_restores_gathered_rows_with_leading_dims() {
    // 8 bit、group 4：每个 u32 打包 4 个值（低位在前），每行 8 列 = 2 个 u32、2 组。
    let pack = |v: [u32; 4]| v[0] | (v[1] << 8) | (v[2] << 16) | (v[3] << 24);
    let w = Array::from_slice(
        &[pack([0, 1, 2, 3]), pack([4, 5, 6, 7]), pack([10, 20, 30, 40]), pack([1, 1, 1, 1])],
        &[1, 2, 2],
    );
    let scales = Array::from_slice(&[1., 0.5, 2., 1.], &[1, 2, 2]);
    let biases = Array::from_slice(&[0., -1., 1., 0.], &[1, 2, 2]);
    let out = ops::dequantize(&w, &scales, &biases, 4, 8).unwrap();
    assert_eq!(out.shape(), vec![1, 2, 8]);
    near(
        &out,
        &[
            0., 1., 2., 3., 1., 1.5, 2., 2.5, //
            21., 41., 61., 81., 1., 1., 1., 1.,
        ],
    );
    assert!(ops::dequantize(&w, &scales, None, 4, 8).is_err());
}
