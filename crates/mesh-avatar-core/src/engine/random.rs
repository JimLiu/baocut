//! Caller-injected randomness; core never reads a wall clock.
/// Random sources travel with an avatar between host threads; captures must be Send.
pub trait RandomSource: Send {
    fn next_f64(&mut self) -> f64;
}
impl<F: FnMut() -> f64 + Send> RandomSource for F {
    fn next_f64(&mut self) -> f64 {
        self()
    }
}

/// The seededRandom algorithm used by the JavaScript motion scenarios.
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
