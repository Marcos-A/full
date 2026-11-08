//! What the native side tells the page without being asked.

use crate::grants::Offered;
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NativeEvent {
    DragEntered,
    DragLeft,
    Files {
        files: Vec<Offered>,
    },
    /// Cmd+W: the page knows whether there's a file to close.
    CloseFile,
    /// The app is about to close. The page has to answer with this `id`.
    CloseRequested {
        id: u64,
    },
}

/// Holds events for the page until it's ready. Finder can hand over a file before the page has
/// loaded, so anything that must arrive waits here until the page connects.
pub struct Inbox<T> {
    held: Vec<T>,
    send: Option<Box<dyn FnMut(T) + Send>>,
}

impl<T> Default for Inbox<T> {
    fn default() -> Self {
        Inbox {
            held: Vec::new(),
            send: None,
        }
    }
}

impl<T> Inbox<T> {
    /// For what must arrive, like files to open.
    pub fn deliver(&mut self, item: T) {
        match &mut self.send {
            Some(send) => send(item),
            None => self.held.push(item),
        }
    }

    /// For what only matters right now, like showing a drag.
    pub fn deliver_if_connected(&mut self, item: T) {
        if let Some(send) = &mut self.send {
            send(item);
        }
    }

    pub fn is_connected(&self) -> bool {
        self.send.is_some()
    }

    /// Hands over what's been held, in order. Connecting again replaces the page that was there,
    /// as a reload does.
    pub fn connect(&mut self, mut send: Box<dyn FnMut(T) + Send>) {
        self.held.drain(..).for_each(&mut send);
        self.send = Some(send);
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
    fn cold_start_files_wait_until_the_page_asks() {
        let log = Log::default();
        let mut inbox = Inbox::default();
        inbox.deliver("first");
        inbox.deliver("second");
        assert!(log.lock().unwrap().is_empty());
        inbox.connect(recorder(&log));
        assert_eq!(*log.lock().unwrap(), ["first", "second"]);
    }

    #[test]
    fn warm_opens_go_straight_through() {
        let log = Log::default();
        let mut inbox = Inbox::default();
        inbox.connect(recorder(&log));
        inbox.deliver("now");
        assert_eq!(*log.lock().unwrap(), ["now"]);
    }

    #[test]
    fn held_files_are_handed_over_once() {
        let first = Log::default();
        let second = Log::default();
        let mut inbox = Inbox::default();
        inbox.deliver("file");
        inbox.connect(recorder(&first));
        inbox.connect(recorder(&second));
        assert_eq!(*first.lock().unwrap(), ["file"]);
        assert!(second.lock().unwrap().is_empty());
    }

    #[test]
    fn a_drag_before_the_page_is_ready_is_forgotten() {
        let log = Log::default();
        let mut inbox = Inbox::default();
        inbox.deliver_if_connected("drag");
        inbox.connect(recorder(&log));
        assert!(log.lock().unwrap().is_empty());
        inbox.deliver_if_connected("drag");
        assert_eq!(*log.lock().unwrap(), ["drag"]);
    }

    #[test]
    fn the_page_gets_the_names_it_expects() {
        let json = serde_json::to_value(NativeEvent::Files { files: vec![] }).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "files", "files": [] }));
        let json = serde_json::to_value(NativeEvent::DragEntered).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "dragEntered" }));
        let json = serde_json::to_value(NativeEvent::DragLeft).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "dragLeft" }));
        let json = serde_json::to_value(NativeEvent::CloseFile).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "closeFile" }));
        let json = serde_json::to_value(NativeEvent::CloseRequested { id: 7 }).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "closeRequested", "id": 7 })
        );
    }

    #[test]
    fn it_knows_whether_a_page_is_there() {
        let log = Log::default();
        let mut inbox = Inbox::default();
        assert!(!inbox.is_connected());
        inbox.connect(recorder(&log));
        assert!(inbox.is_connected());
    }
}
