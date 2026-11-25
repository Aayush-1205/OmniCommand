pub mod ipc;
pub mod models;
pub mod runner;
pub mod security;
pub mod storage;

use ipc::AppState;
use runner::ProcessRunner;
use std::sync::atomic::{AtomicBool, Ordering};
use storage::AtomicJsonStore;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Trims idle working-set RAM pages when OmniCommand hides to the Windows
/// system tray, keeping WebView2 warm for instant (<20 ms) reopen while
/// dropping background memory footprint to a minimal level.
#[cfg(target_os = "windows")]
fn trim_process_working_set() {
    use windows::Win32::System::ProcessStatus::K32EmptyWorkingSet;
    use windows::Win32::System::Threading::{GetCurrentProcess, SetProcessWorkingSetSize};

    unsafe {
        let process = GetCurrentProcess();
        let _ = K32EmptyWorkingSet(process);
        let _ = SetProcessWorkingSetSize(process, usize::MAX, usize::MAX);
    }
}

#[cfg(not(target_os = "windows"))]
fn trim_process_working_set() {}

/// Restores the single existing `"main"` window to the foreground (`unminimize -> show -> set_focus`).
/// Only recreates `"main"` if `unloadWebviewOnClose` explicitly destroyed it, using `visible(false)`
/// so React finishes hydrating `session.json` before revealing with zero white flash.
fn restore_main_window(app: &AppHandle, open_launcher: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        if open_launcher {
            let _ = window.emit("omnicommand:open-launcher", ());
        }
        return;
    }

    if let Some(state) = app.try_state::<AppState>() {
        state
            .pending_open_launcher
            .store(open_launcher, Ordering::SeqCst);
    }

    let _ = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("OmniCommand")
        .inner_size(1320.0, 840.0)
        .min_inner_size(960.0, 620.0)
        .center()
        .visible(false)
        .build();
}

/// Registers the OS-level Quick Launcher shortcut (default `Shift+Space`).
/// When OmniCommand's own window gains focus, we unregister (pause) this hook so
/// typing fast inside AI chat or console stdin never collides with the global hook.
fn register_global_shortcut(app: &AppHandle, shortcut: &str) {
    let trimmed = shortcut.trim();
    if trimmed.is_empty() {
        return;
    }
    let _ = app.global_shortcut().unregister_all();
    let app_handle = app.clone();
    let _ = app
        .global_shortcut()
        .on_shortcut(trimmed, move |_app, _sc, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            if let Some(window) = app_handle.get_webview_window("main") {
                if window.is_focused().unwrap_or(false) {
                    // Defense-in-depth Window-Focus Guard
                    return;
                }
            }
            restore_main_window(&app_handle, true);
        });
}

fn pause_global_shortcut(app: &AppHandle) {
    let _ = app.global_shortcut().unregister_all();
}

/// Called from `ipc::save_settings` when the user changes their launcher shortcut.
pub fn rebind_global_shortcut(app: &AppHandle, shortcut: &str) {
    let is_main_focused = app
        .get_webview_window("main")
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false);
    if is_main_focused {
        pause_global_shortcut(app);
    } else {
        register_global_shortcut(app, shortcut);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let store = AtomicJsonStore::new().expect("Failed to initialize OmniCommand local store");
    let runner = ProcessRunner::new(store.clone());
    let initial_settings = store.load_settings();

    tauri::Builder::default()
        // CRITICAL: Register single-instance plugin FIRST so clicking the app icon
        // while hidden in the tray always focuses the existing window with zero duplicates.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            restore_main_window(app, false);
        }))
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState {
            store: store.clone(),
            runner,
            pending_open_launcher: AtomicBool::new(false),
        })
        .setup(move |app| {
            // System Tray context menu
            let show_item =
                MenuItem::with_id(app, "show", "Open OmniCommand", true, None::<&str>)?;
            let launcher_item = MenuItem::with_id(
                app,
                "launcher",
                "Quick Launcher (Shift+Space)",
                true,
                None::<&str>,
            )?;
            let quit_item =
                MenuItem::with_id(app, "quit", "Quit OmniCommand", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &launcher_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("OmniCommand")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => restore_main_window(app, false),
                    "launcher" => restore_main_window(app, true),
                    "quit" => {
                        // Flush active session & wait for any atomic JSON writes before exiting cleanly
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("omnicommand:before-unload", ());
                        }
                        if let Some(state) = app.try_state::<AppState>() {
                            state.store.flush_checkpoint_sync();
                        }
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    }
                    | TrayIconEvent::DoubleClick {
                        button: MouseButton::Left,
                        ..
                    } => {
                        restore_main_window(tray.app_handle(), false);
                    }
                    _ => {}
                });

            let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))
                .ok()
                .or_else(|| app.default_window_icon().cloned());
            if let Some(icon) = tray_icon {
                tray_builder = tray_builder.icon(icon);
            }
            let _tray = tray_builder.build(app)?;

            // Register global Shift+Space shortcut (paused automatically whenever main window has focus)
            register_global_shortcut(app.handle(), &initial_settings.launcher_shortcut);

            Ok(())
        })
        .on_window_event(move |window, event| {
            if window.label() != "main" {
                return;
            }
            match event {
                WindowEvent::Focused(focused) => {
                    if *focused {
                        // Pause global Shift+Space hook while OmniCommand is focused so
                        // typing inside AI chat or console stdin is never intercepted by the OS hook.
                        pause_global_shortcut(window.app_handle());
                    } else {
                        let settings = store.load_settings();
                        register_global_shortcut(window.app_handle(), &settings.launcher_shortcut);
                    }
                }
                WindowEvent::CloseRequested { api, .. } => {
                    let settings = store.load_settings();
                    if settings.close_to_tray {
                        if settings.unload_webview_on_close {
                            // Optional Ultra-Low RAM mode: flush session.json before destroying WebView2
                            let _ = window.emit("omnicommand:before-unload", ());
                            register_global_shortcut(
                                window.app_handle(),
                                &settings.launcher_shortcut,
                            );
                            trim_process_working_set();
                        } else {
                            // Default: keep WebView2 warm for instant (<20 ms) reopen and trim idle RAM pages
                            api.prevent_close();
                            let _ = window.hide();
                            register_global_shortcut(
                                window.app_handle(),
                                &settings.launcher_shortcut,
                            );
                            trim_process_working_set();
                        }
                    }
                }
                WindowEvent::Destroyed => {
                    // Ensure global shortcut remains active in tray if WebView2 was unloaded
                    let settings = store.load_settings();
                    if settings.close_to_tray {
                        register_global_shortcut(window.app_handle(), &settings.launcher_shortcut);
                        trim_process_working_set();
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            ipc::reveal_main_window,
            ipc::get_projects,
            ipc::save_projects,
            ipc::upsert_projects,
            ipc::get_commands,
            ipc::save_commands,
            ipc::upsert_commands_batch,
            ipc::get_settings,
            ipc::save_settings,
            ipc::set_provider_api_key,
            ipc::get_provider_decrypted_key,
            ipc::get_executions,
            ipc::get_execution_log,
            ipc::get_session_state,
            ipc::save_session_state,
            ipc::run_command,
            ipc::stop_execution,
            ipc::send_execution_stdin,
            ipc::validate_path,
            ipc::check_guardrails,
            ipc::list_available_engines,
            ipc::get_storage_root,
            ipc::inspect_workspace_files,
        ])
        .build(tauri::generate_context!())
        .expect("error while building OmniCommand")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    if let Some(state) = app_handle.try_state::<AppState>() {
                        if state.store.load_settings().close_to_tray {
                            api.prevent_exit();
                        }
                    }
                }
            }
        });
}
