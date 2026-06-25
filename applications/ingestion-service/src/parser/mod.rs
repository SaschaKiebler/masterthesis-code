//! Payload parsing and decryption
//!
//! Protocol-specific parsers are organized into submodules.

pub mod generic;
pub mod shelly;
pub mod tasmota;

use chrono::{DateTime, Utc};

pub use self::generic::{parse_generic, parse_generic_topic};
pub use self::shelly::{parse_shelly, parse_shelly_topic};
pub use self::tasmota::{parse_tasmota, parse_tasmota_topic};



/// A parsed measurement ready for insertion
#[derive(Debug, Clone)]
pub struct Measurement {
    pub metric_id: i16,
    pub value: f64,
    pub time: DateTime<Utc>,
}
