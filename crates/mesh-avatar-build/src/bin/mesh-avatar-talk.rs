//! 按一段配音渲染会说话的主播：模拟固定 60 Hz，口型由音量驱动，逐帧输出未预乘的 RGBA8，交给视频编码器。

use std::fs;
use std::io::{self, Write};
use std::path::PathBuf;

use anyhow::{Context, Result, bail, ensure};
use mesh_avatar_build::talk::{TICKS_PER_SECOND, level_at, read_mono};
use mesh_avatar_core::{Avatar, AvatarOptions, engine::random::SeededRandom, format::AvatarPackage};
use mesh_avatar_wgpu::{Fit, Renderer, ViewOptions, headless_device, wgpu};

const USAGE: &str = "Usage: mesh-avatar-talk <avatar> --audio speech.wav -o -|out.rgba
Options: --size WxH (default 1080x1920)  --fps N (default 30)  --seed N  --lead S (idle seconds before the voice, default 0.6)
         --tail S (idle seconds after, default 1.0)  --gain G (voice sensitivity, default 1)  --expression NAME
         --fit contain|cover  --pad-top N  --pad-side N  --samples 1|4 (default 4)
Streams straight RGBA8 frames; the frame count and size go to stderr. Pipe into ffmpeg -f rawvideo -pix_fmt rgba.";

struct Args {
    avatar: PathBuf,
    audio: PathBuf,
    output: PathBuf,
    size: [u32; 2],
    fps: f64,
    seed: u32,
    lead: f64,
    tail: f64,
    gain: f64,
    expression: Option<String>,
    fit: Fit,
    pad_top: Option<f64>,
    pad_side: Option<f64>,
    samples: u32,
}

fn parse() -> Result<Option<Args>> {
    let mut it = std::env::args().skip(1);
    let mut avatar = None;
    let mut audio = None;
    let mut output = None;
    let mut args = Args {
        avatar: PathBuf::new(),
        audio: PathBuf::new(),
        output: PathBuf::new(),
        size: [1080, 1920],
        fps: 30.0,
        seed: 0,
        lead: 0.6,
        tail: 1.0,
        gain: 1.0,
        expression: None,
        fit: Fit::Contain,
        pad_top: None,
        pad_side: None,
        samples: 4,
    };
    while let Some(arg) = it.next() {
        let mut value = || it.next().with_context(|| format!("{arg} needs a value"));
        match arg.as_str() {
            "-h" | "--help" => {
                println!("{USAGE}");
                return Ok(None);
            }
            "--audio" => audio = Some(PathBuf::from(value()?)),
            "-o" | "--out" => output = Some(PathBuf::from(value()?)),
            "--size" => {
                let v = value()?;
                let (w, h) = v.split_once('x').context("--size must be WxH")?;
                args.size = [w.parse()?, h.parse()?];
            }
            "--fps" => args.fps = value()?.parse()?,
            "--seed" => args.seed = value()?.parse()?,
            "--lead" => args.lead = value()?.parse()?,
            "--tail" => args.tail = value()?.parse()?,
            "--gain" => args.gain = value()?.parse()?,
            "--expression" => args.expression = Some(value()?),
            "--fit" => {
                args.fit = match value()?.as_str() {
                    "contain" => Fit::Contain,
                    "cover" => Fit::Cover,
                    other => bail!("--fit must be contain or cover, got {other}"),
                }
            }
            "--pad-top" => args.pad_top = Some(value()?.parse()?),
            "--pad-side" => args.pad_side = Some(value()?.parse()?),
            "--samples" => args.samples = value()?.parse()?,
            other if !other.starts_with('-') && avatar.is_none() => avatar = Some(PathBuf::from(other)),
            other => bail!("unexpected argument {other}\n{USAGE}"),
        }
    }
    args.avatar = avatar.with_context(|| format!("missing <avatar>\n{USAGE}"))?;
    args.audio = audio.with_context(|| format!("missing --audio\n{USAGE}"))?;
    args.output = output.with_context(|| format!("missing -o\n{USAGE}"))?;
    ensure!(args.fps > 0.0 && args.fps <= 120.0, "--fps must be in (0, 120]");
    ensure!(args.lead >= 0.0 && args.tail >= 0.0, "--lead and --tail must not be negative");
    ensure!(args.size[0] > 0 && args.size[1] > 0, "--size must be positive");
    Ok(Some(args))
}

fn run(args: Args) -> Result<()> {
    let package = AvatarPackage::open(&args.avatar)?;
    let view = ViewOptions {
        image_size: [package.rig.image.width, package.rig.image.height],
        pad_top: args.pad_top.unwrap_or(package.rig.view.pad_top),
        pad_side: args.pad_side.unwrap_or(package.rig.view.pad_side),
        fit: args.fit,
    };
    view.transform(args.size)?;
    let (samples, rate) = read_mono(&args.audio)?;
    let voice_seconds = samples.len() as f64 / rate as f64;
    let lead_ticks = (args.lead * TICKS_PER_SECOND).round() as usize;
    let voice_ticks = (voice_seconds * TICKS_PER_SECOND).ceil() as usize;
    let total_seconds = args.lead + voice_seconds + args.tail;
    let frames = (total_seconds * args.fps).ceil() as usize;

    let mut avatar = Avatar::with_rng(package, AvatarOptions::default(), Box::new(SeededRandom::new(args.seed)))?;
    if let Some(expression) = &args.expression {
        avatar.set_expression(expression);
    }
    let (device, queue, info) = pollster::block_on(headless_device())?;
    eprintln!(
        "GPU: {} ({:?}); {} frames of {}x{} at {} fps; voice {:.2} s",
        info.name, info.backend, frames, args.size[0], args.size[1], args.fps, voice_seconds
    );
    let mut renderer = Renderer::new(&device, &queue, wgpu::TextureFormat::Rgba8Unorm, args.samples, avatar.textures())?;
    let mut writer: Box<dyn Write> = if args.output.as_os_str() == "-" {
        Box::new(io::BufWriter::new(io::stdout().lock()))
    } else {
        if let Some(parent) = args.output.parent().filter(|p| !p.as_os_str().is_empty()) {
            fs::create_dir_all(parent)?;
        }
        Box::new(io::BufWriter::new(fs::File::create(&args.output)?))
    };
    let mut frame = avatar.tick(0.0);
    let mut simulated = 0usize;
    for index in 0..frames {
        // 模拟固定在 60 Hz，与输出帧率无关；每一步先按当时的音量设好口型输入。
        let target = (index as f64 * TICKS_PER_SECOND / args.fps).round() as usize;
        while simulated < target {
            let speaking = simulated >= lead_ticks && simulated < lead_ticks + voice_ticks;
            avatar.set_speaking(speaking);
            if speaking {
                avatar.set_voice_level(level_at(&samples, rate, simulated - lead_ticks, args.gain));
            }
            frame = avatar.tick(1.0 / TICKS_PER_SECOND);
            simulated += 1;
        }
        writer.write_all(&renderer.render_rgba(&frame, args.size, &view)?)?;
    }
    writer.flush()?;
    Ok(())
}

fn main() {
    if let Err(error) = parse().and_then(|args| args.map(run).transpose()) {
        eprintln!("mesh-avatar-talk: {error:#}");
        std::process::exit(1);
    }
}
