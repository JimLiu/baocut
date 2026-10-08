//! HTDemucs-FT 对着 candle 的张量词汇（`tensor/candle.rs`）编译的一份模型图与分离器（见 [`super`]）。

#[path = "layers.rs"]
mod layers;
#[path = "model.rs"]
mod model;
#[path = "separator.rs"]
mod separator;
#[path = "tensor/candle.rs"]
mod tensor;
#[path = "transformer.rs"]
mod transformer;
#[path = "weights.rs"]
mod weights;

pub use separator::HtDemucs;
pub use tensor::use_device;
