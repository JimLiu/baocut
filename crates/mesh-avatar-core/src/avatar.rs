use crate::{
    engine::{
        cloth::ClothPhysics,
        expression::{ExpressionOverlay, ExpressionSettings},
        grid::{build_grid, Grid},
        kana::Vowel,
        lip_sync::LipSyncSettings,
        motion::{LipSyncState, Mode, Motion, SpeakOptions},
        motions::{motions, MotionDefinition},
        physics::Physics,
        random::{RandomSource, SeededRandom},
        rig::{
            eye_part_alpha, eye_part_y, BaseWeights, EyePart, HandWeights, Parameters, RigEngine,
        },
        sprites::{eye_mood, Sprites},
    },
    format::{AvatarPackage, Rect, Texture},
};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::Path};

#[derive(Default)]
pub struct AvatarOptions {
    pub preserve_mouth_form: bool,
    pub lip_sync: Option<LipSyncSettings>,
    pub expressions: Option<ExpressionSettings>,
}
#[derive(Debug, Clone, Serialize)]
pub struct DrawLayer {
    pub name: String,
    pub texture: String,
    pub rect: [f64; 4],
    pub positions: Vec<f32>,
    pub uvs: Vec<f32>,
    pub indices: Vec<u32>,
    pub alpha: f64,
    pub face: bool,
    pub eye_ball: Option<usize>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FaceUniforms {
    pub angles: [f32; 3],
    pub eye_box: [[f32; 4]; 2],
    pub eye_top: [[f32; 24]; 2],
    pub eye_bot: [[f32; 24]; 2],
    pub eyes: [f32; 8],
    pub mouth: [f32; 4],
    pub mouth_state: [f32; 4],
    pub cheeks: [f32; 4],
    pub cheek: f32,
}
#[derive(Debug, Clone, Serialize)]
pub struct Frame {
    pub layers: Vec<DrawLayer>,
    pub uniforms: FaceUniforms,
    pub motion_events: Vec<Option<String>>,
}

struct BaseLayer {
    name: String,
    mesh: Grid,
    weights: Vec<BaseWeights>,
}
struct EyeLayer {
    base: BaseLayer,
    eye: usize,
    part: EyePart,
    alpha: f64,
}
struct HandLayer {
    mesh: Grid,
    weights: Vec<HandWeights>,
}

fn mesh(package: &AvatarPackage, name: &str, rect: Rect, cell: u32, fine: bool) -> Result<Grid> {
    let image = &package.textures[&format!("{name}.png")];
    build_grid(
        rect.map(f64::from),
        cell as f64,
        &image.alpha(),
        image.width as usize,
        fine.then_some(&package.rig.mesh.fine),
    )
}
fn weighted(engine: &RigEngine<'_>, name: &str, mesh: Grid, hair: Option<&Texture>) -> BaseLayer {
    let weights = mesh
        .rest
        .as_chunks::<2>()
        .0
        .iter()
        .map(|&[x, y]| {
            let h = hair.map_or(0.0, |image| {
                let ix = (x.round().max(0.0) as u32).min(image.width - 1);
                let iy = (y.round().max(0.0) as u32).min(image.height - 1);
                image.rgba[((iy * image.width + ix) * 4) as usize] as f64 / 255.0
            });
            engine.base_weights(x as f64, y as f64, h)
        })
        .collect();
    BaseLayer {
        name: name.into(),
        mesh,
        weights,
    }
}
fn draw_layer(
    name: &str,
    texture: String,
    mesh: &Grid,
    alpha: f64,
    face: bool,
    eye_ball: Option<usize>,
) -> DrawLayer {
    DrawLayer {
        name: name.into(),
        texture,
        rect: mesh.rect,
        positions: mesh.pos.clone(),
        uvs: mesh.uv.clone(),
        indices: mesh.tris.clone(),
        alpha,
        face,
        eye_ball,
    }
}

pub struct Avatar {
    package: AvatarPackage,
    motion: Motion,
    physics: Physics,
    cloth: ClothPhysics,
    body_dynamics: crate::engine::legs::BodyDynamics,
    expression: ExpressionOverlay,
    options: AvatarOptions,
    overrides: BTreeMap<String, f64>,
    parameter_weight: f64,
    last_parameters: Parameters,
    base: BaseLayer,
    eyes: Vec<EyeLayer>,
    sprites: Option<Sprites>,
    overlays: crate::engine::overlays::Overlays,
    tassels: Vec<(String, Grid)>,
    hand: Option<HandLayer>,
}

impl Avatar {
    /// Load with deterministic seed zero. Use with_rng to inject another sequence.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        Self::from_package(AvatarPackage::open(path)?)
    }
    pub fn from_package(package: AvatarPackage) -> Result<Self> {
        Self::with_rng(
            package,
            AvatarOptions::default(),
            Box::new(SeededRandom::new(0)),
        )
    }
    pub fn with_rng(
        mut package: AvatarPackage,
        options: AvatarOptions,
        rng: Box<dyn RandomSource>,
    ) -> Result<Self> {
        let r = &package.rig;
        let engine = RigEngine::new(r);
        let mut motion = Motion::with_rng(
            r.view
                .gaze_center
                .unwrap_or([r.head.ellipse.cx, r.head.ellipse.cy]),
            rng,
        );
        motion.configure_rig(r);
        if let Some(settings) = &package.manifest.lip_sync {
            motion.set_lip_sync(&LipSyncSettings::parse(settings)?)?;
        }
        if let Some(settings) = &options.lip_sync {
            motion.set_lip_sync(settings)?;
        }
        let saved = package
            .manifest
            .expressions
            .as_ref()
            .map(ExpressionSettings::parse)
            .transpose()?
            .unwrap_or_default();
        let settings = saved.merge(
            options
                .expressions
                .as_ref()
                .unwrap_or(&ExpressionSettings::default()),
        )?;
        let expression = ExpressionOverlay::with_settings(settings)?;
        let base_rect = package.layers.layers.get("base").copied().unwrap_or([
            0,
            0,
            r.image.width,
            r.image.height,
        ]);
        let base_name = if r.cloth.is_empty() {
            "base"
        } else {
            "base_cloth"
        };
        let base = weighted(
            &engine,
            "base",
            mesh(&package, base_name, base_rect, r.mesh.base_cell, true)?,
            Some(&package.textures["hairmask.png"]),
        );
        let mut eyes = vec![];
        for eye in 0..2 {
            for (name, part) in [
                ("ball", EyePart::Ball),
                ("low", EyePart::Low),
                ("crease", EyePart::Crease),
                ("lash", EyePart::Lash),
            ] {
                let name = format!("eye{eye}_{name}");
                let cell = if matches!(part, EyePart::Ball) {
                    r.mesh.eye_ball_cell
                } else {
                    r.mesh.eye_cell
                };
                eyes.push(EyeLayer {
                    base: weighted(
                        &engine,
                        &name,
                        mesh(&package, &name, package.layers.layers[&name], cell, false)?,
                        None,
                    ),
                    eye,
                    part,
                    alpha: 1.0,
                });
            }
        }
        let sprites = package
            .sprites
            .as_ref()
            .map(|sheet| Sprites::new(&engine, sheet, &package.textures))
            .transpose()?;
        let overlays = package
            .overlays
            .as_ref()
            .map(|sheet| {
                crate::engine::overlays::Overlays::new(&engine, sheet, &mut package.textures)
            })
            .transpose()?
            .unwrap_or_default();
        let tassels = r
            .accessories
            .iter()
            .map(|t| {
                Ok((
                    t.name.clone(),
                    mesh(
                        &package,
                        &t.name,
                        package.layers.layers[&t.name],
                        r.mesh.tassel_cell,
                        false,
                    )?,
                ))
            })
            .collect::<Result<Vec<_>>>()?;
        let hand = if r.hand.is_some() {
            let mesh = mesh(
                &package,
                "hand",
                package.layers.layers["hand"],
                r.mesh.hand_cell,
                false,
            )?;
            let weights = mesh
                .rest
                .as_chunks::<2>()
                .0
                .iter()
                .map(|&[x, y]| engine.hand_weights(x as f64, y as f64))
                .collect();
            Some(HandLayer { mesh, weights })
        } else {
            None
        };
        let physics = Physics::new(r);
        let mut cloth = ClothPhysics::new(&engine, r)?;
        for c in &r.cloth {
            let name = format!("cloth_{}", c.name);
            cloth.attach(
                &c.name,
                mesh(
                    &package,
                    &name,
                    package.layers.layers[&name],
                    r.mesh.cloth_cell.unwrap_or(8),
                    false,
                )?,
            )?;
        }
        Ok(Self {
            package,
            motion,
            physics,
            cloth,
            body_dynamics: Default::default(),
            expression,
            options,
            overrides: BTreeMap::new(),
            parameter_weight: 1.0,
            last_parameters: Parameters::default(),
            base,
            eyes,
            sprites,
            overlays,
            tassels,
            hand,
        })
    }
    pub fn motions(&self) -> &'static [MotionDefinition] {
        motions()
    }
    pub fn package(&self) -> &AvatarPackage {
        &self.package
    }
    pub fn textures(&self) -> &BTreeMap<String, Texture> {
        &self.package.textures
    }
    pub fn parameters(&self) -> &Parameters {
        &self.last_parameters
    }
    pub fn set_parameters(&mut self, values: BTreeMap<String, f64>) {
        self.set_parameters_weighted(values, 1.0);
    }
    pub fn set_parameters_weighted(&mut self, values: BTreeMap<String, f64>, weight: f64) {
        self.overrides = values;
        self.parameter_weight = if weight.is_nan() {
            0.0
        } else {
            weight.clamp(0.0, 1.0)
        };
    }
    pub fn set_voice_level(&mut self, value: f64) {
        self.motion.set_voice_level(value);
    }
    pub fn set_speaking(&mut self, on: bool) {
        self.motion.set_speaking(on);
    }
    pub fn set_emotion(&mut self, tag: &str) {
        self.motion.set_emotion(tag, true);
    }
    pub fn set_emotion_with_motion(&mut self, tag: &str, play_motion: bool) {
        self.motion.set_emotion(tag, play_motion);
    }
    pub fn set_expression(&mut self, name: &str) {
        self.expression.set(name);
    }
    /// Show exactly the listed overlay names. Unknown names are ignored; an empty list hides all.
    pub fn set_overlays(&mut self, names: &[&str]) {
        self.overlays.set(names);
    }
    pub fn expression(&self) -> (&str, bool) {
        (&self.expression.name, self.expression.active())
    }
    pub fn play(&mut self, id: &str) {
        self.motion.play_motion(id);
    }
    pub fn speak_kana(&mut self, text: &str, options: SpeakOptions) {
        self.motion.speak_kana(text, options);
    }
    pub fn hold_mouth(&mut self, vowel: Vowel) {
        self.motion.hold_mouth(Some(vowel));
    }
    pub fn stop_lip_sync(&mut self) {
        self.motion.stop_lip_sync();
    }
    pub fn lip_sync_state(&self) -> LipSyncState {
        self.motion.lip_sync_state()
    }
    pub fn set_lip_sync(&mut self, settings: &LipSyncSettings) -> Result<()> {
        self.motion.set_lip_sync(settings)
    }
    pub fn set_auto_idle(&mut self, on: bool) {
        self.motion.auto_idle = on;
    }
    pub fn set_auto_motion(&mut self, on: bool) {
        self.motion.auto_motion = on;
    }
    pub fn set_sway_gain(&mut self, gain: f64) {
        self.physics.gain = if gain.is_nan() { 0.0 } else { gain.max(0.0) };
        self.cloth.gain = self.physics.gain;
    }
    /// Adjust one garment, or every garment with `None`, without editing the rig.
    pub fn set_cloth_tuning(
        &mut self,
        name: Option<&str>,
        tuning: &crate::rig::ClothTuningUpdate,
    ) -> Result<()> {
        self.cloth.set_tuning(name, tuning)
    }
    pub fn set_talk_gain(&mut self, gain: f64) {
        self.motion.talk_gain = if gain.is_nan() { 0.0 } else { gain.max(0.0) };
    }

    fn update_parameters(&mut self, dt: f64) -> Parameters {
        let mut p = self.motion.update(dt);
        for (key, &value) in &self.overrides {
            let original = p.get(key).unwrap_or(0.0);
            p.set(
                key,
                if self.parameter_weight == 1.0 {
                    value
                } else {
                    original + (value - original) * self.parameter_weight
                },
            );
        }
        if self.motion.lip_open.is_some() {
            p.mouth_open = self.motion.parameters.mouth_open;
            if !self.options.preserve_mouth_form || !self.overrides.contains_key("mouthForm") {
                p.mouth_form = self.motion.parameters.mouth_form;
            }
        }
        let out = self.expression.apply(&p, dt);
        self.last_parameters = out.clone();
        out
    }
    pub fn advance_parameters(&mut self, dt: f64) -> &Parameters {
        self.update_parameters(if dt.is_finite() { dt.max(0.0) } else { 0.0 });
        &self.last_parameters
    }

    /// Advance by caller-provided seconds, capped at 0.05 like the JS animation loop.
    pub fn tick(&mut self, dt: f64) -> Frame {
        let dt = if dt.is_nan() {
            0.0
        } else {
            dt.clamp(0.0, 0.05)
        };
        let p = self.update_parameters(dt);
        let engine = RigEngine::with_body_dynamics(&self.package.rig, self.body_dynamics);
        let phys = self.physics.step(&engine, &p, dt);
        self.body_dynamics = engine.body_dynamics();
        for (k, (rest, pos)) in self
            .base
            .mesh
            .rest
            .as_chunks::<2>()
            .0
            .iter()
            .zip(self.base.mesh.pos.as_chunks_mut::<2>().0)
            .enumerate()
        {
            let q = engine.deform_base(
                rest[0] as f64,
                rest[1] as f64,
                &self.base.weights[k],
                &p,
                phys,
            );
            *pos = q.map(|v| v as f32);
        }
        let eyes_drawn = self.sprites.as_ref().map_or([false; 2], |s| s.eyes_drawn);
        let mut mouth_drawn = false;
        for eye in &mut self.eyes {
            let open = if eyes_drawn[eye.eye] {
                1.0
            } else if eye.eye == 0 {
                p.eye_r_open
            } else {
                p.eye_l_open
            };
            let smile = if eye.eye == 0 {
                p.eye_smile
            } else {
                p.eye_smile_l.unwrap_or(p.eye_smile)
            };
            eye.alpha = eye_part_alpha(eye.part, open, smile);
            for (k, (rest, pos)) in eye
                .base
                .mesh
                .rest
                .as_chunks::<2>()
                .0
                .iter()
                .zip(eye.base.mesh.pos.as_chunks_mut::<2>().0)
                .enumerate()
            {
                let x = rest[0] as f64;
                let y = eye_part_y(
                    &engine.rig.eyes[eye.eye],
                    eye.part,
                    x,
                    rest[1] as f64,
                    open,
                    smile,
                );
                *pos = engine
                    .deform_base(x, y, &eye.base.weights[k], &p, phys)
                    .map(|v| v as f32);
            }
        }
        if let Some(sprites) = &mut self.sprites {
            let mood = eye_mood(
                Some(&self.expression.name),
                if self.motion.mode == Mode::Manual {
                    None
                } else {
                    Some(&self.motion.expr)
                },
            );
            let covered = sprites.update(&engine, &p, phys, dt, mood);
            mouth_drawn = covered.mouth_drawn;
            for eye in &mut self.eyes {
                if covered.eyes[eye.eye] {
                    eye.alpha = 0.0;
                }
            }
        }
        self.overlays.update(&engine, &p, phys);
        if let Some(hand) = &mut self.hand {
            let frame = engine.hand_frame(&p);
            for (k, (rest, pos)) in hand
                .mesh
                .rest
                .as_chunks::<2>()
                .0
                .iter()
                .zip(hand.mesh.pos.as_chunks_mut::<2>().0)
                .enumerate()
            {
                *pos = engine
                    .deform_hand(rest[0] as f64, rest[1] as f64, &hand.weights[k], &p, &frame)
                    .map(|v| v as f32);
            }
        }
        self.cloth.step(&engine, &p, dt, phys);
        self.cloth.deform();
        for (chain, (_, mesh)) in self.physics.chains.iter().zip(&mut self.tassels) {
            chain
                .deform_grid(mesh)
                .expect("physics initialized tassel joints");
        }
        let cloth_layers = |behind| {
            self.cloth
                .garments
                .iter()
                .filter(move |g| g.behind == behind)
                .flat_map(|g| {
                    g.meshes.iter().map(move |m| {
                        draw_layer(
                            &format!("cloth_{}", g.name),
                            format!("cloth_{}.png", g.name),
                            &m.mesh,
                            1.0,
                            false,
                            None,
                        )
                    })
                })
        };
        let mut layers: Vec<_> = cloth_layers(true).collect();
        layers.push(draw_layer(
            "base",
            if self.package.rig.cloth.is_empty() {
                "base.png"
            } else {
                "base_cloth.png"
            }
            .into(),
            &self.base.mesh,
            1.0,
            true,
            None,
        ));
        for eye in &self.eyes {
            layers.push(draw_layer(
                &eye.base.name,
                format!("{}.png", eye.base.name),
                &eye.base.mesh,
                eye.alpha,
                false,
                matches!(eye.part, EyePart::Ball).then_some(eye.eye),
            ));
        }
        if let Some(sprites) = &self.sprites {
            for sprite in &sprites.items {
                if sprite.visible {
                    layers.push(draw_layer(
                        &sprite.name,
                        format!("sprites/{}.png", sprite.name),
                        &sprite.mesh,
                        sprite.alpha,
                        false,
                        None,
                    ));
                }
            }
        }
        layers.extend(cloth_layers(false));
        for item in self.overlays.items.iter().filter(|item| item.visible) {
            layers.push(draw_layer(
                &format!("overlay_{}", item.name),
                item.texture.clone(),
                &item.mesh,
                1.0,
                false,
                None,
            ));
        }
        for (name, mesh) in &self.tassels {
            layers.push(draw_layer(
                name,
                format!("{name}.png"),
                mesh,
                1.0,
                false,
                None,
            ));
        }
        if let Some(hand) = &self.hand {
            layers.push(draw_layer(
                "hand",
                "hand.png".into(),
                &hand.mesh,
                1.0,
                false,
                None,
            ));
        }
        let r = &self.package.rig;
        let mouth = &r.mouth;
        let uniforms = FaceUniforms {
            angles: [p.angle_x as f32, p.angle_y as f32, p.angle_z as f32],
            eye_box: r
                .eyes
                .each_ref()
                .map(|e| [e.x0 as f32, e.x1 as f32, 0.0, 0.0]),
            eye_top: r.eyes.each_ref().map(|e| e.top.map(|v| v as f32)),
            eye_bot: r.eyes.each_ref().map(|e| e.bot.map(|v| v as f32)),
            eyes: [
                if eyes_drawn[0] { 1.0 } else { p.eye_r_open },
                p.eye_smile,
                p.gaze_x * 7.0,
                -p.gaze_y * 7.0 * 0.6,
                if eyes_drawn[1] { 1.0 } else { p.eye_l_open },
                p.eye_smile_l.unwrap_or(p.eye_smile),
                p.gaze_x * 7.0 * 0.85,
                -p.gaze_y * 7.0 * 0.6,
            ]
            .map(|v| v as f32),
            mouth: [mouth.cx, mouth.cy, mouth.angle, mouth.half_len].map(|v| v as f32),
            mouth_state: [
                if mouth_drawn { 0.0 } else { p.mouth_open },
                p.mouth_form,
                mouth.bow,
                0.0,
            ]
            .map(|v| v as f32),
            cheeks: [
                r.cheeks[0][0],
                r.cheeks[0][1],
                r.cheeks[1][0],
                r.cheeks[1][1],
            ]
            .map(|v| v as f32),
            cheek: p.blush as f32,
        };
        Frame {
            layers,
            uniforms,
            motion_events: std::mem::take(&mut self.motion.motion_events),
        }
    }
}
