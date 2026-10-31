//! Small native hooks for the phone shell: edge-to-edge layout and Taptic Engine feedback.

use super::*;

/// Plays the Taptic Engine pattern for an event: UIKit's success, warning and error notifications for a
/// finished run, a question waiting for the user and a failed run; a single impact for an error in the app.
#[tauri::command]
pub fn haptic<R: Runtime>(app: AppHandle<R>, kind: String) -> Result<(), String> {
    app.run_on_main_thread(move || unsafe {
        use objc2::rc::Retained;
        use objc2::runtime::AnyObject;
        use objc2::{class, msg_send};
        let notification: Option<isize> = match kind.as_str() {
            "done" => Some(0),
            "input" => Some(1),
            "error" => Some(2),
            _ => None,
        };
        if let Some(kind) = notification {
            let generator: Option<Retained<AnyObject>> = msg_send![class!(UINotificationFeedbackGenerator), new];
            if let Some(g) = generator {
                let _: () = msg_send![&*g, notificationOccurred: kind];
            }
        } else {
            let generator: Option<Retained<AnyObject>> = msg_send![class!(UIImpactFeedbackGenerator), new];
            if let Some(g) = generator {
                let _: () = msg_send![&*g, impactOccurred];
            }
        }
    })
    .map_err(|e| e.to_string())
}

/// Let the page draw edge to edge. By default the WKWebView's scroll view insets its content by
/// the safe areas, which shrinks the layout viewport (fixed elements stop short of the bottom);
/// the frontend already pads for the notch and home indicator with the safe-area insets.
pub(super) fn edge_to_edge<R: Runtime>(app: &tauri::App<R>) {
    let Some(window) = app.get_webview_window("main") else { return };
    let _ = window.with_webview(|webview| unsafe {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        const UI_SCROLL_VIEW_CONTENT_INSET_ADJUSTMENT_NEVER: isize = 2;
        let wk = webview.inner() as *mut AnyObject;
        let scroll: *mut AnyObject = msg_send![wk, scrollView];
        let _: () = msg_send![scroll, setContentInsetAdjustmentBehavior: UI_SCROLL_VIEW_CONTENT_INSET_ADJUSTMENT_NEVER];
    });
}
