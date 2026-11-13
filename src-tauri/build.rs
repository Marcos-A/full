fn main() {
    // Listing the commands puts them behind the capability file, so a command is only reachable
    // from a window that's been granted it.
    let manifest = tauri_build::AppManifest::new().commands(&[
        "open_external",
        "pick_files",
        "read_granted",
        "pick_save_target",
        "stat_granted",
        "write_granted",
        "confirm_restored_save",
        "confirm_other_type_write",
        "connect_native_events",
        "answer_close",
        "close_window",
        "update_menu",
        "report_timing",
        "set_zoom",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("the Tauri build script failed");
}
