//! Building windows. They're all the same page, built from the window in tauri.conf.json, and each
//! is told one thing before its page starts: nothing, for the first window, which reopens the last
//! session; to start empty, for New Window; or which session to take over, for a tab moved out of
//! another window, and for the other windows of the last session.

use std::sync::atomic::{AtomicU64, Ordering};
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, WebviewWindowBuilder};

use crate::frames::{Frame, Screen};
use crate::pages::FIRST;

/// Where a window opens.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Placement {
    /// Where macOS puts the first window, or cascaded from the one in front.
    Default,
    /// Near where a tab was dropped, in screen points.
    Near(f64, f64),
    /// Where it was when the app quit.
    Saved(Frame),
    /// At the size it had, but placed as by default, as where it was is off every screen now.
    Sized(f64, f64),
}

/// A saved frame where its title bar can be reached, or else only its size.
pub fn placement_for(frame: Option<Frame>, screens: &[Screen]) -> Placement {
    match frame {
        Some(frame) if frame.reachable(screens) => Placement::Saved(frame),
        Some(frame) => Placement::Sized(frame.width, frame.height),
        None => Placement::Default,
    }
}

/// The screens connected now, in points.
pub fn screens(app: &AppHandle) -> Vec<Screen> {
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|monitor| {
            let scale = monitor.scale_factor();
            let position = monitor.position().to_logical::<f64>(scale);
            let size = monitor.size().to_logical::<f64>(scale);
            Screen {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            }
        })
        .collect()
}

/// Where this window is now, as `Placement::Saved` puts it back.
pub fn frame_of(window: &tauri::WebviewWindow) -> Option<Frame> {
    let scale = window.scale_factor().ok()?;
    let position = window.outer_position().ok()?.to_logical::<f64>(scale);
    let size = window.inner_size().ok()?.to_logical::<f64>(scale);
    Some(Frame {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

/// How a new window's page starts.
pub enum Start<'a> {
    Empty,
    /// The page takes over this session, whose files are waiting for it in the recovery store.
    /// A moved file also brings its grant, which never goes into storage: grants are numbered per
    /// run, so after a restart the same one could name another file.
    Session(&'a str, Option<&'a str>),
}

/// A session id as the page makes them, with `crypto.randomUUID()`. Nothing else is ever written
/// into a page's start script.
pub fn valid_session(id: &str) -> bool {
    id.len() == 36
        && id.char_indices().all(|(index, c)| match index {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_digit() || ('a'..='f').contains(&c),
        })
}

/// A grant as `Registry::grant_for` makes them.
pub fn valid_grant(grant: &str) -> bool {
    grant.strip_prefix("grant-").is_some_and(|number| {
        !number.is_empty() && number.len() <= 20 && number.bytes().all(|b| b.is_ascii_digit())
    })
}

/// Runs before the page's own scripts. See `windowStart` in src/desktop/host.ts.
pub fn start_script(start: &Start) -> String {
    match start {
        Start::Empty => "window.__fullWindow = { empty: true };".to_string(),
        Start::Session(id, grant) => {
            assert!(
                valid_session(id),
                "only a checked session id goes into a page"
            );
            match grant {
                Some(grant) => {
                    assert!(valid_grant(grant), "only a checked grant goes into a page");
                    format!("window.__fullWindow = {{ session: \"{id}\", grant: \"{grant}\" }};")
                }
                None => format!("window.__fullWindow = {{ session: \"{id}\" }};"),
            }
        }
    }
}

/// Where a window dragged out at this point goes, so that its tab ends up near the pointer.
pub fn dropped_at(x: f64, y: f64) -> (f64, f64) {
    (x - 80.0, y - 14.0)
}

/// WebKit asks for a new window when the user picks "Open Link" on a link that opens in a new tab,
/// as rendered Markdown links do. Only the user can ask: the page never calls `window.open` in the
/// app, and the HTML preview runs no scripts. So a link the app opens goes to the system, and no
/// window opens.
fn refuse_new_window(url: &tauri::Url) {
    eprintln!(
        "[full] link: new-window request for a {} link",
        url.scheme()
    );
    if url.scheme() == "about" {
        eprintln!(
            "[full] link: that request was {}",
            crate::short(url.as_str())
        );
    }
    // "Open Link in New Window" on a link in an HTML preview carries the link rewritten.
    let link = crate::links::preview_link(url).unwrap_or_else(|| url.to_string());
    let _ = crate::open_external(&link);
}

fn first_config(app: &AppHandle) -> tauri::utils::config::WindowConfig {
    app.config()
        .app
        .windows
        .iter()
        .find(|window| window.label == FIRST)
        .cloned()
        .expect("tauri.conf.json has the main window")
}

/// The window from tauri.conf.json, built here to give it the new-window handler, and to put it
/// where the window it reopens was.
pub fn build_first(app: &AppHandle, placement: Placement) -> tauri::Result<()> {
    let mut builder = WebviewWindowBuilder::from_config(app, &first_config(app))?.on_new_window(
        |url, _features| {
            refuse_new_window(&url);
            NewWindowResponse::Deny
        },
    );
    match placement {
        Placement::Saved(frame) => {
            builder = builder
                .position(frame.x, frame.y)
                .inner_size(frame.width, frame.height)
        }
        Placement::Sized(width, height) => builder = builder.inner_size(width, height),
        Placement::Default | Placement::Near(..) => {}
    }
    builder.build()?;
    Ok(())
}

static NEXT: AtomicU64 = AtomicU64::new(1);

/// A little below and to the right of that window, as AppKit places a new document window.
fn cascade(app: &AppHandle, from: &str) -> Option<(f64, f64)> {
    let window = app.get_webview_window(from)?;
    let scale = window.scale_factor().ok()?;
    let position = window.outer_position().ok()?.to_logical::<f64>(scale);
    Some((position.x + 28.0, position.y + 28.0))
}

/// Opens another window and returns its label. Placed by default, it cascades from `from`. A
/// window opened in the background leaves `from` in front.
pub fn open(
    app: &AppHandle,
    start: Start,
    placement: Placement,
    from: &str,
    focus: bool,
) -> tauri::Result<String> {
    let mut config = first_config(app);
    config.label = format!("window-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let script = start_script(&start);
    let mut builder = WebviewWindowBuilder::from_config(app, &config)?
        .initialization_script(script.as_str())
        .focused(focus)
        .on_new_window(|url, _features| {
            refuse_new_window(&url);
            NewWindowResponse::Deny
        });
    let position = match placement {
        Placement::Saved(frame) => Some((frame.x, frame.y)),
        Placement::Near(x, y) => Some(dropped_at(x, y)),
        Placement::Default | Placement::Sized(..) => cascade(app, from),
    };
    if let Some((x, y)) = position {
        builder = builder.position(x, y);
    }
    match placement {
        Placement::Saved(frame) => builder = builder.inner_size(frame.width, frame.height),
        Placement::Sized(width, height) => builder = builder.inner_size(width, height),
        Placement::Default | Placement::Near(..) => {}
    }
    builder.build()?;
    Ok(config.label)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_session_id_the_page_could_have_made_is_accepted() {
        assert!(valid_session("0f8fad5b-d9cb-469f-a165-70867728950e"));
        assert!(!valid_session("0F8FAD5B-D9CB-469F-A165-70867728950E"));
        assert!(!valid_session("0f8fad5b-d9cb-469f-a165-70867728950"));
        assert!(!valid_session("0f8fad5b-d9cb-469f-a165-70867728950e0"));
        assert!(!valid_session("0f8fad5bxd9cb-469f-a165-70867728950e"));
        assert!(!valid_session("0f8fad5b-d9cb-469f-a165-7086772895\"e"));
        assert!(!valid_session("\"; alert(1); \"-469f-a165-70867728950e"));
        assert!(!valid_session(""));
    }

    #[test]
    fn the_page_is_told_how_to_start() {
        assert_eq!(
            start_script(&Start::Empty),
            "window.__fullWindow = { empty: true };"
        );
        assert_eq!(
            start_script(&Start::Session(
                "0f8fad5b-d9cb-469f-a165-70867728950e",
                None
            )),
            "window.__fullWindow = { session: \"0f8fad5b-d9cb-469f-a165-70867728950e\" };"
        );
        assert_eq!(
            start_script(&Start::Session(
                "0f8fad5b-d9cb-469f-a165-70867728950e",
                Some("grant-12")
            )),
            "window.__fullWindow = { session: \"0f8fad5b-d9cb-469f-a165-70867728950e\", grant: \"grant-12\" };"
        );
    }

    #[test]
    fn only_a_grant_as_rust_makes_them_is_accepted() {
        assert!(valid_grant("grant-1"));
        assert!(valid_grant("grant-18446744073709551615"));
        assert!(!valid_grant("grant-"));
        assert!(!valid_grant("grant-1a"));
        assert!(!valid_grant("grant-1\""));
        assert!(!valid_grant("grant-184467440737095516150"));
        assert!(!valid_grant("/Users/someone/file.md"));
    }

    #[test]
    #[should_panic(expected = "only a checked grant")]
    fn an_unchecked_grant_never_reaches_a_page() {
        start_script(&Start::Session(
            "0f8fad5b-d9cb-469f-a165-70867728950e",
            Some("\"; alert(1); //"),
        ));
    }

    #[test]
    #[should_panic(expected = "only a checked session id")]
    fn an_unchecked_id_never_reaches_a_page() {
        start_script(&Start::Session("\"; alert(1); //", None));
    }

    #[test]
    fn a_saved_frame_is_used_only_where_it_can_be_reached() {
        let screen = Screen {
            x: 0.0,
            y: 0.0,
            width: 1920.0,
            height: 1080.0,
        };
        let frame = Frame {
            x: 200.0,
            y: 100.0,
            width: 900.0,
            height: 700.0,
        };
        assert_eq!(
            placement_for(Some(frame), &[screen]),
            Placement::Saved(frame)
        );
        let gone = Frame { x: 3000.0, ..frame };
        assert_eq!(
            placement_for(Some(gone), &[screen]),
            Placement::Sized(900.0, 700.0)
        );
        assert_eq!(placement_for(None, &[screen]), Placement::Default);
    }

    #[test]
    fn a_dragged_tab_lands_near_the_pointer() {
        assert_eq!(dropped_at(500.0, 300.0), (420.0, 286.0));
    }
}
