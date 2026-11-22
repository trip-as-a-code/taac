//! RFC 3339 date-time with a fixed UTC offset, built on [`jiff`].

use std::cmp::Ordering;
use std::fmt;
use std::str::FromStr;

use jiff::Timestamp;
use jiff::civil::{Date, DateTime, Time};
use jiff::fmt::temporal::{DateTimeParser, DateTimePrinter, PiecesOffset};
use jiff::tz::Offset;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// An instant together with the local UTC offset it was written in.
///
/// Ordering and equality compare the underlying instant, matching RFC 3339
/// semantics (and `chrono::DateTime<FixedOffset>`).
#[derive(Clone, Copy)]
pub struct OffsetDateTime {
    timestamp: Timestamp,
    offset: Offset,
}

impl OffsetDateTime {
    pub fn timestamp(self) -> Timestamp {
        self.timestamp
    }

    pub fn offset(self) -> Offset {
        self.offset
    }

    pub fn datetime(self) -> DateTime {
        self.offset.to_datetime(self.timestamp)
    }

    pub fn date(self) -> Date {
        self.datetime().date()
    }

    pub fn time(self) -> Time {
        self.datetime().time()
    }

    pub fn format_hm(self) -> String {
        let t = self.time();
        format!("{:02}:{:02}", t.hour(), t.minute())
    }

    pub fn format_offset(self) -> String {
        format_offset(self.offset)
    }

    pub fn to_rfc3339(self) -> String {
        self.to_string()
    }
}

/// Formats a UTC offset as `±HH:MM` (e.g. `+09:00`, `-05:00`, `+00:00`).
pub fn format_offset(offset: Offset) -> String {
    let total = offset.seconds();
    let sign = if total < 0 { '-' } else { '+' };
    let abs = total.unsigned_abs();
    let hours = abs / 3600;
    let minutes = (abs % 3600) / 60;
    format!("{sign}{hours:02}:{minutes:02}")
}

impl PartialEq for OffsetDateTime {
    fn eq(&self, other: &Self) -> bool {
        self.timestamp == other.timestamp
    }
}

impl Eq for OffsetDateTime {}

impl PartialOrd for OffsetDateTime {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for OffsetDateTime {
    fn cmp(&self, other: &Self) -> Ordering {
        self.timestamp.cmp(&other.timestamp)
    }
}

impl fmt::Display for OffsetDateTime {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut buf = String::with_capacity(32);
        DateTimePrinter::new()
            .print_timestamp_with_offset(&self.timestamp, self.offset, &mut buf)
            .map_err(|_| fmt::Error)?;
        f.write_str(&buf)
    }
}

impl fmt::Debug for OffsetDateTime {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(self, f)
    }
}

impl FromStr for OffsetDateTime {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let pieces = DateTimeParser::new()
            .parse_pieces(s)
            .map_err(|err| err.to_string())?;
        let Some(time) = pieces.time() else {
            return Err("missing time in RFC 3339 timestamp".into());
        };
        if pieces.time_zone_annotation().is_some() {
            return Err("unexpected time zone annotation in RFC 3339 timestamp".into());
        }
        let offset = match pieces.offset() {
            Some(PiecesOffset::Zulu) => Offset::UTC,
            Some(PiecesOffset::Numeric(numeric)) => numeric.offset(),
            Some(_) => return Err("unsupported UTC offset in RFC 3339 timestamp".into()),
            None => return Err("missing UTC offset in RFC 3339 timestamp".into()),
        };
        let timestamp = offset
            .to_timestamp(pieces.date().to_datetime(time))
            .map_err(|err| err.to_string())?;
        Ok(Self { timestamp, offset })
    }
}

impl Serialize for OffsetDateTime {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for OffsetDateTime {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        s.parse().map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_preserves_offset() {
        let dt: OffsetDateTime = "2026-05-01T14:30:00+09:00".parse().unwrap();
        assert_eq!(dt.to_rfc3339(), "2026-05-01T14:30:00+09:00");
        assert_eq!(dt.date().to_string(), "2026-05-01");
        assert_eq!(dt.format_hm(), "14:30");
        assert_eq!(dt.format_offset(), "+09:00");

        let zulu: OffsetDateTime = "2026-05-01T05:30:00Z".parse().unwrap();
        assert_eq!(zulu.format_offset(), "+00:00");
        assert_eq!(dt, zulu);
    }

    #[test]
    fn rejects_non_rfc3339_inputs() {
        assert!("2026-05-01".parse::<OffsetDateTime>().is_err());
        assert!("2026-05-01T14:30:00".parse::<OffsetDateTime>().is_err());
        assert!(
            "2026-05-01T14:30:00+09:00[Asia/Tokyo]"
                .parse::<OffsetDateTime>()
                .is_err()
        );
    }
}
