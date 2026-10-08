//! 检查溢出的有理数（视频格式规范 §2.3「运算」）。
//!
//! 分子分母用 `i128`，始终约分、分母为正。任何一步超限都返回 `None`，由调用方报
//! `TIME_ARITHMETIC_OVERFLOW`，不退化为浮点数。

use std::cmp::Ordering;
use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Ratio {
    num: i128,
    den: i128,
}

/// 分子与分母的上限。两个合法值交叉相乘（比较、通分）不会越过 `i128`。
const LIMIT: u128 = 1 << 63;

fn gcd(a: u128, b: u128) -> u128 {
    let (mut a, mut b) = (a, b);
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a
}

impl Ratio {
    pub const ZERO: Ratio = Ratio { num: 0, den: 1 };
    pub const ONE: Ratio = Ratio { num: 1, den: 1 };

    /// 约分并把符号放到分子上。分母为零或超限时为 `None`。
    pub fn new(num: i128, den: i128) -> Option<Ratio> {
        if den == 0 {
            return None;
        }
        let g = gcd(num.unsigned_abs(), den.unsigned_abs()) as i128;
        let g = if g == 0 { 1 } else { g };
        let (mut num, mut den) = (num / g, den / g);
        if den < 0 {
            num = num.checked_neg()?;
            den = den.checked_neg()?;
        }
        if num.unsigned_abs() > LIMIT || den.unsigned_abs() > LIMIT {
            return None;
        }
        Some(Ratio { num, den })
    }

    pub fn from_int(n: i128) -> Option<Ratio> {
        Ratio::new(n, 1)
    }

    pub fn num(self) -> i128 {
        self.num
    }

    pub fn den(self) -> i128 {
        self.den
    }

    pub fn is_integer(self) -> bool {
        self.den == 1
    }

    pub fn is_negative(self) -> bool {
        self.num < 0
    }

    pub fn checked_add(self, other: Ratio) -> Option<Ratio> {
        let g = gcd(self.den as u128, other.den as u128) as i128;
        let left = self.num.checked_mul(other.den / g)?;
        let right = other.num.checked_mul(self.den / g)?;
        Ratio::new(left.checked_add(right)?, (self.den / g).checked_mul(other.den)?)
    }

    pub fn checked_sub(self, other: Ratio) -> Option<Ratio> {
        self.checked_add(Ratio {
            num: other.num.checked_neg()?,
            den: other.den,
        })
    }

    /// 相乘之前交叉约分，尽量不让中间值越界。
    pub fn checked_mul(self, other: Ratio) -> Option<Ratio> {
        let g1 = gcd(self.num.unsigned_abs(), other.den as u128).max(1) as i128;
        let g2 = gcd(other.num.unsigned_abs(), self.den as u128).max(1) as i128;
        let num = (self.num / g1).checked_mul(other.num / g2)?;
        let den = (self.den / g2).checked_mul(other.den / g1)?;
        Ratio::new(num, den)
    }

    pub fn checked_div(self, other: Ratio) -> Option<Ratio> {
        if other.num == 0 {
            return None;
        }
        self.checked_mul(Ratio::new(other.den, other.num)?)
    }

    /// 不大于它的最大整数。
    pub fn floor(self) -> i128 {
        self.num.div_euclid(self.den)
    }

    /// 不小于它的最小整数。
    pub fn ceil(self) -> i128 {
        let f = self.floor();
        if self.num.rem_euclid(self.den) == 0 { f } else { f + 1 }
    }

    /// 小数部分，落在 [0, 1)。
    pub fn fract(self) -> Ratio {
        Ratio {
            num: self.num.rem_euclid(self.den),
            den: self.den,
        }
    }

    /// 规范的文本形式，用于缓存键与比较：约分之后的 `num/den`。
    pub fn canonical(self) -> String {
        format!("{}/{}", self.num, self.den)
    }

    /// 宿主边界上的近似值。只在 draw、媒体 API 这类要求原生数值的地方用（§2.13）。
    pub fn to_f64(self) -> f64 {
        self.num as f64 / self.den as f64
    }
}

impl Ord for Ratio {
    fn cmp(&self, other: &Self) -> Ordering {
        // 分母为正，交叉相乘比较；值都在 LIMIT 之内，乘积不超过 2^126。
        (self.num * other.den).cmp(&(other.num * self.den))
    }
}

impl PartialOrd for Ratio {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl fmt::Display for Ratio {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.den == 1 {
            write!(f, "{}", self.num)
        } else {
            write!(f, "{}/{}", self.num, self.den)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reduces_and_normalizes_sign() {
        assert_eq!(Ratio::new(1500, 1000), Ratio::new(3, 2));
        assert_eq!(Ratio::new(3, -6).unwrap(), Ratio::new(-1, 2).unwrap());
        assert_eq!(Ratio::new(0, 7).unwrap(), Ratio::ZERO);
        assert!(Ratio::new(1, 0).is_none());
    }

    #[test]
    fn floor_and_ceil_round_toward_infinities() {
        let r = Ratio::new(-3, 2).unwrap();
        assert_eq!(r.floor(), -2);
        assert_eq!(r.ceil(), -1);
        assert_eq!(Ratio::new(4, 2).unwrap().ceil(), 2);
        assert_eq!(Ratio::new(-3, 2).unwrap().fract(), Ratio::new(1, 2).unwrap());
    }

    #[test]
    fn overflow_is_reported_not_wrapped() {
        let big = Ratio::new(1 << 40, 1).unwrap();
        assert!(big.checked_mul(big).is_none());
        assert!(Ratio::new(1 << 64, 1).is_none());
    }
}
