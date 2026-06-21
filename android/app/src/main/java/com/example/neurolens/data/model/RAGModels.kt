package com.example.neurolens.data.model

import kotlinx.serialization.Serializable

@Serializable
data class RAGSource(
    val content: String,
    val source: String,
    val page: Int? = null,
    val type: String = "txt"
)

@Serializable
data class ChatMessage(
    val id: String,
    val role: String, // "user" or "assistant"
    val content: String,
    val timestamp: Long,
    val sources: List<RAGSource> = emptyList(),
    var isTtsPlaying: Boolean = false
)

@Serializable
data class ChatSession(
    val sessionId: String,
    val title: String,
    val messages: List<ChatMessage> = emptyList(),
    val timestamp: Long
)

// API Request/Response models (Retrofit maps these to/from JSON using Gson)
data class QueryRequest(
    val query: String,
    val history: List<Map<String, String>>, // list of map containing "role" and "content"
    val provider: String,
    val apiKey: String,
    val modelName: String,
    val temperature: Float = 0.3f,
    val k: Int = 5
)

data class RAGResponse(
    val answer: String,
    val sources: List<RAGSource>
)

data class TTSRequest(
    val text: String,
    val language_code: String = "en-IN",
    val speaker: String = "antoni"
)

data class TTSResponse(
    val audio: String // Base64 encoded audio bytes
)

data class FetchUrlRequest(
    val url: String
)

data class FetchUrlResponse(
    val title: String,
    val content: String,
    val url: String
)

data class DocumentListResponse(
    val documents: List<String>
)

data class ClearResponse(
    val message: String
)

data class AppSettings(
    val provider: String = "groq",
    val apiKey: String = "",
    val modelName: String = "llama-3.3-70b-versatile",
    val temperature: Float = 0.3f,
    val k: Int = 5,
    val backendUrl: String = "http://10.0.2.2:8000", // Default Android emulator loopback to localhost
    val elevenLabsApiKey: String = ""
)
