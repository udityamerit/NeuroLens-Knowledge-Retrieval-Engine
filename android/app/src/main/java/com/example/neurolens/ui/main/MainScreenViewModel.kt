package com.example.neurolens.ui.main

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.neurolens.data.local.LocalChatStore
import com.example.neurolens.data.local.LocalSettingsStore
import com.example.neurolens.data.model.*
import com.example.neurolens.data.remote.NetworkClient
import com.example.neurolens.ui.speech.TTSPlayer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.UUID

data class NeuroLensUiState(
    val messages: List<ChatMessage> = emptyList(),
    val documents: List<String> = emptyList(),
    val settings: AppSettings = AppSettings(),
    val isGenerating: Boolean = false,
    val isUploading: Boolean = false,
    val isFetchingUrl: Boolean = false,
    val isListening: Boolean = false,
    val transcribedText: String = "",
    val backendReachable: Boolean? = null, // null = unknown
    val errorMessage: String? = null,
    val speakingMessageId: String? = null
)

class MainScreenViewModel(private val context: Context) : ViewModel() {

    private val _uiState = MutableStateFlow(NeuroLensUiState())
    val uiState: StateFlow<NeuroLensUiState> = _uiState.asStateFlow()

    private val settingsStore = LocalSettingsStore(context)
    private val chatStore = LocalChatStore(context)
    private var ttsPlayer: TTSPlayer? = null

    init {
        val savedSettings = settingsStore.getSettings()
        _uiState.update { it.copy(settings = savedSettings) }
        ttsPlayer = TTSPlayer(context)
        checkBackendHealth()
        loadDocumentList()
    }

    // ── Settings ─────────────────────────────────────────────────────────────

    fun saveSettings(newSettings: AppSettings) {
        settingsStore.saveSettings(newSettings)
        _uiState.update { it.copy(settings = newSettings) }
        // Re-check connectivity if backend URL changed
        checkBackendHealth()
    }

    // ── Health check ─────────────────────────────────────────────────────────

    fun checkBackendHealth() {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val service = NetworkClient.getService(_uiState.value.settings.backendUrl)
                service.checkHealth()
                _uiState.update { it.copy(backendReachable = true) }
                loadDocumentList()
            } catch (e: Exception) {
                _uiState.update { it.copy(backendReachable = false) }
            }
        }
    }

    // ── Document list ─────────────────────────────────────────────────────────

    fun loadDocumentList() {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val service = NetworkClient.getService(_uiState.value.settings.backendUrl)
                val response = service.getDocuments()
                _uiState.update { it.copy(documents = response.documents) }
            } catch (_: Exception) {}
        }
    }

    // ── File upload ───────────────────────────────────────────────────────────

    fun uploadFiles(uris: List<Uri>) {
        viewModelScope.launch(Dispatchers.IO) {
            _uiState.update { it.copy(isUploading = true, errorMessage = null) }
            try {
                val parts = uris.mapNotNull { uri ->
                    val contentResolver = context.contentResolver
                    val mimeType = contentResolver.getType(uri) ?: "application/octet-stream"
                    val fileName = contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                        val nameIndex = cursor.getColumnIndexOrThrow(android.provider.OpenableColumns.DISPLAY_NAME)
                        cursor.moveToFirst()
                        cursor.getString(nameIndex)
                    } ?: "document_${System.currentTimeMillis()}"

                    val bytes = contentResolver.openInputStream(uri)?.readBytes() ?: return@mapNotNull null
                    val requestBody = bytes.toRequestBody(mimeType.toMediaTypeOrNull())
                    MultipartBody.Part.createFormData("files", fileName, requestBody)
                }

                if (parts.isEmpty()) {
                    _uiState.update { it.copy(isUploading = false, errorMessage = "Could not read selected files.") }
                    return@launch
                }

                val service = NetworkClient.getService(_uiState.value.settings.backendUrl)
                service.uploadFiles(parts)
                loadDocumentList()

                val countMsg = "${parts.size} file(s) indexed successfully into the vector store."
                addSystemMessage("📥 **System:** $countMsg")
            } catch (e: Exception) {
                _uiState.update { it.copy(errorMessage = "Upload failed: ${e.message}") }
            } finally {
                _uiState.update { it.copy(isUploading = false) }
            }
        }
    }

    // ── Fetch URL ─────────────────────────────────────────────────────────────

    fun fetchUrl(url: String) {
        viewModelScope.launch(Dispatchers.IO) {
            _uiState.update { it.copy(isFetchingUrl = true, errorMessage = null) }
            try {
                val service = NetworkClient.getService(_uiState.value.settings.backendUrl)
                val normalized = if (!url.startsWith("http://") && !url.startsWith("https://")) "https://$url" else url
                val response = service.fetchUrlContent(FetchUrlRequest(normalized))
                loadDocumentList()
                addSystemMessage("🌐 **System:** Indexed **${response.title}** — content extracted and indexed.")
            } catch (e: Exception) {
                _uiState.update { it.copy(errorMessage = "URL fetch failed: ${e.message}") }
            } finally {
                _uiState.update { it.copy(isFetchingUrl = false) }
            }
        }
    }

    // ── Clear vector store ────────────────────────────────────────────────────

    fun clearDatabase() {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val service = NetworkClient.getService(_uiState.value.settings.backendUrl)
                service.clearDatabase()
                _uiState.update { it.copy(documents = emptyList()) }
                addSystemMessage("🗑️ **System:** All indexed documents have been cleared.")
            } catch (e: Exception) {
                _uiState.update { it.copy(errorMessage = "Clear failed: ${e.message}") }
            }
        }
    }

    // ── Query LLM ─────────────────────────────────────────────────────────────

    fun sendQuery(queryText: String) {
        if (queryText.isBlank()) return

        val userMsg = ChatMessage(
            id = UUID.randomUUID().toString(),
            role = "user",
            content = queryText,
            timestamp = System.currentTimeMillis()
        )
        _uiState.update {
            it.copy(
                messages = it.messages + userMsg,
                isGenerating = true,
                errorMessage = null,
                transcribedText = "" // clear STT input on send
            )
        }

        viewModelScope.launch(Dispatchers.IO) {
            try {
                val settings = _uiState.value.settings
                val history = _uiState.value.messages
                    .filter { it.role == "user" || it.role == "assistant" }
                    .takeLast(8) // last 8 messages for context window
                    .map { mapOf("role" to it.role, "content" to it.content) }

                val request = QueryRequest(
                    query = queryText,
                    history = history,
                    provider = settings.provider,
                    apiKey = settings.apiKey,
                    modelName = settings.modelName,
                    temperature = settings.temperature,
                    k = settings.k
                )

                val service = NetworkClient.getService(settings.backendUrl)
                val response = service.queryDocuments(request)

                val assistantMsg = ChatMessage(
                    id = UUID.randomUUID().toString(),
                    role = "assistant",
                    content = response.answer,
                    timestamp = System.currentTimeMillis(),
                    sources = response.sources
                )
                _uiState.update { it.copy(messages = it.messages + assistantMsg) }

            } catch (e: Exception) {
                val errMsg = ChatMessage(
                    id = UUID.randomUUID().toString(),
                    role = "assistant",
                    content = "❌ **Error running query:** ${e.message}\n\nPlease verify your backend URL and API key in Settings.",
                    timestamp = System.currentTimeMillis()
                )
                _uiState.update { it.copy(messages = it.messages + errMsg) }
            } finally {
                _uiState.update { it.copy(isGenerating = false) }
            }
        }
    }

    // ── TTS ───────────────────────────────────────────────────────────────────

    fun toggleTts(message: ChatMessage) {
        val isPlaying = message.id == _uiState.value.speakingMessageId
        if (isPlaying) {
            stopTts()
        } else {
            stopTts() // stop any current playback first
            _uiState.update { state ->
                state.copy(
                    messages = state.messages.map {
                        if (it.id == message.id) it.copy(isTtsPlaying = true) else it
                    },
                    speakingMessageId = message.id
                )
            }
            val settings = _uiState.value.settings
            if (settings.elevenLabsApiKey.isNotBlank()) {
                // Use ElevenLabs TTS via backend proxy
                viewModelScope.launch(Dispatchers.IO) {
                    try {
                        val service = NetworkClient.getService(settings.backendUrl)
                        val response = service.textToSpeech(TTSRequest(text = message.content))
                        ttsPlayer?.playBase64(response.audio) { onTtsFinished(message.id) }
                    } catch (e: Exception) {
                        // Fallback to system TTS
                        ttsPlayer?.speakSystem(message.content) { onTtsFinished(message.id) }
                    }
                }
            } else {
                ttsPlayer?.speakSystem(message.content) { onTtsFinished(message.id) }
            }
        }
    }

    private fun stopTts() {
        ttsPlayer?.stop()
        val currentSpeakingId = _uiState.value.speakingMessageId
        _uiState.update { state ->
            state.copy(
                messages = state.messages.map {
                    if (it.id == currentSpeakingId) it.copy(isTtsPlaying = false) else it
                },
                speakingMessageId = null
            )
        }
    }

    private fun onTtsFinished(messageId: String) {
        _uiState.update { state ->
            state.copy(
                messages = state.messages.map {
                    if (it.id == messageId) it.copy(isTtsPlaying = false) else it
                },
                speakingMessageId = if (state.speakingMessageId == messageId) null else state.speakingMessageId
            )
        }
    }

    // ── STT Transcript update (called from Activity) ──────────────────────────

    fun onTranscriptUpdate(text: String) {
        _uiState.update { it.copy(transcribedText = text) }
    }

    fun setListening(listening: Boolean) {
        _uiState.update { it.copy(isListening = listening) }
    }

    fun clearTranscript() {
        _uiState.update { it.copy(transcribedText = "") }
    }

    // ── Dismiss error ─────────────────────────────────────────────────────────

    fun dismissError() {
        _uiState.update { it.copy(errorMessage = null) }
    }

    // ── Clear chat ────────────────────────────────────────────────────────────

    fun clearChat() {
        stopTts()
        _uiState.update { it.copy(messages = emptyList()) }
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    private fun addSystemMessage(content: String) {
        val sysMsg = ChatMessage(
            id = UUID.randomUUID().toString(),
            role = "assistant",
            content = content,
            timestamp = System.currentTimeMillis()
        )
        _uiState.update { it.copy(messages = it.messages + sysMsg) }
    }

    override fun onCleared() {
        super.onCleared()
        ttsPlayer?.release()
        ttsPlayer = null
    }
}
