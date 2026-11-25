//! Whether the app may quit yet.
//!
//! Every way of quitting asks every window's page first: the Quit item, the red button or Cmd+W on
//! the last window, and what AppKit sends for Dock Quit and logout. The app quits only once all of
//! them have agreed, and stays open if any says no. Closing one window of several isn't quitting:
//! that window's page is asked on its own, see `close_one_window` in main.rs. This holds the state
//! and does nothing itself, so it can be tested without a Mac.

use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, PartialEq)]
enum State {
    #[default]
    Idle,
    /// The pages still to answer, and whether each has started on it.
    Asking {
        id: u64,
        waiting: BTreeMap<String, bool>,
    },
    Approved,
}

/// What to do about a request to quit.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Verdict {
    /// Nothing can be lost, so go ahead.
    Proceed,
    /// Ask every page, quoting this number.
    Ask(u64),
    /// AppKit is now waiting for the answer to a question already being asked.
    Joined,
    /// Already asked, and nothing more to do.
    Busy,
}

/// How a question ended. `appkit_waiting` means AppKit has to be told, or the quit never ends.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Finish {
    pub close: bool,
    pub appkit_waiting: bool,
}

#[derive(Default)]
pub struct Closing {
    state: State,
    issued: u64,
    appkit_waiting: bool,
}

impl Closing {
    /// `pages` are the windows whose page is ready to answer. `from_appkit` is for a request AppKit
    /// has to get an answer to before it goes on.
    pub fn request(&mut self, pages: &[String], from_appkit: bool) -> Verdict {
        match &self.state {
            State::Approved => Verdict::Proceed,
            State::Asking { .. } if from_appkit && !self.appkit_waiting => {
                self.appkit_waiting = true;
                Verdict::Joined
            }
            State::Asking { .. } => Verdict::Busy,
            State::Idle if pages.is_empty() => {
                self.state = State::Approved;
                Verdict::Proceed
            }
            State::Idle => {
                self.issued += 1;
                self.state = State::Asking {
                    id: self.issued,
                    waiting: pages.iter().map(|page| (page.clone(), false)).collect(),
                };
                self.appkit_waiting = from_appkit;
                Verdict::Ask(self.issued)
            }
        }
    }

    /// Whether a quit is being asked about, or has been agreed to.
    pub fn in_progress(&self) -> bool {
        self.state != State::Idle
    }

    /// That page has started on it, so it may take as long as the user does.
    pub fn acknowledge(&mut self, asked: u64, page: &str) {
        if let State::Asking { id, waiting } = &mut self.state {
            if *id == asked {
                if let Some(started) = waiting.get_mut(page) {
                    *started = true;
                }
            }
        }
    }

    fn end(&mut self, close: bool) -> Finish {
        self.state = if close { State::Approved } else { State::Idle };
        Finish {
            close,
            appkit_waiting: std::mem::take(&mut self.appkit_waiting),
        }
    }

    /// One page has agreed and is done with it, or as good as: the app quits once none is left.
    fn agreed(&mut self, page: &str) -> Option<Finish> {
        let State::Asking { waiting, .. } = &mut self.state else {
            return None;
        };
        waiting.remove(page)?;
        waiting.is_empty().then(|| self.end(true))
    }

    /// An answer to a question that's over, or from a page that wasn't asked, is ignored, so it
    /// can't quit the app later. One page saying no keeps the app open.
    pub fn answer(&mut self, asked: u64, page: &str, close: bool) -> Option<Finish> {
        match &self.state {
            State::Asking { id, waiting } if *id == asked && waiting.contains_key(page) => {
                if close {
                    self.agreed(page)
                } else {
                    Some(self.end(false))
                }
            }
            _ => None,
        }
    }

    /// The page never responded, so it's stuck or gone and can't save anything. Recovery has what
    /// it last wrote, and holding the app open wouldn't add to that.
    pub fn page_silent(&mut self, asked: u64, page: &str) -> Option<Finish> {
        match &self.state {
            State::Asking { id, waiting } if *id == asked && waiting.get(page) == Some(&false) => {
                self.agreed(page)
            }
            _ => None,
        }
    }

    /// A new page has loaded in that window, in place of the one that was asked, and it knows
    /// nothing of this.
    pub fn page_replaced(&mut self, page: &str) -> Option<Finish> {
        match &self.state {
            State::Asking { waiting, .. } if waiting.contains_key(page) => Some(self.end(false)),
            _ => None,
        }
    }

    /// The window has gone, so there's nothing left in it to ask about.
    pub fn page_gone(&mut self, page: &str) -> Option<Finish> {
        self.agreed(page)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FROM_APPKIT: bool = true;

    fn pages(labels: &[&str]) -> Vec<String> {
        labels.iter().map(|label| label.to_string()).collect()
    }

    fn one() -> Vec<String> {
        pages(&["main"])
    }

    fn asking() -> (Closing, u64) {
        let mut closing = Closing::default();
        let Verdict::Ask(id) = closing.request(&one(), false) else {
            panic!("expected to ask");
        };
        (closing, id)
    }

    const CLOSE: Finish = Finish {
        close: true,
        appkit_waiting: false,
    };
    const STAY: Finish = Finish {
        close: false,
        appkit_waiting: false,
    };

    #[test]
    fn nothing_closes_until_the_page_says_so() {
        let (mut closing, id) = asking();
        assert_eq!(closing.request(&one(), false), Verdict::Busy);
        assert!(closing.in_progress());
        assert_eq!(closing.answer(id, "main", true), Some(CLOSE));
        assert_eq!(closing.request(&one(), false), Verdict::Proceed);
    }

    #[test]
    fn staying_open_lets_the_next_request_ask_again() {
        let (mut closing, id) = asking();
        assert_eq!(closing.answer(id, "main", false), Some(STAY));
        assert!(!closing.in_progress());
        assert_eq!(closing.request(&one(), false), Verdict::Ask(id + 1));
    }

    #[test]
    fn a_page_that_is_not_there_cannot_hold_the_app_open() {
        let mut closing = Closing::default();
        assert_eq!(closing.request(&[], false), Verdict::Proceed);
        assert_eq!(closing.request(&[], false), Verdict::Proceed);
    }

    #[test]
    fn appkit_is_told_how_its_own_request_ended() {
        let mut closing = Closing::default();
        let Verdict::Ask(id) = closing.request(&one(), FROM_APPKIT) else {
            panic!("expected to ask");
        };
        assert_eq!(
            closing.answer(id, "main", false),
            Some(Finish {
                close: false,
                appkit_waiting: true
            })
        );
    }

    #[test]
    fn appkit_can_join_a_question_already_asked_but_only_once() {
        let (mut closing, id) = asking();
        assert_eq!(closing.request(&one(), FROM_APPKIT), Verdict::Joined);
        assert_eq!(closing.request(&one(), FROM_APPKIT), Verdict::Busy);
        assert_eq!(
            closing.answer(id, "main", true),
            Some(Finish {
                close: true,
                appkit_waiting: true
            })
        );
    }

    #[test]
    fn appkit_goes_straight_through_once_approved() {
        let (mut closing, id) = asking();
        closing.answer(id, "main", true);
        assert_eq!(closing.request(&one(), FROM_APPKIT), Verdict::Proceed);
    }

    #[test]
    fn appkit_is_not_told_twice() {
        let mut closing = Closing::default();
        let Verdict::Ask(first) = closing.request(&one(), FROM_APPKIT) else {
            panic!("expected to ask");
        };
        closing.answer(first, "main", false);
        let Verdict::Ask(second) = closing.request(&one(), false) else {
            panic!("expected to ask");
        };
        assert_eq!(closing.answer(second, "main", false), Some(STAY));
    }

    #[test]
    fn an_old_or_made_up_answer_does_nothing() {
        let (mut closing, id) = asking();
        assert_eq!(closing.answer(id + 1, "main", true), None);
        assert_eq!(closing.answer(0, "main", true), None);
        assert_eq!(closing.answer(id, "window-9", true), None);
        closing.answer(id, "main", false);
        assert_eq!(closing.answer(id, "main", true), None);
        assert_eq!(closing.request(&one(), false), Verdict::Ask(id + 1));
    }

    #[test]
    fn an_answer_with_no_question_does_nothing() {
        let mut closing = Closing::default();
        assert_eq!(closing.answer(1, "main", true), None);
        assert_eq!(closing.request(&one(), false), Verdict::Ask(1));
    }

    #[test]
    fn a_silent_page_lets_the_app_close() {
        let (mut closing, id) = asking();
        assert_eq!(closing.page_silent(id, "main"), Some(CLOSE));
        assert_eq!(closing.request(&one(), false), Verdict::Proceed);
    }

    #[test]
    fn a_page_that_has_started_may_take_as_long_as_the_user_does() {
        let (mut closing, id) = asking();
        closing.acknowledge(id, "main");
        assert_eq!(closing.page_silent(id, "main"), None);
        assert_eq!(closing.request(&one(), false), Verdict::Busy);
    }

    #[test]
    fn the_wait_for_an_earlier_question_cannot_end_a_later_one() {
        let (mut closing, first) = asking();
        closing.answer(first, "main", false);
        let Verdict::Ask(second) = closing.request(&one(), false) else {
            panic!("expected to ask");
        };
        assert_eq!(closing.page_silent(first, "main"), None);
        assert_eq!(closing.request(&one(), false), Verdict::Busy);
        assert!(closing.page_silent(second, "main").is_some());
    }

    #[test]
    fn a_reloaded_page_keeps_the_app_open() {
        let mut closing = Closing::default();
        let Verdict::Ask(_) = closing.request(&one(), FROM_APPKIT) else {
            panic!("expected to ask");
        };
        assert_eq!(
            closing.page_replaced("main"),
            Some(Finish {
                close: false,
                appkit_waiting: true
            })
        );
        assert_eq!(closing.page_replaced("main"), None);
        assert_eq!(closing.request(&one(), false), Verdict::Ask(2));
    }

    #[test]
    fn loading_the_page_for_the_first_time_changes_nothing() {
        let mut closing = Closing::default();
        assert_eq!(closing.page_replaced("main"), None);
        assert_eq!(closing.request(&one(), false), Verdict::Ask(1));
    }

    // With several windows.

    fn asking_two() -> (Closing, u64) {
        let mut closing = Closing::default();
        let Verdict::Ask(id) = closing.request(&pages(&["main", "window-1"]), false) else {
            panic!("expected to ask");
        };
        (closing, id)
    }

    #[test]
    fn the_app_quits_only_once_every_window_has_agreed() {
        let (mut closing, id) = asking_two();
        assert_eq!(closing.answer(id, "main", true), None);
        assert_eq!(closing.answer(id, "main", true), None);
        assert_eq!(closing.request(&pages(&["window-1"]), false), Verdict::Busy);
        assert_eq!(closing.answer(id, "window-1", true), Some(CLOSE));
    }

    #[test]
    fn one_window_saying_no_keeps_the_app_open() {
        let (mut closing, id) = asking_two();
        assert_eq!(closing.answer(id, "main", true), None);
        assert_eq!(closing.answer(id, "window-1", false), Some(STAY));
        assert!(!closing.in_progress());
    }

    #[test]
    fn a_window_opened_during_the_question_is_not_waited_for() {
        let (mut closing, id) = asking_two();
        assert_eq!(closing.page_replaced("window-2"), None);
        assert_eq!(closing.answer(id, "window-2", true), None);
        closing.answer(id, "main", true);
        assert_eq!(closing.answer(id, "window-1", true), Some(CLOSE));
    }

    #[test]
    fn a_window_that_closes_during_the_question_is_not_waited_for() {
        let (mut closing, id) = asking_two();
        assert_eq!(closing.page_gone("window-1"), None);
        assert_eq!(closing.answer(id, "main", true), Some(CLOSE));
    }

    #[test]
    fn the_last_window_going_away_ends_the_question() {
        let (mut closing, id) = asking_two();
        closing.answer(id, "main", true);
        assert_eq!(closing.page_gone("window-1"), Some(CLOSE));
        assert_eq!(closing.page_gone("main"), None);
    }

    #[test]
    fn each_window_has_its_own_wait() {
        let (mut closing, id) = asking_two();
        closing.acknowledge(id, "main");
        assert_eq!(closing.page_silent(id, "main"), None);
        // Silence from the other counts as its agreement, and the started one is still to answer.
        assert_eq!(closing.page_silent(id, "window-1"), None);
        assert_eq!(closing.answer(id, "main", true), Some(CLOSE));
    }

    #[test]
    fn reloading_one_window_keeps_the_app_open() {
        let (mut closing, id) = asking_two();
        closing.answer(id, "main", true);
        assert_eq!(closing.page_replaced("window-1"), Some(STAY));
    }

    #[test]
    fn nothing_goes_away_when_no_one_is_asking() {
        let mut closing = Closing::default();
        assert_eq!(closing.page_gone("main"), None);
        assert!(!closing.in_progress());
    }
}
