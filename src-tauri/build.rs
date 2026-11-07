fn main() {
    // Listing the commands puts them behind the capability file, so a command is only reachable
    // from a window that's been granted it.
    let manifest = tauri_build::AppManifest::new().commands(&["open_external"]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("the Tauri build script failed");
}
