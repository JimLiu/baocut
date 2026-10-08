//! 引擎侧的停止屏障（架构设计 §7.4）。
//!
//! 任务与流水线的写入带着 `run: { runId, runGeneration }` 提交；Runtime 停止一个执行时先发 `runs.invalidate`，
//! 之后同一执行、代数不高于失效代数的提交在视频的串行提交入口被拒（`TASK_STOPPED`），不开事务、不产生回执。
//! 普通的用户与 Agent 编辑不带 `run`，不受影响。
//!
//! 记录只在内存里、按视频分开：视频关闭时清掉；每个视频最多记 `MAX_RUNS_PER_VIDEO` 个执行，满了先进先出淘汰最早的。
//! 引擎重启或记录被淘汰之后，退回 Node 侧的屏障（ApplicationRunner 每次提交前查停止标记）。

use std::collections::{HashMap, VecDeque};

use serde::Deserialize;
use message_ref::msg;
use video_engine::model::Id;
use video_engine::{ErrorBody, Retryability};

/// 每个视频最多记住的失效执行数。
pub const MAX_RUNS_PER_VIDEO: usize = 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunRef {
    pub run_id: Id,
    /// 十进制整数字符串；重试换代时递增。
    pub run_generation: String,
}

impl RunRef {
    pub fn generation(&self) -> Result<u64, ErrorBody> {
        self.run_generation
            .parse()
            .map_err(|_| ErrorBody::new(
                "INVALID_PARAMS",
                msg!("engineHost.runGenerationNotInteger", "runGeneration must be a decimal integer"),
                Retryability::Never,
            ))
    }
}

#[derive(Default)]
struct VideoRuns {
    /// runId → 已失效的最高代数。
    invalid: HashMap<Id, u64>,
    /// 记录的先后，满了从前面淘汰。
    order: VecDeque<Id>,
}

#[derive(Default)]
pub struct RunBarrier {
    videos: HashMap<Id, VideoRuns>,
}

impl RunBarrier {
    /// 让这个执行的这一代及更早的代失效。
    pub fn invalidate(&mut self, video_id: &str, run: &RunRef) -> Result<(), ErrorBody> {
        let generation = run.generation()?;
        let runs = self.videos.entry(video_id.to_string()).or_default();
        match runs.invalid.get_mut(&run.run_id) {
            Some(existing) => *existing = (*existing).max(generation),
            None => {
                if runs.order.len() >= MAX_RUNS_PER_VIDEO
                    && let Some(oldest) = runs.order.pop_front()
                {
                    runs.invalid.remove(&oldest);
                }
                runs.invalid.insert(run.run_id.clone(), generation);
                runs.order.push_back(run.run_id.clone());
            }
        }
        Ok(())
    }

    /// 这次提交所属的执行是否已被停止；返回失效到的代数。
    pub fn stopped(&self, video_id: &str, run: &RunRef) -> Result<Option<u64>, ErrorBody> {
        let generation = run.generation()?;
        Ok(self
            .videos
            .get(video_id)
            .and_then(|runs| runs.invalid.get(&run.run_id))
            .copied()
            .filter(|stopped| generation <= *stopped))
    }

    /// 视频关闭：它的记录一起清掉。
    pub fn forget(&mut self, video_id: &str) {
        self.videos.remove(video_id);
    }

    #[cfg(test)]
    pub fn len(&self, video_id: &str) -> usize {
        self.videos.get(video_id).map_or(0, |runs| runs.invalid.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(id: &str, generation: u64) -> RunRef {
        RunRef {
            run_id: id.into(),
            run_generation: generation.to_string(),
        }
    }

    #[test]
    fn later_generations_pass_and_earlier_ones_stay_stopped() {
        let mut barrier = RunBarrier::default();
        barrier.invalidate("v", &run("job_a", 2)).unwrap();
        assert_eq!(barrier.stopped("v", &run("job_a", 1)).unwrap(), Some(2));
        assert_eq!(barrier.stopped("v", &run("job_a", 2)).unwrap(), Some(2));
        assert_eq!(barrier.stopped("v", &run("job_a", 3)).unwrap(), None);
        assert_eq!(barrier.stopped("v", &run("job_b", 1)).unwrap(), None);
        assert_eq!(barrier.stopped("other", &run("job_a", 1)).unwrap(), None);
        // 失效到更早的代不会放宽已有的记录。
        barrier.invalidate("v", &run("job_a", 1)).unwrap();
        assert_eq!(barrier.stopped("v", &run("job_a", 2)).unwrap(), Some(2));
        assert!(barrier.stopped("v", &run("job_a", 0)).is_ok());
        assert_eq!(
            barrier
                .stopped(
                    "v",
                    &RunRef {
                        run_id: "job_a".into(),
                        run_generation: "x".into()
                    }
                )
                .unwrap_err()
                .code,
            "INVALID_PARAMS"
        );
    }

    #[test]
    fn records_are_bounded_per_video_and_cleared_on_forget() {
        let mut barrier = RunBarrier::default();
        for i in 0..MAX_RUNS_PER_VIDEO + 5 {
            barrier.invalidate("v", &run(&format!("job_{i}"), 1)).unwrap();
        }
        assert_eq!(barrier.len("v"), MAX_RUNS_PER_VIDEO);
        // 最早的被淘汰，最近的还在。
        assert_eq!(barrier.stopped("v", &run("job_0", 1)).unwrap(), None);
        let last = format!("job_{}", MAX_RUNS_PER_VIDEO + 4);
        assert_eq!(barrier.stopped("v", &run(&last, 1)).unwrap(), Some(1));
        barrier.forget("v");
        assert_eq!(barrier.len("v"), 0);
    }
}
