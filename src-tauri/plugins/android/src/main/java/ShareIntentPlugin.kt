package cloud.kabbouchi.shareintent

import android.app.Activity
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.ByteArrayOutputStream
import java.io.InputStream
import org.json.JSONArray

private const val MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024
private const val MAX_ATTACHMENTS = 4

@TauriPlugin
class ShareIntentPlugin(private val activity: Activity) : Plugin(activity) {
    private var pendingPayload: String? = null
    private var lastPayload: String? = null

    override fun load(webView: WebView) {
        handleShareIntent(activity.intent)
    }

    override fun onNewIntent(intent: Intent) {
        handleShareIntent(intent)
    }

    @Command
    fun pendingShare(invoke: Invoke) {
        val response = JSObject()
        response.put("payload", pendingPayload)
        invoke.resolve(response)
    }

    @Command
    fun clearPendingShare(invoke: Invoke) {
        pendingPayload = null
        lastPayload = null
        val response = JSObject()
        response.put("cleared", true)
        invoke.resolve(response)
    }

    private fun handleShareIntent(intent: Intent?) {
        if (intent == null || (intent.action != Intent.ACTION_SEND && intent.action != Intent.ACTION_SEND_MULTIPLE)) return

        val payload = JSObject()
        payload.put("text", intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() ?: "")
        payload.put("subject", intent.getStringExtra(Intent.EXTRA_SUBJECT) ?: "")

        val files = JSONArray()
        sharedUris(intent).take(MAX_ATTACHMENTS).forEach { uri ->
            val bytes = readShareBytes(uri) ?: return@forEach
            val item = JSObject()
            item.put("name", displayName(uri))
            item.put("mimeType", activity.contentResolver.getType(uri) ?: intent.type ?: "application/octet-stream")
            item.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))
            item.put("size", bytes.size)
            files.put(item)
        }
        payload.put("files", files)

        val serialized = payload.toString()
        if (serialized == lastPayload) return
        lastPayload = serialized
        pendingPayload = serialized
        trigger("share", payload)
    }

    @Suppress("DEPRECATION")
    private fun sharedUris(intent: Intent): List<Uri> {
        val uris = mutableListOf<Uri>()
        when (intent.action) {
            Intent.ACTION_SEND -> (intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri)?.let(uris::add)
            Intent.ACTION_SEND_MULTIPLE -> intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.let(uris::addAll)
        }
        return uris.distinct()
    }

    private fun readShareBytes(uri: Uri): ByteArray? = try {
        activity.contentResolver.openInputStream(uri)?.use(::readAtMost)
    } catch (_: Exception) {
        null
    }

    private fun readAtMost(stream: InputStream): ByteArray? {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        while (true) {
            val read = stream.read(buffer)
            if (read < 0) break
            if (output.size() + read > MAX_ATTACHMENT_BYTES) return null
            output.write(buffer, 0, read)
        }
        return output.toByteArray()
    }

    private fun displayName(uri: Uri): String {
        val cursor: Cursor? = activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        cursor?.use {
            if (it.moveToFirst()) {
                val index = it.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0) {
                    val name = it.getString(index)?.trim()
                    if (!name.isNullOrEmpty()) return sanitiseFileName(name)
                }
            }
        }
        return sanitiseFileName(uri.lastPathSegment ?: "attachment")
    }

    private fun sanitiseFileName(name: String): String = name
        .replace(Regex("[\\\\/\\r\\n\\u0000]"), "_")
        .take(255)
        .ifBlank { "attachment" }
}
