use crate::{
    MAX_PAGES, PageRange, Request,
    document::{count, load, output, save, writable},
    err, invalid,
};
use napi::Result;
use pdfcraft_cos::Document;
use pdfcraft_organize as org;
use serde_json::{Value, json};

pub(crate) fn indices(pages: &[u32], n: usize) -> Result<Vec<usize>> {
    if pages.is_empty()
        || pages.len() > MAX_PAGES
        || pages.iter().any(|&p| p == 0 || p as usize > n)
    {
        return Err(err(
            "PAGE_RANGE",
            "pages must be nonempty, 1-based and within document bounds",
        ));
    }
    Ok(pages.iter().map(|p| *p as usize - 1).collect())
}
fn range(range: &PageRange, n: usize) -> Result<Vec<usize>> {
    if range.start == 0 || range.end < range.start || range.end as usize > n {
        return Err(err("PAGE_RANGE", "invalid inclusive page range"));
    }
    Ok((range.start as usize - 1..range.end as usize).collect())
}
fn editable(doc: &Document) -> Result<()> {
    writable(doc)?;
    if let Some(root) = doc.root() {
        let obj = doc.get(root);
        if obj
            .as_dict()
            .is_some_and(|d| d.contains(b"StructTreeRoot") || d.contains(b"Threads"))
        {
            return Err(err(
                "UNSUPPORTED",
                "page edits cannot preserve structure trees or article threads",
            ));
        }
    }
    Ok(())
}
pub(crate) fn geometry(doc: &Document) -> Result<Vec<Value>> {
    let pdf = hayro_syntax::Pdf::new(doc.bytes().clone())
        .map_err(|_| invalid("cannot inspect page geometry"))?;
    if pdf.pages().len() != count(doc)? {
        return Err(invalid("parsers disagree on page count"));
    }
    pdf.pages().iter().enumerate().map(|(i, page)| {
        let (w,h) = page.render_dimensions();
        if !w.is_finite() || !h.is_finite() || w <= 0. || h <= 0. { return Err(invalid("invalid page dimensions")); }
        let rotation = org::page_rotation(doc, i).map_err(invalid)?.rem_euclid(360);
        Ok(json!({ "width": w, "height": h, "rotation": rotation, "orientation": if w > h { "landscape" } else { "portrait" } }))
    }).collect()
}
fn extracted(doc: &Document, selected: &[usize], max: usize) -> Result<Vec<u8>> {
    let mut out = org::extract_pages(doc, selected).map_err(invalid)?;
    out.set_version(crate::document::version(doc)?);
    save(&out, true, max, selected.len())
}
fn batch(
    r: &Request,
    doc: &Document,
    start: u32,
    end: u32,
    manifest: &mut Vec<Value>,
    total: &mut usize,
) -> Result<()> {
    if manifest.len() >= r.outputs.len() {
        return Err(err(
            "OUTPUT_TOO_LARGE",
            "batch count exceeds configured output limit",
        ));
    }
    let max = r.max_batch_bytes.unwrap_or(r.max_output_bytes);
    let remaining = r.max_output_bytes.saturating_sub(*total);
    // Serialize one candidate at a time; never retain all split outputs in memory.
    let selected = range(&PageRange { start, end }, count(doc)?)?;
    let bytes = extracted(doc, &selected, r.max_output_bytes)?;
    if bytes.len() > max {
        drop(bytes);
        if start == end {
            return Err(err("OUTPUT_TOO_LARGE", "single page exceeds maxBatchBytes"));
        }
        let mid = start + (end - start) / 2;
        batch(r, doc, start, mid, manifest, total)?;
        return batch(r, doc, mid + 1, end, manifest, total);
    }
    if bytes.len() > remaining {
        return Err(err("OUTPUT_TOO_LARGE", "aggregate output exceeds limit"));
    }
    let i = manifest.len();
    output(r, i, &bytes)?;
    *total += bytes.len();
    manifest.push(json!({ "index": i, "start": start, "end": end, "bytes": bytes.len() }));
    Ok(())
}
pub(crate) fn run(r: &Request) -> Result<String> {
    if r.inputs.is_empty()
        || (r.op != "merge" && r.op != "replace" && r.inputs.len() != 1)
        || (r.op == "replace" && r.inputs.len() != 2)
    {
        return Err(err("INVALID_ARGUMENT", "invalid number of inputs"));
    }
    let mut aggregate = 0usize;
    for p in &r.inputs {
        let size = std::fs::metadata(p).map_err(crate::io)?.len();
        aggregate = aggregate
            .checked_add(
                usize::try_from(size).map_err(|_| err("INPUT_TOO_LARGE", "input exceeds limit"))?,
            )
            .ok_or_else(|| err("INPUT_TOO_LARGE", "input exceeds limit"))?;
        if aggregate > r.max_input_bytes {
            return Err(err("INPUT_TOO_LARGE", "aggregate input exceeds limit"));
        }
    }
    let mut doc = load(&r.inputs[0], r.max_input_bytes)?;
    let n = count(&doc)?;
    if r.op == "info" {
        return Ok(
            json!({ "pageCount": n, "version": crate::document::version(&doc)?, "pages": geometry(&doc)? })
                .to_string(),
        );
    }
    editable(&doc)?;
    if r.op == "split" || r.op == "batches" {
        if r.ranges.is_empty() || r.ranges.len() > 128 {
            return Err(err("PAGE_RANGE", "provide 1..128 ranges"));
        }
        let mut manifest = Vec::new();
        let mut total = 0;
        if r.op == "batches" {
            let cap = r.max_range_pages.unwrap_or(128);
            if cap == 0
                || cap > 128
                || r.max_batch_bytes
                    .is_some_and(|b| b == 0 || b > r.max_output_bytes)
            {
                return Err(err("INVALID_ARGUMENT", "invalid batch limits"));
            }
            for rr in &r.ranges {
                range(rr, n)?;
                let mut start = rr.start;
                while start <= rr.end {
                    let end = (start + cap - 1).min(rr.end);
                    batch(r, &doc, start, end, &mut manifest, &mut total)?;
                    start = end + 1;
                }
            }
        } else {
            if r.outputs.len() != r.ranges.len() {
                return Err(err("INVALID_ARGUMENT", "one output per range required"));
            }
            for (i, rr) in r.ranges.iter().enumerate() {
                let bytes = extracted(
                    &doc,
                    &range(rr, n)?,
                    r.max_output_bytes.saturating_sub(total),
                )?;
                output(r, i, &bytes)?;
                total += bytes.len();
                manifest.push(
                    json!({ "index": i, "start": rr.start, "end": rr.end, "bytes": bytes.len() }),
                );
            }
        }
        return Ok(Value::Array(manifest).to_string());
    }
    let expected;
    match r.op.as_str() {
        "merge" => {
            expected = {
                let mut total = n;
                for input in r.inputs.iter().skip(1) {
                    let src = load(input, r.max_input_bytes)?;
                    editable(&src)?;
                    doc.set_version(
                        crate::document::version(&doc)?.max(crate::document::version(&src)?),
                    );
                    let m = count(&src)?;
                    if total + m > MAX_PAGES {
                        return Err(err("PAGE_RANGE", "merged page count exceeds limit"));
                    }
                    org::import_pages_with(
                        &mut doc,
                        &src,
                        &(0..m).collect::<Vec<_>>(),
                        total,
                        org::FieldConflicts::Rename,
                    )
                    .map_err(invalid)?;
                    total += m;
                }
                total
            };
        }
        "select" => {
            let selected = indices(&r.pages, n)?;
            let bytes = extracted(&doc, &selected, r.max_output_bytes)?;
            output(r, 0, &bytes)?;
            return Ok("null".into());
        }
        "remove" => {
            let selected = indices(&r.pages, n)?;
            let keep: Vec<usize> = (0..n).filter(|p| !selected.contains(p)).collect();
            if keep.is_empty() {
                return Err(err("PAGE_RANGE", "cannot remove all pages"));
            }
            expected = keep.len();
            org::delete_pages(&mut doc, &selected).map_err(invalid)?;
        }
        "replace" => {
            let selected = indices(&r.pages, n)?;
            let at = *selected
                .iter()
                .min()
                .ok_or_else(|| err("PAGE_RANGE", "no selected pages"))?;
            let src = load(&r.inputs[1], r.max_input_bytes)?;
            editable(&src)?;
            doc.set_version(crate::document::version(&doc)?.max(crate::document::version(&src)?));
            let m = count(&src)?;
            let removed = selected
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len();
            expected = n - removed + m;
            if expected > MAX_PAGES {
                return Err(err("PAGE_RANGE", "replacement page count exceeds limit"));
            }
            // Insert first so replacing all pages does not transiently delete the whole document.
            org::import_pages_with(
                &mut doc,
                &src,
                &(0..m).collect::<Vec<_>>(),
                at,
                org::FieldConflicts::Rename,
            )
            .map_err(invalid)?;
            let shifted: Vec<usize> = selected
                .iter()
                .map(|p| if *p >= at { p + m } else { *p })
                .collect();
            org::delete_pages(&mut doc, &shifted).map_err(invalid)?;
        }
        _ => return Err(err("UNSUPPORTED", "unknown page operation")),
    }
    let bytes = save(&doc, true, r.max_output_bytes, expected)?;
    output(r, 0, &bytes)?;
    Ok("null".into())
}
