use crate::{
    Request,
    document::{count, load, output, save, writable},
    err,
};
use napi::Result;
use pdfcraft_optimize::{Compatibility, Compression, ImageSettings, Settings};

pub(crate) fn run(r: &Request) -> Result<String> {
    if r.inputs.len() != 1 || r.outputs.len() != 1 {
        return Err(err("INVALID_ARGUMENT", "one input and output required"));
    }
    let mut doc = load(&r.inputs[0], r.max_input_bytes)?;
    writable(&doc)?;
    let n = count(&doc)?;
    let compatibility = Compatibility::from_name(r.compatibility.as_deref().unwrap_or("retain"))
        .ok_or_else(|| err("INVALID_ARGUMENT", "invalid compatibility"))?;
    // Upstream does not convert newer PDF features; never claim a downgrade succeeded.
    let version = crate::document::version(&doc)?;
    if compatibility
        .version()
        .is_some_and(|v| v < version.as_str())
    {
        return Err(err("UNSUPPORTED", "PDF version downgrade is not supported"));
    }
    let image = match r.mode.as_deref().unwrap_or("balanced") {
        "lossless" => ImageSettings {
            downsample: false,
            compression: Compression::Retain,
            ..ImageSettings::REDUCE
        },
        "balanced" => ImageSettings::REDUCE,
        "strong" => ImageSettings {
            compression: Compression::Jpeg(60),
            ..ImageSettings::MOBILE
        },
        _ => return Err(err("INVALID_ARGUMENT", "invalid compression mode")),
    };
    let settings = Settings {
        compatibility,
        color: image,
        gray: image,
        merge_fragments: false,
        discard_thumbnails: false,
        discard_alternate_images: false,
        discard_tags: false,
        discard_print_settings: false,
        remove_invalid_links: false,
        remove_unreferenced_dests: false,
        ..Settings::default()
    };
    pdfcraft_optimize::optimize(&mut doc, &settings).map_err(|e| err("UNSUPPORTED", e))?;
    // Include trailer references in upstream's candidate-only reference rewrite.
    let trailer = doc.add(doc.trailer().clone());
    let candidates = doc
        .object_numbers()
        .into_iter()
        .map(|n| pdfcraft_cos::ObjRef::new(n, doc.generation(n)))
        .collect::<Vec<_>>();
    pdfcraft_organize::dedupe_resources(&mut doc, &candidates, false);
    *doc.trailer_mut() = doc
        .get(trailer)
        .as_dict()
        .cloned()
        .ok_or_else(|| crate::invalid("resource deduplication lost trailer"))?;
    doc.free(trailer);
    let original = doc.bytes();
    let bytes = match save(
        &doc,
        settings.effective_object_streams(),
        crate::MAX_OUTPUT,
        n,
    ) {
        Ok(bytes) => Some(bytes),
        Err(e)
            if e.reason.starts_with("ERR_PDFCRAFT_OUTPUT_TOO_LARGE")
                && original.len() <= r.max_output_bytes =>
        {
            None
        }
        Err(e) => return Err(e),
    };
    let result = bytes
        .as_deref()
        .filter(|b| b.len() < original.len())
        .unwrap_or(original.as_slice());
    if result.len() > r.max_output_bytes {
        return Err(err("OUTPUT_TOO_LARGE", "output exceeds limit"));
    }
    output(r, 0, result)?;
    Ok("null".into())
}
