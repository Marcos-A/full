//! The app's windows, each with its own page, and which of them is in front.
//!
//! Every window loads the same page, which knows only its own files. Native events for a window go
//! to that window's page: a drop goes to the window it landed on, and the menu, Finder's files and
//! Cmd+W go to the window in front. Like the closing state, this holds no Tauri types, so it can be
//! tested without a Mac.

use crate::native_events::Inbox;
use std::collections::HashMap;

/// The window built from tauri.conf.json, which is the first and, until another opens, the only one.
pub const FIRST: &str = "main";

pub struct Pages<T> {
    inboxes: HashMap<String, Inbox<T>>,
    /// Open windows, least recently focused first, so the last one is in front.
    order: Vec<String>,
}

impl<T> Default for Pages<T> {
    fn default() -> Self {
        Pages {
            inboxes: HashMap::new(),
            order: Vec::new(),
        }
    }
}

impl<T> Pages<T> {
    /// A new window comes to the front, as it opens in front of the others.
    pub fn opened(&mut self, label: &str) {
        self.order.retain(|open| open != label);
        self.order.push(label.to_string());
    }

    /// A window that comes forward. A label that isn't open is ignored.
    pub fn focused(&mut self, label: &str) {
        if let Some(index) = self.order.iter().position(|open| open == label) {
            let label = self.order.remove(index);
            self.order.push(label);
        }
    }

    /// The window is gone, with whatever its page hadn't been given yet.
    pub fn closed(&mut self, label: &str) {
        self.order.retain(|open| open != label);
        self.inboxes.remove(label);
    }

    /// The window in front. Before any window exists, Finder's files are kept for the first one.
    pub fn front(&self) -> &str {
        self.order.last().map_or(FIRST, String::as_str)
    }

    pub fn window_count(&self) -> usize {
        self.order.len()
    }

    pub fn inbox(&mut self, label: &str) -> &mut Inbox<T> {
        self.inboxes.entry(label.to_string()).or_default()
    }

    pub fn front_inbox(&mut self) -> &mut Inbox<T> {
        let front = self.front().to_string();
        self.inbox(&front)
    }

    /// The open windows whose page is ready to be asked something.
    pub fn connected(&self) -> Vec<String> {
        self.order
            .iter()
            .filter(|label| self.inboxes.get(*label).is_some_and(Inbox::is_connected))
            .cloned()
            .collect()
    }

    pub fn is_connected(&self, label: &str) -> bool {
        self.inboxes.get(label).is_some_and(Inbox::is_connected)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    type Log = Arc<Mutex<Vec<&'static str>>>;

    fn recorder(log: &Log) -> Box<dyn FnMut(&'static str) + Send> {
        let log = log.clone();
        Box::new(move |item| log.lock().unwrap().push(item))
    }

    #[test]
    fn files_from_finder_before_any_window_wait_for_the_first() {
        let mut pages = Pages::default();
        pages.front_inbox().deliver("file");
        pages.opened(FIRST);
        let log = Log::default();
        pages.inbox(FIRST).connect(recorder(&log));
        assert_eq!(*log.lock().unwrap(), ["file"]);
    }

    #[test]
    fn the_last_window_opened_or_focused_is_in_front() {
        let mut pages: Pages<&str> = Pages::default();
        pages.opened(FIRST);
        pages.opened("window-1");
        assert_eq!(pages.front(), "window-1");
        pages.focused(FIRST);
        assert_eq!(pages.front(), FIRST);
        pages.focused("not-a-window");
        assert_eq!(pages.front(), FIRST);
        assert_eq!(pages.window_count(), 2);
    }

    #[test]
    fn closing_the_front_window_brings_the_one_behind_it_forward() {
        let mut pages: Pages<&str> = Pages::default();
        pages.opened(FIRST);
        pages.opened("window-1");
        pages.opened("window-2");
        pages.focused(FIRST);
        pages.closed(FIRST);
        assert_eq!(pages.front(), "window-2");
        assert_eq!(pages.window_count(), 2);
    }

    #[test]
    fn events_go_to_the_window_they_are_for() {
        let mut pages = Pages::default();
        pages.opened(FIRST);
        pages.opened("window-1");
        let first = Log::default();
        let second = Log::default();
        pages.inbox(FIRST).connect(recorder(&first));
        pages.inbox("window-1").connect(recorder(&second));
        pages.inbox(FIRST).deliver("drop");
        pages.front_inbox().deliver("menu");
        assert_eq!(*first.lock().unwrap(), ["drop"]);
        assert_eq!(*second.lock().unwrap(), ["menu"]);
    }

    #[test]
    fn only_open_windows_with_a_ready_page_are_asked() {
        let mut pages = Pages::default();
        pages.opened(FIRST);
        pages.opened("window-1");
        pages.inbox(FIRST).connect(recorder(&Log::default()));
        assert_eq!(pages.connected(), [FIRST]);
        assert!(pages.is_connected(FIRST));
        assert!(!pages.is_connected("window-1"));
        pages.closed(FIRST);
        assert!(pages.connected().is_empty());
        assert!(!pages.is_connected(FIRST));
    }
}
