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
        // An HTML file's preview is an `<iframe srcdoc>`, whose content only the app can set. A link
        // in it takes the frame to a blank page whose fragment holds the link, for the page to read.
        "about" => matches!(url.path(), "blank" | "srcdoc") && url.query().is_none(),
        "http" => dev && url.host_str() == Some("localhost") && url.port() == Some(5173),
        _ => false,
    }
}

const PREVIEW_LINK: &str = "full-link=";

/// The link a rewritten HTML preview link carries (`about:blank#full-link=<encoded>`, see
/// htmlPreview.ts), from the address WebKit reports, in whatever form it reports it.
pub fn preview_link(url: &Url) -> Option<String> {
    if url.scheme() != "about" {
        return None;
    }
    let text = url.as_str();
    let encoded = &text[text.find(PREVIEW_LINK)? + PREVIEW_LINK.len()..];
    // WebKit may have encoded it once more on the way.
    let once = percent_decode(encoded)?;
    if once.starts_with("http%3A") || once.starts_with("https%3A") || once.starts_with("mailto%3A")
    {
        return percent_decode(&once);
    }
    Some(once)
}

/// `%XX` escapes back to UTF-8, as encodeURIComponent wrote them. None for a malformed escape.
fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = text.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
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
        assert!(stays_in_app(&url("about:srcdoc"), false));
        assert!(stays_in_app(
            &url("about:blank#full-link=https%3A%2F%2Fexample.com%2F"),
            false
        ));
        for other in [
            "https://full.marcos-a.com/",
            "http://localhost:5173/",
            "tauri://example.com/",
            "file:///etc/passwd",
            "data:text/html,hi",
            "about:config",
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

    #[test]
    fn a_preview_link_is_read_back_in_any_form() {
        let link = Some("http://www.youtube.com/?a=1&b=é".to_string());
        let written = "http%3A%2F%2Fwww.youtube.com%2F%3Fa%3D1%26b%3D%C3%A9";
        assert_eq!(
            preview_link(&url(&format!("about:blank#full-link={written}"))),
            link
        );
        assert_eq!(
            preview_link(&url(&format!("about:blank%23full-link={written}"))),
            link
        );
        assert_eq!(
            preview_link(&url(&format!("about:srcdoc#full-link={written}"))),
            link
        );
        let twice = written.replace('%', "%25");
        assert_eq!(
            preview_link(&url(&format!("about:blank#full-link={twice}"))),
            link
        );
        assert_eq!(
            preview_link(&url("about:blank#full-link=%23intro")),
            Some("#intro".to_string())
        );
        assert_eq!(preview_link(&url("about:blank")), None);
        assert_eq!(preview_link(&url("https://example.com/#full-link=x")), None);
        assert_eq!(preview_link(&url("about:blank#full-link=%ZZ")), None);
    }
}
