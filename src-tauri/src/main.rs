// No console window on Windows, once that port exists.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod closing;
mod frames;
mod grants;
mod links;
#[cfg(target_os = "macos")]
mod mac_quit;
mod menu;
mod menu_table;
mod native_events;
mod pages;
mod save;
mod tickets;
mod timings;
mod windows;

use closing::{Closing, Finish, Verdict};
use frames::{Frames, Saved};
use grants::{
    other_type_confirmation, restored_confirmation, save_panel_defaults, Access, Grants, Offered,
    SaveTarget,
};
use native_events::NativeEvent;
use pages::Pages;
use save::{Failure, Revision};
use serde::Deserialize;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeBody, Request, Response};
use tauri::plugin::{self, TauriPlugin};
use tauri::{AppHandle, DragDropEvent, Manager, Runtime, State, WebviewWindow, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use windows::{Placement, Start};

type PagesState = Mutex<Pages<NativeEvent>>;
type ClosingState = Mutex<Closing>;
type FramesState = Mutex<Frames>;

/// How long a page gets to show it's alive. Once it has, it can take as long as the user does.
const PAGE_RESPONSE_LIMIT: Duration = Duration::from_secs(5);

/// Opens a link in the user's default apps. The frontend checks it first, and this checks again.
#[tauri::command]
fn open_external(href: &str) -> Result<(), String> {
    // Each step goes to stderr, by scheme only, so a run from Terminal shows where a link stops.
    let Some(url) = links::parse_external(href) else {
        eprintln!("[full] link: refused, not a link the app opens");
        return Err("Not a link the app opens".to_string());
    };
    eprintln!("[full] link: opening a {} link", url.scheme());
    match open::that_detached(url.as_str()) {
        Ok(()) => {
            eprintln!("[full] link: handed to the system");
            Ok(())
        }
        Err(error) => {
            eprintln!("[full] link: the system refused it: {error}");
            Err("Couldn't open the link".to_string())
        }
    }
}

/// Shows the Open panel on the window that asked. An empty list means the user cancelled.
#[tauri::command]
async fn pick_files(
    app: AppHandle,
    window: WebviewWindow,
    grants: State<'_, Grants>,
) -> Result<Vec<Offered>, String> {
    // The panel runs on the main thread, and waiting for it there would freeze the app.
    let handle = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        handle
            .dialog()
            .file()
            .set_parent(&window)
            .blocking_pick_files()
    })
    .await
    .map_err(|_| "The Open panel failed".to_string())?;
    let paths: Vec<PathBuf> = picked
        .unwrap_or_default()
        .into_iter()
        .filter_map(|file| file.into_path().ok())
        .collect();
    Ok(grants.offer(&paths))
}

/// The bytes of a granted file, raw instead of as JSON. Runs off the main thread, so that reading
/// a large file can't freeze the window.
#[tauri::command(async)]
fn read_granted(grant: String, grants: State<'_, Grants>) -> Result<Response, String> {
    grants
        .read(&grant)
        .map(Response::new)
        .map_err(|error| error.to_string())
}

/// Shows the Save panel, which also asks about replacing a file that exists. None means the user
/// cancelled. The page only suggests a name, and the path comes from the panel.
#[tauri::command]
async fn pick_save_target(
    app: AppHandle,
    window: WebviewWindow,
    grants: State<'_, Grants>,
    suggested_name: String,
) -> Result<Option<SaveTarget>, Failure> {
    let (name, extensions) = save_panel_defaults(&suggested_name);
    let handle = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut panel = handle
            .dialog()
            .file()
            .set_file_name(name)
            .set_parent(&window);
        if !extensions.is_empty() {
            panel = panel.add_filter("full", &extensions);
        }
        panel.blocking_save_file()
    })
    .await
    .map_err(|_| Failure::Other)?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|_| Failure::Other)?;
    grants.offer_save_target(&path).map(Some)
}

#[tauri::command(async)]
fn stat_granted(grant: String, grants: State<'_, Grants>) -> Result<Revision, Failure> {
    grants.stat(&grant)
}

/// The body is the file's bytes, raw instead of as JSON, so the rest travels in headers.
#[tauri::command(async)]
fn write_granted(request: Request<'_>, grants: State<'_, Grants>) -> Result<Revision, Failure> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(Failure::Other);
    };
    let header = |name| request.headers().get(name).and_then(|v| v.to_str().ok());
    let grant = header("x-full-grant").ok_or(Failure::NotAllowed)?;
    if header("x-full-recreate").is_some() {
        return grants.recreate(grant, bytes);
    }
    let expected = Revision::parse(header("x-full-size"), header("x-full-modified-ms"))?;
    grants.write(grant, bytes, expected)
}

/// The first save of a restored file. Rust names the file from its own list and shows the
/// confirmation itself, so a script in the page can't authorise this or choose what it names. The
/// page only picks the language. None means the user said no.
#[tauri::command]
async fn confirm_restored_save(
    app: AppHandle,
    window: WebviewWindow,
    grants: State<'_, Grants>,
    ticket: String,
    language: String,
) -> Result<Option<Access>, Failure> {
    let path = grants.restored_path(&ticket)?;
    if !ask_natively(&app, window, restored_confirmation(&language, &path)).await? {
        return Ok(None);
    }
    grants.grant_restored(&path).map(Some)
}

/// The first save to a file outside the app's own types. `write_granted` refuses it until the user
/// has said yes here, so a script in the page can't skip this. False means the user said no.
#[tauri::command]
async fn confirm_other_type_write(
    app: AppHandle,
    window: WebviewWindow,
    grants: State<'_, Grants>,
    grant: String,
    language: String,
) -> Result<bool, Failure> {
    let Some(path) = grants.awaiting_confirmation(&grant)? else {
        return Ok(true);
    };
    if !ask_natively(&app, window, other_type_confirmation(&language, &path)).await? {
        return Ok(false);
    }
    grants.confirm_write(&grant);
    Ok(true)
}

/// A dialog the page has no way of answering, on the window that asked. Its text is the title,
/// body and two buttons.
async fn ask_natively(
    app: &AppHandle,
    window: WebviewWindow,
    [title, body, save, cancel]: [String; 4],
) -> Result<bool, Failure> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        handle
            .dialog()
            .message(body)
            .title(title)
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(save, cancel))
            .parent(&window)
            .blocking_show()
    })
    .await
    .map_err(|_| Failure::Other)
}

/// Called once a window's page can open files. Files that arrived for it before then are sent
/// straight away.
#[tauri::command]
fn connect_native_events(
    app: AppHandle,
    window: WebviewWindow,
    channel: Channel<NativeEvent>,
    pages: State<'_, PagesState>,
    closing: State<'_, ClosingState>,
) {
    pages
        .lock()
        .unwrap()
        .inbox(window.label())
        .connect(Box::new(move |event| {
            // Fails only if the page has gone, and then there's nothing to tell.
            let _ = channel.send(event);
        }));
    let finished = closing.lock().unwrap().page_replaced(window.label());
    if let Some(finish) = finished {
        apply(&app, finish);
    }
}

/// What a page says about a request to quit. See src/desktop/closing.ts.
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
enum CloseAnswer {
    Asking,
    Close,
    Stay,
}

/// With Close, a page also says which session it was and when it closed it, and whether it
/// reopens anything. If it does, the window's frame is noted for the next launch.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
fn answer_close(
    app: AppHandle,
    window: WebviewWindow,
    id: u64,
    answer: CloseAnswer,
    session: Option<String>,
    closed_at: Option<f64>,
    reopens: bool,
    closing: State<'_, ClosingState>,
    frames: State<'_, FramesState>,
) {
    let page = window.label();
    if let (CloseAnswer::Close, true, Some(session), Some(closed_at), Some(frame)) = (
        answer,
        reopens,
        session,
        closed_at,
        windows::frame_of(&window),
    ) {
        frames.lock().unwrap().closing(Saved {
            session,
            closed_at,
            frame,
        });
    }
    let finished = {
        let mut closing = closing.lock().unwrap();
        match answer {
            CloseAnswer::Asking => {
                closing.acknowledge(id, page);
                None
            }
            CloseAnswer::Close => closing.answer(id, page, true),
            CloseAnswer::Stay => closing.answer(id, page, false),
        }
    };
    if let Some(finish) = finished {
        apply(&app, finish);
    }
}

/// Cmd+W with no file open in that window. It still goes through the page, so that it can't lose
/// a file opened a moment ago.
#[tauri::command]
fn close_window(app: AppHandle, window: WebviewWindow) {
    close_one_window(&app, window.label());
}

/// The page of a window that isn't the last has closed its files, or been told it can't keep them,
/// so the window can go. If it has become the last meanwhile, this is quitting after all.
#[tauri::command]
fn window_may_close(app: AppHandle, window: WebviewWindow, pages: State<'_, PagesState>) {
    let last = pages.lock().unwrap().window_count() <= 1;
    if last {
        quit(&app);
    } else if let Err(error) = window.destroy() {
        eprintln!("[full] a window couldn't be closed: {error}");
    }
}

/// A tab moved out of a window, or a window of the last session reopened. Its files wait in the
/// recovery store under this session, for the new window's page to take over. A moved file's
/// `grant` goes with it, and only one this run issued. `x` and `y` are where a tab was dropped, in
/// screen points. In the background, the window that asked stays in front.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
async fn open_window(
    app: AppHandle,
    window: WebviewWindow,
    session: String,
    grant: Option<String>,
    x: Option<f64>,
    y: Option<f64>,
    background: bool,
    pages: State<'_, PagesState>,
    grants: State<'_, Grants>,
    frames: State<'_, FramesState>,
) -> Result<(), String> {
    if !windows::valid_session(&session) {
        return Err("Not a session".to_string());
    }
    if let Some(grant) = &grant {
        if !windows::valid_grant(grant) || !grants.is_issued(grant) {
            return Err("Not a grant".to_string());
        }
    }
    // A dropped tab goes where it was dropped. A window of the last session goes where it was.
    let placement = match x.zip(y) {
        Some((x, y)) => Placement::Near(x, y),
        None => windows::placement_for(
            frames.lock().unwrap().for_session(&session),
            &windows::screens(&app),
        ),
    };
    open_window_now(
        &app,
        &pages,
        Start::Session(&session, grant.as_deref()),
        placement,
        window.label(),
        !background,
    )
}

fn open_window_now(
    app: &AppHandle,
    pages: &PagesState,
    start: Start,
    placement: Placement,
    from: &str,
    focus: bool,
) -> Result<(), String> {
    let label = windows::open(app, start, placement, from, focus).map_err(|error| {
        eprintln!("[full] a window couldn't be opened: {error}");
        "Couldn't open a window".to_string()
    })?;
    let mut pages = pages.lock().unwrap();
    pages.opened(&label);
    // Opened behind, so the one that asked is still in front.
    if !focus {
        pages.focused(from);
    }
    Ok(())
}

/// Starts asking every window's page, unless there's no need to.
fn request_close(app: &AppHandle, from_appkit: bool) -> Verdict {
    let ready = app.state::<PagesState>().lock().unwrap().connected();
    let verdict = app
        .state::<ClosingState>()
        .lock()
        .unwrap()
        .request(&ready, from_appkit);
    if let Verdict::Ask(id) = verdict {
        for page in ready {
            app.state::<PagesState>()
                .lock()
                .unwrap()
                .inbox(&page)
                .deliver_if_connected(NativeEvent::CloseRequested { id });
            let handle = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(PAGE_RESPONSE_LIMIT);
                let finished = handle
                    .state::<ClosingState>()
                    .lock()
                    .unwrap()
                    .page_silent(id, &page);
                if let Some(finish) = finished {
                    eprintln!("[full] a page didn't respond, so closing without it");
                    apply(&handle, finish);
                }
            });
        }
    }
    verdict
}

/// The Quit item, Cmd+W or the red button on the last window, and anything else that isn't
/// AppKit asking.
fn quit(app: &AppHandle) {
    eprintln!("[full] close route: quit item, or the last window");
    if request_close(app, false) == Verdict::Proceed {
        app.exit(0);
    }
}

/// The red button or Cmd+W with no file. On the last window that's quitting, which asks nothing,
/// since everything reopens. On another, its page asks about its unsaved files as closing each one
/// would, because nothing of a window closed on its own reopens.
fn close_one_window(app: &AppHandle, label: &str) {
    if app.state::<ClosingState>().lock().unwrap().in_progress() {
        return;
    }
    let state = app.state::<PagesState>();
    let mut pages = state.lock().unwrap();
    if pages.window_count() <= 1 {
        drop(pages);
        quit(app);
    } else if pages.is_connected(label) {
        eprintln!("[full] close route: one window of several");
        pages
            .inbox(label)
            .deliver_if_connected(NativeEvent::CloseWindow);
    } else if let Some(window) = app.get_webview_window(label) {
        // A page that never loaded has nothing to lose.
        drop(pages);
        let _ = window.destroy();
    }
}

fn apply(
    app: &AppHandle,
    Finish {
        close,
        appkit_waiting,
    }: Finish,
) {
    // Where the windows were goes to disk only once the quit is agreed.
    {
        let state = app.state::<FramesState>();
        let mut frames = state.lock().unwrap();
        if close {
            frames.save();
        } else {
            frames.cancelled();
        }
    }
    if appkit_waiting {
        #[cfg(target_os = "macos")]
        let _ = app.run_on_main_thread(move || mac_quit::reply(close));
        if close {
            // AppKit quits by itself after that reply. This is in case it had stopped waiting.
            let handle = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(2));
                handle.exit(0);
            });
        }
    } else if close {
        app.exit(0);
    }
}

#[cfg(target_os = "macos")]
fn on_terminate(app: &AppHandle) -> mac_quit::Reply {
    let verdict = request_close(app, true);
    eprintln!("[full] close route: AppKit asked, {verdict:?}");
    match verdict {
        Verdict::Proceed => mac_quit::Reply::Now,
        Verdict::Ask(_) | Verdict::Joined => mac_quit::Reply::Later,
        Verdict::Busy => mac_quit::Reply::Cancel,
    }
}

/// A click on the menu, or a shortcut the page didn't take, for the window in front. Cmd+W and
/// Cmd+Q are the app's own items and not the predefined ones, because those go straight to AppKit
/// and closing would never reach the page.
fn on_menu(app: &AppHandle, id: &str) {
    if id == menu_table::QUIT {
        quit(app);
        return;
    }
    let pages = app.state::<PagesState>();
    if id == menu_table::NEW_WINDOW {
        let front = pages.lock().unwrap().front().to_string();
        let _ = open_window_now(app, &pages, Start::Empty, Placement::Default, &front, true);
        return;
    }
    let event = if id == menu_table::CLOSE {
        NativeEvent::CloseFile
    } else if menu_table::is_page_command(id) {
        NativeEvent::MenuCommand { id: id.to_string() }
    } else {
        return;
    };
    pages
        .lock()
        .unwrap()
        .front_inbox()
        .deliver_if_connected(event);
}

/// A page says which menu items apply to its window right now, and in which language. The menu
/// shows it while that window is in front. No item's words or shortcut come from the page.
#[tauri::command]
fn update_menu(
    window: WebviewWindow,
    language: String,
    enabled: Vec<String>,
    checked: Vec<String>,
    handles: State<'_, menu::Handles>,
    pages: State<'_, PagesState>,
) {
    let label = window.label();
    handles.remember(
        label,
        menu::State {
            language,
            enabled,
            checked,
        },
    );
    if pages.lock().unwrap().front() == label {
        show_menu_of(&handles, label);
    }
}

fn show_menu_of(handles: &menu::Handles, window: &str) {
    if let Err(error) = handles.show(window) {
        eprintln!("[full] the menu couldn't be updated: {error}");
    }
}

/// For the budgets in the audit: prints a measurement when the app was started with `FULL_TIMINGS`
/// set, and otherwise does nothing. The answer tells the page whether to measure at all.
#[tauri::command]
fn report_timing(report: String, timings: State<'_, timings::Timings>) -> bool {
    timings.report(&report)
}

/// The View menu's zoom, for the window that asked. The page remembers the level, as it does the
/// theme, and this only keeps it within what stays usable.
#[tauri::command]
fn set_zoom(window: WebviewWindow, level: f64) -> Result<(), String> {
    let level = if level.is_finite() {
        level.clamp(0.5, 3.0)
    } else {
        1.0
    };
    window
        .set_zoom(level)
        .map_err(|_| "Couldn't zoom".to_string())
}

/// Where the app keeps its own small files: the list of restorable files, and where the windows
/// were. A later port needs its own answer here.
fn support_file(identifier: &str, name: &str) -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(
        PathBuf::from(home)
            .join("Library/Application Support")
            .join(identifier)
            .join(name),
    )
}

/// The one way native events turn paths into grants. Dialogs go through `pick_files`. Without a
/// window, the files go to the one in front.
fn offer_files(app: &AppHandle, window: Option<&str>, paths: &[PathBuf]) {
    if paths.is_empty() {
        return;
    }
    let files = app.state::<Grants>().offer(paths);
    let state = app.state::<PagesState>();
    let mut pages = state.lock().unwrap();
    let inbox = match window {
        Some(label) => pages.inbox(label),
        None => pages.front_inbox(),
    };
    inbox.deliver(NativeEvent::Files { files });
}

/// A drag of files over a window goes to that window's page, wherever the front window is.
fn on_drag(app: &AppHandle, window: &str, drag: &DragDropEvent) {
    let tell_page = |event| {
        app.state::<PagesState>()
            .lock()
            .unwrap()
            .inbox(window)
            .deliver_if_connected(event)
    };
    match drag {
        DragDropEvent::Enter { paths, .. } if !paths.is_empty() => {
            tell_page(NativeEvent::DragEntered)
        }
        DragDropEvent::Leave => tell_page(NativeEvent::DragLeft),
        DragDropEvent::Drop { paths, .. } => {
            tell_page(NativeEvent::DragLeft);
            offer_files(app, Some(window), paths);
        }
        _ => {}
    }
}

/// Finder hands over files at launch or while the app is running, both through `RunEvent::Opened`.
/// They open in the window in front.
#[cfg(target_os = "macos")]
fn on_opened(app: &AppHandle, urls: &[tauri::Url]) {
    let paths: Vec<PathBuf> = urls
        .iter()
        .filter(|url| url.scheme() == "file")
        .filter_map(|url| url.to_file_path().ok())
        .collect();
    eprintln!("[full] files sent by Finder: {}", paths.len());
    offer_files(app, None, &paths);
    let front = app
        .state::<PagesState>()
        .lock()
        .unwrap()
        .front()
        .to_string();
    if let Some(window) = app.get_webview_window(&front) {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// A window came forward: the menu and the next Finder files are now its own.
fn on_focused(app: &AppHandle, window: &str) {
    app.state::<PagesState>().lock().unwrap().focused(window);
    show_menu_of(&app.state::<menu::Handles>(), window);
}

/// A window has gone. Whatever is in front now gets the menu, and a quit that was waiting for this
/// window's answer has one less to wait for.
fn on_destroyed(app: &AppHandle, window: &str) {
    let state = app.state::<PagesState>();
    let front = {
        let mut pages = state.lock().unwrap();
        pages.closed(window);
        (pages.window_count() > 0).then(|| pages.front().to_string())
    };
    let handles = app.state::<menu::Handles>();
    handles.forget(window);
    if let Some(front) = front {
        show_menu_of(&handles, &front);
    }
    let finished = app
        .state::<ClosingState>()
        .lock()
        .unwrap()
        .page_gone(window);
    if let Some(finish) = finished {
        apply(app, finish);
    }
}

/// At most 300 characters of an address, for the log.
fn short(text: &str) -> String {
    text.chars().take(300).collect()
}

/// Whether this link was opened in the last second, so that one click never opens two tabs if
/// WebKit reports the same navigation twice.
fn opened_just_now(link: &str) -> bool {
    static LAST: Mutex<Option<(String, Instant)>> = Mutex::new(None);
    let mut last = LAST.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let now = Instant::now();
    let repeat = last.as_ref().is_some_and(|(previous, at)| {
        previous == link && now.duration_since(*at) < Duration::from_secs(1)
    });
    *last = Some((link.to_string(), now));
    repeat
}

/// The app never navigates away from its bundled page. See `links::stays_in_app`.
fn navigation_guard<R: Runtime>() -> TauriPlugin<R> {
    plugin::Builder::<R>::new("navigation-guard")
        .on_navigation(|_webview, url| {
            // A link clicked in an HTML preview, or opened with "Open Link". The frame stays where
            // it is and the system opens the link, as a Markdown link does. Only an in-page link
            // goes on to the blank page, for the page to scroll to its target.
            if let Some(link) = links::preview_link(url) {
                if links::parse_external(&link).is_some() {
                    eprintln!("[full] link: a preview link was clicked");
                    if !opened_just_now(&link) {
                        let _ = open_external(&link);
                    }
                    return false;
                }
            }
            let stays = links::stays_in_app(url, cfg!(debug_assertions));
            if stays && links::preview_link(url).is_some() {
                eprintln!(
                    "[full] link: a preview link went to {}",
                    short(url.as_str())
                );
            }
            if !stays {
                eprintln!("[full] link: refused a {} page in the window", url.scheme());
                // The app's own blank pages carry no address but the link clicked in a preview.
                if url.scheme() == "about" {
                    eprintln!("[full] link: that page was {}", short(url.as_str()));
                }
            }
            stays
        })
        .build()
}

fn main() {
    let context = tauri::generate_context!();
    let identifier = context.config().identifier.clone();
    let grants = match support_file(&identifier, "restorable-files.json") {
        Some(store) => Grants::with_store(store),
        None => Grants::default(),
    };
    let frames = match support_file(&identifier, "window-frames.json") {
        Some(store) => Frames::take_from(store),
        None => Frames::default(),
    };
    let app = tauri::Builder::default()
        // Used from Rust only. No window has permission to call it.
        .plugin(tauri_plugin_dialog::init())
        .plugin(navigation_guard())
        // Here and not in setup: Finder's files can arrive before setup runs.
        .manage(grants)
        .manage(PagesState::default())
        .manage(ClosingState::default())
        .manage(FramesState::new(frames))
        .manage(timings::Timings::from_env())
        .menu(menu::build)
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .setup(|app| {
            // Where the window whose session the page reopens was, as both pick the last closed.
            let first = app.state::<FramesState>().lock().unwrap().first();
            let placement = windows::placement_for(first, &windows::screens(app.handle()));
            windows::build_first(app.handle(), placement)?;
            app.state::<PagesState>()
                .lock()
                .unwrap()
                .opened(pages::FIRST);
            #[cfg(target_os = "macos")]
            {
                let handle = app.handle().clone();
                mac_quit::install(move || on_terminate(&handle));
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            let app = window.app_handle();
            let label = window.label();
            match event {
                WindowEvent::DragDrop(drag) => on_drag(app, label, drag),
                WindowEvent::Focused(true) => on_focused(app, label),
                WindowEvent::Destroyed => on_destroyed(app, label),
                WindowEvent::CloseRequested { api, .. } => {
                    // Quitting, once agreed, closes every window without asking again.
                    if app.state::<ClosingState>().lock().unwrap().in_progress() {
                        let verdict = request_close(app, false);
                        eprintln!("[full] close route: window while quitting, {verdict:?}");
                        if verdict != Verdict::Proceed {
                            api.prevent_close();
                        }
                        return;
                    }
                    let several = app.state::<PagesState>().lock().unwrap().window_count() > 1;
                    if several {
                        api.prevent_close();
                        close_one_window(app, label);
                        return;
                    }
                    let verdict = request_close(app, false);
                    eprintln!("[full] close route: window, {verdict:?}");
                    if verdict != Verdict::Proceed {
                        api.prevent_close();
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            open_external,
            pick_files,
            read_granted,
            pick_save_target,
            stat_granted,
            write_granted,
            confirm_restored_save,
            confirm_other_type_write,
            connect_native_events,
            answer_close,
            close_window,
            window_may_close,
            open_window,
            update_menu,
            report_timing,
            set_zoom
        ])
        .build(context)
        .expect("the app failed to start");

    app.run(|_app, _event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &_event {
            on_opened(_app, urls);
        }
    });
}
