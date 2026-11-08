//! Measuring the app against the budgets in the audit, on the same build people install. With
//! `FULL_TIMINGS` unset, which is how the app normally runs, this measures and prints nothing.
//!
//! Started as `FULL_TIMINGS=<milliseconds since 1970> full`, the launch is timed from that moment.
//! Started with any other value, everything but the launch time is still printed.

use std::time::{SystemTime, UNIX_EPOCH};

/// A report comes from the page, so it can't flood or fake a line in the log.
const LONGEST_REPORT: usize = 200;

pub struct Timings {
    enabled: bool,
    launched_at_ms: Option<f64>,
}

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0.0, |elapsed| elapsed.as_secs_f64() * 1000.0)
}

/// One line, whatever the page sent. The launch time is added here, from the clock on this side.
fn line(report: &str, launched_at_ms: Option<f64>, now_ms: f64) -> String {
    let report: String = report
        .chars()
        .filter(|c| !c.is_control())
        .take(LONGEST_REPORT)
        .collect();
    match launched_at_ms {
        Some(start) if report == "ready" => {
            format!("[full] timing ready launch-ms={:.0}", now_ms - start)
        }
        _ => format!("[full] timing {report}"),
    }
}

impl Timings {
    pub fn from_env() -> Self {
        Self::from_value(std::env::var("FULL_TIMINGS").ok().as_deref())
    }

    fn from_value(value: Option<&str>) -> Self {
        Timings {
            enabled: value.is_some(),
            launched_at_ms: value.and_then(|text| text.parse().ok()),
        }
    }

    /// Prints the report if timings are on, and says whether they are.
    pub fn report(&self, report: &str) -> bool {
        if self.enabled && report != "check" {
            eprintln!("{}", line(report, self.launched_at_ms, now_ms()));
        }
        self.enabled
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn off_unless_the_variable_is_set() {
        assert!(!Timings::from_value(None).report("anything"));
        assert!(Timings::from_value(Some("1")).report("check"));
    }

    #[test]
    fn the_launch_is_timed_from_the_moment_given() {
        assert_eq!(
            line("ready", Some(1000.0), 1812.4),
            "[full] timing ready launch-ms=812"
        );
    }

    #[test]
    fn with_no_start_time_ready_is_still_reported() {
        let timings = Timings::from_value(Some("yes"));
        assert_eq!(timings.launched_at_ms, None);
        assert_eq!(line("ready", None, 5.0), "[full] timing ready");
    }

    #[test]
    fn a_report_can_not_break_the_log_into_more_lines_or_run_on() {
        assert_eq!(
            line("open\nfake [full] line", None, 0.0),
            "[full] timing openfake [full] line"
        );
        let long = "x".repeat(500);
        assert_eq!(line(&long, None, 0.0).len(), "[full] timing ".len() + 200);
    }
}
