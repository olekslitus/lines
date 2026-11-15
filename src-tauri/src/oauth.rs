//! Signing in to a site in the browser (MyAnimeList, src/plugins/myanimelist/list.ts): the site sends
//! the browser back to `http://127.0.0.1:<port><path>?code=…&state=…`, which lines listens for here,
//! on this computer only, once. The browser is told it can close its tab, and the page that asked
//! gets the query. It gives up after a few minutes, or when asked to.

use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// How long the browser has to come back.
const WAIT: Duration = Duration::from_secs(300);

static CANCELLED: AtomicBool = AtomicBool::new(false);

/// Listens on 127.0.0.1:`port` for the browser coming back to `path`, answering it with the page
/// `done`; gives back the query it came with.
#[tauri::command]
pub async fn oauth_wait(port: u16, path: String, done: String) -> Result<String, String> {
  CANCELLED.store(false, Ordering::SeqCst);
  tauri::async_runtime::spawn_blocking(move || wait(port, &path, &done))
    .await
    .map_err(|error| error.to_string())?
}

/// Stops listening, if lines is.
#[tauri::command]
pub fn oauth_cancel() {
  CANCELLED.store(true, Ordering::SeqCst);
}

fn wait(port: u16, path: &str, done: &str) -> Result<String, String> {
  let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|error| format!("Couldn't listen on port {port}: {error}"))?;
  listener.set_nonblocking(true).map_err(|error| error.to_string())?;
  let deadline = Instant::now() + WAIT;
  while Instant::now() < deadline && !CANCELLED.load(Ordering::SeqCst) {
    match listener.accept() {
      Ok((stream, _)) => {
        if let Some(query) = answer(stream, path, done) {
          return Ok(query);
        }
      }
      Err(error) if error.kind() == ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(100)),
      Err(error) => return Err(error.to_string()),
    }
  }
  Err("The browser didn't come back".into())
}

/// Reads one request: `done` and its query if it's to `path`, else a 404 (a browser's favicon) and nothing.
fn answer(mut stream: TcpStream, path: &str, done: &str) -> Option<String> {
  stream.set_nonblocking(false).ok()?;
  stream.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
  let mut buffer = [0u8; 8192];
  let read = stream.read(&mut buffer).ok()?;
  let request = String::from_utf8_lossy(&buffer[..read]);
  let query = query_of(&request, path);
  let (status, body) = if query.is_some() { ("200 OK", done) } else { ("404 Not Found", "") };
  let _ = write!(
    stream,
    "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
    body.len()
  );
  query
}

/// The query of a GET request to `path`: `code=…&state=…`.
fn query_of(request: &str, path: &str) -> Option<String> {
  let mut line = request.lines().next()?.split_whitespace();
  if line.next()? != "GET" {
    return None;
  }
  let target = line.next()?;
  let (at, query) = target.split_once('?').unwrap_or((target, ""));
  (at == path).then(|| query.to_string())
}

#[cfg(test)]
mod tests {
  use super::query_of;

  #[test]
  fn reads_the_query_of_a_request_to_its_path_only() {
    let request = "GET /myanimelist?code=abc&state=xyz HTTP/1.1\r\nHost: 127.0.0.1:45291\r\n\r\n";
    assert_eq!(query_of(request, "/myanimelist").as_deref(), Some("code=abc&state=xyz"));
    assert_eq!(query_of("GET /favicon.ico HTTP/1.1\r\n\r\n", "/myanimelist"), None);
    assert_eq!(query_of("POST /myanimelist?code=abc HTTP/1.1\r\n\r\n", "/myanimelist"), None);
    assert_eq!(query_of("GET /myanimelist HTTP/1.1\r\n\r\n", "/myanimelist").as_deref(), Some(""));
  }
}
