const COMMANDS: &[&str] = &["pending_share", "clear_pending_share"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
