//! Caller-injected randomness; core never reads a wall clock.
/// Random sources travel with an avatar between host threads; captures must be Send.
/// They are also cloned with the avatar, so a host can snapshot and restore its state.
pub trait RandomSource: Send + CloneRandom {
    fn next_f64(&mut self) -> f64;
}
impl<F: FnMut() -> f64 + Send + Clone + 'static> RandomSource for F {
    fn next_f64(&mut self) -> f64 {
        self()
    }
}

/// Copies a boxed random source together with its position in the sequence.
pub trait CloneRandom {
    fn clone_box(&self) -> Box<dyn RandomSource>;
}
impl<T: RandomSource + Clone + 'static> CloneRandom for T {
    fn clone_box(&self) -> Box<dyn RandomSource> {
        Box::new(self.clone())
    }
}
impl Clone for Box<dyn RandomSource> {
    fn clone(&self) -> Self {
        (**self).clone_box()
    }
}

/// The seededRandom algorithm used by the JavaScript motion scenarios.
#[derive(Clone)]
pub struct SeededRandom {
    state: u32,
}
impl SeededRandom {
    pub fn new(seed: u32) -> Self {
        Self { state: seed }
    }
}
impl RandomSource for SeededRandom {
    fn next_f64(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6d2b79f5);
        let state = self.state;
        let mut t = (state ^ (state >> 15)).wrapping_mul(1 | state);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t));
        f64::from(t ^ (t >> 14)) / 4294967296.0
    }
}
