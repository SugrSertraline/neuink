use super::*;

impl ArxivGate {
    pub fn new(path: Option<PathBuf>) -> Self {
        let mut state = State {
            queue: VecDeque::new(),
            next_id: 0,
            active: false,
            next_send: None,
            cooldown: None,
            storage_failed: false,
        };
        if let Some(path) = &path {
            match read_state(path) {
                Ok(bytes) => match serde_json::from_slice::<Persisted>(&bytes) {
                    Ok(saved) if saved.version == 1 => {
                        match chrono::DateTime::parse_from_rfc3339(&saved.cooldown_until) {
                            Ok(at) => {
                                let remaining = (at.with_timezone(&chrono::Utc)
                                    - chrono::Utc::now())
                                .to_std()
                                .unwrap_or_default();
                                if remaining > Duration::from_secs(86400) {
                                    state.storage_failed = true;
                                } else if !remaining.is_zero() {
                                    state.cooldown =
                                        Some((Instant::now() + remaining, saved.cooldown_until));
                                }
                            }
                            Err(_) => state.storage_failed = true,
                        }
                    }
                    _ => state.storage_failed = true,
                },
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => state.storage_failed = true,
            }
        }
        Self {
            state: Mutex::new(state),
            changed: Notify::new(),
            path,
            traces: Mutex::new(VecDeque::new()),
            born: Instant::now(),
        }
    }
    pub(super) fn trace(&self, context: &Context, state: &str, attempts: u32, code: Option<&str>) {
        if let Ok(mut rows) = self.traces.lock() {
            if rows.len() == 128 {
                rows.pop_front();
            }
            rows.push_back(RequestTrace {
                request_id: context.request_id.clone(),
                source: context.source.into(),
                state: state.into(),
                elapsed_ms: self.born.elapsed().as_millis().min(u64::MAX as u128) as u64,
                attempts_started: attempts,
                code: code.map(Into::into),
            });
        }
    }
    // Bounded diagnostic snapshot used by local verification; no public IPC or query logging.
    #[allow(dead_code)]
    pub fn traces(&self) -> Vec<RequestTrace> {
        self.traces
            .lock()
            .map(|r| r.iter().cloned().collect())
            .unwrap_or_default()
    }
    pub(super) fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }
    pub(super) fn blocked(state: &State) -> Option<GateError> {
        if state.storage_failed {
            return Some(GateError::new("state_storage_error"));
        }
        state.cooldown.as_ref().and_then(|(at, utc)| {
            let duration = at.saturating_duration_since(Instant::now());
            if duration.is_zero() {
                return None;
            }
            let mut error = GateError::new("cooldown");
            error.phase = "cooldown".into();
            error.retry_after_seconds =
                Some(duration.as_secs() + u64::from(duration.subsec_nanos() > 0));
            error.cooldown_until = Some(utc.clone());
            Some(error)
        })
    }
    pub(super) fn cooling(&self, seconds: u64) -> Result<(), GateError> {
        let mut state = self.lock();
        let at = Instant::now() + Duration::from_secs(seconds);
        if state.cooldown.as_ref().is_some_and(|(old, _)| *old >= at) {
            return Ok(());
        }
        let until = (chrono::Utc::now() + chrono::Duration::seconds(seconds as i64)).to_rfc3339();
        state.cooldown = Some((at, until.clone()));
        if let Some(path) = &self.path {
            if neuink_workspace::atomic_write_json(
                path,
                &Persisted {
                    version: 1,
                    cooldown_until: until,
                },
            )
            .is_err()
            {
                state.storage_failed = true;
                self.changed.notify_waiters();
                return Err(GateError::new("state_storage_error"));
            }
        }
        self.changed.notify_waiters();
        Ok(())
    }
    pub(super) async fn acquire(self: &Arc<Self>, context: &Context) -> Result<Lease, GateError> {
        let id = {
            let mut s = self.lock();
            if let Some(error) = Self::blocked(&s) {
                return Err(error);
            }
            if s.queue.len() >= 8 {
                return Err(GateError::new("queue_full"));
            }
            s.next_id += 1;
            let id = s.next_id;
            s.queue.push_back(id);
            id
        };
        let mut ticket = Ticket {
            gate: self.clone(),
            id,
        };
        self.trace(context, "queued", 0, None);
        let until = Instant::now() + Duration::from_secs(30);
        loop {
            let notified = self.changed.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            let wake = {
                let mut s = self.lock();
                if Instant::now() >= context.deadline {
                    return Err(GateError::new("total_timeout"));
                }
                if let Some(error) = Self::blocked(&s) {
                    return Err(error);
                }
                if Instant::now() >= until {
                    return Err(GateError::new("queue_timeout"));
                }
                if !s.active
                    && s.queue.front() == Some(&id)
                    && s.next_send.is_none_or(|at| at <= Instant::now())
                {
                    s.queue.pop_front();
                    s.active = true;
                    ticket.id = 0;
                    return Ok(Lease { gate: self.clone() });
                }
                s.next_send
                    .filter(|at| *at > Instant::now())
                    .unwrap_or(until)
                    .min(until)
                    .min(context.deadline)
            };
            tokio::select! {_=notified=>{},_=tokio::time::sleep_until(wake)=>{}}
        }
    }
}
