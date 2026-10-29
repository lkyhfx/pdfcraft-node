use crate::{document::{load, count, writable, save, output}, err, Request};
use napi::Result;
use pdfcraft_optimize::{Compatibility, Compression, ImageSettings, Settings};

pub(crate) fn run(r: &Request) -> Result<String> {
    if r.inputs.len() != 1 || r.outputs.len() != 1 { return Err(err("INVALID_ARGUMENT", "one input and output required")); }
    let mut doc = load(&r.inputs[0], r.max_input_bytes)?;
    writable(&doc)?;
    let n = count(&doc)?;
    let compatibility = Compatibility::from_name(r.compatibility.as_deref().unwrap_or("retain"))
        .ok_or_else(|| err("INVALID_ARGUMENT", "invalid compatibility"))?;
    // Upstream does not convert newer PDF features; never claim a downgrade succeeded.
    let mut version = doc.version().to_string();
    if let Some(root) = doc.root() {
        if let Some(v) = doc.get(root).as_dict().and_then(|d| d.name(b"Version")) {
            version = version.max(String::from_utf8_lossy(v).into_owned());
        }
    }
    if compatibility.version().is_some_and(|v| v < version.as_str()) { return Err(err("UNSUPPORTED", "PDF version downgrade is not supported")); }
    let image = match r.mode.as_deref().unwrap_or("balanced") {
        "lossless" => ImageSettings { downsample: false, compression: Compression::Retain, ..ImageSettings::REDUCE },
        "balanced" => ImageSettings::REDUCE,
        "strong" => ImageSettings { compression: Compression::Jpeg(60), ..ImageSettings::MOBILE },
        _ => return Err(err("INVALID_ARGUMENT", "invalid compression mode")),
    };
    let settings = Settings {
        compatibility, color: image, gray: image, merge_fragments: false,
        discard_thumbnails: false, discard_alternate_images: false, discard_tags: false,
        discard_print_settings: false, remove_invalid_links: false, remove_unreferenced_dests: false,
        ..Settings::default()
    };
    pdfcraft_optimize::optimize(&mut doc, &settings).map_err(|e| err("UNSUPPORTED", e))?;
    let bytes = save(&doc, settings.effective_object_streams(), r.max_output_bytes, n)?;
    let original = doc.bytes();
    let result = if bytes.len() < original.len() { bytes.as_slice() } else { original.as_slice() };
    if result.len() > r.max_output_bytes { return Err(err("OUTPUT_TOO_LARGE", "output exceeds limit")); }
    output(r, 0, result)?;
    Ok("null".into())
}
