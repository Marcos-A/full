//! Lets a restored file be named without the page being trusted about where it is.
//!
//! A grant ends when the app quits, but a recovery record outlives it. Saving a restored file back
//! needs Rust to know the path, and the record's copy can't be used: the page wrote it, and could
//! write anything. So Rust keeps its own list of the paths it has granted, and the record holds an
//! opaque ticket into that list. A ticket opens nothing. It only lets the page ask for a native
//! confirmation naming a file the user offered before.
//!
//! The list goes to disk as soon as it changes, because a crash is when it's needed. Anything lost
//! or dropped from it means the first save of that file uses the Save panel instead, so a missing or
//! corrupt list costs a click and nothing else. It holds paths in plain text, as recovery does.

use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

/// Far more than the recovery list keeps, so that a record's ticket is never the one dropped.
const MOST_KEPT: usize = 200;

#[derive(Clone, Default, Deserialize, Serialize)]
struct Stored {
    next: u64,
    /// Oldest first.
    files: Vec<Known>,
}

#[derive(Clone, Deserialize, Serialize)]
struct Known {
    ticket: String,
    path: PathBuf,
}

#[derive(Default)]
pub struct Tickets {
    store: Option<PathBuf>,
    list: Stored,
    unsaved: bool,
}

impl Tickets {
    /// With a list that can't be read, this starts an empty one.
    pub fn load(store: PathBuf) -> Self {
        let list = fs::read(&store)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Tickets {
            store: Some(store),
            list,
            unsaved: false,
        }
    }

    /// None for a path JSON can't hold exactly, which then has no ticket and uses the Save panel.
    pub fn issue(&mut self, path: &Path) -> Option<String> {
        path.to_str()?;
        let files = &mut self.list.files;
        if files.last().is_some_and(|known| known.path == path) {
            return files.last().map(|known| known.ticket.clone());
        }
        self.unsaved = true;
        if let Some(found) = files.iter().position(|known| known.path == path) {
            let known = files.remove(found);
            let ticket = known.ticket.clone();
            files.push(known);
            return Some(ticket);
        }
        self.list.next += 1;
        let ticket = format!("ticket-{}", self.list.next);
        files.push(Known {
            ticket: ticket.clone(),
            path: path.to_path_buf(),
        });
        let excess = files.len().saturating_sub(MOST_KEPT);
        files.drain(..excess);
        Some(ticket)
    }

    pub fn path_of(&self, ticket: &str) -> Option<PathBuf> {
        self.list
            .files
            .iter()
            .find(|known| known.ticket == ticket)
            .map(|known| known.path.clone())
    }

    /// Writes the list if it changed. Failing only means these files use the Save panel later.
    pub fn save(&mut self) {
        if !std::mem::take(&mut self.unsaved) {
            return;
        }
        let Some(store) = &self.store else {
            return;
        };
        if write_replacing(store, &self.list).is_err() {
            eprintln!("[full] couldn't write the list of restorable files");
        }
    }
}

fn write_replacing(store: &Path, list: &Stored) -> std::io::Result<()> {
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
    file.write_all(&serde_json::to_vec(list)?)?;
    file.sync_all()?;
    fs::rename(&temporary, store)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::atomic::{AtomicU32, Ordering};

    struct Place(PathBuf);

    impl Place {
        fn new() -> Self {
            static NEXT: AtomicU32 = AtomicU32::new(0);
            let unique = format!(
                "full-tickets-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            );
            Place(std::env::temp_dir().join(unique))
        }

        fn store(&self) -> PathBuf {
            self.0.join("nested").join("restorable-files.json")
        }
    }

    impl Drop for Place {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn a_ticket_finds_its_path_and_nothing_else_does() {
        let mut tickets = Tickets::default();
        let ticket = tickets.issue(Path::new("/docs/a.md")).unwrap();
        assert_eq!(tickets.path_of(&ticket), Some(PathBuf::from("/docs/a.md")));
        for other in ["/docs/a.md", "ticket-2", "ticket-", ""] {
            assert_eq!(tickets.path_of(other), None, "{other:?}");
        }
    }

    #[test]
    fn a_ticket_outlives_the_app() {
        let place = Place::new();
        let mut first = Tickets::load(place.store());
        let ticket = first.issue(Path::new("/docs/a.md")).unwrap();
        first.save();
        let second = Tickets::load(place.store());
        assert_eq!(second.path_of(&ticket), Some(PathBuf::from("/docs/a.md")));
    }

    #[test]
    fn the_same_file_keeps_its_ticket_across_sessions() {
        let place = Place::new();
        let mut first = Tickets::load(place.store());
        let ticket = first.issue(Path::new("/docs/a.md")).unwrap();
        first.issue(Path::new("/docs/b.md")).unwrap();
        assert_eq!(first.issue(Path::new("/docs/a.md")).unwrap(), ticket);
        first.save();
        let mut second = Tickets::load(place.store());
        assert_eq!(second.issue(Path::new("/docs/a.md")).unwrap(), ticket);
    }

    #[test]
    fn numbers_are_not_reused_after_a_restart() {
        let place = Place::new();
        let mut first = Tickets::load(place.store());
        let ticket = first.issue(Path::new("/docs/a.md")).unwrap();
        first.save();
        let mut second = Tickets::load(place.store());
        assert_ne!(second.issue(Path::new("/docs/b.md")).unwrap(), ticket);
    }

    #[test]
    fn only_the_oldest_are_forgotten_and_opening_counts_as_recent() {
        let mut tickets = Tickets::default();
        let oldest = tickets.issue(Path::new("/docs/oldest.md")).unwrap();
        let kept = tickets.issue(Path::new("/docs/kept.md")).unwrap();
        assert_eq!(tickets.issue(Path::new("/docs/oldest.md")).unwrap(), oldest);
        for n in 0..MOST_KEPT - 1 {
            tickets.issue(Path::new(&format!("/docs/{n}.md"))).unwrap();
        }
        assert_eq!(tickets.path_of(&kept), None);
        assert_eq!(
            tickets.path_of(&oldest),
            Some(PathBuf::from("/docs/oldest.md"))
        );
    }

    #[test]
    fn a_damaged_list_starts_again_without_failing() {
        let place = Place::new();
        fs::create_dir_all(place.store().parent().unwrap()).unwrap();
        fs::write(place.store(), b"{not json").unwrap();
        let mut tickets = Tickets::load(place.store());
        assert_eq!(tickets.path_of("ticket-1"), None);
        let ticket = tickets.issue(Path::new("/docs/a.md")).unwrap();
        tickets.save();
        assert!(Tickets::load(place.store()).path_of(&ticket).is_some());
    }

    #[test]
    fn a_missing_list_is_an_empty_one() {
        let place = Place::new();
        assert_eq!(Tickets::load(place.store()).path_of("ticket-1"), None);
    }

    #[test]
    fn only_this_user_can_read_the_list() {
        let place = Place::new();
        let mut tickets = Tickets::load(place.store());
        tickets.issue(Path::new("/docs/a.md")).unwrap();
        tickets.save();
        let mode = fs::metadata(place.store()).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn nothing_is_written_when_nothing_changed() {
        let place = Place::new();
        let mut first = Tickets::load(place.store());
        first.issue(Path::new("/docs/a.md")).unwrap();
        first.save();
        fs::remove_file(place.store()).unwrap();
        first.issue(Path::new("/docs/a.md")).unwrap();
        first.save();
        assert!(!place.store().exists());
    }

    #[test]
    fn a_path_json_cannot_hold_gets_no_ticket() {
        use std::ffi::OsStr;
        use std::os::unix::ffi::OsStrExt;
        let mut tickets = Tickets::default();
        let path = Path::new(OsStr::from_bytes(b"/docs/\xff.md"));
        assert_eq!(tickets.issue(path), None);
    }
}
