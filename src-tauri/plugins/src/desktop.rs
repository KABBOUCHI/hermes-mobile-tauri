use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<ShareIntent<R>> {
    Ok(ShareIntent(app.clone()))
}

/// Access to the share-intent APIs.
pub struct ShareIntent<R: Runtime>(AppHandle<R>);

impl<R: Runtime> ShareIntent<R> {
    pub fn pending_share(&self) -> crate::Result<PendingShareResponse> {
        Ok(PendingShareResponse::default())
    }

    pub fn clear_pending_share(&self) -> crate::Result<ClearPendingShareResponse> {
        Ok(ClearPendingShareResponse { cleared: true })
    }
}
