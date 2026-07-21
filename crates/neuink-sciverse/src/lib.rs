mod client;
mod error;
mod models;

pub use client::{SciverseClient, DEFAULT_SCIVERSE_BASE_URL};
pub use error::{SciverseError, SciverseResult};
pub use models::{
    AgenticSearchFilter, AgenticSearchHit, AgenticSearchRequest, AgenticSearchResponse,
    ContentRequest, ContentResponse, SciverseBinaryResource,
};
