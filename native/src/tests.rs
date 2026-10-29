use super::*;
use pdfcraft_cos::{Algorithm, Dict, Document, NewEncryption, Object, SaveOptions};
use std::sync::Arc;

#[test]
fn encrypted_pdfs_are_refused_even_with_an_empty_password() {
    let mut doc = Document::new_empty();
    pdfcraft_organize::insert_blank_page(&mut doc, 0, 200., 400.).unwrap();
    doc.set_encryption(&NewEncryption {
        algorithm: Algorithm::Aes256,
        user_password: "",
        owner_password: "owner",
        permissions: -4,
        encrypt_metadata: true,
        seed: [7; 32],
    })
    .unwrap();
    let bytes = pdfcraft_cos::write_full(&doc, &SaveOptions::default()).unwrap();
    let p = std::env::temp_dir().join(format!("pdfcraft-encrypted-{}.pdf", std::process::id()));
    std::fs::write(&p, bytes).unwrap();
    let result = document::load(p.to_str().unwrap(), MAX_INPUT);
    std::fs::remove_file(p).unwrap();
    assert!(
        result
            .unwrap_err()
            .reason
            .starts_with("ERR_PDFCRAFT_PASSWORD_REQUIRED")
    );
}
#[test]
fn compression_preserves_rich_catalog_and_image_bytes_in_lossless_mode() {
    let data = include_bytes!("../../tests/fixtures/rich.pdf");
    let original = Document::open(Arc::new(data.to_vec())).unwrap();
    let source_root = original.get(original.root().unwrap());
    let protected = [
        b"Outlines".as_slice(),
        b"AcroForm",
        b"Names",
        b"Metadata",
        b"StructTreeRoot",
        b"OCProperties",
    ];
    let dir = std::env::temp_dir().join(format!("pdfcraft-native-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    for mode in ["lossless", "balanced", "strong"] {
        let input = dir.join("input.pdf");
        let output = dir.join(format!("{mode}.pdf"));
        std::fs::write(&input, data).unwrap();
        let req: Request = serde_json::from_value(serde_json::json!({ "op":"compress", "inputs":[input], "outputs":[output], "maxInputBytes":MAX_INPUT,"maxOutputBytes":MAX_OUTPUT,"mode":mode })).unwrap();
        compression::run(&req).unwrap();
        let result = document::load(output.to_str().unwrap(), MAX_INPUT).unwrap();
        let root = result.get(result.root().unwrap());
        for key in protected {
            assert!(source_root.as_dict().unwrap().contains(key));
            assert!(root.as_dict().unwrap().contains(key));
        }
        assert_eq!(pdfcraft_organize::bookmarks(&result).len(), 1);
        assert_eq!(
            pdfcraft_organize::attachment_keys(&result),
            vec!["note.txt"]
        );
        assert_eq!(document::count(&result).unwrap(), 3);
        if mode == "lossless" {
            let images = |d: &Document| {
                d.scan_objects()
                    .filter_map(|(_, o)| {
                        if let Object::Stream(s) = &*o {
                            (s.dict.name(b"Subtype") == Some(b"Image"))
                                .then(|| s.decoded().unwrap())
                        } else {
                            None
                        }
                    })
                    .collect::<Vec<_>>()
            };
            assert!(
                images(&original) == images(&result),
                "decoded image samples changed"
            );
        }
    }
    std::fs::remove_dir_all(dir).unwrap();
}
#[test]
fn signature_detection_catches_inline_fields_and_page_order_validation() {
    let mut doc = Document::new_empty();
    pdfcraft_organize::insert_blank_page(&mut doc, 0, 200., 400.).unwrap();
    let mut sig = Dict::new();
    sig.set(b"ByteRange".to_vec(), Object::Array(vec![]));
    let root = doc.root().unwrap();
    doc.update_dict(root, |d| {
        d.set(b"InlineSignature".to_vec(), Object::Dict(sig))
    })
    .unwrap();
    assert!(
        document::writable(&doc)
            .unwrap_err()
            .reason
            .starts_with("ERR_PDFCRAFT_UNSUPPORTED")
    );
    assert_eq!(pages::indices(&[3, 1, 3], 3).unwrap(), vec![2, 0, 2]);
    assert!(pages::indices(&[0], 3).is_err());
}

#[test]
fn effective_version_resolves_catalog_indirect_reference() {
    let mut doc = Document::new_empty();
    pdfcraft_organize::insert_blank_page(&mut doc, 0, 200., 400.).unwrap();
    doc.set_version("1.4");
    let v = doc.add(Object::name("1.7"));
    doc.update_dict(doc.root().unwrap(), |d| {
        d.set(b"Version".to_vec(), Object::Ref(v))
    })
    .unwrap();
    assert_eq!(document::version(&doc).unwrap(), "1.7");
}

#[test]
fn unchanged_original_can_fit_a_limit_smaller_than_the_rewrite() {
    let mut doc = Document::new_empty();
    pdfcraft_organize::insert_blank_page(&mut doc, 0, 200., 400.).unwrap();
    let original = pdfcraft_cos::write_full(
        &doc,
        &SaveOptions {
            object_streams: false,
            ..Default::default()
        },
    )
    .unwrap();
    let candidate = pdfcraft_cos::write_full(&doc, &SaveOptions::default()).unwrap();
    assert!(
        candidate.len() > original.len(),
        "fixture must exercise a larger rewrite"
    );
    let dir = std::env::temp_dir().join(format!("pdfcraft-fallback-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let input = dir.join("input.pdf");
    let output = dir.join("output.pdf");
    std::fs::write(&input, &original).unwrap();
    let r: Request=serde_json::from_value(serde_json::json!({"op":"compress","inputs":[input],"outputs":[output],"maxInputBytes":MAX_INPUT,"maxOutputBytes":original.len(),"mode":"lossless"})).unwrap();
    compression::run(&r).unwrap();
    assert!(std::fs::read(output).unwrap() == original);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn duplicate_resource_merging_preserves_custom_trailer_references() {
    use pdfcraft_cos::Stream;
    let mut doc = Document::new_empty();
    let page = pdfcraft_organize::insert_blank_page(&mut doc, 0, 200., 400.).unwrap();
    let image = || {
        let mut d = Dict::new();
        d.set(b"Type".to_vec(), Object::name("XObject"));
        d.set(b"Subtype".to_vec(), Object::name("Image"));
        d.set(b"Width".to_vec(), Object::Int(1));
        d.set(b"Height".to_vec(), Object::Int(1));
        d.set(b"BitsPerComponent".to_vec(), Object::Int(8));
        d.set(b"ColorSpace".to_vec(), Object::name("DeviceGray"));
        Stream::from_raw(d, vec![128])
    };
    let a = doc.add(Object::Stream(image()));
    let b = doc.add(Object::Stream(image()));
    let mut x = Dict::new();
    x.set(b"I1".to_vec(), Object::Ref(a));
    x.set(b"I2".to_vec(), Object::Ref(b));
    let mut resources = Dict::new();
    resources.set(b"XObject".to_vec(), Object::Dict(x));
    let contents = doc.add(Object::Stream(Stream::from_raw(
        Dict::new(),
        b"/I1 Do /I2 Do\n".to_vec(),
    )));
    doc.update_dict(page, |d| {
        d.set(b"Resources".to_vec(), Object::Dict(resources));
        d.set(b"Contents".to_vec(), Object::Ref(contents));
    })
    .unwrap();
    doc.trailer_mut()
        .set(b"ExtensionData".to_vec(), Object::Ref(b));
    let dir = std::env::temp_dir().join(format!("pdfcraft-dedupe-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let input = dir.join("in.pdf");
    let output = dir.join("out.pdf");
    std::fs::write(
        &input,
        pdfcraft_cos::write_full(&doc, &SaveOptions::default()).unwrap(),
    )
    .unwrap();
    let r:Request=serde_json::from_value(serde_json::json!({"op":"compress","inputs":[input],"outputs":[output],"maxInputBytes":MAX_INPUT,"maxOutputBytes":MAX_OUTPUT,"mode":"lossless"})).unwrap();
    compression::run(&r).unwrap();
    let out = document::load(output.to_str().unwrap(), MAX_INPUT).unwrap();
    let ext = out.resolve(out.trailer().get(b"ExtensionData").unwrap());
    assert!(matches!(&*ext,Object::Stream(s) if s.decoded().unwrap()==vec![128]));
    let image_count = out
        .scan_objects()
        .filter(
            |(_, o)| matches!(&**o,Object::Stream(s) if s.dict.name(b"Subtype")==Some(b"Image")),
        )
        .count();
    assert_eq!(image_count, 1);
    std::fs::remove_dir_all(dir).unwrap();
}
