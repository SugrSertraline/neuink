use std::{io::Cursor, path::PathBuf};

use image::{ImageFormat, ImageReader};
use neuink_domain::{EntryId, NoteId};

use crate::{atomic_write, tag_reading::validate_id, Workspace, WorkspaceError};

pub const MAX_NOTE_IMAGE_BYTES: usize = 20 * 1024 * 1024;

fn invalid(message: &str) -> WorkspaceError {
    WorkspaceError::InvalidNoteDocument(message.into())
}

impl Workspace {
    /// Content-addressed attachments never overwrite a different image or edit the note.
    /// The caller adds the returned relative reference through normal revision-checked saving.
    pub fn write_note_image(
        &self,
        entry_id: &EntryId,
        note_id: &NoteId,
        bytes: &[u8],
    ) -> Result<(String, PathBuf), WorkspaceError> {
        validate_id(entry_id.as_str())?;
        validate_id(note_id.as_str())?;
        if bytes.is_empty() || bytes.len() > MAX_NOTE_IMAGE_BYTES {
            return Err(invalid("图片为空或超过 20 MB"));
        }
        // An error page served as image/jpeg must never become a broken local image.
        let format = image::guess_format(bytes).map_err(|_| invalid("下载内容不是支持的图片"))?;
        let extension = match format {
            ImageFormat::Png => "png",
            ImageFormat::Jpeg => "jpg",
            ImageFormat::Gif => "gif",
            ImageFormat::WebP => "webp",
            ImageFormat::Avif => "avif",
            _ => return Err(invalid("图片格式不支持")),
        };
        // AVIF is displayed by WebView2; this workspace does not ship an AVIF decoder.
        if format != ImageFormat::Avif {
            let (width, height) = ImageReader::with_format(Cursor::new(bytes), format)
                .into_dimensions()
                .map_err(|_| invalid("图片内容损坏"))?;
            if width == 0 || height == 0 {
                return Err(invalid("图片尺寸无效"));
            }
        }
        let _guard = self.begin_tag_safe_mutation()?;
        self.read_note(entry_id, note_id)?;
        let name = format!("image-{}.{}", blake3::hash(bytes).to_hex(), extension);
        let path = self
            .layout()
            .entry_note_assets_dir(entry_id, note_id)
            .join(&name);
        self.validate_note_workspace_path(&path)?;
        atomic_write(&path, bytes)?;
        Ok((format!("./{note_id}.assets/{name}"), path))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use neuink_domain::ContentItem;

    #[test]
    fn note_images_validate_and_deduplicate_without_editing_the_note() {
        let dir = std::env::temp_dir().join(format!("neuink-note-image-{}", EntryId::new()));
        let workspace = Workspace::create(&dir).unwrap();
        let entry = workspace.create_entry("Paper").unwrap();
        let entry = workspace.create_note(&entry.id, "My note").unwrap();
        let ContentItem::Note { note_id, .. } = &entry.contents[0];
        let before = workspace.read_note(&entry.id, note_id).unwrap();
        assert!(workspace
            .write_note_image(&entry.id, note_id, b"<html>Denied</html>")
            .is_err());
        assert!(workspace
            .write_note_image(&entry.id, note_id, b"\x89PNG\r\n\x1a\n")
            .is_err());
        assert!(!workspace
            .layout()
            .entry_note_assets_dir(&entry.id, note_id)
            .exists());
        let mut png = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(3, 2)
            .write_to(&mut png, ImageFormat::Png)
            .unwrap();
        let saved = workspace
            .write_note_image(&entry.id, note_id, png.get_ref())
            .unwrap();
        assert!(saved.0.starts_with(&format!("./{note_id}.assets/")));
        assert_eq!(std::fs::read(&saved.1).unwrap(), *png.get_ref());
        assert_eq!(
            workspace
                .write_note_image(&entry.id, note_id, png.get_ref())
                .unwrap(),
            saved
        );
        assert_eq!(
            workspace.read_note(&entry.id, note_id).unwrap().revision,
            before.revision
        );
        workspace.delete_note(&entry.id, note_id).unwrap();
        assert!(workspace
            .write_note_image(&entry.id, note_id, png.get_ref())
            .is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
