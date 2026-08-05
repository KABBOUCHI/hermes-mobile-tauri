use tauri::{command, AppHandle, Runtime};

use crate::models::{ClearPendingShareResponse, PendingShareResponse};
use crate::Result;
use crate::ShareIntentExt;

#[command]
pub(crate) fn pending_share<R: Runtime>(app: AppHandle<R>) -> Result<PendingShareResponse> {
    app.share_intent().pending_share()
}

#[command]
pub(crate) fn clear_pending_share<R: Runtime>(
    app: AppHandle<R>,
) -> Result<ClearPendingShareResponse> {
    app.share_intent().clear_pending_share()
}
