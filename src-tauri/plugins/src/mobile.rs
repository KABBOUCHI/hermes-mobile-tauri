use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_share_intent);

// initializes the Kotlin or Swift plugin classes
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<ShareIntent<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin("cloud.kabbouchi.shareintent", "ShareIntentPlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_share_intent)?;
    Ok(ShareIntent(handle))
}

/// Access to the share-intent APIs.
pub struct ShareIntent<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> ShareIntent<R> {
    pub fn pending_share(&self) -> crate::Result<PendingShareResponse> {
        self.0
            .run_mobile_plugin("pendingShare", ())
            .map_err(Into::into)
    }

    pub fn clear_pending_share(&self) -> crate::Result<ClearPendingShareResponse> {
        self.0
            .run_mobile_plugin("clearPendingShare", ())
            .map_err(Into::into)
    }
}
