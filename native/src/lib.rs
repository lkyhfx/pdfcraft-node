mod compression;
mod document;
use napi::{bindgen_prelude::AsyncTask, Env, Error, Result, Task};
use napi_derive::napi;
use serde::Deserialize;
use std::{panic::{catch_unwind, AssertUnwindSafe}, sync::atomic::{AtomicBool, Ordering}};

pub(crate) fn err(code: &str, message: impl std::fmt::Display) -> Error {
    Error::from_reason(format!("ERR_PDFCRAFT_{code}: {message}"))
}
pub(crate) fn invalid(e: impl std::fmt::Display) -> Error { err("INVALID_PDF", e) }
pub(crate) fn io(e: std::io::Error) -> Error { err("IO", e) }
pub(crate) const MAX_INPUT: usize = 512 * 1024 * 1024;
pub(crate) const MAX_OUTPUT: usize = 256 * 1024 * 1024;
pub(crate) const MAX_PAGES: usize = 10_000;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Request {
    pub op: String,
    pub inputs: Vec<String>,
    pub outputs: Vec<String>,
    pub max_input_bytes: usize,
    pub max_output_bytes: usize,
    pub mode: Option<String>,
    pub compatibility: Option<String>,
}
static BUSY: AtomicBool = AtomicBool::new(false);
pub struct Job(String);
impl Task for Job {
    type Output = String;
    type JsValue = String;
    fn compute(&mut self) -> Result<String> {
        if BUSY.swap(true, Ordering::AcqRel) { return Err(err("BUSY", "one task per isolated worker")); }
        struct Permit;
        impl Drop for Permit { fn drop(&mut self) { BUSY.store(false, Ordering::Release); } }
        let _permit = Permit;
        catch_unwind(AssertUnwindSafe(|| {
            let r: Request = serde_json::from_str(&self.0).map_err(|e| err("INVALID_ARGUMENT", e))?;
            if r.max_input_bytes == 0 || r.max_input_bytes > MAX_INPUT || r.max_output_bytes == 0 || r.max_output_bytes > MAX_OUTPUT || r.inputs.len() > 128 || r.outputs.len() > 128 {
                return Err(err("INVALID_ARGUMENT", "resource limits exceed native bounds"));
            }
            // The addon is private to disposable workers; allocation failure cannot abort its caller.
            let limit = libc::rlimit { rlim_cur: 1536 * 1024 * 1024, rlim_max: 1536 * 1024 * 1024 };
            if unsafe { libc::setrlimit(libc::RLIMIT_DATA, &limit) } != 0 { return Err(io(std::io::Error::last_os_error())); }
            match r.op.as_str() {
                "compress" => compression::run(&r),
                _ => Err(err("UNSUPPORTED", "unknown operation")),
            }
        })).unwrap_or_else(|_| Err(err("PANIC", "native operation panicked")))
    }
    fn resolve(&mut self, _: Env, output: String) -> Result<String> { Ok(output) }
}
#[napi]
pub fn execute(request: String) -> Result<AsyncTask<Job>> {
    if request.len() > 1024 * 1024 { return Err(err("INPUT_TOO_LARGE", "request too large")); }
    Ok(AsyncTask::new(Job(request)))
}
