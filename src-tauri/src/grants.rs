//! Which files the webview may read.
//!
//! Which files the webview may read and write.
//!
//! A path gets in only through `offer` and `offer_save_target`, which are called with paths from
//! native dialogs and native events. The webview gets back an opaque grant for each file, and no
//! command takes a path, so a script in the page can only ever reach files the user offered. Grants
//! last until the app quits. They're plain counters because guessing one gains nothing: every grant
//! that exists is for a file the page was already told about.

use crate::save::{self, Expected, Failure, Revision};
use serde::Serialize;
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{self, Read};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// The same types as SUPPORTED_EXTENSIONS in src/core/fileTypes.ts. file-type-cases.txt holds both
/// to the same cases.
pub const EXTENSIONS: [&str; 4] = ["csv", "md", "markdown", "txt"];

fn is_supported(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower
        .rsplit_once('.')
        .is_some_and(|(_, extension)| EXTENSIONS.contains(&extension))
}

/// What the Save panel starts with. The page only suggests a name, so anything like a folder in it
/// goes. The panel adds the first extension to a name typed without one, so that's the file's own.
pub fn save_panel_defaults(suggested: &str) -> (String, Vec<&'static str>) {
    let name = suggested.rsplit('/').next().unwrap_or_default().to_string();
    let lower = name.to_lowercase();
    let mut extensions = EXTENSIONS.to_vec();
    extensions.sort_by_key(|extension| !lower.ends_with(&format!(".{extension}")));
    (name, extensions)
}

/// What the webview learns about a file it was offered. With no `access` it can't be read, and
/// the name is only there to tell the user so.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Offered {
    pub name: String,
    pub access: Option<Access>,
}

/// `path` is the canonical path, which goes out for the recovery record and to recognise a file
/// that's already open. Nothing ever accepts it back: `grant` is what opens the file.
///
/// The size and time are read before the bytes are. If the file changes in between, a later save
/// sees a conflict that isn't one, which is the safe way round.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Access {
    pub grant: String,
    pub path: String,
    pub size: u64,
    pub modified_ms: u64,
}

/// The file the Save panel chose. It may not exist yet.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SaveTarget {
    pub name: String,
    pub grant: String,
    pub path: String,
}

#[derive(Default)]
struct Registry {
    paths: HashMap<String, PathBuf>,
    grants: HashMap<PathBuf, String>,
    issued: u64,
    /// What the Save panel found at the path, which is what the user agreed to replace.
    seen_by_panel: HashMap<String, Expected>,
}

impl Registry {
    fn grant_for(&mut self, path: &Path) -> String {
        if let Some(grant) = self.grants.get(path) {
            return grant.clone();
        }
        self.issued += 1;
        let grant = format!("grant-{}", self.issued);
        self.grants.insert(path.to_path_buf(), grant.clone());
        self.paths.insert(grant.clone(), path.to_path_buf());
        grant
    }
}

#[derive(Default)]
pub struct Grants {
    registry: Mutex<Registry>,
    /// One save at a time, so that two can't both pass the revision check.
    saving: Mutex<()>,
}

fn file_name(path: &Path) -> String {
    path.file_name().map_or_else(
        || path.to_string_lossy().into_owned(),
        |name| name.to_string_lossy().into_owned(),
    )
}

/// Where a path from the Save panel really leads, and what's there now. Saving over a link saves to
/// the file it points at, as it does for a file opened through a link.
fn resolve_save_target(path: &Path) -> Result<(PathBuf, Expected), Failure> {
    match fs::symlink_metadata(path) {
        Ok(_) => {
            let canonical = fs::canonicalize(path)?;
            let metadata = fs::metadata(&canonical)?;
            if !metadata.is_file() {
                return Err(Failure::NotAFile);
            }
            Ok((canonical, Expected::Exactly(Revision::of(&metadata))))
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let parent = path.parent().ok_or(Failure::Other)?;
            let name = path.file_name().ok_or(Failure::Other)?;
            Ok((fs::canonicalize(parent)?.join(name), Expected::Missing))
        }
        Err(error) => Err(error.into()),
    }
}

impl Grants {
    /// Call this only with paths the system gave the app because of something the user did.
    pub fn offer(&self, paths: &[PathBuf]) -> Vec<Offered> {
        paths.iter().map(|path| self.offer_one(path)).collect()
    }

    fn offer_one(&self, path: &Path) -> Offered {
        let refused = |name| Offered { name, access: None };
        // The canonical path decides, so that a link named notes.md can't stand in for another
        // type of file, and a file opened through a link is the same file as its target.
        let Ok(canonical) = fs::canonicalize(path) else {
            return refused(file_name(path));
        };
        let name = file_name(&canonical);
        if !is_supported(&name) {
            return refused(name);
        }
        let metadata = match fs::metadata(&canonical) {
            Ok(metadata) if metadata.is_file() => metadata,
            _ => return refused(name),
        };
        let grant = self.registry.lock().unwrap().grant_for(&canonical);
        Offered {
            name,
            access: Some(Access {
                grant,
                path: canonical.to_string_lossy().into_owned(),
                size: metadata.len(),
                modified_ms: save::modified_ms(&metadata),
            }),
        }
    }

    /// Call this only with a path from the Save panel. The user has agreed to what's there.
    pub fn offer_save_target(&self, path: &Path) -> Result<SaveTarget, Failure> {
        let (canonical, found) = resolve_save_target(path)?;
        let name = file_name(&canonical);
        if !is_supported(&name) {
            return Err(Failure::UnsupportedType);
        }
        let mut registry = self.registry.lock().unwrap();
        let grant = registry.grant_for(&canonical);
        registry.seen_by_panel.insert(grant.clone(), found);
        Ok(SaveTarget {
            name,
            grant,
            path: canonical.to_string_lossy().into_owned(),
        })
    }

    fn path_of(&self, grant: &str) -> Option<PathBuf> {
        self.registry.lock().unwrap().paths.get(grant).cloned()
    }

    pub fn stat(&self, grant: &str) -> Result<Revision, Failure> {
        save::stat(&self.path_of(grant).ok_or(Failure::NotAllowed)?)
    }

    /// Replaces the file if it's still as expected. Without an expected revision, this has to be
    /// the first write since the Save panel, and it's held to what the panel found.
    pub fn write(
        &self,
        grant: &str,
        bytes: &[u8],
        expected: Option<Revision>,
    ) -> Result<Revision, Failure> {
        let _one_at_a_time = self.saving.lock().unwrap();
        let path = self.path_of(grant).ok_or(Failure::NotAllowed)?;
        let seen = self.registry.lock().unwrap().seen_by_panel.remove(grant);
        let expected = expected
            .map(Expected::Exactly)
            .or(seen)
            .ok_or(Failure::NotAllowed)?;
        save::write(&path, bytes, expected)
    }

    /// The file's bytes, if this grant exists and the path still holds a regular file.
    pub fn read(&self, grant: &str) -> io::Result<Vec<u8>> {
        let path = self
            .path_of(grant)
            .ok_or_else(|| io::Error::from(io::ErrorKind::PermissionDenied))?;
        // Refuses a link that has taken the file's place since the grant, and won't wait on a pipe.
        let mut file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(path)?;
        let metadata = file.metadata()?;
        if !metadata.is_file() {
            return Err(io::Error::from(io::ErrorKind::InvalidInput));
        }
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        file.read_to_end(&mut bytes)?;
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;
    use std::process::Command;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// A real directory that's removed afterwards. Canonical, because the temp directory is often
    /// reached through a link.
    struct Dir(PathBuf);

    impl Dir {
        fn new() -> Self {
            static NEXT: AtomicU32 = AtomicU32::new(0);
            let unique = format!(
                "full-grants-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            );
            let path = std::env::temp_dir().join(unique);
            fs::create_dir(&path).unwrap();
            Dir(fs::canonicalize(path).unwrap())
        }

        fn file(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let path = self.0.join(name);
            fs::write(&path, bytes).unwrap();
            path
        }
    }

    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn offer(grants: &Grants, path: &Path) -> Offered {
        grants.offer(&[path.to_path_buf()]).remove(0)
    }

    fn grant_of(offered: &Offered) -> String {
        offered.access.as_ref().unwrap().grant.clone()
    }

    fn assert_refused(grants: &Grants, grant: &str) {
        assert_eq!(
            grants.read(grant).unwrap_err().kind(),
            io::ErrorKind::PermissionDenied,
            "{grant:?}"
        );
    }

    #[test]
    fn a_path_the_user_never_offered_cannot_be_read() {
        let dir = Dir::new();
        let secret = dir.file("secret.md", b"private");
        let grants = Grants::default();
        assert_refused(&grants, secret.to_str().unwrap());
        assert_refused(&grants, &format!("file://{}", secret.display()));
        assert_refused(&grants, "grant-1");
        assert_refused(&grants, "");
    }

    #[test]
    fn offering_one_file_opens_nothing_else() {
        let dir = Dir::new();
        let path = dir.file("offered.md", b"yes");
        let sibling = dir.file("sibling.md", b"no");
        let grants = Grants::default();
        let offered = offer(&grants, &path);
        assert_eq!(grants.read(&grant_of(&offered)).unwrap(), b"yes");
        assert_refused(&grants, sibling.to_str().unwrap());
        assert_refused(&grants, "grant-2");
        // Knowing a file's path doesn't open it, even a file that has a grant.
        assert_refused(&grants, &offered.access.unwrap().path);
    }

    #[test]
    fn the_bytes_come_back_exactly_with_the_details_of_the_file() {
        let dir = Dir::new();
        let bytes = [0xff, 0xfe, 0x00, b'\r', b'\n', 0x80];
        let path = dir.file("binary.txt", &bytes);
        let grants = Grants::default();
        let offered = offer(&grants, &path);
        assert_eq!(offered.name, "binary.txt");
        let access = offered.access.unwrap();
        assert_eq!(access.path, path.to_str().unwrap());
        assert_eq!(access.size, 6);
        assert_eq!(
            access.modified_ms,
            save::modified_ms(&fs::metadata(&path).unwrap())
        );
        assert!(access.modified_ms > 0);
        assert_eq!(grants.read(&access.grant).unwrap(), bytes);
    }

    #[test]
    fn an_unsupported_type_gets_no_grant() {
        let dir = Dir::new();
        let grants = Grants::default();
        for name in ["photo.png", "notes", "md", "notes.md.exe"] {
            let offered = offer(&grants, &dir.file(name, b"x"));
            assert_eq!(offered.name, name);
            assert_eq!(offered.access, None, "{name}");
        }
        assert_refused(&grants, "grant-1");
    }

    #[test]
    fn file_types_follow_the_shared_cases() {
        let cases = include_str!("file-type-cases.txt");
        let mut checked = 0;
        for line in cases
            .lines()
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
        {
            let (expected, name) = line.split_once('\t').unwrap();
            assert_eq!(is_supported(name), expected == "supported", "{name:?}");
            checked += 1;
        }
        assert!(checked > 10);
    }

    #[test]
    fn only_regular_files_get_a_grant() {
        let dir = Dir::new();
        let grants = Grants::default();

        let folder = dir.0.join("folder.md");
        fs::create_dir(&folder).unwrap();
        assert_eq!(offer(&grants, &folder).access, None);

        let pipe = dir.0.join("pipe.md");
        assert!(Command::new("mkfifo")
            .arg(&pipe)
            .status()
            .unwrap()
            .success());
        assert_eq!(offer(&grants, &pipe).access, None);

        let missing = offer(&grants, &dir.0.join("missing.md"));
        assert_eq!(missing.name, "missing.md");
        assert_eq!(missing.access, None);
    }

    #[test]
    fn the_same_file_keeps_its_grant_however_it_was_reached() {
        let dir = Dir::new();
        let path = dir.file("a.md", b"x");
        let link = dir.0.join("link.md");
        symlink(&path, &link).unwrap();
        let grants = Grants::default();
        let direct = offer(&grants, &path);
        assert_eq!(offer(&grants, &path), direct);
        assert_eq!(offer(&grants, &dir.0.join(".").join("a.md")), direct);
        assert_eq!(offer(&grants, &link), direct);
    }

    #[test]
    fn a_link_is_judged_by_what_it_points_at() {
        let dir = Dir::new();
        let target = dir.file("id_rsa", b"private");
        let link = dir.0.join("notes.md");
        symlink(&target, &link).unwrap();
        let grants = Grants::default();
        let offered = offer(&grants, &link);
        assert_eq!(offered.name, "id_rsa");
        assert_eq!(offered.access, None);
    }

    #[test]
    fn a_link_swapped_in_after_the_grant_is_refused() {
        let dir = Dir::new();
        let path = dir.file("a.md", b"x");
        let secret = dir.file("secret.txt", b"private");
        let grants = Grants::default();
        let grant = grant_of(&offer(&grants, &path));
        fs::remove_file(&path).unwrap();
        symlink(&secret, &path).unwrap();
        assert!(grants.read(&grant).is_err());
    }

    #[test]
    fn a_pipe_swapped_in_after_the_grant_is_refused_without_waiting() {
        let dir = Dir::new();
        let path = dir.file("a.md", b"x");
        let grants = Grants::default();
        let grant = grant_of(&offer(&grants, &path));
        fs::remove_file(&path).unwrap();
        assert!(Command::new("mkfifo")
            .arg(&path)
            .status()
            .unwrap()
            .success());
        assert_eq!(
            grants.read(&grant).unwrap_err().kind(),
            io::ErrorKind::InvalidInput
        );
    }

    #[test]
    fn a_grant_follows_a_file_replaced_by_another_app() {
        let dir = Dir::new();
        let path = dir.file("a.md", b"old");
        let grants = Grants::default();
        let grant = grant_of(&offer(&grants, &path));
        let replacement = dir.file("a.md.tmp", b"new");
        fs::rename(&replacement, &path).unwrap();
        assert_eq!(grants.read(&grant).unwrap(), b"new");
    }

    #[test]
    fn a_deleted_file_reads_as_an_error() {
        let dir = Dir::new();
        let path = dir.file("a.md", b"x");
        let grants = Grants::default();
        let grant = grant_of(&offer(&grants, &path));
        fs::remove_file(&path).unwrap();
        assert_eq!(
            grants.read(&grant).unwrap_err().kind(),
            io::ErrorKind::NotFound
        );
    }

    fn revision_of(path: &Path) -> Revision {
        save::stat(path).unwrap()
    }

    fn target_of(grants: &Grants, path: &Path) -> SaveTarget {
        grants.offer_save_target(path).unwrap()
    }

    #[test]
    fn a_path_the_user_never_offered_cannot_be_written_or_examined() {
        let dir = Dir::new();
        let secret = dir.file("secret.md", b"private");
        let grants = Grants::default();
        let name = secret.to_str().unwrap();
        for grant in [name, "grant-1", ""] {
            assert_eq!(
                grants.write(grant, b"x", Some(revision_of(&secret))),
                Err(Failure::NotAllowed)
            );
            assert_eq!(grants.stat(grant), Err(Failure::NotAllowed));
        }
        assert_eq!(fs::read(&secret).unwrap(), b"private");
    }

    #[test]
    fn writing_one_file_reaches_only_that_file() {
        let dir = Dir::new();
        let path = dir.file("a.md", b"a");
        let sibling = dir.file("b.md", b"b");
        let grants = Grants::default();
        let grant = grant_of(&offer(&grants, &path));
        let written = grants.write(&grant, b"new", Some(revision_of(&path)));
        assert_eq!(written, Ok(revision_of(&path)));
        assert_eq!(grants.stat(&grant), Ok(revision_of(&path)));
        assert_eq!(fs::read(&path).unwrap(), b"new");
        assert_eq!(fs::read(&sibling).unwrap(), b"b");
    }

    #[test]
    fn a_file_opened_through_a_link_saves_to_its_target() {
        let dir = Dir::new();
        let target = dir.file("real.md", b"old");
        let link = dir.0.join("link.md");
        symlink(&target, &link).unwrap();
        let grants = Grants::default();
        let grant = grant_of(&offer(&grants, &link));
        grants
            .write(&grant, b"new", Some(revision_of(&target)))
            .unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new");
        assert!(fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
    }

    #[test]
    fn a_write_needs_something_to_check_against() {
        let dir = Dir::new();
        let path = dir.file("a.md", b"old");
        let grants = Grants::default();
        let grant = grant_of(&offer(&grants, &path));
        assert_eq!(grants.write(&grant, b"new", None), Err(Failure::NotAllowed));
        assert_eq!(fs::read(&path).unwrap(), b"old");
    }

    #[test]
    fn a_file_chosen_in_the_save_panel_can_be_created_once() {
        let dir = Dir::new();
        let path = dir.0.join("new.md");
        let grants = Grants::default();
        let target = target_of(&grants, &path);
        assert_eq!(target.name, "new.md");
        assert_eq!(target.path, path.to_str().unwrap());
        assert_eq!(fs::read(&path).ok(), None);
        grants.write(&target.grant, b"hello", None).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"hello");
        // What the panel saw is used up, so later saves have to say what they expect.
        assert_eq!(
            grants.write(&target.grant, b"again", None),
            Err(Failure::NotAllowed)
        );
        assert_eq!(fs::read(&path).unwrap(), b"hello");
    }

    #[test]
    fn a_grant_from_the_save_panel_reads_what_was_saved() {
        let dir = Dir::new();
        let grants = Grants::default();
        let target = target_of(&grants, &dir.0.join("new.md"));
        grants.write(&target.grant, b"hello", None).unwrap();
        assert_eq!(grants.read(&target.grant).unwrap(), b"hello");
    }

    #[test]
    fn replacing_in_the_save_panel_is_held_to_what_the_panel_found() {
        let dir = Dir::new();
        let path = dir.file("a.md", b"old");
        let grants = Grants::default();
        let target = target_of(&grants, &path);
        fs::write(&path, b"changed after the panel closed").unwrap();
        assert_eq!(
            grants.write(&target.grant, b"mine", None),
            Err(Failure::Changed)
        );
        assert_eq!(fs::read(&path).unwrap(), b"changed after the panel closed");
    }

    #[test]
    fn replacing_in_the_save_panel_goes_ahead_if_nothing_changed() {
        let dir = Dir::new();
        let path = dir.file("a.md", b"old");
        let grants = Grants::default();
        let target = target_of(&grants, &path);
        grants.write(&target.grant, b"mine", None).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"mine");
    }

    #[test]
    fn a_new_file_that_appears_after_the_panel_closed_is_kept() {
        let dir = Dir::new();
        let path = dir.0.join("new.md");
        let grants = Grants::default();
        let target = target_of(&grants, &path);
        fs::write(&path, b"theirs").unwrap();
        assert_eq!(
            grants.write(&target.grant, b"mine", None),
            Err(Failure::Changed)
        );
        assert_eq!(fs::read(&path).unwrap(), b"theirs");
    }

    #[test]
    fn saving_over_a_link_in_the_panel_saves_to_its_target() {
        let dir = Dir::new();
        let target = dir.file("real.md", b"old");
        let link = dir.0.join("link.md");
        symlink(&target, &link).unwrap();
        let grants = Grants::default();
        let chosen = target_of(&grants, &link);
        assert_eq!(chosen.name, "real.md");
        assert_eq!(chosen.path, target.to_str().unwrap());
        grants.write(&chosen.grant, b"new", None).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new");
        assert!(fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
    }

    #[test]
    fn the_save_panel_can_only_grant_files_the_app_can_open() {
        let dir = Dir::new();
        let grants = Grants::default();
        for name in ["notes", "photo.png", "notes.md.exe"] {
            assert_eq!(
                grants.offer_save_target(&dir.0.join(name)),
                Err(Failure::UnsupportedType),
                "{name}"
            );
        }
        // A link is judged by what it points at, here and when opening.
        let key = dir.file("id_rsa", b"private");
        let link = dir.0.join("notes.md");
        symlink(&key, &link).unwrap();
        assert_eq!(
            grants.offer_save_target(&link),
            Err(Failure::UnsupportedType)
        );
        assert_eq!(fs::read(&key).unwrap(), b"private");
    }

    #[test]
    fn the_save_panel_refuses_what_is_not_a_file_or_a_place() {
        let dir = Dir::new();
        let grants = Grants::default();
        let folder = dir.0.join("folder.md");
        fs::create_dir(&folder).unwrap();
        assert_eq!(grants.offer_save_target(&folder), Err(Failure::NotAFile));
        let dangling = dir.0.join("dangling.md");
        symlink(dir.0.join("missing.md"), &dangling).unwrap();
        assert_eq!(grants.offer_save_target(&dangling), Err(Failure::Missing));
        assert_eq!(
            grants.offer_save_target(&dir.0.join("gone").join("a.md")),
            Err(Failure::Missing)
        );
    }

    #[test]
    fn a_file_keeps_one_grant_whether_opened_or_saved_to() {
        let dir = Dir::new();
        let path = dir.file("a.md", b"x");
        let grants = Grants::default();
        let opened = grant_of(&offer(&grants, &path));
        assert_eq!(target_of(&grants, &path).grant, opened);
    }

    #[test]
    fn the_save_panel_starts_from_a_bare_name_and_its_own_type() {
        for (suggested, name, first) in [
            ("notes.md", "notes.md", "md"),
            ("TABLE.CSV", "TABLE.CSV", "csv"),
            ("a.markdown", "a.markdown", "markdown"),
            ("../../.ssh/notes.txt", "notes.txt", "txt"),
            ("/etc/notes.csv", "notes.csv", "csv"),
            ("no-extension", "no-extension", "csv"),
        ] {
            let (found, extensions) = save_panel_defaults(suggested);
            assert_eq!(found, name);
            assert_eq!(extensions[0], first);
            assert_eq!(extensions.len(), 4);
        }
    }

    #[test]
    fn the_webview_gets_camel_case_details() {
        let offered = Offered {
            name: "a.md".into(),
            access: Some(Access {
                grant: "grant-1".into(),
                path: "/a.md".into(),
                size: 1,
                modified_ms: 2,
            }),
        };
        let json = serde_json::to_value(&offered).unwrap();
        assert_eq!(json["access"]["modifiedMs"], 2);
    }
}
