use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod commands;
mod error;
mod models;

pub use error::{Error, Result};

#[cfg(desktop)]
use desktop::ShareIntent;
#[cfg(mobile)]
use mobile::ShareIntent;

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to access the share-intent APIs.
pub trait ShareIntentExt<R: Runtime> {
    fn share_intent(&self) -> &ShareIntent<R>;
}

impl<R: Runtime, T: Manager<R>> crate::ShareIntentExt<R> for T {
    fn share_intent(&self) -> &ShareIntent<R> {
        self.state::<ShareIntent<R>>().inner()
    }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("share-intent")
        .invoke_handler(tauri::generate_handler![
            commands::pending_share,
            commands::clear_pending_share
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let share_intent = mobile::init(app, api)?;
            #[cfg(desktop)]
            let share_intent = desktop::init(app, api)?;
            app.manage(share_intent);
            Ok(())
        })
        .build()
}
