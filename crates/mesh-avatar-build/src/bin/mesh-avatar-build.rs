//! 命令行：`layers` 切分层，`variant-requests` 写变体的编辑遮罩与说明，`sprites` 导入画好的变体。

use std::path::{Path, PathBuf};
use std::{env, fs};

use anyhow::{Context, Result, bail};
use mesh_avatar_build::{layers, sprites, variants};
use serde_json::Value;

const USAGE: &str = "Usage:
  mesh-avatar-build layers <project> [--rig FILE] [--out AVATAR_DIR]
      Cut eye layers, the skin-filled base and the hair mask from <project>/source.png.
      Writes AVATAR_DIR/built/ and AVATAR_DIR/rig.json (default AVATAR_DIR: <project>).
  mesh-avatar-build variant-requests <project>
      Write <project>/variant-requests/<name>/{mask.png,prompt.md} for drawn eye and mouth variants.
  mesh-avatar-build sprites <project> [--out DIR] [--tolerance N]
      Import <project>/variants/*.png as feathered sprites (default DIR: <project>/built/sprites).";

fn rig_path(project: &Path, name: Option<&str>) -> Result<PathBuf> {
    if let Some(name) = name {
        return Ok(project.join(name));
    }
    ["rig.json", "rig.draft.json"]
        .iter()
        .map(|n| project.join(n))
        .find(|p| p.exists())
        .context("project has no rig.json or rig.draft.json")
}

struct Options {
    project: PathBuf,
    flags: Vec<(String, String)>,
}

impl Options {
    fn parse(args: &[String], allowed: &[&str]) -> Result<Self> {
        let mut project = None;
        let mut flags = Vec::new();
        let mut iter = args.iter();
        while let Some(arg) = iter.next() {
            if let Some(flag) = arg.strip_prefix("--") {
                if !allowed.contains(&flag) {
                    bail!("unknown option --{flag}\n{USAGE}");
                }
                let value = iter.next().with_context(|| format!("--{flag} needs a value"))?;
                flags.push((flag.to_owned(), value.clone()));
            } else if project.is_none() {
                project = Some(PathBuf::from(arg));
            } else {
                bail!("unexpected argument {arg}\n{USAGE}");
            }
        }
        Ok(Self {
            project: project.with_context(|| format!("missing <project>\n{USAGE}"))?,
            flags,
        })
    }
    fn get(&self, name: &str) -> Option<&str> {
        self.flags.iter().rev().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }
}

fn run() -> Result<()> {
    let args: Vec<String> = env::args().skip(1).collect();
    let Some(command) = args.first() else {
        println!("{USAGE}");
        return Ok(());
    };
    match command.as_str() {
        "layers" => {
            let o = Options::parse(&args[1..], &["rig", "out"])?;
            let rig = rig_path(&o.project, o.get("rig"))?;
            let source = fs::read(o.project.join("source.png")).context("cannot read source.png")?;
            let rig_bytes = fs::read(&rig).with_context(|| format!("cannot read {}", rig.display()))?;
            let result = layers::build_layers(&source, &rig_bytes)?;
            let out = o.get("out").map(PathBuf::from).unwrap_or_else(|| o.project.clone());
            layers::write_layers(&result, &out)?;
            let names: Vec<&str> = result.images.iter().map(|(n, _)| n.as_str()).collect();
            println!(
                "{}",
                serde_json::json!({ "build": result.build, "size": result.meta["size"], "layers": names })
            );
        }
        "variant-requests" => {
            let o = Options::parse(&args[1..], &[])?;
            let source = image::open(o.project.join("source.png")).context("cannot read source.png")?;
            let rig: Value = serde_json::from_slice(&fs::read(rig_path(&o.project, None)?)?).context("rig: invalid JSON")?;
            let (w, h) = (source.width() as usize, source.height() as usize);
            let image_size = rig.get("image");
            if image_size.and_then(|i| i.get("width")).and_then(Value::as_u64) != Some(w as u64)
                || image_size.and_then(|i| i.get("height")).and_then(Value::as_u64) != Some(h as u64)
            {
                bail!("rig.image must match source.png");
            }
            let count = variants::write_requests(&o.project, &rig, w, h)?;
            println!(
                "Prepared {count} variant requests in {}",
                o.project.join("variant-requests").display()
            );
        }
        "sprites" => {
            let o = Options::parse(&args[1..], &["out", "tolerance"])?;
            let tolerance: f32 = match o.get("tolerance") {
                Some(v) => v.parse().context("--tolerance must be a number")?,
                None => 8.0,
            };
            let out = o
                .get("out")
                .map(PathBuf::from)
                .unwrap_or_else(|| o.project.join("built").join("sprites"));
            match sprites::build_sprites(&o.project, tolerance) {
                Ok(Some(result)) => {
                    for line in &result.log {
                        eprintln!("{line}");
                    }
                    sprites::write_sprites(&result, &out)?;
                    println!("Built {} sprites; build {}.", result.layers.len(), result.build);
                }
                Ok(None) => println!("No variants available; existing sprites were left unchanged."),
                Err(error) => return Err(error),
            }
        }
        "-h" | "--help" | "help" => println!("{USAGE}"),
        other => bail!("unknown command {other}\n{USAGE}"),
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("mesh-avatar-build: {error:#}");
        std::process::exit(1);
    }
}
