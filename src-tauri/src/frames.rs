//! Where each window was when the app quit, so the windows of the last session reopen there.
//!
//! When quitting, each window's page answers with its session and when it was closed, and the
//! window's position and size are noted then. They're written to a file only once the quit is
//! agreed, and read back and deleted at the next launch, so a crash or a cancelled quit leaves
//! nothing behind. The first window takes the frame of the session its page will reopen, chosen
//! by the same rule the page uses: the most recently closed. The others are found by session.
//! Like the closing state, this holds no Tauri types, so it can be tested without a Mac.

use crate::windows::valid_session;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

/// A window's top-left corner and the size of its content, in points, as AppKit places windows.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Frame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// A screen's area, in points.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Screen {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// The window's smallest size, the same as in tauri.conf.json, which a unit test checks. Small
/// enough for half of a MacBook Air's screen, 1440 points wide, in either direction.
pub const MIN_WIDTH: f64 = 560.0;
pub const MIN_HEIGHT: f64 = 420.0;

/// How much of the title bar has to be on a screen for the window to be put back there: enough to
/// see it and drag it.
const REACHABLE_WIDTH: f64 = 100.0;
const REACHABLE_HEIGHT: f64 = 10.0;
const TITLE_BAR: f64 = 28.0;

fn overlap(a: (f64, f64), b: (f64, f64)) -> f64 {
    (a.1.min(b.1) - a.0.max(b.0)).max(0.0)
}

impl Frame {
    /// Numbers a window can have, no smaller than the window's minimum.
    pub fn sane(&self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|n| n.is_finite() && n.abs() < 100_000.0)
            && self.width >= MIN_WIDTH
            && self.height >= MIN_HEIGHT
    }

    /// Whether the title bar would be on one of these screens. A window saved on a screen that has
    /// since been unplugged isn't, and goes where a new window would instead.
    pub fn reachable(&self, screens: &[Screen]) -> bool {
        screens.iter().any(|screen| {
            overlap(
                (self.x, self.x + self.width),
                (screen.x, screen.x + screen.width),
            ) >= REACHABLE_WIDTH
                && overlap(
                    (self.y, self.y + TITLE_BAR),
                    (screen.y, screen.y + screen.height),
                ) >= REACHABLE_HEIGHT
        })
    }
}

/// A window of the last session: its page's session, when the page closed it, and where it was.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub session: String,
    pub closed_at: f64,
    pub frame: Frame,
}

impl Saved {
    fn valid(&self) -> bool {
        valid_session(&self.session) && self.closed_at.is_finite() && self.frame.sane()
    }
}

#[derive(Default)]
pub struct Frames {
    store: Option<PathBuf>,
    /// From the last quit, until each window has been placed.
    last: Vec<Saved>,
    /// Noted during this quit, for the next launch.
    closing: Vec<Saved>,
}

impl Frames {
    /// Reads what the last quit wrote, and deletes it, as it describes that launch only.
    pub fn take_from(store: PathBuf) -> Self {
        let last = fs::read(&store)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Vec<Saved>>(&bytes).ok())
            .unwrap_or_default()
            .into_iter()
            .filter(Saved::valid)
            .collect();
        let _ = fs::remove_file(&store);
        Frames {
            store: Some(store),
            last,
            closing: Vec::new(),
        }
    }

    /// The first window's frame: that of the most recently closed window, as the page reopens that
    /// one first. Ties are broken by session, as the page breaks them.
    pub fn first(&self) -> Option<Frame> {
        self.last
            .iter()
            .max_by(|a, b| {
                a.closed_at
                    .total_cmp(&b.closed_at)
                    .then_with(|| a.session.cmp(&b.session))
            })
            .map(|saved| saved.frame)
    }

    /// The frame of another window of the last session, which only its own window gets.
    pub fn for_session(&mut self, session: &str) -> Option<Frame> {
        let index = self
            .last
            .iter()
            .position(|saved| saved.session == session)?;
        Some(self.last.remove(index).frame)
    }

    /// A page has agreed to quit. A window that reopens nothing isn't kept.
    pub fn closing(&mut self, saved: Saved) {
        if !saved.valid() {
            return;
        }
        self.closing.retain(|known| known.session != saved.session);
        self.closing.push(saved);
    }

    /// The quit didn't happen, so what was noted for it doesn't describe the next launch.
    pub fn cancelled(&mut self) {
        self.closing.clear();
    }

    /// Once the quit is agreed.
    pub fn save(&mut self) {
        let Some(store) = &self.store else {
            return;
        };
        let written = if self.closing.is_empty() {
            match fs::remove_file(store) {
                Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error),
                _ => Ok(()),
            }
        } else {
            write_replacing(store, &self.closing)
        };
        if written.is_err() {
            eprintln!("[full] couldn't write where the windows were");
        }
    }
}

fn write_replacing(store: &Path, list: &[Saved]) -> std::io::Result<()> {
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

    const A: &str = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const B: &str = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
    const C: &str = "16fd2706-8baf-433b-82eb-8c7fada847da";

    fn frame(x: f64, y: f64) -> Frame {
        Frame {
            x,
            y,
            width: 1100.0,
            height: 750.0,
        }
    }

    fn saved(session: &str, closed_at: f64, x: f64) -> Saved {
        Saved {
            session: session.to_string(),
            closed_at,
            frame: frame(x, 100.0),
        }
    }

    fn store() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "full-frames-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = fs::remove_dir_all(&dir);
        dir.join("window-frames.json")
    }

    fn written(store: &Path, list: &[Saved]) -> Frames {
        let mut frames = Frames {
            store: Some(store.to_path_buf()),
            ..Frames::default()
        };
        for saved in list {
            frames.closing(saved.clone());
        }
        frames.save();
        Frames::take_from(store.to_path_buf())
    }

    const SCREEN: Screen = Screen {
        x: 0.0,
        y: 0.0,
        width: 1920.0,
        height: 1080.0,
    };

    #[test]
    fn the_first_window_goes_where_the_last_closed_one_was() {
        let store = store();
        let frames = written(
            &store,
            &[
                saved(A, 10.0, 1.0),
                saved(B, 30.0, 2.0),
                saved(C, 20.0, 3.0),
            ],
        );
        assert_eq!(frames.first(), Some(frame(2.0, 100.0)));
    }

    #[test]
    fn a_tie_is_broken_by_session_as_the_page_does() {
        let store = store();
        let frames = written(&store, &[saved(A, 10.0, 1.0), saved(B, 10.0, 2.0)]);
        // B sorts after A, so it's the one taken, in Rust as in lastSession.ts.
        assert_eq!(frames.first(), Some(frame(2.0, 100.0)));
    }

    #[test]
    fn each_other_window_gets_its_own_frame_once() {
        let store = store();
        let mut frames = written(&store, &[saved(A, 10.0, 1.0), saved(B, 30.0, 2.0)]);
        assert_eq!(frames.for_session(A), Some(frame(1.0, 100.0)));
        assert_eq!(frames.for_session(A), None);
        assert_eq!(frames.for_session(C), None);
    }

    #[test]
    fn the_file_describes_one_launch_only() {
        let store = store();
        written(&store, &[saved(A, 10.0, 1.0)]);
        assert!(!store.exists());
        assert_eq!(Frames::take_from(store).first(), None);
    }

    #[test]
    fn a_cancelled_quit_leaves_nothing() {
        let store = store();
        let mut frames = written(&store, &[]);
        frames.closing(saved(A, 10.0, 1.0));
        frames.cancelled();
        frames.save();
        assert!(!store.exists());
    }

    #[test]
    fn a_window_answering_twice_is_kept_once() {
        let store = store();
        let mut frames = Frames {
            store: Some(store.clone()),
            ..Frames::default()
        };
        frames.closing(saved(A, 10.0, 1.0));
        frames.closing(saved(A, 20.0, 5.0));
        frames.save();
        let mut frames = Frames::take_from(store);
        assert_eq!(frames.for_session(A), Some(frame(5.0, 100.0)));
    }

    #[test]
    fn nothing_odd_is_kept_or_read_back() {
        let store = store();
        let mut frames = Frames {
            store: Some(store.clone()),
            ..Frames::default()
        };
        frames.closing(Saved {
            session: "not-a-session".into(),
            ..saved(A, 10.0, 1.0)
        });
        frames.closing(saved(A, f64::NAN, 1.0));
        frames.closing(Saved {
            frame: Frame {
                width: 10.0,
                ..frame(1.0, 1.0)
            },
            ..saved(A, 10.0, 1.0)
        });
        frames.save();
        assert!(!store.exists());

        fs::create_dir_all(store.parent().unwrap()).unwrap();
        fs::write(&store, b"not json").unwrap();
        assert_eq!(Frames::take_from(store.clone()).first(), None);
        assert!(!store.exists());
    }

    #[test]
    fn a_window_is_put_back_only_where_its_title_bar_can_be_reached() {
        assert!(frame(100.0, 100.0).reachable(&[SCREEN]));
        // Mostly off the right or the bottom, but still with enough to grab.
        assert!(frame(1800.0, 100.0).reachable(&[SCREEN]));
        assert!(frame(100.0, 1060.0).reachable(&[SCREEN]));
        // Too little left to grab, or on a screen that's gone.
        assert!(!frame(1850.0, 100.0).reachable(&[SCREEN]));
        assert!(!frame(100.0, 1075.0).reachable(&[SCREEN]));
        assert!(!frame(2500.0, 100.0).reachable(&[SCREEN]));
        assert!(!frame(100.0, 100.0).reachable(&[]));
        // On a second screen to the left.
        let left = Screen {
            x: -1440.0,
            y: 0.0,
            width: 1440.0,
            height: 900.0,
        };
        assert!(frame(-1300.0, 50.0).reachable(&[SCREEN, left]));
    }
}
