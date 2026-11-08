// No console window on Windows, once that port exists.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod grants;
mod links;
mod native_events;
mod save;

use grants::{save_panel_defaults, Grants, Offered, SaveTarget, EXTENSIONS};
use native_events::{Inbox, NativeEvent};
use save::{Failure, Revision};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::ipc::{Channel, InvokeBody, Request, Response};
use tauri::plugin::{self, TauriPlugin};
use tauri::{AppHandle, DragDropEvent, Manager, Runtime, State, WindowEvent};
use tauri_plugin_dialog::DialogExt;

type Events = Mutex<Inbox<NativeEvent>>;

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
        let mut panel = handle.dialog().file().add_filter("full", &EXTENSIONS);
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
        let mut panel = handle
            .dialog()
            .file()
            .add_filter("full", &extensions)
            .set_file_name(name);
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
    let expected = Revision::parse(header("x-full-size"), header("x-full-modified-ms"))?;
    grants.write(grant, bytes, expected)
}

/// Called once the page can open files. Files that arrived before then are sent straight away.
#[tauri::command]
fn connect_native_events(channel: Channel<NativeEvent>, events: State<'_, Events>) {
    events.lock().unwrap().connect(Box::new(move |event| {
        // Fails only if the page has gone, and then there's nothing to tell.
        let _ = channel.send(event);
    }));
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

fn main() {
    let app = tauri::Builder::default()
        // Used from Rust only. The window has no permission to call it.
        .plugin(tauri_plugin_dialog::init())
        .plugin(navigation_guard())
        // Here and not in setup: Finder's files can arrive before setup runs.
        .manage(Grants::default())
        .manage(Events::default())
        .on_window_event(|window, event| {
            if let WindowEvent::DragDrop(drag) = event {
                on_drag(window.app_handle(), drag);
            }
        })
        .invoke_handler(tauri::generate_handler![
            open_external,
            pick_files,
            read_granted,
            pick_save_target,
            stat_granted,
            write_granted,
            connect_native_events
        ])
        .build(tauri::generate_context!())
        .expect("the app failed to start");

    app.run(|_app, _event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &_event {
            on_opened(_app, urls);
        }
    });
}
