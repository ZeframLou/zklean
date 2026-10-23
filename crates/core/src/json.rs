//! JSON for the private export must have one meaning before either parser reads it.
//! serde_json::Value otherwise silently keeps the last duplicate object key,
//! whereas Nanoda's flattened enum parser can select the first one.
use serde::de::{self, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};
use serde_json::{Map, Value};
use std::fmt;

struct Unique(Value);

impl<'de> Deserialize<'de> for Unique {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct JsonVisitor;

        impl<'de> Visitor<'de> for JsonVisitor {
            type Value = Unique;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("JSON with unique object keys and unsigned integers")
            }

            fn visit_unit<E: de::Error>(self) -> Result<Unique, E> {
                Ok(Unique(Value::Null))
            }

            fn visit_bool<E: de::Error>(self, value: bool) -> Result<Unique, E> {
                Ok(Unique(value.into()))
            }

            fn visit_u64<E: de::Error>(self, value: u64) -> Result<Unique, E> {
                Ok(Unique(value.into()))
            }

            fn visit_str<E: de::Error>(self, value: &str) -> Result<Unique, E> {
                Ok(Unique(value.into()))
            }

            fn visit_seq<A: SeqAccess<'de>>(self, mut array: A) -> Result<Unique, A::Error> {
                let mut values = Vec::new();
                while let Some(Unique(value)) = array.next_element()? {
                    values.push(value);
                }
                Ok(Unique(Value::Array(values)))
            }

            fn visit_map<A: MapAccess<'de>>(self, mut object: A) -> Result<Unique, A::Error> {
                let mut values = Map::new();
                while let Some(key) = object.next_key::<String>()? {
                    if values.contains_key(&key) {
                        return Err(de::Error::custom(format!("duplicate JSON key: {key}")));
                    }
                    let Unique(value) = object.next_value()?;
                    values.insert(key, value);
                }
                Ok(Unique(Value::Object(values)))
            }
        }

        deserializer.deserialize_any(JsonVisitor)
    }
}

pub fn parse(text: &str) -> serde_json::Result<Value> {
    serde_json::from_str::<Unique>(text).map(|value| value.0)
}
