//! Carnet de Kamas desktop app: a native window showing the web app (`../src`), plus
//! the commands its data file needs (see `src/js/data/tauri-file.js`, which plugs
//! them into `src/js/data/data-file.js`).
//!
//! The data file's location is decided here, never by the page: `$CARNET_DATA` when
//! set, otherwise the per-user data folder, the same one the local server uses
//! (`server/paths.js`): `%APPDATA%\Carnet de Kamas` on Windows,
//! `~/Library/Application Support/Carnet de Kamas` on macOS and
//! `~/.local/share/carnet-de-kamas` on Linux.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use tauri::Manager;

/// Where the data file is, decided once at start-up, and the app's version.
struct DataFile(PathBuf, String);

/// The data file's path, for messages and the status line.
#[tauri::command]
fn data_file_path(file: tauri::State<'_, DataFile>) -> String {
    file.0.display().to_string()
}

/// The data file's text, or `None` when it does not exist yet.
#[tauri::command]
fn read_data(file: tauri::State<'_, DataFile>) -> Result<Option<String>, String> {
    read_optional(&file.0).map_err(|error| error.to_string())
}

/// Replaces the data file with `contents`, atomically.
#[tauri::command]
fn write_data(file: tauri::State<'_, DataFile>, contents: String) -> Result<(), String> {
    write_atomic(&file.0, &contents).map_err(|error| error.to_string())
}

/// Copies the data file to its backup (see `backup_path`), and, the first time this
/// version of the app opens it, to a copy that is never overwritten (see
/// `version_backup_path`): the file exactly as the previous version left it.
#[tauri::command]
fn backup_data(file: tauri::State<'_, DataFile>) -> Result<(), String> {
    backup(&file.0, &file.1).map_err(|error| error.to_string())
}

fn backup(path: &Path, version: &str) -> io::Result<()> {
    let kept = version_backup_path(path, version);
    if !kept.exists() {
        fs::copy(path, &kept)?;
    }
    fs::copy(path, backup_path(path)).map(|_| ())
}

fn read_optional(path: &Path) -> io::Result<Option<String>> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

/// Writes a temporary file next to `path`, flushes it to disk, then renames it over
/// `path`, so that a crash or power cut leaves the old or the new file, never half
/// of one. Folders are created as needed.
fn write_atomic(path: &Path, contents: &str) -> io::Result<()> {
    if let Some(folder) = path.parent() {
        fs::create_dir_all(folder)?;
    }
    let temp = path.with_extension(format!("{}.tmp", std::process::id()));
    let result = (|| {
        let mut file = fs::File::create(&temp)?;
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
        fs::rename(&temp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

/// "carnet.json" → "carnet.backup.json": the same rule as `backupPath` in data-file.js.
fn backup_path(path: &Path) -> PathBuf {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let base = if name.to_lowercase().ends_with(".json") {
        &name[..name.len() - ".json".len()]
    } else {
        &name
    };
    path.with_file_name(format!("{base}.backup.json"))
}

/// "carnet.json", "3.0.2" → "carnet.before-3.0.2.backup.json". Kept after an upgrade, so
/// a bug in the new version cannot reach the data both backups were made from.
fn version_backup_path(path: &Path, version: &str) -> PathBuf {
    let backup = backup_path(path);
    let name = backup.file_name().unwrap_or_default().to_string_lossy();
    let base = &name[..name.len() - ".backup.json".len()];
    path.with_file_name(format!("{base}.before-{version}.backup.json"))
}

/// `$CARNET_DATA`, or `carnet.json` in the per-user data folder.
fn data_file_location(app: &tauri::App) -> tauri::Result<PathBuf> {
    if let Some(custom) = std::env::var_os("CARNET_DATA") {
        return Ok(PathBuf::from(custom));
    }
    let folder = if cfg!(target_os = "linux") {
        "carnet-de-kamas"
    } else {
        "Carnet de Kamas"
    };
    Ok(app.path().data_dir()?.join(folder).join("carnet.json"))
}

/// Starts the app.
pub fn run() {
    tauri::Builder::default()
        // First: a second launch only focuses the open window, so the data file has one writer.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let location = data_file_location(app)?;
            let version = app.package_info().version.to_string();
            app.manage(DataFile(location, version));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            data_file_path,
            read_data,
            write_data,
            backup_data
        ])
        .run(tauri::generate_context!())
        .expect("error while running Carnet de Kamas");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh, empty folder for one test.
    fn folder(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("carnet-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        path
    }

    #[test]
    fn write_atomic_creates_folders_and_replaces_the_file() {
        let dir = folder("write");
        let file = dir.join("nested").join("carnet.json");
        write_atomic(&file, "first").unwrap();
        write_atomic(&file, "second").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "second");
        let leftovers: Vec<_> = fs::read_dir(file.parent().unwrap()).unwrap().collect();
        assert_eq!(leftovers.len(), 1, "no temporary file left behind");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn write_atomic_fails_cleanly_when_a_folder_stands_in_the_way() {
        let dir = folder("blocked");
        let file = dir.join("carnet.json");
        fs::create_dir_all(&file).unwrap(); // a directory where the file should go
        assert!(write_atomic(&file, "text").is_err());
        let leftovers: Vec<_> = fs::read_dir(&dir).unwrap().collect();
        assert_eq!(leftovers.len(), 1, "the temporary file is removed");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn read_optional_tells_a_missing_file_from_an_empty_one() {
        let dir = folder("read");
        let file = dir.join("carnet.json");
        assert_eq!(read_optional(&file).unwrap(), None);
        write_atomic(&file, "").unwrap();
        assert_eq!(read_optional(&file).unwrap(), Some(String::new()));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn backup_keeps_the_file_as_the_previous_version_left_it() {
        let dir = folder("backup");
        let file = dir.join("carnet.json");
        write_atomic(&file, "from 3.0.1").unwrap();
        backup(&file, "3.0.2").unwrap();
        write_atomic(&file, "from 3.0.2").unwrap();
        backup(&file, "3.0.2").unwrap();
        let read = |name: &str| fs::read_to_string(dir.join(name)).unwrap();
        assert_eq!(read("carnet.backup.json"), "from 3.0.2");
        assert_eq!(read("carnet.before-3.0.2.backup.json"), "from 3.0.1");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn version_backup_path_follows_the_backup_name() {
        let dir = Path::new("data");
        assert_eq!(
            version_backup_path(&dir.join("carnet.json"), "3.0.2"),
            dir.join("carnet.before-3.0.2.backup.json")
        );
        assert_eq!(
            version_backup_path(&dir.join("notes.txt"), "3.0.2"),
            dir.join("notes.txt.before-3.0.2.backup.json")
        );
    }

    #[test]
    fn backup_path_matches_the_web_app_rule() {
        let dir = Path::new("data");
        assert_eq!(
            backup_path(&dir.join("carnet.json")),
            dir.join("carnet.backup.json")
        );
        assert_eq!(
            backup_path(&dir.join("Carnet.JSON")),
            dir.join("Carnet.backup.json")
        );
        assert_eq!(
            backup_path(&dir.join("carnet")),
            dir.join("carnet.backup.json")
        );
        assert_eq!(
            backup_path(&dir.join("notes.txt")),
            dir.join("notes.txt.backup.json")
        );
    }
}
