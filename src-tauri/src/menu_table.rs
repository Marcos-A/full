//! What's in the menu bar and what it says. The page decides which items are on, and the words are
//! kept here, like the ones in the restored-file confirmation, so a page can't relabel the menu.

/// A menu item of the app's own. `id` is either a command the page already has, or `CLOSE`/`QUIT`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Item {
    pub id: &'static str,
    pub en: &'static str,
    pub ca: &'static str,
    pub keys: Option<&'static str>,
    pub check: bool,
}

/// An item AppKit provides, which reaches the focused text control by itself.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum System {
    About,
    Services,
    Hide,
    HideOthers,
    ShowAll,
    Cut,
    Copy,
    Paste,
    Fullscreen,
    Minimize,
    Zoom,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Row {
    Item(Item),
    System(System),
    Separator,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Role {
    Normal,
    Window,
    Help,
}

pub struct Section {
    pub en: &'static str,
    pub ca: &'static str,
    pub role: Role,
    pub rows: &'static [Row],
}

/// Cmd+W. Rust handles it and asks the page, because it may mean closing the window.
pub const CLOSE: &str = "close";
/// Cmd+Q. Rust handles it and asks the page about unsaved files.
pub const QUIT: &str = "quit";

const fn item(
    id: &'static str,
    en: &'static str,
    ca: &'static str,
    keys: Option<&'static str>,
) -> Row {
    Row::Item(Item {
        id,
        en,
        ca,
        keys,
        check: false,
    })
}

const fn check(id: &'static str, en: &'static str, ca: &'static str) -> Row {
    check_keys(id, en, ca, None)
}

const fn check_keys(
    id: &'static str,
    en: &'static str,
    ca: &'static str,
    keys: Option<&'static str>,
) -> Row {
    Row::Item(Item {
        id,
        en,
        ca,
        keys,
        check: true,
    })
}

const CMD_N: Option<&str> = Some("CmdOrCtrl+N");
const CMD_O: Option<&str> = Some("CmdOrCtrl+O");
const CMD_W: Option<&str> = Some("CmdOrCtrl+W");
const CMD_S: Option<&str> = Some("CmdOrCtrl+S");
const CMD_SHIFT_S: Option<&str> = Some("CmdOrCtrl+Shift+S");
const CMD_Z: Option<&str> = Some("CmdOrCtrl+Z");
const CMD_SHIFT_Z: Option<&str> = Some("CmdOrCtrl+Shift+Z");
const CMD_K: Option<&str> = Some("CmdOrCtrl+K");
const CMD_A: Option<&str> = Some("CmdOrCtrl+A");
const CMD_EQUAL: Option<&str> = Some("CmdOrCtrl+=");
const CMD_MINUS: Option<&str> = Some("CmdOrCtrl+-");
const CMD_0: Option<&str> = Some("CmdOrCtrl+0");
// The page takes these first, by key position. Switching to the view in use does nothing, so a
// press that also reaches the menu is harmless.
const ALT_1: Option<&str> = Some("Alt+1");
const ALT_2: Option<&str> = Some("Alt+2");
const ALT_3: Option<&str> = Some("Alt+3");

pub const QUIT_ITEM: Item = Item {
    id: QUIT,
    en: "Quit full",
    ca: "Surt de full",
    keys: Some("CmdOrCtrl+Q"),
    check: false,
};

/// The sections after the app's own, in the order they appear.
pub const SECTIONS: &[Section] = &[
    Section {
        en: "File",
        ca: "Fitxer",
        role: Role::Normal,
        rows: &[
            item("new-file", "New File…", "Fitxer nou…", CMD_N),
            item(
                "new-markdown",
                "New Markdown File",
                "Fitxer Markdown nou",
                None,
            ),
            item("new-csv", "New CSV File", "Fitxer CSV nou", None),
            item("new-text", "New Text File", "Fitxer de text nou", None),
            Row::Separator,
            item("open", "Open…", "Obre…", CMD_O),
            Row::Separator,
            item(CLOSE, "Close", "Tanca", CMD_W),
            item("save", "Save", "Desa", CMD_S),
            item("save-as", "Save As…", "Anomena i desa…", CMD_SHIFT_S),
            item(
                "revert",
                "Revert to Last Saved",
                "Torna a l'última versió desada",
                None,
            ),
            Row::Separator,
            item(
                "export-html",
                "Export as HTML…",
                "Exporta com a HTML…",
                None,
            ),
            item(
                "export-xlsx",
                "Export as Excel (.xlsx)…",
                "Exporta com a Excel (.xlsx)…",
                None,
            ),
            Row::Separator,
            item(
                "recover",
                "Show Recoverable Files",
                "Mostra els fitxers recuperables",
                None,
            ),
        ],
    },
    Section {
        en: "Edit",
        ca: "Edita",
        role: Role::Normal,
        rows: &[
            item("undo", "Undo", "Desfés", CMD_Z),
            item("redo", "Redo", "Refés", CMD_SHIFT_Z),
            Row::Separator,
            Row::System(System::Cut),
            Row::System(System::Copy),
            Row::System(System::Paste),
            item("select-all", "Select All", "Selecciona-ho tot", CMD_A),
        ],
    },
    Section {
        en: "View",
        ca: "Visualització",
        role: Role::Normal,
        rows: &[
            check_keys("view-split", "Side by Side", "Costat a costat", ALT_1),
            check_keys("view-source", "Source Only", "Només el codi font", ALT_2),
            check_keys("view-rendered", "Rendered Only", "Només el resultat", ALT_3),
            Row::Separator,
            check("view-grid", "Table", "Taula"),
            check("view-raw", "Raw CSV Text", "Text CSV sense format"),
            Row::Separator,
            check("wrap", "Word Wrap", "Ajust de línia"),
            check(
                "toggle-header",
                "First Row as Header",
                "Primera fila com a capçalera",
            ),
            check(
                "remote-images",
                "Load Remote Images",
                "Carrega les imatges remotes",
            ),
            Row::Separator,
            item("palette", "Command Palette…", "Paleta d'ordres…", CMD_K),
            Row::Separator,
            item("zoom-in", "Zoom In", "Augmenta el zoom", CMD_EQUAL),
            item("zoom-out", "Zoom Out", "Redueix el zoom", CMD_MINUS),
            item("zoom-reset", "Actual Size", "Mida real", CMD_0),
            Row::Separator,
            Row::System(System::Fullscreen),
        ],
    },
    Section {
        en: "Table",
        ca: "Taula",
        role: Role::Normal,
        rows: &[
            item(
                "row-above",
                "Insert Row Above",
                "Insereix una fila a sobre",
                None,
            ),
            item(
                "row-below",
                "Insert Row Below",
                "Insereix una fila a sota",
                None,
            ),
            item(
                "row-delete",
                "Delete Selected Rows",
                "Suprimeix les files seleccionades",
                None,
            ),
            item("rows-up", "Move Rows Up", "Mou les files amunt", None),
            item("rows-down", "Move Rows Down", "Mou les files avall", None),
            Row::Separator,
            item(
                "column-left",
                "Insert Column Left",
                "Insereix una columna a l'esquerra",
                None,
            ),
            item(
                "column-right",
                "Insert Column Right",
                "Insereix una columna a la dreta",
                None,
            ),
            item(
                "column-delete",
                "Delete Selected Columns",
                "Suprimeix les columnes seleccionades",
                None,
            ),
            item(
                "columns-left",
                "Move Columns Left",
                "Mou les columnes a l'esquerra",
                None,
            ),
            item(
                "columns-right",
                "Move Columns Right",
                "Mou les columnes a la dreta",
                None,
            ),
        ],
    },
    Section {
        en: "Window",
        ca: "Finestra",
        role: Role::Window,
        rows: &[
            Row::System(System::Minimize),
            Row::System(System::Zoom),
            Row::Separator,
            item("next-tab", "Next Tab", "Pestanya següent", None),
            item("previous-tab", "Previous Tab", "Pestanya anterior", None),
        ],
    },
    Section {
        en: "Help",
        ca: "Ajuda",
        role: Role::Help,
        rows: &[],
    },
];

/// Every item of the app's own in the menu bar.
pub fn items() -> impl Iterator<Item = Item> {
    SECTIONS
        .iter()
        .flat_map(|section| section.rows)
        .filter_map(|row| match row {
            Row::Item(item) => Some(*item),
            _ => None,
        })
        .chain([QUIT_ITEM])
}

/// Rust answers these itself. The page can't turn them off, so closing can never be locked out.
pub fn always_on(id: &str) -> bool {
    id == CLOSE || id == QUIT
}

/// Whether a click should be passed to the page as a command.
pub fn is_page_command(id: &str) -> bool {
    !always_on(id) && items().any(|item| item.id == id)
}

pub fn words(language: &str, en: &'static str, ca: &'static str) -> &'static str {
    if language == "ca" {
        ca
    } else {
        en
    }
}

/// The words for what AppKit provides. `Hide` and `About` name the app.
pub fn system_words(language: &str, item: System) -> &'static str {
    let (en, ca) = match item {
        System::About => ("About full", "Quant a full"),
        System::Services => ("Services", "Serveis"),
        System::Hide => ("Hide full", "Amaga full"),
        System::HideOthers => ("Hide Others", "Amaga les altres"),
        System::ShowAll => ("Show All", "Mostra-ho tot"),
        System::Cut => ("Cut", "Retalla"),
        System::Copy => ("Copy", "Copia"),
        System::Paste => ("Paste", "Enganxa"),
        System::Fullscreen => ("Enter Full Screen", "Pantalla completa"),
        System::Minimize => ("Minimize", "Minimitza"),
        System::Zoom => ("Zoom", "Amplia"),
    };
    words(language, en, ca)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn every_id_is_used_once() {
        let mut seen = HashSet::new();
        for item in items() {
            assert!(seen.insert(item.id), "{} is listed twice", item.id);
        }
    }

    #[test]
    fn close_and_quit_keep_their_own_shortcuts_and_can_not_be_turned_off() {
        let keys = |id| items().find(|item| item.id == id).unwrap().keys;
        assert_eq!(keys(CLOSE), Some("CmdOrCtrl+W"));
        assert_eq!(keys(QUIT), Some("CmdOrCtrl+Q"));
        assert!(always_on(CLOSE) && always_on(QUIT));
        assert!(!always_on("save"));
    }

    #[test]
    fn close_and_quit_never_reach_the_page_as_commands() {
        assert!(!is_page_command(CLOSE));
        assert!(!is_page_command(QUIT));
        assert!(is_page_command("save"));
    }

    #[test]
    fn only_the_table_can_become_a_command() {
        assert!(!is_page_command("../../etc/passwd"));
        assert!(!is_page_command(""));
    }

    #[test]
    fn no_two_items_share_a_shortcut() {
        let mut seen = HashSet::new();
        for keys in items().filter_map(|item| item.keys) {
            assert!(seen.insert(keys), "{keys} is listed twice");
        }
    }

    #[test]
    fn the_words_follow_the_language_and_fall_back_to_english() {
        assert_eq!(words("ca", "Save", "Desa"), "Desa");
        assert_eq!(words("en", "Save", "Desa"), "Save");
        assert_eq!(words("anything else", "Save", "Desa"), "Save");
        assert_eq!(system_words("ca", System::Copy), "Copia");
    }
}
