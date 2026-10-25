mod client;
mod error;
mod models;
mod paper;

pub use client::{SciverseClient, DEFAULT_SCIVERSE_BASE_URL};
pub use error::{SciverseError, SciverseResult};
pub use models::{
    AgenticSearchFilter, AgenticSearchHit, AgenticSearchRequest, AgenticSearchResponse,
    ContentRequest, ContentResponse, SciverseBinaryResource,
};
