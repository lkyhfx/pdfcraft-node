use crate::{MAX_PAGES, Request, err, invalid, io};
use napi::Result;
use pdfcraft_cos::{Document, Object, SaveOptions, write_full};
use std::os::unix::fs::OpenOptionsExt;
use std::{
    fs::File,
    io::{Read, Write},
    sync::Arc,
};

pub(crate) fn load(path: &str, max: usize) -> Result<Document> {
    let f = File::open(path).map_err(io)?;
    if !f.metadata().map_err(io)?.is_file() {
        return Err(err("IO", "input must be a regular file"));
    }
    if f.metadata().map_err(io)?.len() > max as u64 {
        return Err(err("INPUT_TOO_LARGE", "input exceeds limit"));
    }
    let mut bytes = Vec::new();
    f.take(max as u64 + 1).read_to_end(&mut bytes).map_err(io)?;
    if bytes.len() > max {
        return Err(err("INPUT_TOO_LARGE", "input exceeds limit"));
    }
    let doc = Document::open(Arc::new(bytes)).map_err(|e| match e {
        pdfcraft_cos::CosError::NeedsPassword | pdfcraft_cos::CosError::WrongPassword => {
            err("PASSWORD_REQUIRED", "encrypted PDF is unsupported")
        }
        _ => invalid(e),
    })?;
    if doc.trailer().contains(b"Encrypt") {
        return Err(err("PASSWORD_REQUIRED", "encrypted PDF is unsupported"));
    }
    if doc.reconstructed() || !doc.repair_log().is_empty() {
        return Err(invalid("PDF requires repair"));
    }
    count(&doc)?;
    version(&doc)?;
    Ok(doc)
}
pub(crate) fn version(doc: &Document) -> Result<String> {
    let mut version = doc.version().to_string();
    if let Some(root) = doc.root()
        && let Some(value) = doc
            .get(root)
            .as_dict()
            .and_then(|d| d.get(b"Version"))
            .cloned()
    {
        let resolved = doc.resolve(&value);
        let name = resolved
            .as_name()
            .ok_or_else(|| invalid("invalid catalog version"))?;
        version = version.max(String::from_utf8_lossy(name).into_owned());
    }
    if !matches!(
        version.as_str(),
        "1.0" | "1.1" | "1.2" | "1.3" | "1.4" | "1.5" | "1.6" | "1.7" | "2.0"
    ) {
        return Err(err("UNSUPPORTED", "unsupported PDF version"));
    }
    Ok(version)
}
pub(crate) fn count(doc: &Document) -> Result<usize> {
    let n = pdfcraft_organize::page_count(doc).map_err(invalid)?;
    if n == 0 || n > MAX_PAGES {
        return Err(err("PAGE_RANGE", "page count must be 1..10000"));
    }
    Ok(n)
}
pub(crate) fn writable(doc: &Document) -> Result<()> {
    for (_, obj) in doc.scan_objects_checked() {
        let obj = obj.map_err(invalid)?;
        let mut pending = vec![(&*obj, 0)];
        while let Some((o, depth)) = pending.pop() {
            if depth > 128 {
                return Err(invalid("object nesting exceeds limit"));
            }
            if let Some(d) = o.as_dict() {
                if d.name(b"Type") == Some(b"Sig")
                    || d.contains(b"ByteRange")
                    || d.name(b"FT") == Some(b"Sig")
                {
                    return Err(err(
                        "UNSUPPORTED",
                        "signed PDFs and signature fields cannot be rewritten",
                    ));
                }
                if d.contains(b"XFA") {
                    return Err(err("UNSUPPORTED", "XFA cannot be safely rewritten"));
                }
                pending.extend(d.iter().map(|(_, v)| (v, depth + 1)));
            }
            if let Object::Array(items) = o {
                pending.extend(items.iter().map(|v| (v, depth + 1)));
            }
        }
    }
    Ok(())
}
pub(crate) fn save(
    doc: &Document,
    object_streams: bool,
    max: usize,
    expected: usize,
) -> Result<Vec<u8>> {
    let bytes = write_full(
        doc,
        &SaveOptions {
            object_streams,
            ..Default::default()
        },
    )
    .map_err(invalid)?;
    if bytes.len() > max {
        return Err(err("OUTPUT_TOO_LARGE", "output exceeds limit"));
    }
    let check = Document::open(Arc::new(bytes.clone())).map_err(invalid)?;
    if count(&check)? != expected {
        return Err(invalid("output page count mismatch"));
    }
    Ok(bytes)
}
pub(crate) fn output(r: &Request, index: usize, bytes: &[u8]) -> Result<()> {
    let path = r
        .outputs
        .get(index)
        .ok_or_else(|| err("INVALID_ARGUMENT", "missing output path"))?;
    let mut file = File::options()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map_err(io)?;
    file.write_all(bytes).map_err(io)?;
    file.sync_all().map_err(io)
}
