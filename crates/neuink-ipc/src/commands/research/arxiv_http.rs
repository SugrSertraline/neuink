use super::network::StatusResponse;
#[cfg(test)]
use super::network;
use super::arxiv_gate::{self, GateError};
use std::{future::Future, pin::Pin};
#[cfg(test)]
use std::time::Duration;
#[cfg(test)]
use tokio::{sync::Mutex, time::Instant};

pub type Reply = Result<StatusResponse, &'static str>;
pub trait Transport: Send + Sync {
    fn get(&self, url: reqwest::Url) -> Pin<Box<dyn Future<Output = Reply> + Send + '_>>;
    fn get_gate(&self, url:reqwest::Url)->Pin<Box<dyn Future<Output=Result<StatusResponse,GateError>>+Send+'_>> {
        Box::pin(async move { self.get(url).await.map_err(Into::into) })
    }
}

#[cfg(test)]
#[derive(Default)]
pub struct Gate(Mutex<Option<Instant>>);
#[cfg(test)]
impl Gate {
    pub async fn run(&self, future: impl Future<Output = Reply>) -> Reply {
        let mut last = self.0.lock().await;
        if let Some(at) = *last {
            tokio::time::sleep_until(at + Duration::from_secs(3)).await;
        }
        *last = Some(Instant::now());
        // Keep the permit until the body has been consumed or the future is dropped.
        future.await
    }
}

pub struct Native;
impl Transport for Native {
    fn get(&self, url: reqwest::Url) -> Pin<Box<dyn Future<Output = Reply> + Send + '_>> {
        Box::pin(async move { self.get_gate(url).await.map_err(|_|"gate_failed") })
    }
    fn get_gate(&self,url:reqwest::Url)->Pin<Box<dyn Future<Output=Result<StatusResponse,GateError>>+Send+'_>>{
        Box::pin(async move {let mut context=arxiv_gate::context("arxiv_search");context.request_id=neuink_domain::NoteId::new().to_string();
            arxiv_gate::shared()?.request(url,context).await})
    }
}

#[cfg(test)]
pub fn redirect(url: &reqwest::Url, location: Option<&str>) -> Result<reqwest::Url, &'static str> {
    let target = url
        .join(location.ok_or("invalid_redirect")?)
        .map_err(|_| "invalid_redirect")?;
    network::public_url(target.as_str()).map_err(|_| "invalid_redirect")?;
    if !matches!(target.host_str(), Some("arxiv.org" | "export.arxiv.org"))
        || target.path() != "/api/query"
    {
        return Err("invalid_redirect");
    }
    Ok(target)
}
