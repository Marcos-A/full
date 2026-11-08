//! Whether the app may close yet.
//!
//! Every way of closing asks the page first: the red button, the Quit item, Cmd+W with no file
//! open, and what AppKit sends for Dock Quit and logout. With one window, closing it ends the app,
//! so they're all the same question. This holds the state and does nothing itself, so it can be
//! tested without a Mac.

#[derive(Clone, Copy, Debug, Default, PartialEq)]
enum State {
    #[default]
    Idle,
    Asking {
        id: u64,
        acknowledged: bool,
    },
    Approved,
}

/// What to do about a request to close.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Verdict {
    /// Nothing can be lost, so go ahead.
    Proceed,
    /// Ask the page, quoting this number.
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
    /// `from_appkit` is for a request AppKit has to get an answer to before it goes on.
    pub fn request(&mut self, page_ready: bool, from_appkit: bool) -> Verdict {
        match self.state {
            State::Approved => Verdict::Proceed,
            State::Asking { .. } if from_appkit && !self.appkit_waiting => {
                self.appkit_waiting = true;
                Verdict::Joined
            }
            State::Asking { .. } => Verdict::Busy,
            State::Idle if !page_ready => {
                self.state = State::Approved;
                Verdict::Proceed
            }
            State::Idle => {
                self.issued += 1;
                self.state = State::Asking {
                    id: self.issued,
                    acknowledged: false,
                };
                self.appkit_waiting = from_appkit;
                Verdict::Ask(self.issued)
            }
        }
    }

    /// The page has started on it, so it may take as long as the user does.
    pub fn acknowledge(&mut self, asked: u64) {
        if let State::Asking { id, acknowledged } = &mut self.state {
            if *id == asked {
                *acknowledged = true;
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

    /// An answer to a question that's over is ignored, so it can't close the app later.
    pub fn answer(&mut self, asked: u64, close: bool) -> Option<Finish> {
        match self.state {
            State::Asking { id, .. } if id == asked => Some(self.end(close)),
            _ => None,
        }
    }

    /// The page never responded, so it's stuck or gone and can't save anything. Recovery has what
    /// it last wrote, and holding the app open wouldn't add to that.
    pub fn page_silent(&mut self, asked: u64) -> Option<Finish> {
        match self.state {
            State::Asking {
                id,
                acknowledged: false,
            } if id == asked => Some(self.end(true)),
            _ => None,
        }
    }

    /// A new page has loaded in place of the one that was asked, and it knows nothing of this.
    pub fn page_replaced(&mut self) -> Option<Finish> {
        match self.state {
            State::Asking { .. } => Some(self.end(false)),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const READY: bool = true;
    const FROM_APPKIT: bool = true;

    fn asking() -> (Closing, u64) {
        let mut closing = Closing::default();
        let Verdict::Ask(id) = closing.request(READY, false) else {
            panic!("expected to ask");
        };
        (closing, id)
    }

    #[test]
    fn nothing_closes_until_the_page_says_so() {
        let (mut closing, id) = asking();
        assert_eq!(closing.request(READY, false), Verdict::Busy);
        assert_eq!(
            closing.answer(id, true),
            Some(Finish {
                close: true,
                appkit_waiting: false
            })
        );
        assert_eq!(closing.request(READY, false), Verdict::Proceed);
    }

    #[test]
    fn staying_open_lets_the_next_request_ask_again() {
        let (mut closing, id) = asking();
        assert_eq!(
            closing.answer(id, false),
            Some(Finish {
                close: false,
                appkit_waiting: false
            })
        );
        assert_eq!(closing.request(READY, false), Verdict::Ask(id + 1));
    }

    #[test]
    fn a_page_that_is_not_there_cannot_hold_the_app_open() {
        let mut closing = Closing::default();
        assert_eq!(closing.request(!READY, false), Verdict::Proceed);
        assert_eq!(closing.request(!READY, false), Verdict::Proceed);
    }

    #[test]
    fn appkit_is_told_how_its_own_request_ended() {
        let mut closing = Closing::default();
        let Verdict::Ask(id) = closing.request(READY, FROM_APPKIT) else {
            panic!("expected to ask");
        };
        assert_eq!(
            closing.answer(id, false),
            Some(Finish {
                close: false,
                appkit_waiting: true
            })
        );
    }

    #[test]
    fn appkit_can_join_a_question_already_asked_but_only_once() {
        let (mut closing, id) = asking();
        assert_eq!(closing.request(READY, FROM_APPKIT), Verdict::Joined);
        assert_eq!(closing.request(READY, FROM_APPKIT), Verdict::Busy);
        assert_eq!(
            closing.answer(id, true),
            Some(Finish {
                close: true,
                appkit_waiting: true
            })
        );
    }

    #[test]
    fn appkit_goes_straight_through_once_approved() {
        let (mut closing, id) = asking();
        closing.answer(id, true);
        assert_eq!(closing.request(READY, FROM_APPKIT), Verdict::Proceed);
    }

    #[test]
    fn appkit_is_not_told_twice() {
        let mut closing = Closing::default();
        let Verdict::Ask(first) = closing.request(READY, FROM_APPKIT) else {
            panic!("expected to ask");
        };
        closing.answer(first, false);
        let Verdict::Ask(second) = closing.request(READY, false) else {
            panic!("expected to ask");
        };
        assert_eq!(
            closing.answer(second, false),
            Some(Finish {
                close: false,
                appkit_waiting: false
            })
        );
    }

    #[test]
    fn an_old_or_made_up_answer_does_nothing() {
        let (mut closing, id) = asking();
        assert_eq!(closing.answer(id + 1, true), None);
        assert_eq!(closing.answer(0, true), None);
        closing.answer(id, false);
        assert_eq!(closing.answer(id, true), None);
        assert_eq!(closing.request(READY, false), Verdict::Ask(id + 1));
    }

    #[test]
    fn an_answer_with_no_question_does_nothing() {
        let mut closing = Closing::default();
        assert_eq!(closing.answer(1, true), None);
        assert_eq!(closing.request(READY, false), Verdict::Ask(1));
    }

    #[test]
    fn a_silent_page_lets_the_app_close() {
        let (mut closing, id) = asking();
        assert_eq!(
            closing.page_silent(id),
            Some(Finish {
                close: true,
                appkit_waiting: false
            })
        );
        assert_eq!(closing.request(READY, false), Verdict::Proceed);
    }

    #[test]
    fn a_page_that_has_started_may_take_as_long_as_the_user_does() {
        let (mut closing, id) = asking();
        closing.acknowledge(id);
        assert_eq!(closing.page_silent(id), None);
        assert_eq!(closing.request(READY, false), Verdict::Busy);
    }

    #[test]
    fn the_wait_for_an_earlier_question_cannot_end_a_later_one() {
        let (mut closing, first) = asking();
        closing.answer(first, false);
        let Verdict::Ask(second) = closing.request(READY, false) else {
            panic!("expected to ask");
        };
        assert_eq!(closing.page_silent(first), None);
        assert_eq!(closing.request(READY, false), Verdict::Busy);
        assert!(closing.page_silent(second).is_some());
    }

    #[test]
    fn a_reloaded_page_keeps_the_app_open() {
        let mut closing = Closing::default();
        let Verdict::Ask(_) = closing.request(READY, FROM_APPKIT) else {
            panic!("expected to ask");
        };
        assert_eq!(
            closing.page_replaced(),
            Some(Finish {
                close: false,
                appkit_waiting: true
            })
        );
        assert_eq!(closing.page_replaced(), None);
        assert_eq!(closing.request(READY, false), Verdict::Ask(2));
    }

    #[test]
    fn loading_the_page_for_the_first_time_changes_nothing() {
        let mut closing = Closing::default();
        assert_eq!(closing.page_replaced(), None);
        assert_eq!(closing.request(READY, false), Verdict::Ask(1));
    }
}
