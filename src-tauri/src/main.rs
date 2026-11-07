// No console window on Windows, once that port exists.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod links;

use tauri::plugin::{self, TauriPlugin};
use tauri::Runtime;

/// Opens a link in the user's default apps. The frontend checks it first, and this checks again.
#[tauri::command]
fn open_external(href: &str) -> Result<(), String> {
    let url = links::parse_external(href).ok_or("Not a link the app opens")?;
    open::that_detached(url.as_str()).map_err(|_| "Couldn't open the link".to_string())
}

/// The app never navigates away from its bundled page. See `links::stays_in_app`.
fn navigation_guard<R: Runtime>() -> TauriPlugin<R> {
    plugin::Builder::<R>::new("navigation-guard")
        .on_navigation(|_webview, url| links::stays_in_app(url, cfg!(debug_assertions)))
        .build()
}

fn main() {
    tauri::Builder::default()
        .plugin(navigation_guard())
        .invoke_handler(tauri::generate_handler![open_external])
        .run(tauri::generate_context!())
        .expect("the app failed to start");
}
