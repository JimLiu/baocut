//! Kana-to-mora timing without audio or external text processing.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Vowel {
    A,
    I,
    U,
    E,
    O,
    N,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct MouthTarget {
    pub open: f64,
    pub form: Option<f64>,
    pub vowel: Vowel,
}
impl Vowel {
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "a" => Some(Self::A),
            "i" => Some(Self::I),
            "u" => Some(Self::U),
            "e" => Some(Self::E),
            "o" => Some(Self::O),
            "n" => Some(Self::N),
            _ => None,
        }
    }
    pub fn target(self) -> MouthTarget {
        let (open, form) = match self {
            Self::A => (0.9, Some(0.0)),
            Self::I => (0.5, Some(-0.85)),
            Self::U => (0.4, Some(0.9)),
            Self::E => (0.62, Some(-0.4)),
            Self::O => (0.75, Some(0.6)),
            Self::N => (0.0, None),
        };
        MouthTarget {
            open,
            form,
            vowel: self,
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Onset {
    Lips,
    Consonant,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mora {
    pub vowel: Vowel,
    pub dur: f64,
    pub onset: Option<Onset>,
}
fn hiragana(c: char) -> char {
    if ('ァ'..='ヶ').contains(&c) {
        char::from_u32(c as u32 - 0x60).unwrap()
    } else {
        c
    }
}
fn vowel_of(c: char) -> Option<Vowel> {
    [
        (Vowel::A, "あかさたなはまやらわがざだばぱぁ"),
        (Vowel::I, "いきしちにひみりぎじぢびぴぃ"),
        (Vowel::U, "うくすつぬふむゆるぐずづぶぷぅゔ"),
        (Vowel::E, "えけせてねへめれげぜでべぺぇ"),
        (Vowel::O, "おこそとのほもよろをごぞどぼぽぉ"),
    ]
    .into_iter()
    .find(|(_, row)| row.contains(c))
    .map(|(v, _)| v)
}
fn small_y(c: char) -> Option<Vowel> {
    match c {
        'ゃ' => Some(Vowel::A),
        'ゅ' => Some(Vowel::U),
        'ょ' => Some(Vowel::O),
        _ => None,
    }
}
fn pause(c: char) -> bool {
    "、。，．,.！？!? 　…".contains(c)
}
pub fn skipped_kana_characters(text: &str) -> Vec<char> {
    let mut out = vec![];
    for c in text.chars().map(hiragana) {
        if vowel_of(c).is_none()
            && small_y(c).is_none()
            && !matches!(c, 'ー' | 'っ' | 'ん')
            && !pause(c)
            && !out.contains(&c)
        {
            out.push(c);
        }
    }
    out
}
pub fn kana_to_moras(text: &str, mora: f64) -> Vec<Mora> {
    let mut out: Vec<Mora> = vec![];
    for c in text.chars().map(hiragana) {
        if let Some(last) = out.last_mut() {
            if let Some(v) = small_y(c) {
                last.vowel = v;
                continue;
            }
            if c == 'ー' {
                last.dur += mora;
                continue;
            }
        }
        if matches!(c, 'っ' | 'ん') || pause(c) {
            out.push(Mora {
                vowel: Vowel::N,
                dur: mora
                    * if c == 'っ' {
                        0.8
                    } else if c == 'ん' {
                        1.0
                    } else {
                        2.2
                    },
                onset: None,
            });
            continue;
        }
        if let Some(vowel) = vowel_of(c) {
            let onset = if "まみむめもばびぶべぼぱぴぷぺぽ".contains(c) {
                Some(Onset::Lips)
            } else if "あいうえおぁぃぅぇぉ".contains(c) {
                None
            } else {
                Some(Onset::Consonant)
            };
            out.push(Mora {
                vowel,
                dur: mora,
                onset,
            });
        }
    }
    out
}
pub fn sample_moras(moras: &[Mora], t: f64, granularity: f64) -> Option<MouthTarget> {
    let grouped = granularity != 0.5;
    let group_seconds = if granularity < 0.5 {
        (0.5 - granularity) * 0.72
    } else {
        0.0
    };
    let mut start = 0.0;
    let mut group_duration = 0.0;
    let mut group_vowel = None;
    for m in moras {
        let mut vowel = m.vowel;
        if grouped {
            if m.vowel == Vowel::N {
                if let Some(group) = group_vowel.filter(|_| group_seconds != 0.0 && m.dur <= 0.2) {
                    vowel = group;
                } else {
                    group_duration = 0.0;
                    group_vowel = None;
                }
            } else {
                if group_vowel.is_none() || group_duration >= group_seconds {
                    group_vowel = Some(m.vowel);
                    group_duration = 0.0;
                }
                group_duration += m.dur;
                if group_seconds != 0.0 {
                    vowel = group_vowel.unwrap();
                }
            }
        }
        if t < start + m.dur {
            let mut target = vowel.target();
            let original = match m.onset {
                Some(Onset::Lips) => 0.05,
                Some(Onset::Consonant) => 0.45,
                None => 1.0,
            };
            let k = if grouped {
                let onset = if granularity < 0.5 {
                    1.0 - (1.0 - original) * granularity * 2.0
                } else {
                    original * (2.0 - granularity * 2.0)
                };
                let attack = (m.dur * 0.35).min(0.05);
                let x = (t - start) / attack;
                if x < 1.0 {
                    onset + (1.0 - onset) * x
                } else {
                    1.0
                }
            } else {
                let x = (t - start) / m.dur;
                if x < 0.35 {
                    original + (1.0 - original) * (x / 0.35)
                } else {
                    1.0
                }
            };
            target.open *= k;
            return Some(target);
        }
        start += m.dur;
    }
    None
}
