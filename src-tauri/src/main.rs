// No console window on Windows, once that port exists.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod closing;
mod grants;
mod links;
#[cfg(target_os = "macos")]
mod mac_quit;
mod menu;
mod menu_table;
mod native_events;
mod save;
mod tickets;
mod timings;

use closing::{Closing, Finish, Verdict};
use grants::{
    other_type_confirmation, restored_confirmation, save_panel_defaults, Access, Grants, Offered,
    SaveTarget,
};
use native_events::{Inbox, NativeEvent};
use save::{Failure, Revision};
use serde::Deserialize;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::ipc::{Channel, InvokeBody, Request, Response};
use tauri::plugin::{self, TauriPlugin};
use tauri::{AppHandle, DragDropEvent, Manager, Runtime, State, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

type Events = Mutex<Inbox<NativeEvent>>;
type ClosingState = Mutex<Closing>;

/// How long the page gets to show it's alive. Once it has, it can take as long as the user does.
const PAGE_RESPONSE_LIMIT: Duration = Duration::from_secs(5);

/// Opens a link in the user's default apps. The frontend checks it first, and this checks again.
#[tauri::command]
fn open_external(href: &str) -> Result<(), String> {
    let url = links::parse_external(href).ok_or("Not a link the app opens")?;
    open::that_detached(url.as_str()).map_err(|_| "Couldn't open the link".to_string())
}

/// Shows the Open panel. An empty list means the user cancelled.
#[tauri::command]
async fn pick_files(app: AppHandle, grants: State<'_, Grants>) -> Result<Vec<Offered>, String> {
    // The panel runs on the main thread, and waiting for it there would freeze the app.
    let handle = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut panel = handle.dialog().file();
        if let Some(window) = handle.get_webview_window("main") {
            panel = panel.set_parent(&window);
        }
        panel.blocking_pick_files()
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
    grants: State<'_, Grants>,
    suggested_name: String,
) -> Result<Option<SaveTarget>, Failure> {
    let (name, extensions) = save_panel_defaults(&suggested_name);
    let handle = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut panel = handle.dialog().file().set_file_name(name);
        if !extensions.is_empty() {
            panel = panel.add_filter("full", &extensions);
        }
        if let Some(window) = handle.get_webview_window("main") {
            panel = panel.set_parent(&window);
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
    grants: State<'_, Grants>,
    ticket: String,
    language: String,
) -> Result<Option<Access>, Failure> {
    let path = grants.restored_path(&ticket)?;
    if !ask_natively(&app, restored_confirmation(&language, &path)).await? {
        return Ok(None);
    }
    grants.grant_restored(&path).map(Some)
}

/// The first save to a file outside the app's own types. `write_granted` refuses it until the user
/// has said yes here, so a script in the page can't skip this. False means the user said no.
#[tauri::command]
async fn confirm_other_type_write(
    app: AppHandle,
    grants: State<'_, Grants>,
    grant: String,
    language: String,
) -> Result<bool, Failure> {
    let Some(path) = grants.awaiting_confirmation(&grant)? else {
        return Ok(true);
    };
    if !ask_natively(&app, other_type_confirmation(&language, &path)).await? {
        return Ok(false);
    }
    grants.confirm_write(&grant);
    Ok(true)
}

/// A dialog the page has no way of answering. Its text is the title, body and two buttons.
async fn ask_natively(
    app: &AppHandle,
    [title, body, save, cancel]: [String; 4],
) -> Result<bool, Failure> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = handle
            .dialog()
            .message(body)
            .title(title)
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(save, cancel));
        if let Some(window) = handle.get_webview_window("main") {
            dialog = dialog.parent(&window);
        }
        dialog.blocking_show()
    })
    .await
    .map_err(|_| Failure::Other)
}

/// Called once the page can open files. Files that arrived before then are sent straight away.
#[tauri::command]
fn connect_native_events(
    app: AppHandle,
    channel: Channel<NativeEvent>,
    events: State<'_, Events>,
    closing: State<'_, ClosingState>,
) {
    events.lock().unwrap().connect(Box::new(move |event| {
        // Fails only if the page has gone, and then there's nothing to tell.
        let _ = channel.send(event);
    }));
    let finished = closing.lock().unwrap().page_replaced();
    if let Some(finish) = finished {
        apply(&app, finish);
    }
}

/// What the page says about a request to close. See src/desktop/closing.ts.
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
enum CloseAnswer {
    Asking,
    Close,
    Stay,
}

#[tauri::command]
fn answer_close(app: AppHandle, id: u64, answer: CloseAnswer, closing: State<'_, ClosingState>) {
    let finished = {
        let mut closing = closing.lock().unwrap();
        match answer {
            CloseAnswer::Asking => {
                closing.acknowledge(id);
                None
            }
            CloseAnswer::Close => closing.answer(id, true),
            CloseAnswer::Stay => closing.answer(id, false),
        }
    };
    if let Some(finish) = finished {
        apply(&app, finish);
    }
}

/// Cmd+W with no file open. It still goes through the page, so that it can't lose a file opened a
/// moment ago.
#[tauri::command]
fn close_window(app: AppHandle) {
    quit(&app);
}

/// Starts asking the page, unless there's no need to.
fn request_close(app: &AppHandle, from_appkit: bool) -> Verdict {
    let page_ready = app.state::<Events>().lock().unwrap().is_connected();
    let verdict = app
        .state::<ClosingState>()
        .lock()
        .unwrap()
        .request(page_ready, from_appkit);
    if let Verdict::Ask(id) = verdict {
        app.state::<Events>()
            .lock()
            .unwrap()
            .deliver_if_connected(NativeEvent::CloseRequested { id });
        let handle = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(PAGE_RESPONSE_LIMIT);
            let finished = handle
                .state::<ClosingState>()
                .lock()
                .unwrap()
                .page_silent(id);
            if let Some(finish) = finished {
                eprintln!("[full] the page didn't respond, so closing without it");
                apply(&handle, finish);
            }
        });
    }
    verdict
}

/// The Quit item, and anything else that isn't AppKit asking.
fn quit(app: &AppHandle) {
    eprintln!("[full] close route: quit item or Cmd+W with no file");
    if request_close(app, false) == Verdict::Proceed {
        app.exit(0);
    }
}

fn apply(
    app: &AppHandle,
    Finish {
        close,
        appkit_waiting,
    }: Finish,
) {
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

/// A click on the menu, or a shortcut the page didn't take. Cmd+W and Cmd+Q are the app's own items
/// and not the predefined ones, because those go straight to AppKit and closing would never reach
/// the page.
fn on_menu(app: &AppHandle, id: &str) {
    if id == menu_table::QUIT {
        quit(app);
        return;
    }
    let event = if id == menu_table::CLOSE {
        NativeEvent::CloseFile
    } else if menu_table::is_page_command(id) {
        NativeEvent::MenuCommand { id: id.to_string() }
    } else {
        return;
    };
    app.state::<Events>()
        .lock()
        .unwrap()
        .deliver_if_connected(event);
}

/// The page says which menu items apply right now, and in which language. No item's words or
/// shortcut come from the page.
#[tauri::command]
fn update_menu(
    language: String,
    enabled: Vec<String>,
    checked: Vec<String>,
    handles: State<'_, menu::Handles>,
) {
    if let Err(error) = handles.update(&language, &enabled, &checked) {
        eprintln!("[full] the menu couldn't be updated: {error}");
    }
}

/// For the budgets in the audit: prints a measurement when the app was started with `FULL_TIMINGS`
/// set, and otherwise does nothing. The answer tells the page whether to measure at all.
#[tauri::command]
fn report_timing(report: String, timings: State<'_, timings::Timings>) -> bool {
    timings.report(&report)
}

/// The View menu's zoom. The page remembers the level, as it does the theme, and this only keeps it
/// within what stays usable.
#[tauri::command]
fn set_zoom(app: AppHandle, level: f64) -> Result<(), String> {
    let level = if level.is_finite() {
        level.clamp(0.5, 3.0)
    } else {
        1.0
    };
    let window = app.get_webview_window("main").ok_or("No window")?;
    window
        .set_zoom(level)
        .map_err(|_| "Couldn't zoom".to_string())
}

/// Where the list of restorable files lives. A later port needs its own answer here.
fn restorable_files_store(identifier: &str) -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(
        PathBuf::from(home)
            .join("Library/Application Support")
            .join(identifier)
            .join("restorable-files.json"),
    )
}

/// The one way native events turn paths into grants. Dialogs go through `pick_files`.
fn offer_files(app: &AppHandle, paths: &[PathBuf]) {
    if paths.is_empty() {
        return;
    }
    let files = app.state::<Grants>().offer(paths);
    app.state::<Events>()
        .lock()
        .unwrap()
        .deliver(NativeEvent::Files { files });
}

fn on_drag(app: &AppHandle, drag: &DragDropEvent) {
    let tell_page = |event| {
        app.state::<Events>()
            .lock()
            .unwrap()
            .deliver_if_connected(event)
    };
    match drag {
        DragDropEvent::Enter { paths, .. } if !paths.is_empty() => {
            tell_page(NativeEvent::DragEntered)
        }
        DragDropEvent::Leave => tell_page(NativeEvent::DragLeft),
        DragDropEvent::Drop { paths, .. } => {
            tell_page(NativeEvent::DragLeft);
            offer_files(app, paths);
        }
        _ => {}
    }
}

/// Finder hands over files at launch or while the app is running, both through `RunEvent::Opened`.
#[cfg(target_os = "macos")]
fn on_opened(app: &AppHandle, urls: &[tauri::Url]) {
    let paths: Vec<PathBuf> = urls
        .iter()
        .filter(|url| url.scheme() == "file")
        .filter_map(|url| url.to_file_path().ok())
        .collect();
    eprintln!("[full] files sent by Finder: {}", paths.len());
    offer_files(app, &paths);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// The app never navigates away from its bundled page. See `links::stays_in_app`.
fn navigation_guard<R: Runtime>() -> TauriPlugin<R> {
    plugin::Builder::<R>::new("navigation-guard")
        .on_navigation(|_webview, url| links::stays_in_app(url, cfg!(debug_assertions)))
        .build()
}

/// The window from tauri.conf.json, built here only to give it a new-window handler. WebKit asks
/// for a new window when the user picks "Open Link" on a link that opens in a new tab, as rendered
/// Markdown links do. Only the user can ask: the page never calls `window.open` in the app, and the
/// HTML preview runs no scripts. So a link the app opens goes to the system, and no window opens.
fn build_main_window(app: &AppHandle) -> tauri::Result<()> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .cloned()
        .expect("tauri.conf.json has the main window");
    tauri::WebviewWindowBuilder::from_config(app, &config)?
        .on_new_window(|url, _features| {
            if open_external(url.as_str()).is_err() {
                eprintln!("[full] refused a new window for a link the app doesn't open");
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .build()?;
    Ok(())
}

fn main() {
    let context = tauri::generate_context!();
    let grants = match restorable_files_store(&context.config().identifier) {
        Some(store) => Grants::with_store(store),
        None => Grants::default(),
    };
    let app = tauri::Builder::default()
        // Used from Rust only. The window has no permission to call it.
        .plugin(tauri_plugin_dialog::init())
        .plugin(navigation_guard())
        // Here and not in setup: Finder's files can arrive before setup runs.
        .manage(grants)
        .manage(Events::default())
        .manage(ClosingState::default())
        .manage(timings::Timings::from_env())
        .menu(menu::build)
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .setup(|app| {
            build_main_window(app.handle())?;
            #[cfg(target_os = "macos")]
            {
                let handle = app.handle().clone();
                mac_quit::install(move || on_terminate(&handle));
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::DragDrop(drag) => on_drag(window.app_handle(), drag),
            WindowEvent::CloseRequested { api, .. } => {
                let verdict = request_close(window.app_handle(), false);
                eprintln!("[full] close route: window, {verdict:?}");
                if verdict != Verdict::Proceed {
                    api.prevent_close();
                }
            }
            _ => {}
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
