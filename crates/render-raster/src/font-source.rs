//! Content-addressed primary faces without changing ordinary family matching.
use super::{TextEngine, fontdb};
use anyhow::{Result, bail, ensure};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

impl TextEngine {
    /// Register original byte resources without changing named family matching.
    /// Collection faces remain at their original indices. Only a referenced face
    /// is copied into the shaping database under a private family.
    pub fn add_font_sources(&mut self, fonts: Vec<std::sync::Arc<Vec<u8>>>) -> Result<()> {
        let mut resources = self.font_source_resources.clone();
        let mut bytes = self.font_source_resource_bytes;
        let mut count = self.font_source_resource_count;
        for source in fonts {
            let source: std::sync::Arc<dyn AsRef<[u8]> + Send + Sync> = source;
            if resources
                .faces()
                .any(|face| matches!(&face.source, fontdb::Source::Binary(existing) if std::sync::Arc::ptr_eq(existing, &source)))
            {
                continue;
            }
            let length = source.as_ref().as_ref().len();
            ensure!(
                count < 1024 && bytes.saturating_add(length) <= 256 * 1024 * 1024,
                "FONT_SOURCE_RESOURCE_BUDGET"
            );
            let before = resources.faces().count();
            resources.load_font_source(fontdb::Source::Binary(source));
            let after = resources.faces().count();
            ensure!(after > before, "FONT_SOURCE_RESOURCE_INVALID");
            ensure!(after <= 4096, "FONT_SOURCE_FACE_BUDGET");
            bytes += length;
            count += 1;
        }
        self.font_source_resources = resources;
        self.font_source_resource_bytes = bytes;
        self.font_source_resource_count = count;
        Ok(())
    }

    /// Resolve one face from explicitly registered font bytes. The returned
    /// private family has exactly that face, so loading order cannot substitute
    /// another version with the same public family/weight/style. Missing sources
    /// and collection indices fail; glyph-level script fallback remains enabled.
    /// System files are not opened or hashed implicitly: hosts register bytes.
    pub fn resolve_font_source(&mut self, sha256: &str, face_index: u32) -> Result<String> {
        ensure!(
            sha256.len() == 64 && sha256.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) && face_index <= 1023,
            "FONT_SOURCE_INVALID"
        );
        let key = (sha256.to_owned(), face_index);
        if let Some((family, id, _)) = self.font_source_aliases.get(&key) {
            if self.font_system.db().face(*id).is_some() {
                return Ok(family.clone());
            }
        }
        ensure!(self.font_source_aliases.len() < 1024, "FONT_SOURCE_BINDING_BUDGET");
        self.font_source_digests.retain(|(source, _, _)| source.strong_count() != 0);
        let mut digest_bytes: usize = self.font_source_digests.iter().map(|(_, _, bytes)| *bytes).sum();
        let mut visited = HashSet::new();
        let mut found = None;
        for face in self
            .font_source_resources
            .faces()
            .chain(self.font_system.db().faces())
            .filter(|f| f.index == face_index)
        {
            let fontdb::Source::Binary(source) = &face.source else { continue };
            let identity = std::sync::Arc::as_ptr(source) as *const () as usize;
            if !visited.insert(identity) {
                continue;
            }
            let digest = if let Some((_, digest, _)) = self
                .font_source_digests
                .iter()
                .find(|(weak, _, _)| weak.upgrade().is_some_and(|cached| std::sync::Arc::ptr_eq(&cached, source)))
            {
                digest.clone()
            } else {
                let bytes = source.as_ref().as_ref();
                ensure!(
                    self.font_source_digests.len() < 1024 && digest_bytes.saturating_add(bytes.len()) <= 256 * 1024 * 1024,
                    "FONT_SOURCE_DIGEST_BUDGET"
                );
                let digest = Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect::<String>();
                digest_bytes += bytes.len();
                self.font_source_digests
                    .push((std::sync::Arc::downgrade(source), digest.clone(), bytes.len()));
                digest
            };
            if digest == sha256 {
                found = Some(face.clone());
                break;
            }
        }
        let Some(mut face) = found else {
            bail!("FONT_SOURCE_UNREGISTERED_OR_FACE_MISSING")
        };
        let family = format!("__baocut_font_source_{sha256}_{face_index}");
        ensure!(!self.has_family(&family), "FONT_SOURCE_ALIAS_COLLISION");
        let display = face
            .families
            .first()
            .ok_or_else(|| anyhow::anyhow!("FONT_SOURCE_FAMILY_MISSING"))?
            .0
            .clone();
        let language = face
            .families
            .first()
            .ok_or_else(|| anyhow::anyhow!("FONT_SOURCE_FAMILY_MISSING"))?
            .1;
        face.families = vec![(family.clone(), language)];
        let id = self.font_system.db_mut().push_face_info(face);
        self.family_present.remove(&family);
        self.font_source_aliases.insert(key, (family.clone(), id, display));
        Ok(family)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn versions() -> [Vec<u8>; 2] {
        let original = include_bytes!("../assets/fonts/VKSans-400.ttf").to_vec();
        let mut changed = original.clone();
        let face = swash::FontRef::from_index(&original, 0).unwrap();
        let table = face.table(u32::from_be_bytes(*b"hmtx")).unwrap();
        let start = table.as_ptr() as usize - original.as_ptr() as usize;
        let header = face.table(u32::from_be_bytes(*b"hhea")).unwrap();
        let count = u16::from_be_bytes(header[34..36].try_into().unwrap()) as usize;
        for index in 0..count {
            let offset = start + index * 4;
            let advance = u16::from_be_bytes(changed[offset..offset + 2].try_into().unwrap());
            changed[offset..offset + 2].copy_from_slice(&advance.saturating_add(128).to_be_bytes());
        }
        [original, changed]
    }
    fn sha(bytes: &[u8]) -> String {
        Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn exact_sources_ignore_order_and_keep_warmed_families_separate() {
        let data = versions();
        let family = super::super::font_data_faces(data[0].clone())[0].families[0].clone();
        for order in [[0, 1], [1, 0]] {
            let mut engine = TextEngine::with_document_fonts(&[data[order[0]].clone(), data[order[1]].clone()]);
            let legacy = engine.shape("AVA", &family, 40., 400);
            let mut widths = Vec::new();
            for index in [0, 1, 0, 1] {
                let alias = engine.resolve_font_source(&sha(&data[index]), 0).unwrap();
                let line = engine.shape("AVA", &alias, 40., 400);
                assert!(!line.glyphs.is_empty());
                for glyph in &line.glyphs {
                    let face = engine.font_system.db().face(glyph.cache_key.font_id).unwrap();
                    let fontdb::Source::Binary(bytes) = &face.source else {
                        panic!("explicit source used a system file")
                    };
                    assert_eq!(sha(bytes.as_ref().as_ref()), sha(&data[index]));
                    assert_eq!(face.index, 0);
                }
                widths.push(line.width);
            }
            assert!(widths[1] > widths[0], "different versions really have different metrics");
            assert_eq!(widths[0], widths[2]);
            assert_eq!(widths[1], widths[3]);
            assert_eq!(
                engine.shape("AVA", &family, 40., 400).width,
                legacy.width,
                "source binding changes no ordinary family match"
            );
            assert_eq!(engine.font_source_aliases.len(), 2);
            assert_eq!(engine.font_source_digests.len(), 2, "warm source switches do not rehash the pool");
            let log = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
            engine.set_face_log(Some(log.clone()));
            let alias = engine.resolve_font_source(&sha(&data[0]), 0).unwrap();
            engine.shape("AVA", &alias, 40., 400);
            assert!(!log.lock().unwrap().is_empty());
            assert!(
                log.lock().unwrap().iter().all(|(name, _, _)| name == &family),
                "usage census does not expose private aliases"
            );
        }
    }

    #[test]
    fn source_only_resources_keep_legacy_metrics_and_fail_atomically() {
        let data = versions();
        let family = super::super::font_data_faces(data[0].clone())[0].families[0].clone();
        let mut engine = TextEngine::with_document_fonts(&[data[0].clone()]);
        let legacy = engine.shape("AVA", &family, 40., 400).width;
        let source = std::sync::Arc::new(data[1].clone());
        engine.add_font_sources(vec![source.clone(), source]).unwrap();
        assert_eq!(engine.font_source_resource_count, 1);
        assert_eq!(engine.shape("AVA", &family, 40., 400).width, legacy);
        let alias = engine.resolve_font_source(&sha(&data[1]), 0).unwrap();
        assert!(engine.shape("AVA", &alias, 40., 400).width > legacy);
        assert_eq!(engine.shape("AVA", &family, 40., 400).width, legacy);
        let count = engine.font_source_resources.faces().count();
        assert!(
            engine
                .add_font_sources(vec![std::sync::Arc::new(data[0].clone()), std::sync::Arc::new(vec![0; 20])])
                .is_err()
        );
        assert_eq!(engine.font_source_resource_count, 1);
        assert_eq!(engine.font_source_resources.faces().count(), count);
        assert_eq!(
            engine.shape("AVA", &alias, 40., 400).width,
            engine.shape("AVA", &alias, 40., 400).width
        );
    }

    #[test]
    fn missing_or_invalid_sources_do_not_fall_back_or_add_faces() {
        let data = versions();
        let mut engine = TextEngine::with_document_fonts(&[data[0].clone()]);
        let count = engine.font_system.db().faces().count();
        for (digest, index) in [("x".repeat(64), 0), (sha(&data[0]), 1024), (sha(&data[0]), 1), (sha(&data[1]), 0)] {
            assert!(engine.resolve_font_source(&digest, index).is_err());
            assert_eq!(engine.font_system.db().faces().count(), count);
        }
        assert!(engine.font_source_aliases.is_empty());
    }
}
