//! Putting bytes in a file so that a failure at any point leaves the old file as it was.
//!
//! The new content is written and flushed somewhere else first, and only then takes the old file's
//! place. On macOS the swap is `NSFileManager`'s, the system's safe-save call, which keeps the old
//! file's mode, Finder tags, extended attributes and creation date.
//!
//! The revision is checked immediately before the swap, but this is not a compare-and-swap: another
//! program can still change the file in the instant between the check and the swap, and the swap
//! would overwrite that change. Replacing also gives the file a new inode, so a hard link to the
//! old file keeps the old content.

use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Revision {
    pub size: u64,
    pub modified_ms: u64,
}

pub fn modified_ms(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |elapsed| elapsed.as_millis() as u64)
}

impl Revision {
    pub fn of(metadata: &fs::Metadata) -> Self {
        Revision {
            size: metadata.len(),
            modified_ms: modified_ms(metadata),
        }
    }

    /// From the two halves that travel as text beside a raw body. Neither means nothing was sent.
    pub fn parse(size: Option<&str>, modified_ms: Option<&str>) -> Result<Option<Self>, Failure> {
        match (size, modified_ms) {
            (None, None) => Ok(None),
            (Some(size), Some(modified_ms)) => Ok(Some(Revision {
                size: size.parse().map_err(|_| Failure::Other)?,
                modified_ms: modified_ms.parse().map_err(|_| Failure::Other)?,
            })),
            _ => Err(Failure::Other),
        }
    }
}

/// What the file has to look like for the write to go ahead.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Expected {
    Missing,
    Exactly(Revision),
}

/// Why something didn't happen. These go to the page, so they never carry a path, and the page
/// words them in the user's language.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Failure {
    Changed,
    Missing,
    NotAFile,
    NotAllowed,
    UnsupportedType,
    DiskFull,
    ReadOnlyVolume,
    Other,
    /// A restored file Rust can't name, so it has to go through the Save panel.
    NoGrant,
}

impl From<io::Error> for Failure {
    fn from(error: io::Error) -> Self {
        match error.kind() {
            io::ErrorKind::NotFound => Failure::Missing,
            io::ErrorKind::PermissionDenied => Failure::NotAllowed,
            io::ErrorKind::StorageFull | io::ErrorKind::QuotaExceeded => Failure::DiskFull,
            io::ErrorKind::ReadOnlyFilesystem => Failure::ReadOnlyVolume,
            _ => Failure::Other,
        }
    }
}

enum OnDisk {
    Missing,
    File(Revision),
}

/// What's at this canonical path now. Refuses anything but the regular file a grant was given for:
/// a link at the path or on the way to it can only have appeared since.
fn on_disk(path: &Path) -> Result<OnDisk, Failure> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(OnDisk::Missing),
        Err(error) => return Err(error.into()),
    };
    if !metadata.is_file() || fs::canonicalize(path)? != path {
        return Err(Failure::NotAFile);
    }
    Ok(OnDisk::File(Revision::of(&metadata)))
}

pub fn stat(path: &Path) -> Result<Revision, Failure> {
    match on_disk(path)? {
        OnDisk::File(revision) => Ok(revision),
        OnDisk::Missing => Err(Failure::Missing),
    }
}

fn confirm(path: &Path, expected: Expected) -> Result<(), Failure> {
    match (on_disk(path)?, expected) {
        (OnDisk::Missing, Expected::Missing) => Ok(()),
        (OnDisk::File(found), Expected::Exactly(wanted)) if found == wanted => Ok(()),
        (OnDisk::Missing, Expected::Exactly(_)) => Err(Failure::Missing),
        _ => Err(Failure::Changed),
    }
}

/// A private directory that holds the new content until the swap, and is always removed.
struct Staging(PathBuf);

impl Staging {
    fn new(target: &Path) -> io::Result<Self> {
        platform::staging_directory(target).map(Staging)
    }

    /// Readable by this user only until it takes the old file's place and metadata.
    fn write(&self, name: &std::ffi::OsStr, bytes: &[u8]) -> io::Result<PathBuf> {
        let path = self.0.join(name);
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        Ok(path)
    }
}

impl Drop for Staging {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// So that the rename itself survives a power cut. Not every volume can do this, and the file is
/// already in place either way.
fn sync_parent(path: &Path) {
    if let Some(parent) = path.parent() {
        let _ = File::open(parent).and_then(|directory| directory.sync_all());
    }
}

/// A new file has no metadata to keep, and nothing to lose if it's left half written. `create_new`
/// refuses a file or link that has appeared since the panel closed, without following it.
fn write_new(path: &Path, bytes: &[u8]) -> Result<Revision, Failure> {
    let parent = path.parent().ok_or(Failure::Other)?;
    if fs::canonicalize(parent)? != parent {
        return Err(Failure::NotAFile);
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| match error.kind() {
            io::ErrorKind::AlreadyExists => Failure::Changed,
            _ => error.into(),
        })?;
    let written = file.write_all(bytes).and_then(|()| file.sync_all());
    if let Err(error) = written {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(error.into());
    }
    let revision = Revision::of(&file.metadata().map_err(Failure::from)?);
    sync_parent(path);
    Ok(revision)
}

/// `while_staged` and `replace` are seams for the tests, for what can only go wrong at that moment.
fn write_with(
    path: &Path,
    bytes: &[u8],
    expected: Expected,
    while_staged: impl FnOnce(),
    replace: impl FnOnce(&Path, &Path) -> io::Result<()>,
) -> Result<Revision, Failure> {
    confirm(path, expected)?;
    if expected == Expected::Missing {
        return write_new(path, bytes);
    }

    // A rename never looks at the old file's own permissions, so ask the file itself. This is what
    // stops a read-only or Finder-locked file from being replaced.
    OpenOptions::new()
        .write(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)?;

    let staging = Staging::new(path)?;
    let name = path.file_name().ok_or(Failure::Other)?;
    let staged = staging.write(name, bytes)?;
    while_staged();
    // Writing a large file takes long enough for this to have changed.
    confirm(path, expected)?;
    replace(path, &staged)?;
    sync_parent(path);
    stat(path)
}

pub fn write(path: &Path, bytes: &[u8], expected: Expected) -> Result<Revision, Failure> {
    write_with(path, bytes, expected, || {}, platform::replace)
}

/// macOS only ships today. Elsewhere there's just enough to run the shared tests on the server.
#[cfg(not(target_os = "macos"))]
mod platform {
    use std::fs;
    use std::io;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU32, Ordering};

    pub fn staging_directory(target: &Path) -> io::Result<PathBuf> {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let unique = format!(
            ".full-saving-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        );
        let path = target
            .parent()
            .ok_or(io::ErrorKind::InvalidInput)?
            .join(unique);
        fs::create_dir(&path)?;
        Ok(path)
    }

    pub fn replace(target: &Path, new: &Path) -> io::Result<()> {
        fs::set_permissions(new, fs::metadata(target)?.permissions())?;
        fs::rename(new, target)
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use objc2::rc::{autoreleasepool, Retained};
    use objc2_foundation::{
        NSError, NSFileManager, NSFileManagerItemReplacementOptions, NSPOSIXErrorDomain,
        NSSearchPathDirectory, NSSearchPathDomainMask, NSString, NSURL,
    };
    use std::io;
    use std::path::{Path, PathBuf};

    fn file_url(path: &Path) -> io::Result<Retained<NSURL>> {
        let path = path.to_str().ok_or(io::ErrorKind::InvalidInput)?;
        Ok(NSURL::fileURLWithPath(&NSString::from_str(path)))
    }

    /// These are NSCocoaErrorDomain's file codes, from FoundationErrors.h.
    fn to_io_error(error: &NSError) -> io::Error {
        let code = error.code();
        // SAFETY: Foundation always defines this constant.
        if error
            .domain()
            .isEqualToString(unsafe { NSPOSIXErrorDomain })
        {
            return io::Error::from_raw_os_error(code as i32);
        }
        match code {
            4 | 260 => io::ErrorKind::NotFound,
            257 | 513 => io::ErrorKind::PermissionDenied,
            640 => io::ErrorKind::StorageFull,
            642 => io::ErrorKind::ReadOnlyFilesystem,
            _ => io::ErrorKind::Other,
        }
        .into()
    }

    /// A fresh directory the system picks on the same volume as the target, which is what makes the
    /// swap possible. It's outside the user's folder, so sync clients don't pick up the staged file.
    pub fn staging_directory(target: &Path) -> io::Result<PathBuf> {
        autoreleasepool(|_| {
            let url = NSFileManager::defaultManager()
                .URLForDirectory_inDomain_appropriateForURL_create_error(
                    NSSearchPathDirectory::ItemReplacementDirectory,
                    NSSearchPathDomainMask::UserDomainMask,
                    Some(&*file_url(target)?),
                    true,
                )
                .map_err(|error| to_io_error(&error))?;
            let path = url.path().ok_or(io::ErrorKind::InvalidData)?;
            Ok(PathBuf::from(path.to_string()))
        })
    }

    /// With no options the result keeps the old file's metadata, which is the point of this call.
    pub fn replace(target: &Path, new: &Path) -> io::Result<()> {
        autoreleasepool(|_| {
            NSFileManager::defaultManager()
                .replaceItemAtURL_withItemAtURL_backupItemName_options_resultingItemURL_error(
                    &*file_url(target)?,
                    &*file_url(new)?,
                    None,
                    NSFileManagerItemReplacementOptions::empty(),
                    None,
                )
                .map_err(|error| to_io_error(&error))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, MetadataExt, PermissionsExt};
    use std::process::Command;
    use std::sync::atomic::{AtomicU32, Ordering};

    struct Dir(PathBuf);

    impl Dir {
        fn new() -> Self {
            static NEXT: AtomicU32 = AtomicU32::new(0);
            let unique = format!(
                "full-save-{}-{}",
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

        /// Nothing but these names: a failed save must not leave anything behind.
        fn assert_holds_only(&self, names: &[&str]) {
            let mut found: Vec<String> = fs::read_dir(&self.0)
                .unwrap()
                .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
                .collect();
            found.sort();
            assert_eq!(found, names);
        }
    }

    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = fs::set_permissions(&self.0, fs::Permissions::from_mode(0o755));
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn current(path: &Path) -> Expected {
        Expected::Exactly(stat(path).unwrap())
    }

    fn mode(path: &Path) -> u32 {
        fs::metadata(path).unwrap().mode() & 0o7777
    }

    fn set_mode(path: &Path, mode: u32) {
        fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
    }

    fn other(_: &Path, _: &Path) -> io::Result<()> {
        panic!("replaced a file it should have refused to");
    }

    #[test]
    fn saving_puts_exactly_these_bytes_in_place() {
        let dir = Dir::new();
        let path = dir.file("a.csv", b"old");
        let bytes = [0xff, 0xfe, 0x00, b'\r', b'\n', 0x80];
        let revision = write(&path, &bytes, current(&path)).unwrap();
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(revision, stat(&path).unwrap());
        assert_eq!(revision.size, 6);
        dir.assert_holds_only(&["a.csv"]);
    }

    #[test]
    fn its_own_save_is_not_a_change() {
        let dir = Dir::new();
        let path = dir.file("a.md", b"one");
        let first = write(&path, b"two", current(&path)).unwrap();
        write(&path, b"three", Expected::Exactly(first)).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"three");
    }

    #[test]
    fn an_empty_file_can_be_saved() {
        let dir = Dir::new();
        let path = dir.file("a.txt", b"not empty");
        assert_eq!(write(&path, b"", current(&path)).unwrap().size, 0);
        assert_eq!(fs::read(&path).unwrap(), b"");
    }

    #[test]
    fn a_large_file_arrives_whole() {
        let dir = Dir::new();
        let path = dir.file("big.csv", b"old");
        let bytes = vec![b'x'; 8 * 1024 * 1024];
        assert_eq!(
            write(&path, &bytes, current(&path)).unwrap().size,
            bytes.len() as u64
        );
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }

    #[test]
    fn the_permissions_of_the_old_file_are_kept() {
        let dir = Dir::new();
        for wanted in [0o644, 0o640, 0o600, 0o664, 0o666] {
            let path = dir.file("a.md", b"old");
            set_mode(&path, wanted);
            write(&path, b"new", current(&path)).unwrap();
            assert_eq!(mode(&path), wanted, "{wanted:o}");
        }
    }

    #[test]
    fn the_modification_time_is_the_new_one() {
        let dir = Dir::new();
        let path = dir.file("a.md", b"old");
        assert!(Command::new("touch")
            .args(["-t", "200001010000"])
            .arg(&path)
            .status()
            .unwrap()
            .success());
        let old = modified_ms(&fs::metadata(&path).unwrap());
        let revision = write(&path, b"new", current(&path)).unwrap();
        assert!(revision.modified_ms > old);
    }

    #[test]
    fn a_change_in_size_is_noticed() {
        let dir = Dir::new();
        let path = dir.file("a.md", b"old");
        let expected = current(&path);
        fs::write(&path, b"longer, by someone else").unwrap();
        assert_eq!(write(&path, b"mine", expected), Err(Failure::Changed));
        assert_eq!(fs::read(&path).unwrap(), b"longer, by someone else");
        dir.assert_holds_only(&["a.md"]);
    }

    #[test]
    fn a_change_of_the_same_size_is_noticed() {
        let dir = Dir::new();
        let path = dir.file("a.md", b"old");
        let Expected::Exactly(seen) = current(&path) else {
            unreachable!()
        };
        let expected = Expected::Exactly(Revision {
            modified_ms: seen.modified_ms - 1,
            ..seen
        });
        assert_eq!(write(&path, b"new", expected), Err(Failure::Changed));
        assert_eq!(fs::read(&path).unwrap(), b"old");
    }

    #[test]
    fn a_change_while_the_new_content_is_being_written_is_noticed() {
        let dir = Dir::new();
        let path = dir.file("a.md", b"old");
        let expected = current(&path);
        let someone_else = || fs::write(&path, b"longer, by someone else").unwrap();
        assert_eq!(
            write_with(&path, b"mine", expected, someone_else, other),
            Err(Failure::Changed)
        );
        assert_eq!(fs::read(&path).unwrap(), b"longer, by someone else");
        dir.assert_holds_only(&["a.md"]);
    }

    #[test]
    fn a_failed_swap_leaves_the_old_file_and_nothing_else() {
        let dir = Dir::new();
        let path = dir.file("a.md", b"old");
        set_mode(&path, 0o640);
        for (kind, failure) in [
            (io::ErrorKind::StorageFull, Failure::DiskFull),
            (io::ErrorKind::PermissionDenied, Failure::NotAllowed),
            (io::ErrorKind::ReadOnlyFilesystem, Failure::ReadOnlyVolume),
            (io::ErrorKind::Other, Failure::Other),
        ] {
            assert_eq!(
                write_with(
                    &path,
                    b"new",
                    current(&path),
                    || {},
                    |_, _| Err(kind.into())
                ),
                Err(failure)
            );
            assert_eq!(fs::read(&path).unwrap(), b"old");
            assert_eq!(mode(&path), 0o640);
            dir.assert_holds_only(&["a.md"]);
        }
    }

    #[test]
    fn a_deleted_file_is_not_brought_back() {
        let dir = Dir::new();
        let path = dir.file("a.md", b"old");
        let expected = current(&path);
        fs::remove_file(&path).unwrap();
        assert_eq!(write(&path, b"new", expected), Err(Failure::Missing));
        assert_eq!(stat(&path), Err(Failure::Missing));
        dir.assert_holds_only(&[]);
    }

    #[test]
    fn a_read_only_file_is_refused_although_a_rename_would_work() {
        let dir = Dir::new();
        let path = dir.file("a.md", b"old");
        set_mode(&path, 0o444);
        assert_eq!(
            write(&path, b"new", current(&path)),
            Err(Failure::NotAllowed)
        );
        assert_eq!(fs::read(&path).unwrap(), b"old");
        assert_eq!(mode(&path), 0o444);
        dir.assert_holds_only(&["a.md"]);
    }

    #[test]
    fn a_file_in_a_read_only_folder_is_refused_and_left_alone() {
        let dir = Dir::new();
        let path = dir.file("a.md", b"old");
        let expected = current(&path);
        set_mode(&dir.0, 0o555);
        assert!(write(&path, b"new", expected).is_err());
        set_mode(&dir.0, 0o755);
        assert_eq!(fs::read(&path).unwrap(), b"old");
        dir.assert_holds_only(&["a.md"]);
    }

    #[test]
    fn a_link_swapped_in_is_refused_and_its_target_left_alone() {
        let dir = Dir::new();
        let path = dir.file("a.md", b"old");
        let secret = dir.file("secret.md", b"private");
        let expected = current(&path);
        fs::remove_file(&path).unwrap();
        symlink(&secret, &path).unwrap();
        assert_eq!(write(&path, b"new", expected), Err(Failure::NotAFile));
        assert_eq!(fs::read(&secret).unwrap(), b"private");
        assert!(fs::symlink_metadata(&path)
            .unwrap()
            .file_type()
            .is_symlink());
    }

    #[test]
    fn a_link_swapped_in_for_a_parent_folder_is_refused() {
        let dir = Dir::new();
        let folder = dir.0.join("folder");
        fs::create_dir(&folder).unwrap();
        let path = folder.join("a.md");
        fs::write(&path, b"old").unwrap();
        let expected = current(&path);
        let elsewhere = dir.0.join("elsewhere");
        fs::rename(&folder, &elsewhere).unwrap();
        symlink(&elsewhere, &folder).unwrap();
        assert_eq!(write(&path, b"new", expected), Err(Failure::NotAFile));
        assert_eq!(fs::read(elsewhere.join("a.md")).unwrap(), b"old");
    }

    #[test]
    fn a_folder_swapped_in_is_refused() {
        let dir = Dir::new();
        let path = dir.file("a.md", b"old");
        let expected = current(&path);
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        assert_eq!(write(&path, b"new", expected), Err(Failure::NotAFile));
        assert!(path.is_dir());
    }

    #[test]
    fn a_pipe_swapped_in_is_refused_without_waiting() {
        let dir = Dir::new();
        let path = dir.file("a.md", b"old");
        let expected = current(&path);
        fs::remove_file(&path).unwrap();
        assert!(Command::new("mkfifo")
            .arg(&path)
            .status()
            .unwrap()
            .success());
        assert_eq!(write(&path, b"new", expected), Err(Failure::NotAFile));
        assert_eq!(stat(&path), Err(Failure::NotAFile));
    }

    #[test]
    fn a_new_file_is_created_with_the_usual_permissions() {
        let dir = Dir::new();
        let path = dir.0.join("new.md");
        let control = dir.file("control", b"");
        let revision = write(&path, b"hello", Expected::Missing).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"hello");
        assert_eq!(revision, stat(&path).unwrap());
        assert_eq!(mode(&path), mode(&control));
    }

    #[test]
    fn a_new_file_never_lands_on_one_that_has_appeared() {
        let dir = Dir::new();
        let path = dir.file("new.md", b"theirs");
        assert_eq!(
            write(&path, b"mine", Expected::Missing),
            Err(Failure::Changed)
        );
        assert_eq!(fs::read(&path).unwrap(), b"theirs");
    }

    #[test]
    fn a_new_file_never_follows_a_link_that_has_appeared() {
        let dir = Dir::new();
        let secret = dir.file("secret.md", b"private");
        let path = dir.0.join("new.md");
        symlink(&secret, &path).unwrap();
        assert!(write(&path, b"mine", Expected::Missing).is_err());
        assert_eq!(fs::read(&secret).unwrap(), b"private");
    }

    #[test]
    fn a_new_file_in_a_folder_that_is_gone_is_an_error() {
        let dir = Dir::new();
        let path = dir.0.join("gone").join("new.md");
        assert_eq!(
            write(&path, b"mine", Expected::Missing),
            Err(Failure::Missing)
        );
    }

    #[test]
    fn a_new_file_in_a_read_only_folder_is_refused() {
        let dir = Dir::new();
        set_mode(&dir.0, 0o555);
        assert_eq!(
            write(&dir.0.join("new.md"), b"mine", Expected::Missing),
            Err(Failure::NotAllowed)
        );
        set_mode(&dir.0, 0o755);
        dir.assert_holds_only(&[]);
    }

    #[test]
    fn a_revision_is_read_from_both_halves_or_neither() {
        assert_eq!(Revision::parse(None, None), Ok(None));
        assert_eq!(
            Revision::parse(Some("3"), Some("9007199254740991")),
            Ok(Some(Revision {
                size: 3,
                modified_ms: 9_007_199_254_740_991
            }))
        );
        for (size, modified) in [
            (Some("3"), None),
            (None, Some("3")),
            (Some("x"), Some("3")),
            (Some("3"), Some("-1")),
        ] {
            assert_eq!(Revision::parse(size, modified), Err(Failure::Other));
        }
    }

    #[test]
    fn the_page_gets_the_names_it_expects() {
        let as_json = |failure| serde_json::to_value(failure).unwrap();
        assert_eq!(as_json(Failure::NotAFile), "notAFile");
        assert_eq!(as_json(Failure::DiskFull), "diskFull");
        assert_eq!(as_json(Failure::ReadOnlyVolume), "readOnlyVolume");
        assert_eq!(as_json(Failure::UnsupportedType), "unsupportedType");
        let revision = serde_json::to_value(Revision {
            size: 1,
            modified_ms: 2,
        })
        .unwrap();
        assert_eq!(revision["modifiedMs"], 2);
    }

    /// Only a real Mac can answer these, so they run in CI on the macOS runner.
    #[cfg(target_os = "macos")]
    mod on_macos {
        use super::*;
        use std::time::SystemTime;

        fn run(program: &str, args: &[&str], path: &Path) {
            let status = Command::new(program).args(args).arg(path).status().unwrap();
            assert!(status.success(), "{program} {args:?}");
        }

        fn xattr(path: &Path, name: &str) -> Vec<u8> {
            let output = Command::new("xattr")
                .args(["-px", name])
                .arg(path)
                .output()
                .unwrap();
            assert!(output.status.success(), "{name} is gone");
            output.stdout
        }

        fn created(path: &Path) -> SystemTime {
            fs::metadata(path).unwrap().created().unwrap()
        }

        #[test]
        fn finder_tags_and_extended_attributes_survive() {
            let dir = Dir::new();
            let path = dir.file("a.md", b"old");
            for name in [
                "com.apple.metadata:_kMDItemUserTags",
                "com.apple.metadata:kMDItemWhereFroms",
                "com.example.full-test",
            ] {
                run("xattr", &["-w", name, "kept"], &path);
            }
            run(
                "xattr",
                &[
                    "-wx",
                    "com.apple.FinderInfo",
                    "0000000000000000000C00000000000000000000000000000000000000000000",
                ],
                &path,
            );
            let names = [
                "com.apple.metadata:_kMDItemUserTags",
                "com.apple.metadata:kMDItemWhereFroms",
                "com.example.full-test",
                "com.apple.FinderInfo",
            ];
            let before: Vec<_> = names.iter().map(|name| xattr(&path, name)).collect();
            write(&path, b"new", current(&path)).unwrap();
            assert_eq!(fs::read(&path).unwrap(), b"new");
            let after: Vec<_> = names.iter().map(|name| xattr(&path, name)).collect();
            assert_eq!(before, after);
        }

        #[test]
        fn the_creation_date_survives() {
            let dir = Dir::new();
            let path = dir.file("a.md", b"old");
            // Setting a modification time before the creation date moves the creation date too.
            run("touch", &["-t", "200001010000"], &path);
            let before = created(&path);
            assert!(before < SystemTime::now() - std::time::Duration::from_secs(86_400));
            write(&path, b"new", current(&path)).unwrap();
            assert_eq!(created(&path), before);
        }

        #[test]
        fn a_save_after_a_save_keeps_everything_too() {
            let dir = Dir::new();
            let path = dir.file("a.md", b"old");
            set_mode(&path, 0o640);
            run("xattr", &["-w", "com.example.full-test", "kept"], &path);
            run("touch", &["-t", "200001010000"], &path);
            let before = created(&path);
            let first = write(&path, b"one", current(&path)).unwrap();
            write(&path, b"two", Expected::Exactly(first)).unwrap();
            assert_eq!(mode(&path), 0o640);
            assert_eq!(created(&path), before);
            assert!(!xattr(&path, "com.example.full-test").is_empty());
        }

        #[test]
        fn a_finder_locked_file_is_refused() {
            let dir = Dir::new();
            let path = dir.file("a.md", b"old");
            run("chflags", &["uchg"], &path);
            let result = write(&path, b"new", current(&path));
            let content = fs::read(&path).unwrap();
            run("chflags", &["nouchg"], &path);
            assert_eq!(result, Err(Failure::NotAllowed));
            assert_eq!(content, b"old");
        }

        #[test]
        fn nothing_is_left_beside_the_file() {
            let dir = Dir::new();
            let path = dir.file("a.md", b"old");
            write(&path, b"new", current(&path)).unwrap();
            dir.assert_holds_only(&["a.md"]);
        }
    }
}
