// The software keyboard on iOS. WKWebView observes the keyboard notifications itself: as the keyboard
// moves it records how much of the view is covered, insets and scrolls its scroll view, and scrolls the
// focused field into view, all inside the keyboard's animation. That is what moved the whole app up.
// (Resetting the scroll from an observer only stacked a second animation on the first: up, then back.)
// So WKWebView is taken off those notifications, as Capacitor's keyboard plugin does, and never learns of
// the keyboard; the page is told instead, as the keyboard starts to move, its height and the animation's
// duration, and lifts its bottom edge with a matching transition, so only the composer rides up.
// `interactive-widget=overlays-content` would ask WebKit for this directly, but iOS does not support it.
use objc2::encode::{Encode, Encoding};
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject, NSObjectProtocol};
use objc2::{class, define_class, msg_send, sel, ClassType};
use std::ffi::CString;
use std::sync::OnceLock;
use tauri::{Emitter, Manager, Runtime};

#[repr(C)]
#[derive(Clone, Copy)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CGSize {
    width: f64,
    height: f64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CGRect {
    origin: CGPoint,
    size: CGSize,
}

unsafe impl Encode for CGPoint {
    const ENCODING: Encoding = Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
}
unsafe impl Encode for CGSize {
    const ENCODING: Encoding = Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]);
}
unsafe impl Encode for CGRect {
    const ENCODING: Encoding = Encoding::Struct("CGRect", &[CGPoint::ENCODING, CGSize::ENCODING]);
}

/// The notifications WKWebView registers for in `_registerForNotifications`.
const WEBKIT_KEYBOARD_NOTIFICATIONS: [&str; 4] = [
    "UIKeyboardWillChangeFrameNotification",
    "UIKeyboardDidChangeFrameNotification",
    "UIKeyboardWillShowNotification",
    "UIKeyboardWillHideNotification",
];

/// Sends the keyboard's height over the page and its animation duration to the front end.
static REPORT: OnceLock<Box<dyn Fn(f64, f64) + Send + Sync>> = OnceLock::new();

/// An autoreleased NSString. UIKit's notification and user-info key constants equal their own names.
unsafe fn ns(s: &str) -> *mut AnyObject {
    let c = CString::new(s).unwrap_or_default();
    msg_send![class!(NSString), stringWithUTF8String: c.as_ptr()]
}

unsafe fn keyboard_changed(note: &AnyObject) {
    let info: *mut AnyObject = msg_send![note, userInfo];
    if info.is_null() {
        return;
    }
    let frame: *mut AnyObject = msg_send![info, objectForKey: ns("UIKeyboardFrameEndUserInfoKey")];
    let duration: *mut AnyObject = msg_send![info, objectForKey: ns("UIKeyboardAnimationDurationUserInfoKey")];
    if frame.is_null() {
        return;
    }
    // The end frame is in screen coordinates; the web view fills the screen, so what the keyboard covers
    // is everything below its top edge.
    let end: CGRect = msg_send![frame, CGRectValue];
    let screen: *mut AnyObject = msg_send![class!(UIScreen), mainScreen];
    let bounds: CGRect = msg_send![screen, bounds];
    let height = (bounds.size.height - end.origin.y).clamp(0.0, bounds.size.height);
    let seconds: f64 = if duration.is_null() { 0.25 } else { msg_send![duration, doubleValue] };
    if let Some(report) = REPORT.get() {
        report(height, seconds);
    }
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements, and the class implements no Drop.
    #[unsafe(super(NSObject))]
    #[name = "KestrelKeyboardObserver"]
    struct Observer;

    impl Observer {
        #[unsafe(method(keyboardWillChangeFrame:))]
        fn keyboard_will_change_frame(&self, note: &AnyObject) {
            unsafe { keyboard_changed(note) }
        }
    }

    unsafe impl NSObjectProtocol for Observer {}
);

pub fn install<R: Runtime>(app: &tauri::App<R>) {
    let handle = app.handle().clone();
    let _ = REPORT.set(Box::new(move |height, duration| {
        let _ = handle.emit("kestrel://keyboard", serde_json::json!({ "height": height, "duration": duration }));
    }));
    let Some(window) = app.get_webview_window("main") else { return };
    let _ = window.with_webview(|webview| unsafe {
        let center: *mut AnyObject = msg_send![class!(NSNotificationCenter), defaultCenter];
        let wk = webview.inner() as *mut AnyObject;
        let none = std::ptr::null_mut::<AnyObject>();
        for name in WEBKIT_KEYBOARD_NOTIFICATIONS {
            let _: () = msg_send![center, removeObserver: wk, name: ns(name), object: none];
        }
        let observer: Retained<AnyObject> = msg_send![Observer::class(), new];
        let _: () = msg_send![
            center,
            addObserver: &*observer,
            selector: sel!(keyboardWillChangeFrame:),
            name: ns("UIKeyboardWillChangeFrameNotification"),
            object: none
        ];
        // Observes for as long as the app runs.
        std::mem::forget(observer);
    });
}
