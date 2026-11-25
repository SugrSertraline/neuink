use super::*;

impl ArxivGate {
    pub async fn request(
        self: &Arc<Self>,
        url: reqwest::Url,
        context: Context,
    ) -> Result<GateResponse, GateError> {
        self.request_with(url, context, &NativeSender).await
    }
    pub async fn request_with(
        self: &Arc<Self>,
        url: reqwest::Url,
        context: Context,
        sender: &(impl Sender + ?Sized),
    ) -> Result<GateResponse, GateError> {
        self.request_detailed_with(url, context, sender)
            .await
            .map(|success| success.response)
    }
    pub async fn request_detailed_with(
        self: &Arc<Self>,
        mut url: reqwest::Url,
        context: Context,
        sender: &(impl Sender + ?Sized),
    ) -> Result<GateSuccess, GateError> {
        let mut completion = Completion {
            gate: self,
            context: &context,
            attempts: std::sync::atomic::AtomicU32::new(0),
            finished: false,
        };
        let mut attempts = 0;
        let mut retry = false;
        let mut redirects = 0;
        let work = async {
            validate(&url, false)?;
            loop {
                let lease = self.acquire(&context).await?;
                attempts += 1;
                completion
                    .attempts
                    .store(attempts, std::sync::atomic::Ordering::Relaxed);
                self.trace(&context, "sending", attempts, None);
                let response =
                    tokio::time::timeout(Duration::from_secs(25), sender.send(url.clone()))
                        .await
                        .unwrap_or_else(|_| Err(GateError::new("request_timeout")));
                if let Ok(reply) = &response {
                    if reply.status == 429 {
                        let seconds =
                            retry_seconds(reply.retry_after.as_deref(), chrono::Utc::now());
                        self.cooling(seconds)?;
                        let mut error = Self::blocked(&self.lock())
                            .unwrap_or_else(|| GateError::new("cooldown"));
                        error.code = "rate_limited".into();
                        error.http_status = Some(429);
                        return Err(error);
                    }
                }
                drop(lease);
                let reply = match response {
                    Ok(reply) => reply,
                    Err(error) => {
                        if !retry
                            && matches!(
                                error.code.as_str(),
                                "request_timeout" | "connection_failed" | "dns_failed"
                            )
                        {
                            retry = true;
                            continue;
                        }
                        return Err(error);
                    }
                };
                if (300..400).contains(&reply.status) {
                    if redirects == 5 {
                        return Err(GateError::new("redirect_limit"));
                    }
                    url = url
                        .join(
                            reply
                                .location
                                .as_deref()
                                .ok_or_else(|| GateError::new("invalid_redirect"))?,
                        )
                        .map_err(|_| GateError::new("invalid_redirect"))?;
                    validate(&url, true).map_err(|_| GateError::new("invalid_redirect"))?;
                    redirects += 1;
                    continue;
                }
                if matches!(reply.status, 500 | 502 | 503 | 504) && !retry {
                    retry = true;
                    continue;
                }
                if !(200..300).contains(&reply.status) {
                    let mut error = GateError::new("http_error");
                    error.http_status = Some(reply.status);
                    return Err(error);
                }
                return Ok(reply);
            }
        };
        let result = tokio::time::timeout_at(context.deadline, work)
            .await
            .unwrap_or_else(|_| Err(GateError::new("total_timeout")));
        self.trace(
            &context,
            if result.is_ok() {
                "completed"
            } else {
                "failed"
            },
            attempts,
            result.as_ref().err().map(|e| e.code.as_str()),
        );
        completion.finished = true;
        result
            .map(|response| GateSuccess {
                response,
                request_id: context.request_id.clone(),
                source: context.source,
                attempts_started: attempts,
            })
            .map_err(|mut error| {
                error.attempts_started = attempts;
                error.request_id = context.request_id.clone();
                error.source = context.source.into();
                if error.code.starts_with("queue_") {
                    error.phase = "queue".into();
                }
                if error.code == "total_timeout" {
                    error.phase = "task".into();
                }
                error
            })
    }
}
struct Completion<'a> {
    gate: &'a ArxivGate,
    context: &'a Context,
    attempts: std::sync::atomic::AtomicU32,
    finished: bool,
}
impl Drop for Completion<'_> {
    fn drop(&mut self) {
        if !self.finished {
            self.gate.trace(
                self.context,
                "cancelled",
                self.attempts.load(std::sync::atomic::Ordering::Relaxed),
                Some("cancelled"),
            );
        }
    }
}
