//! Map Qwen2.5-Omni shards and load only the Thinker text tensors needed by
//! AuK. The checkpoint also contains vision, audio and talker towers; eagerly
//! loading it would exhaust a 12 GiB GPU before the Flux model can run.

use anyhow::{Context, Result, anyhow, bail};
use candle_core::safetensors::Load;
use candle_core::{DType, Device, Tensor};
use memmap2::{Mmap, MmapOptions};
use safetensors::SafeTensors;
use std::collections::HashMap;
use std::fs::File;
use std::path::{Path, PathBuf};

struct Shard {
    path: PathBuf,
    data: Mmap,
}

/// Read-only mappings of the pinned Qwen model shards. Model files are owned
/// by the model catalog and are never modified while a session is running.
pub struct ThinkerWeights {
    shards: Vec<Shard>,
}

impl ThinkerWeights {
    pub fn open(directory: &Path) -> Result<Self> {
        let mut files = std::fs::read_dir(directory)
            .with_context(|| format!("reading the AuK Qwen directory {}", directory.display()))?
            .map(|entry| entry.map(|entry| entry.path()))
            .collect::<std::io::Result<Vec<_>>>()?;
        files.retain(|path| path.extension().is_some_and(|ext| ext == "safetensors"));
        files.sort();
        if files.is_empty() {
            bail!("no safetensors in the AuK Qwen directory {}", directory.display());
        }
        let mut shards = Vec::with_capacity(files.len());
        for path in files {
            let file = File::open(&path).with_context(|| format!("opening {}", path.display()))?;
            // SAFETY: BaoCut maps the installed checkpoint read-only. The
            // mapping owns its OS handle; this code never writes the file.
            let data = unsafe { MmapOptions::new().map(&file) }.with_context(|| format!("mapping {}", path.display()))?;
            SafeTensors::deserialize(&data).with_context(|| format!("parsing {}", path.display()))?;
            shards.push(Shard { path, data });
        }
        Ok(Self { shards })
    }

    /// Load a complete named text module (`model.embed_tokens`, one
    /// `model.layers.N`, or `model.norm`) into the chosen compute precision.
    /// Returned keys omit the checkpoint's `thinker.` prefix.
    pub fn module(&self, prefix: &str, device: &Device, dtype: DType) -> Result<HashMap<String, Tensor>> {
        let full = format!("thinker.{prefix}.");
        let mut output = HashMap::new();
        for shard in &self.shards {
            let tensors = SafeTensors::deserialize(&shard.data).with_context(|| format!("parsing {}", shard.path.display()))?;
            for name in tensors.names() {
                if !name.starts_with(&full) {
                    continue;
                }
                let value = tensors
                    .tensor(name)?
                    .load(&Device::Cpu)
                    .with_context(|| format!("reading AuK Qwen weight {name}"))?;
                let value = if value.dtype().is_float() { value.to_dtype(dtype)? } else { value };
                let value = value.to_device(device)?;
                let normalized = name.strip_prefix("thinker.").unwrap_or(name).to_owned();
                if output.insert(normalized.clone(), value).is_some() {
                    bail!("duplicate AuK Qwen weight: {normalized}");
                }
            }
        }
        if output.is_empty() {
            return Err(anyhow!("AuK Qwen has no weights under {full}"));
        }
        Ok(output)
    }
}
