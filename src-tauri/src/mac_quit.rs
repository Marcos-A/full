//! Catches quitting at the one place AppKit asks about it.
//!
//! Dock Quit, logout, restart and an Apple event all reach `applicationShouldTerminate:`. Tao's
//! delegate doesn't implement it, so AppKit quits without asking and all Tauri sees is `Exit`.
//! This adds the method to tao's delegate at startup, which needs no fork of tao.

use objc2::ffi::class_addMethod;
use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
use objc2::{class, msg_send, sel};
use std::sync::OnceLock;

/// AppKit's NSApplicationTerminateReply.
#[derive(Clone, Copy)]
#[repr(usize)]
pub enum Reply {
    Cancel = 0,
    Now = 1,
    Later = 2,
}

type Decide = Box<dyn Fn() -> Reply + Send + Sync>;

static DECIDE: OnceLock<Decide> = OnceLock::new();

extern "C-unwind" fn should_terminate(_: *mut AnyObject, _: Sel, _: *mut AnyObject) -> usize {
    DECIDE.get().map_or(Reply::Now, |decide| decide()) as usize
}

fn application() -> *mut AnyObject {
    unsafe { msg_send![class!(NSApplication), sharedApplication] }
}

/// Call this on the main thread, once the event loop exists.
pub fn install(decide: impl Fn() -> Reply + Send + Sync + 'static) {
    if DECIDE.set(Box::new(decide)).is_err() {
        return;
    }
    let app = application();
    unsafe {
        let delegate: *mut AnyObject = msg_send![app, delegate];
        let Some(delegate_ref) = delegate.as_ref() else {
            eprintln!("[full] no application delegate, so quitting can't be held back");
            return;
        };
        let class: *const AnyClass = delegate_ref.class();
        let method: extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> usize =
            should_terminate;
        let added = class_addMethod(
            class as *mut AnyClass,
            sel!(applicationShouldTerminate:),
            std::mem::transmute::<
                extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> usize,
                Imp,
            >(method),
            c"Q@:@".as_ptr(),
        );
        if !added.as_bool() {
            eprintln!("[full] the delegate already answers applicationShouldTerminate:");
        }
        // Setting it again makes AppKit look at what the delegate responds to now.
        let _: () = msg_send![app, setDelegate: delegate];
    }
}

/// Ends a `Later`. Call this on the main thread.
pub fn reply(close: bool) {
    let _: () =
        unsafe { msg_send![application(), replyToApplicationShouldTerminate: Bool::new(close)] };
}
