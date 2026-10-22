use super::*;

#[test]
fn merges_before_recycling_and_keeps_source_on_recycle_failure() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("neuink_data");
    let data = temp.path().join("Neuink/data");
    neuink_workspace::Workspace::create(&source).unwrap();
    std::fs::create_dir_all(&data).unwrap();
    std::fs::write(source.join("proof.txt"), "saved").unwrap();
    let report = scan_candidates(&[source.clone(), source.clone()], &data, |path| {
        assert_eq!(path, source);
        assert_eq!(
            std::fs::read_to_string(data.join("library/proof.txt")).unwrap(),
            "saved"
        );
        Err("回收站不可用，原目录已保留。".into())
    });
    assert_eq!(report.imported, 1);
    assert_eq!(report.recycled, 0);
    assert_eq!(report.errors.len(), 1);
    assert!(source.exists());
    let recycled = temp.path().join("synthetic-recycle-bin");
    let report = scan_candidates(&[source.clone()], &data, |path| {
        std::fs::rename(path, &recycled).unwrap();
        Ok(())
    });
    assert_eq!(report.recycled, 1, "{:?}", report.errors);
    assert!(report.errors.is_empty());
    assert!(!source.exists());
    assert!(recycled.join("proof.txt").exists());
}

#[test]
fn invalid_named_directory_is_not_removed() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("neuink_data");
    std::fs::create_dir(&source).unwrap();
    let report = scan_candidates(&[source.clone()], temp.path(), |_| {
        panic!("must not recycle")
    });
    assert_eq!(report.imported, 0);
    assert_eq!(report.errors.len(), 1);
    assert!(source.exists());
}

#[cfg(windows)]
#[test]
fn scans_only_sibling_and_same_drive_root_without_duplicates() {
    assert_eq!(
        candidates(Path::new(r"E:\Apps\Neuink\Neuink.exe")),
        vec![
            PathBuf::from(r"E:\Apps\neuink_data"),
            PathBuf::from(r"E:\neuink_data")
        ]
    );
    assert_eq!(
        candidates(Path::new(r"E:\Neuink\Neuink.exe")),
        vec![PathBuf::from(r"E:\neuink_data")]
    );
    assert!(candidates(Path::new(r"E:\Apps\Neuink\Neuink.exe"))
        .iter()
        .all(|p| !p.starts_with(r"D:\")));
}

#[cfg(windows)]
#[test]
#[ignore = "Uses the real Windows Recycle Bin, synthetic folder only"]
fn windows_recycles_synthetic_directory() {
    let temp = tempfile::tempdir().unwrap();
    let name = format!("neuink-recycle-{}", neuink_domain::EntryId::new());
    let source = temp.path().join(&name);
    std::fs::create_dir(&source).unwrap();
    std::fs::write(
        source.join("synthetic-proof.txt"),
        "synthetic fixture, no user data",
    )
    .unwrap();
    recycle(&source).unwrap();
    assert!(!source.exists());
    // Verify the actual recoverable item, not merely disappearance from its original path.
    use windows::Win32::{System::Com::*, UI::Shell::*};
    let found = unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().unwrap();
        let bin: IShellItem = SHGetKnownFolderItem(&FOLDERID_RecycleBinFolder, KF_FLAG_DEFAULT, None).unwrap();
        let items: IEnumShellItems = bin.BindToHandler(None, &BHID_EnumItems).unwrap();
        let mut found = false;
        loop {
            let mut next = [None];
            let mut fetched = 0;
            items.Next(&mut next, Some(&mut fetched)).unwrap();
            if fetched == 0 { break; }
            let display = next[0].as_ref().unwrap().GetDisplayName(SIGDN_PARENTRELATIVE).unwrap();
            let label = display.to_string().unwrap();
            let matches = label == name;
            CoTaskMemFree(Some(display.0.cast()));
            if matches { found = true; break; }
        }
        drop(items); drop(bin); CoUninitialize();
        found
    };
    assert!(found, "Synthetic folder must be present in the Windows Recycle Bin");
}
