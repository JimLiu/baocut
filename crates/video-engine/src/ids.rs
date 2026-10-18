//! 服务端分配的 ID 与时间戳。

use std::time::{SystemTime, UNIX_EPOCH};

/// `<前缀>_<16 位十六进制>`。实体 ID 只要求在视频内唯一且稳定。
pub fn new_id(prefix: &str) -> String {
    let hex = uuid::Uuid::new_v4().simple().to_string();
    format!("{prefix}_{}", &hex[..16])
}

/// 事务 ID 用完整的 128 位。
pub fn new_transaction_id() -> String {
    format!("tx_{}", uuid::Uuid::new_v4().simple())
}

/// 当前时间的 RFC 3339（UTC，毫秒）。
pub fn now_rfc3339() -> String {
    let elapsed = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    rfc3339_from_unix(elapsed.as_secs(), elapsed.subsec_millis())
}

/// Unix 时间换算成 RFC 3339（UTC，毫秒）。
pub fn rfc3339_from_unix(secs: u64, millis: u32) -> String {
    let secs = secs as i64;
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

/// [`rfc3339_from_unix`] 写出的时间（`YYYY-MM-DDTHH:MM:SS[.mmm]Z`）换算回 Unix 毫秒；别的写法为 `None`。
pub fn unix_millis_from_rfc3339(text: &str) -> Option<i64> {
    let text = text.strip_suffix('Z')?;
    let (date, time) = text.split_once('T')?;
    let mut date = date.splitn(3, '-').map(|p| p.parse::<i64>().ok());
    let (year, month, day) = (date.next()??, date.next()??, date.next()??);
    let (clock, millis) = match time.split_once('.') {
        Some((clock, fraction)) if fraction.len() == 3 => (clock, fraction.parse::<i64>().ok()?),
        Some(_) => return None,
        None => (time, 0),
    };
    let mut clock = clock.splitn(3, ':').map(|p| p.parse::<i64>().ok());
    let (hour, minute, second) = (clock.next()??, clock.next()??, clock.next()??);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    let days = days_from_civil(year, month as u32, day as u32);
    Some(((days * 86_400 + hour * 3600 + minute * 60 + second) * 1000) + millis)
}

/// 公历日期换算成 1970-01-01 起的天数（[`civil_from_days`] 的逆）。
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let yoe = year.rem_euclid(400);
    let mp = if month > 2 { month - 3 } else { month + 9 } as i64;
    let doy = (153 * mp + 2) / 5 + day as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// 1970-01-01 起的天数换算成公历日期（Howard Hinnant 的算法）。
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + if month <= 2 { 1 } else { 0 };
    (year, month, day)
}

#[cfg(test)]
mod tests {
    #[test]
    fn civil_dates() {
        assert_eq!(super::civil_from_days(0), (1970, 1, 1));
        assert_eq!(super::civil_from_days(20_728), (2026, 10, 2));
        assert_eq!(super::civil_from_days(11_016), (2000, 2, 29));
        for days in [0, 11_016, 20_728, -1, 50_000] {
            let (y, m, d) = super::civil_from_days(days);
            assert_eq!(super::days_from_civil(y, m, d), days);
        }
    }

    #[test]
    fn rfc3339_round_trips() {
        let text = super::rfc3339_from_unix(1_792_222_867, 123);
        assert_eq!(super::unix_millis_from_rfc3339(&text), Some(1_792_222_867_123));
        assert_eq!(
            super::unix_millis_from_rfc3339("2026-10-17T09:41:07Z"),
            super::unix_millis_from_rfc3339("2026-10-17T09:41:07.000Z")
        );
        assert_eq!(super::unix_millis_from_rfc3339("2026-10-17 09:41:07Z"), None);
    }
}
