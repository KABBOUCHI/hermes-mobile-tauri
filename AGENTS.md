# Hermes Mobile Tauri — Working Notes

- Keep changes focused and follow the existing Vue 3, TypeScript, Tailwind, and `@lucide/vue` patterns.
- Do not commit unrelated working-tree changes. Run `npm test`, `npm run build`, and `git diff --check` before release work.
- Releases use separate feature and version commits, annotated semantic-version tags, and a verified push of both `main` and the new tag.

## Sessions source selector

- Keep gateway session-list and search requests unscoped: source remains server metadata.
- The mobile Sessions screen must default its **visible** source selector to `desktop`.
- Keep an explicit **All sources** option and retain `cron` as an available source option, even if no cron session is currently loaded.
- Apply the selected source consistently to both loaded sessions and server-search results. Do not silently revert the mobile default to `all` without an explicit user request.
