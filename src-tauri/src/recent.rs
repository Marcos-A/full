//! The files opened most recently, for File › Open Recent and the palette.
//!
//! Only native code adds to it, from the same places paths come in: the Open panel, Finder, a drop
//! and Save As. The page sees only the names, and asks for a file by its place in the list, so it
//! never hands native code a path. Like the restorable-files list, it's kept in Application
//! Support, readable only by this user. Opened files also go to macOS's own Recent Items, which
//! the Dock and the Apple menu show.

use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

/// As many as Finder's own Recent Items show by default.
pub const MAX: usize = 10;

#[derive(Default, Serialize, Deserialize)]
struct Stored {
    paths: Vec<PathBuf>,
}

#[derive(Default)]
pub struct Recent {
    store: Option<PathBuf>,
    paths: Vec<PathBuf>,
}

impl Recent {
    pub fn load(store: PathBuf) -> Self {
        let paths = fs::read(&store)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Stored>(&bytes).ok())
            .map(|stored| stored.paths)
            .unwrap_or_default()
            .into_iter()
            .filter(|path| path.is_absolute())
            .take(MAX)
            .collect();
        Recent {
            store: Some(store),
            paths,
        }
    }

    /// Puts these at the top, in the order given, the last one first. True if the list changed.
    pub fn note(&mut self, paths: &[PathBuf]) -> bool {
        let before = self.paths.clone();
        for path in paths.iter().filter(|path| path.is_absolute()) {
            self.paths.retain(|known| known != path);
            self.paths.insert(0, path.clone());
        }
        self.paths.truncate(MAX);
        self.changed(before)
    }

    pub fn get(&self, index: usize) -> Option<&Path> {
        self.paths.get(index).map(PathBuf::as_path)
    }

    /// A file that has gone. True if it was listed.
    pub fn forget(&mut self, path: &Path) -> bool {
        let before = self.paths.clone();
        self.paths.retain(|known| known != path);
        self.changed(before)
    }

    pub fn clear(&mut self) -> bool {
        let before = std::mem::take(&mut self.paths);
        self.changed(before)
    }

    fn changed(&mut self, before: Vec<PathBuf>) -> bool {
        let changed = before != self.paths;
        if changed {
            self.save();
        }
        changed
    }

    fn save(&self) {
        let Some(store) = &self.store else {
            return;
        };
        let stored = Stored {
            paths: self.paths.clone(),
        };
        if write_replacing(store, &stored).is_err() {
            eprintln!("[full] couldn't write the list of recent files");
        }
    }

    /// What the menu and the palette show, in order: each file's name, with its folder added where
    /// two have the same name, as macOS does.
    pub fn labels(&self) -> Vec<String> {
        let name = |path: &Path| {
            path.file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.to_string_lossy().into_owned())
        };
        self.paths
            .iter()
            .map(|path| {
                let own = name(path);
                let shared = self.paths.iter().filter(|other| name(other) == own).count() > 1;
                match path.parent().and_then(Path::file_name) {
                    Some(folder) if shared => format!("{own} — {}", folder.to_string_lossy()),
                    _ => own,
                }
            })
            .collect()
    }
}

fn write_replacing(store: &Path, stored: &Stored) -> std::io::Result<()> {
    if let Some(parent) = store.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = store.with_extension("tmp");
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&temporary)?;
    file.write_all(&serde_json::to_vec(stored)?)?;
    file.sync_all()?;
    fs::rename(&temporary, store)
}

/// macOS's own Recent Items, which the Dock menu and the Apple menu show.
#[cfg(target_os = "macos")]
pub mod system {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_foundation::{NSString, NSURL};
    use std::path::Path;

    fn controller() -> *mut AnyObject {
        unsafe { msg_send![class!(NSDocumentController), sharedDocumentController] }
    }

    /// On the main thread only, as AppKit requires.
    pub fn note(path: &Path) {
        let Some(path) = path.to_str() else {
            return;
        };
        let url = NSURL::fileURLWithPath(&NSString::from_str(path));
        unsafe {
            let _: () = msg_send![controller(), noteNewRecentDocumentURL: &*url];
        }
    }

    /// On the main thread only.
    pub fn clear() {
        let nothing: *mut AnyObject = std::ptr::null_mut();
        unsafe {
            let _: () = msg_send![controller(), clearRecentDocuments: nothing];
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "full-recent-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = fs::remove_dir_all(&dir);
        dir.join("recent-files.json")
    }

    fn paths(list: &[&str]) -> Vec<PathBuf> {
        list.iter().map(PathBuf::from).collect()
    }

    #[test]
    fn the_newest_comes_first_and_each_file_once() {
        let mut recent = Recent::load(store());
        assert!(recent.note(&paths(&["/a/one.md", "/a/two.csv"])));
        assert!(recent.note(&paths(&["/a/one.md"])));
        assert_eq!(recent.labels(), ["one.md", "two.csv"]);
        assert!(!recent.note(&paths(&["/a/one.md"])));
    }

    #[test]
    fn it_keeps_ten() {
        let mut recent = Recent::load(store());
        for n in 0..15 {
            recent.note(&[PathBuf::from(format!("/a/{n}.txt"))]);
        }
        assert_eq!(recent.labels().len(), MAX);
        assert_eq!(recent.labels()[0], "14.txt");
        assert_eq!(recent.labels()[9], "5.txt");
    }

    #[test]
    fn two_files_with_one_name_show_their_folders() {
        let mut recent = Recent::load(store());
        recent.note(&paths(&[
            "/work/notes.md",
            "/home/notes.md",
            "/home/plan.md",
        ]));
        assert_eq!(
            recent.labels(),
            ["plan.md", "notes.md — home", "notes.md — work"]
        );
    }

    #[test]
    fn it_lasts_across_launches_and_clears() {
        let store = store();
        let mut recent = Recent::load(store.clone());
        recent.note(&paths(&["/a/one.md", "/a/two.md"]));
        let mut again = Recent::load(store.clone());
        assert_eq!(again.labels(), ["two.md", "one.md"]);
        assert_eq!(again.get(1), Some(Path::new("/a/one.md")));
        assert!(again.forget(Path::new("/a/one.md")));
        assert!(!again.forget(Path::new("/a/one.md")));
        assert_eq!(Recent::load(store.clone()).labels(), ["two.md"]);
        assert!(again.clear());
        assert!(!again.clear());
        assert!(Recent::load(store).labels().is_empty());
    }

    #[test]
    fn nothing_but_full_paths_is_kept() {
        let store = store();
        let mut recent = Recent::load(store.clone());
        assert!(!recent.note(&paths(&["relative.md"])));
        assert_eq!(recent.get(0), None);
        fs::create_dir_all(store.parent().unwrap()).unwrap();
        fs::write(&store, br#"{"paths":["relative.md","/a/real.md"]}"#).unwrap();
        assert_eq!(Recent::load(store).labels(), ["real.md"]);
    }
}
