//! 分离输入 / 输出类型。

/// 立体声 PCM：`left` / `right` 等长，范围 [-1, 1]。
#[derive(Debug, Clone, PartialEq)]
pub struct StereoAudio {
    pub left: Vec<f32>,
    pub right: Vec<f32>,
    pub sample_rate: u32,
}

impl StereoAudio {
    pub fn from_mono(samples: Vec<f32>, sample_rate: u32) -> Self {
        Self {
            left: samples.clone(),
            right: samples,
            sample_rate,
        }
    }

    pub fn len(&self) -> usize {
        self.left.len()
    }

    pub fn is_empty(&self) -> bool {
        self.left.is_empty()
    }

    pub fn duration_seconds(&self) -> f64 {
        self.len() as f64 / f64::from(self.sample_rate)
    }

    /// 左右声道平均成单声道。
    pub fn to_mono(&self) -> Vec<f32> {
        self.left.iter().zip(&self.right).map(|(l, r)| (l + r) * 0.5).collect()
    }

    /// 逐样本相加（长度按较短者截断）。
    pub fn add(&self, other: &StereoAudio) -> StereoAudio {
        let n = self.len().min(other.len());
        StereoAudio {
            left: (0..n).map(|i| self.left[i] + other.left[i]).collect(),
            right: (0..n).map(|i| self.right[i] + other.right[i]).collect(),
            sample_rate: self.sample_rate,
        }
    }
}

/// HTDemucs 的四个 stem。
#[derive(Debug, Clone, PartialEq)]
pub struct SeparatedStems {
    pub drums: StereoAudio,
    pub bass: StereoAudio,
    pub other: StereoAudio,
    pub vocals: StereoAudio,
}

impl SeparatedStems {
    /// 背景声 = 鼓 + 贝斯 + 其他（配音时保留的部分）。
    pub fn background(&self) -> StereoAudio {
        self.drums.add(&self.bass).add(&self.other)
    }
}

/// 分离进度：按 7.8 秒窗口逐个推进。
#[derive(Debug, Clone, PartialEq)]
pub enum SeparationProgress {
    Loading {
        stage: String,
    },
    /// 已完成的窗口数 / 总窗口数（每个子模型各算一遍）。
    Window {
        done: usize,
        total: usize,
    },
}
