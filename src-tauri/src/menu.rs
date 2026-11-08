//! The menu bar. `menu_table.rs` says what's in it, and this builds it and keeps it up to date.
//!
//! Tauri's predefined Quit and Close Window items go straight to AppKit and would skip the page, so
//! they must not be used here. A test in tests/unit/desktop.test.ts checks that they stay out.

use crate::menu_table::{self, Item, Role, Row, System, QUIT_ITEM, SECTIONS};
use std::sync::Mutex;
use tauri::menu::{
    AboutMetadata, CheckMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu,
    HELP_SUBMENU_ID, WINDOW_SUBMENU_ID,
};
use tauri::{AppHandle, Manager, Wry};

/// What's needed to change the menu after it's built.
#[derive(Default)]
pub struct Handles {
    items: Vec<(Item, MenuItemKind<Wry>)>,
    system: Vec<(System, PredefinedMenuItem<Wry>)>,
    sections: Vec<(&'static str, &'static str, Submenu<Wry>)>,
    language: Mutex<String>,
}

fn own_item(
    app: &AppHandle,
    item: Item,
    handles: &mut Handles,
) -> tauri::Result<MenuItemKind<Wry>> {
    let enabled = menu_table::always_on(item.id);
    let built = if item.check {
        MenuItemKind::Check(CheckMenuItem::with_id(
            app, item.id, item.en, enabled, false, item.keys,
        )?)
    } else {
        MenuItemKind::MenuItem(MenuItem::with_id(
            app, item.id, item.en, enabled, item.keys,
        )?)
    };
    handles.items.push((item, built.clone()));
    Ok(built)
}

fn system_item(
    app: &AppHandle,
    item: System,
    handles: &mut Handles,
) -> tauri::Result<PredefinedMenuItem<Wry>> {
    let text = Some(menu_table::system_words("en", item));
    let built = match item {
        System::About => {
            let info = app.package_info();
            let about = AboutMetadata {
                name: Some(info.name.clone()),
                version: Some(info.version.to_string()),
                ..Default::default()
            };
            PredefinedMenuItem::about(app, text, Some(about))?
        }
        System::Services => PredefinedMenuItem::services(app, text)?,
        System::Hide => PredefinedMenuItem::hide(app, text)?,
        System::HideOthers => PredefinedMenuItem::hide_others(app, text)?,
        System::ShowAll => PredefinedMenuItem::show_all(app, text)?,
        System::Cut => PredefinedMenuItem::cut(app, text)?,
        System::Copy => PredefinedMenuItem::copy(app, text)?,
        System::Paste => PredefinedMenuItem::paste(app, text)?,
        System::Fullscreen => PredefinedMenuItem::fullscreen(app, text)?,
        System::Minimize => PredefinedMenuItem::minimize(app, text)?,
        System::Zoom => PredefinedMenuItem::maximize(app, text)?,
    };
    handles.system.push((item, built.clone()));
    Ok(built)
}

fn fill(
    submenu: &Submenu<Wry>,
    app: &AppHandle,
    rows: &[Row],
    handles: &mut Handles,
) -> tauri::Result<()> {
    for row in rows {
        match row {
            Row::Item(item) => submenu.append(&own_item(app, *item, handles)?)?,
            Row::System(item) => submenu.append(&system_item(app, *item, handles)?)?,
            Row::Separator => submenu.append(&PredefinedMenuItem::separator(app)?)?,
        }
    }
    Ok(())
}

/// Builds the menu with the page's items off, and turns them on once the page says it's ready.
pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let mut handles = Handles::default();
    let name = app.package_info().name.clone();

    let app_section = Submenu::new(app, &name, true)?;
    let app_rows = [
        Row::System(System::About),
        Row::Separator,
        Row::System(System::Services),
        Row::Separator,
        Row::System(System::Hide),
        Row::System(System::HideOthers),
        Row::System(System::ShowAll),
        Row::Separator,
        Row::Item(QUIT_ITEM),
    ];
    fill(&app_section, app, &app_rows, &mut handles)?;

    let menu = Menu::new(app)?;
    menu.append(&app_section)?;
    for section in SECTIONS {
        let submenu = match section.role {
            Role::Normal => Submenu::new(app, section.en, true)?,
            Role::Window => Submenu::with_id(app, WINDOW_SUBMENU_ID, section.en, true)?,
            Role::Help => Submenu::with_id(app, HELP_SUBMENU_ID, section.en, true)?,
        };
        fill(&submenu, app, section.rows, &mut handles)?;
        menu.append(&submenu)?;
        handles.sections.push((section.en, section.ca, submenu));
    }
    app.manage(handles);
    Ok(menu)
}

impl Handles {
    /// What the page says about the current file and language. Anything not in the table is
    /// ignored, and Close and Quit stay on whatever the page says.
    pub fn update(
        &self,
        language: &str,
        enabled: &[String],
        checked: &[String],
    ) -> tauri::Result<()> {
        let new_language = {
            let mut current = self.language.lock().unwrap();
            let changed = *current != language;
            if changed {
                language.clone_into(&mut current);
            }
            changed
        };
        let has = |list: &[String], id: &str| list.iter().any(|entry| entry == id);
        for (item, built) in &self.items {
            let on = menu_table::always_on(item.id) || has(enabled, item.id);
            match built {
                MenuItemKind::MenuItem(plain) => {
                    plain.set_enabled(on)?;
                    if new_language {
                        plain.set_text(menu_table::words(language, item.en, item.ca))?;
                    }
                }
                MenuItemKind::Check(check) => {
                    check.set_enabled(on)?;
                    check.set_checked(has(checked, item.id))?;
                    if new_language {
                        check.set_text(menu_table::words(language, item.en, item.ca))?;
                    }
                }
                _ => {}
            }
        }
        if new_language {
            for (item, built) in &self.system {
                built.set_text(menu_table::system_words(language, *item))?;
            }
            for (en, ca, submenu) in &self.sections {
                submenu.set_text(menu_table::words(language, en, ca))?;
            }
        }
        Ok(())
    }
}
