//! Explicit live acceptance only: observe and bound actual NativeSender calls.
use super::{GateError, GateResponse};
use serde_json::{json, Value};
use std::{path::PathBuf, sync::{Mutex, OnceLock}, time::{Duration, Instant}};

struct State {
    born: Instant,
    count: u32,
    active: u32,
    peak: u32,
    limit: u32,
    duration: Duration,
    rows: Vec<Value>,
    evidence: PathBuf,
}
static OBSERVER: OnceLock<Mutex<State>> = OnceLock::new();

pub(super) fn install(evidence: PathBuf, limit: u32, seconds: u64) {
    assert!(OBSERVER.set(Mutex::new(State {
        born: Instant::now(), count: 0, active: 0, peak: 0, limit,
        duration: Duration::from_secs(seconds), rows: vec![], evidence,
    })).is_ok(), "One explicit acceptance stage per process");
}

pub(super) struct Observation {
    number: u32,
    started_ms: u64,
    status: Option<u16>,
    error: Option<String>,
    finished: bool,
}

pub(super) fn begin() -> Result<Option<Observation>, GateError> {
    let Some(observer) = OBSERVER.get() else { return Ok(None) };
    let mut state = observer.lock().unwrap();
    if state.count >= state.limit || state.born.elapsed() >= state.duration {
        return Err(GateError::new("acceptance_budget_exhausted"));
    }
    state.count += 1;
    state.active += 1;
    state.peak = state.peak.max(state.active);
    let row = Observation {
        number: state.count, started_ms: state.born.elapsed().as_millis() as u64,
        status: None, error: None, finished: false,
    };
    println!("GATE_ACCEPT_SEND {}", json!({"number":row.number,"started_ms":row.started_ms}));
    Ok(Some(row))
}

impl Observation {
    pub(super) fn finish(&mut self, result: &Result<GateResponse, GateError>) {
        self.finished = true;
        match result {
            Ok(reply) => self.status = Some(reply.status),
            Err(error) => self.error = Some(error.code.clone()),
        }
    }
}
impl Drop for Observation {
    fn drop(&mut self) {
        let mut state = OBSERVER.get().unwrap().lock().unwrap();
        state.active -= 1;
        let row = json!({"number":self.number,"started_ms":self.started_ms,
            "ended_ms":state.born.elapsed().as_millis() as u64,
            "http_status":self.status,"error_code":self.error,
            "cancelled_or_request_timeout":!self.finished});
        println!("GATE_ACCEPT_RESPONSE {row}");
        state.rows.push(row);
        // Persist after every attempt, including if an enclosing future is cancelled.
        let snapshot = snapshot(&state);
        if let Err(error) = std::fs::write(&state.evidence, snapshot.to_string()) {
            eprintln!("acceptance observer evidence write failed: {}", error.kind());
        }
    }
}
fn snapshot(state: &State) -> Value {
    let mut rows = state.rows.clone();
    rows.sort_by_key(|row| row["number"].as_u64().unwrap());
    let gaps: Vec<_> = rows.windows(2).map(|pair| {
        pair[1]["started_ms"].as_i64().unwrap() - pair[0]["ended_ms"].as_i64().unwrap()
    }).collect();
    json!({"actual_http_attempts":state.count,"peak_active":state.peak,
        "elapsed_ms":state.born.elapsed().as_millis() as u64,
        "attempt_limit":state.limit,"seconds_limit":state.duration.as_secs(),
        "end_to_next_start_gaps_ms":gaps,"attempts":rows})
}
pub(super) fn report() -> Value {
    snapshot(&OBSERVER.get().unwrap().lock().unwrap())
}
