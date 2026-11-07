//! What may leave the app, and what may load inside it. The webview is never trusted to decide.

use tauri::Url;

/// The same rule as `classifyLink` in src/core/urls.ts. link-cases.txt holds both to the same cases.
const EXTERNAL_SCHEMES: [&str; 4] = ["http", "https", "mailto", "tel"];

/// The URL to hand to the system, or nothing if this isn't a link the app opens.
pub fn parse_external(href: &str) -> Option<Url> {
    let url = Url::parse(href.trim()).ok()?;
    EXTERNAL_SCHEMES.contains(&url.scheme()).then_some(url)
}

/// Whether the webview may load this itself. Anything else, such as "Open Link" in the context
/// menu, would replace the app with a remote page. `dev` also allows the Vite dev server.
pub fn stays_in_app(url: &Url, dev: bool) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        // "Download copy" saves through a blob link, until M4 gives it a native route.
        "blob" => Url::parse(url.path())
            .is_ok_and(|inner| inner.scheme() != "blob" && stays_in_app(&inner, dev)),
        "about" => url.as_str() == "about:blank",
        "http" => dev && url.host_str() == Some("localhost") && url.port() == Some(5173),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> Url {
        Url::parse(text).unwrap()
    }

    #[test]
    fn external_links_follow_the_shared_cases() {
        let cases = include_str!("link-cases.txt");
        let mut checked = 0;
        for line in cases
            .lines()
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
        {
            let (expected, href) = line.split_once('\t').unwrap();
            assert_eq!(
                parse_external(href).is_some(),
                expected == "external",
                "{href:?}"
            );
            checked += 1;
        }
        assert!(checked > 10);
    }

    #[test]
    fn what_reaches_the_system_is_the_parsed_url() {
        let parsed = parse_external("  https://example.com/a b\n").unwrap();
        assert_eq!(parsed.as_str(), "https://example.com/a%20b");
    }

    #[test]
    fn only_the_bundled_app_stays_in_the_webview() {
        assert!(stays_in_app(&url("tauri://localhost/"), false));
        assert!(stays_in_app(&url("tauri://localhost/index.html"), false));
        assert!(stays_in_app(&url("about:blank"), false));
        for other in [
            "https://full.marcos-a.com/",
            "http://localhost:5173/",
            "tauri://example.com/",
            "file:///etc/passwd",
            "data:text/html,hi",
            "about:srcdoc",
            "javascript:alert(1)",
        ] {
            assert!(!stays_in_app(&url(other), false), "{other}");
        }
    }

    #[test]
    fn blobs_stay_only_if_the_app_made_them() {
        assert!(stays_in_app(&url("blob:tauri://localhost/8a1b"), false));
        assert!(!stays_in_app(&url("blob:https://example.com/8a1b"), false));
        assert!(!stays_in_app(
            &url("blob:blob:tauri://localhost/8a1b"),
            false
        ));
        assert!(!stays_in_app(&url("blob:nonsense"), false));
    }

    #[test]
    fn the_dev_server_is_allowed_only_in_dev() {
        assert!(stays_in_app(&url("http://localhost:5173/"), true));
        assert!(stays_in_app(&url("blob:http://localhost:5173/8a1b"), true));
        assert!(!stays_in_app(&url("http://localhost:5174/"), true));
        assert!(!stays_in_app(&url("https://localhost:5173/"), true));
        assert!(!stays_in_app(&url("http://example.com:5173/"), true));
    }
}
