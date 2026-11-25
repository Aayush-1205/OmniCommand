pub mod ipc;
pub mod models;
pub mod runner;
pub mod security;
pub mod storage;

use ipc::AppState;
use runner::ProcessRunner;
use storage::AtomicJsonStore;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

fn ensure_or_show_main_window(app: &tauri::AppHandle, open_launcher: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        if open_launcher {
            let _ = window.emit("omnicommand:open-launcher", ());
        }
    } else if let Ok(window) =
        WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
            .title("OmniCommand")
            .inner_size(1320.0, 840.0)
            .min_inner_size(960.0, 620.0)
            .center()
            .build()
    {
        let _ = window.set_focus();
        if open_launcher {
            let _ = window.emit("omnicommand:open-launcher", ());
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let store = AtomicJsonStore::new().expect("Failed to initialize OmniCommand local store");
    let runner = ProcessRunner::new(store.clone());
    let initial_settings = store.load_settings();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            ensure_or_show_main_window(app, false);
        }))
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState {
            store: store.clone(),
            runner,
        })
        .setup(move |app| {
            // System Tray setup
            let show_item = MenuItem::with_id(app, "show", "Open OmniCommand", true, None::<&str>)?;
            let launcher_item = MenuItem::with_id(
                app,
                "launcher",
                "Quick Launcher (Shift+Space)",
                true,
                None::<&str>,
            )?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit OmniCommand", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &launcher_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("OmniCommand")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => ensure_or_show_main_window(app, false),
                    "launcher" => ensure_or_show_main_window(app, true),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        ensure_or_show_main_window(tray.app_handle(), false);
                    }
                })
                .build(app)?;

            // Global shortcut registration with Window-Focus Guard:
            // Ignore global Shift+Space when OmniCommand's own window already has focus
            // so typing fast in AI chat or console stdin never collides with the launcher.
            let shortcut = initial_settings.launcher_shortcut.clone();
            let app_handle = app.handle().clone();
            let _ = app.global_shortcut().on_shortcut(shortcut.as_str(), move |_app, _sc, event| {
                if event.state() != ShortcutState::Pressed {
                    return;
                }
                if let Some(window) = app_handle.get_webview_window("main") {
                    if window.is_focused().unwrap_or(false) {
                        // Window is focused — let the frontend input-aware listener decide.
                        return;
                    }
                }
                ensure_or_show_main_window(&app_handle, true);
            });

            Ok(())
        })
        .on_window_event(move |window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let settings = store.load_settings();
                if settings.close_to_tray {
                    if settings.unload_webview_on_close {
                        // Notify frontend to flush session.json before destroying WebView2
                        let _ = window.emit("omnicommand:before-unload", ());
                        // Allow close to destroy WebView2 while tray keeps process alive
                    } else {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running OmniCommand");
}
