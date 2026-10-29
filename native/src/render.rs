use crate::{
    Request,
    document::{count, load, output},
    err, invalid, io,
    pages::{geometry, indices},
};
use image::ImageEncoder;
use napi::Result;
use std::{fs::File, io::Read};

fn dimensions(r: &Request, w: f64, h: f64) -> Result<(u32, u32)> {
    let max_width = r.max_width.unwrap_or(8192);
    let max_height = r.max_height.unwrap_or(8192);
    let max_pixels = r.max_pixels.unwrap_or(32_000_000);
    if max_width == 0
        || max_height == 0
        || max_width > 8192
        || max_height > 8192
        || max_pixels == 0
        || max_pixels > 32_000_000
    {
        return Err(err("INVALID_ARGUMENT", "invalid raster limits"));
    }
    let w = w.ceil();
    let h = h.ceil();
    if !w.is_finite()
        || !h.is_finite()
        || w < 1.
        || h < 1.
        || w > max_width as f64
        || h > max_height as f64
        || w * h > max_pixels as f64
    {
        return Err(err("RENDER", "raster dimensions exceed configured limits"));
    }
    Ok((w as u32, h as u32))
}
fn png(bytes: &[u8], w: u32, h: u32, max: usize) -> Result<Vec<u8>> {
    struct Limited {
        data: Vec<u8>,
        max: usize,
    }
    impl std::io::Write for Limited {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            if bytes.len() > self.max.saturating_sub(self.data.len()) {
                return Err(std::io::Error::other("PNG output limit exceeded"));
            }
            self.data.extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut out = Limited {
        data: Vec::new(),
        max,
    };
    image::codecs::png::PngEncoder::new(&mut out)
        .write_image(bytes, w, h, image::ExtendedColorType::Rgba8)
        .map_err(|e| err("OUTPUT_TOO_LARGE", e))?;
    Ok(out.data)
}
fn check_fonts(doc: &pdfcraft_cos::Document) -> Result<()> {
    const STANDARD: &[&[u8]] = &[
        b"Helvetica",
        b"Helvetica-Bold",
        b"Helvetica-Oblique",
        b"Helvetica-BoldOblique",
        b"Times-Roman",
        b"Times-Bold",
        b"Times-Italic",
        b"Times-BoldItalic",
        b"Courier",
        b"Courier-Bold",
        b"Courier-Oblique",
        b"Courier-BoldOblique",
        b"Symbol",
        b"ZapfDingbats",
    ];
    fn check(doc: &pdfcraft_cos::Document, o: &pdfcraft_cos::Object, depth: usize) -> Result<()> {
        if depth > 128 {
            return Err(invalid("object nesting exceeds limit"));
        }
        if let Some(d) = o.as_dict() {
            if d.name(b"Type") == Some(b"Font")
                && !matches!(d.name(b"Subtype"), Some(b"Type0" | b"Type3"))
            {
                let standard = d.name(b"BaseFont").is_some_and(|n| STANDARD.contains(&n));
                let embedded = d
                    .get(b"FontDescriptor")
                    .and_then(|v| doc.dict(v))
                    .is_some_and(|fd| {
                        [b"FontFile".as_slice(), b"FontFile2", b"FontFile3"]
                            .iter()
                            .any(|k| fd.contains(k))
                    });
                if !standard && !embedded {
                    return Err(err(
                        "RENDER",
                        "nonstandard font is not embedded; refusing possible missing glyphs",
                    ));
                }
            }
            for (_, v) in d.iter() {
                check(doc, v, depth + 1)?;
            }
        }
        if let pdfcraft_cos::Object::Array(items) = o {
            for v in items {
                check(doc, v, depth + 1)?;
            }
        }
        Ok(())
    }
    for (_, obj) in doc.scan_objects_checked() {
        check(doc, obj.map_err(invalid)?.as_ref(), 0)?;
    }
    Ok(())
}
fn pdf(r: &Request) -> Result<Vec<u8>> {
    let doc = load(&r.inputs[0], r.max_input_bytes)?;
    let selected = indices(&r.pages, count(&doc)?)?;
    if selected.len() != 1 {
        return Err(err("PAGE_RANGE", "render exactly one page"));
    }
    check_fonts(&doc)?;
    let page = selected[0];
    let info = geometry(&doc)?;
    let dpi = r.dpi.unwrap_or(144.);
    if !dpi.is_finite() || dpi <= 0. || dpi > 1200. {
        return Err(err("INVALID_ARGUMENT", "DPI must be >0 and <=1200"));
    }
    let scale = dpi / 72.;
    dimensions(
        r,
        info[page]["width"].as_f64().unwrap_or(0.) * scale,
        info[page]["height"].as_f64().unwrap_or(0.) * scale,
    )?;
    let mut renderer = pdfcraft_render::PageRenderer::new(
        doc.bytes().clone(),
        pdfcraft_render::RenderConfig {
            reject_oversize: true,
            transparent: r.transparent.unwrap_or(false),
            ..Default::default()
        },
    );
    if renderer.page_count() != count(&doc)? {
        return Err(err("RENDER", "renderer page count mismatch"));
    }
    let rendered = renderer.render(pdfcraft_render::RenderRequest {
        page,
        scale: scale as f32,
        ..Default::default()
    });
    if let Some(e) = rendered.error {
        return Err(err("RENDER", e));
    }
    if !rendered.warnings.is_empty() {
        return Err(err(
            "RENDER",
            "renderer reported truncated content or colour fallback",
        ));
    }
    dimensions(r, rendered.width as f64, rendered.height as f64)?;
    let mut bytes = rendered.rgba.to_vec();
    // PDFCraft returns premultiplied RGBA; PNG stores straight alpha.
    for px in bytes.chunks_exact_mut(4) {
        let a = px[3] as u32;
        if a > 0 && a < 255 {
            for c in &mut px[..3] {
                *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
    png(&bytes, rendered.width, rendered.height, r.max_output_bytes)
}
fn svg(r: &Request) -> Result<Vec<u8>> {
    let max = r.max_input_bytes.min(8 * 1024 * 1024);
    let f = File::open(&r.inputs[0]).map_err(io)?;
    if !f.metadata().map_err(io)?.is_file() {
        return Err(err("IO", "input must be a regular file"));
    }
    let mut bytes = Vec::new();
    f.take(max as u64 + 1).read_to_end(&mut bytes).map_err(io)?;
    if bytes.len() > max {
        return Err(err("INPUT_TOO_LARGE", "SVG input exceeds limit"));
    }
    let text = std::str::from_utf8(&bytes).map_err(|e| err("RENDER", e))?;
    let xml = roxmltree::Document::parse(text).map_err(|e| err("UNSUPPORTED", e))?;
    if text.contains("<!DOCTYPE") || text.contains("<!ENTITY") {
        return Err(err("UNSUPPORTED", "SVG declarations are forbidden"));
    }
    if xml.descendants().any(|n| n.is_pi()) {
        return Err(err(
            "UNSUPPORTED",
            "SVG processing instructions are forbidden",
        ));
    }
    for node in xml.descendants().filter(|n| n.is_element()) {
        if matches!(
            node.tag_name().name(),
            "script" | "foreignObject" | "animate" | "animateMotion" | "animateTransform" | "set"
        ) {
            return Err(err("UNSUPPORTED", "active SVG content is forbidden"));
        }
        for a in node.attributes() {
            let name = a.name();
            let value = a.value().trim();
            if name.to_ascii_lowercase().starts_with("on") {
                return Err(err("UNSUPPORTED", "SVG event handlers are forbidden"));
            }
            if name == "href"
                && !value.starts_with('#')
                && !value.starts_with("data:image/png;base64,")
                && !value.starts_with("data:image/jpeg;base64,")
            {
                return Err(err("UNSUPPORTED", "external SVG resources are forbidden"));
            }
        }
        for value in node.attributes().map(|a| a.value()).chain(
            node.children()
                .filter(|n| n.is_text())
                .filter_map(|n| n.text()),
        ) {
            let lower = value.to_ascii_lowercase();
            if lower.contains("@import") || lower.contains('\\') {
                return Err(err("UNSUPPORTED", "escaped CSS and imports are forbidden"));
            }
            let mut rest = lower.as_str();
            while let Some(i) = rest.find("url(") {
                rest = &rest[i + 4..];
                let end = rest
                    .find(')')
                    .ok_or_else(|| err("UNSUPPORTED", "invalid SVG resource URL"))?;
                if !rest[..end]
                    .trim()
                    .trim_matches(['\'', '"'])
                    .starts_with('#')
                {
                    return Err(err("UNSUPPORTED", "external SVG resources are forbidden"));
                }
                rest = &rest[end + 1..];
            }
        }
    }
    let mut options = resvg::usvg::Options::default();
    options.image_href_resolver.resolve_string = Box::new(|_, _| None);
    options.fontdb_mut().load_system_fonts();
    let tree = resvg::usvg::Tree::from_data(&bytes, &options).map_err(|e| err("RENDER", e))?;
    let size = tree.size();
    let w = r.width.map(|v| v as f64).unwrap_or_else(|| {
        r.height
            .map(|h| h as f64 * size.width() as f64 / size.height() as f64)
            .unwrap_or(size.width() as f64)
    });
    let h = r
        .height
        .map(|v| v as f64)
        .unwrap_or(w * size.height() as f64 / size.width() as f64);
    let (w, h) = dimensions(r, w, h)?;
    let mut pixmap = resvg::tiny_skia::Pixmap::new(w, h)
        .ok_or_else(|| err("RENDER", "cannot allocate raster"))?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::from_scale(w as f32 / size.width(), h as f32 / size.height()),
        &mut pixmap.as_mut(),
    );
    let mut rgba = Vec::with_capacity(w as usize * h as usize * 4);
    for p in pixmap.pixels() {
        let p = p.demultiply();
        rgba.extend_from_slice(&[p.red(), p.green(), p.blue(), p.alpha()]);
    }
    png(&rgba, w, h, r.max_output_bytes)
}
pub(crate) fn run(r: &Request) -> Result<String> {
    if r.inputs.len() != 1 || r.outputs.len() != 1 {
        return Err(err("INVALID_ARGUMENT", "one input and output required"));
    }
    let bytes = if r.op == "svg" { svg(r)? } else { pdf(r)? };
    output(r, 0, &bytes)?;
    Ok("null".into())
}
