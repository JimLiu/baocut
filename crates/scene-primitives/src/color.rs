//! 颜色解析与插值（#hex / rgb() / rgba()），与 Swift 原型 RGBA 逐式一致。

use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rgba {
    /// 0..=255
    pub r: f64,
    pub g: f64,
    pub b: f64,
    /// 0..=1
    pub a: f64,
}

impl Rgba {
    pub const WHITE: Rgba = Rgba {
        r: 255.0,
        g: 255.0,
        b: 255.0,
        a: 1.0,
    };

    pub fn parse_value(v: Option<&Value>) -> Option<Rgba> {
        Rgba::parse(v?.as_str()?)
    }

    pub fn parse(raw: &str) -> Option<Rgba> {
        let s = raw.trim();
        if let Some(hex) = s.strip_prefix('#') {
            if hex.len() == 6 {
                let n = u32::from_str_radix(hex, 16).ok()?;
                return Some(Rgba {
                    r: ((n >> 16) & 255) as f64,
                    g: ((n >> 8) & 255) as f64,
                    b: (n & 255) as f64,
                    a: 1.0,
                });
            }
            if hex.len() == 3 {
                let mut c = [0.0; 3];
                for (i, ch) in hex.chars().enumerate() {
                    let d = u32::from_str_radix(&format!("{ch}{ch}"), 16).ok()?;
                    c[i] = d as f64;
                }
                return Some(Rgba {
                    r: c[0],
                    g: c[1],
                    b: c[2],
                    a: 1.0,
                });
            }
            return None;
        }
        if s.len() >= 3 && s[..3].eq_ignore_ascii_case("rgb") {
            let l = s.find('(')?;
            let r = s.rfind(')')?;
            let parts: Vec<f64> = s[l + 1..r]
                .split(',')
                .filter_map(|p| p.trim().parse::<f64>().ok())
                .collect();
            if parts.len() < 3 {
                return None;
            }
            return Some(Rgba {
                r: parts[0],
                g: parts[1],
                b: parts[2],
                a: if parts.len() > 3 { parts[3] } else { 1.0 },
            });
        }
        None
    }

    pub fn mixed(&self, to: &Rgba, u: f64) -> Rgba {
        Rgba {
            r: self.r + (to.r - self.r) * u,
            g: self.g + (to.g - self.g) * u,
            b: self.b + (to.b - self.b) * u,
            a: self.a + (to.a - self.a) * u,
        }
    }

    pub fn with_alpha(&self, mul: f64) -> Rgba {
        Rgba {
            a: self.a * mul,
            ..*self
        }
    }

    pub fn css(&self) -> String {
        format!(
            "rgba({},{},{},{})",
            self.r.round() as i64,
            self.g.round() as i64,
            self.b.round() as i64,
            self.a
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_hex_and_rgba() {
        let c = Rgba::parse("#e8906a").unwrap();
        assert_eq!((c.r, c.g, c.b, c.a), (232.0, 144.0, 106.0, 1.0));
        let c = Rgba::parse("rgba(0,0,0,0.55)").unwrap();
        assert_eq!((c.r, c.a), (0.0, 0.55));
        let c = Rgba::parse("#fff").unwrap();
        assert_eq!((c.r, c.g, c.b), (255.0, 255.0, 255.0));
        assert!(Rgba::parse("none").is_none());
    }

    #[test]
    fn css_roundtrip() {
        let c = Rgba::parse("#e8906a").unwrap();
        let mixed = c.mixed(&Rgba::parse("#f6f4ef").unwrap(), 0.5);
        assert!(Rgba::parse(&mixed.css()).is_some());
    }
}
