package com.example.neurolens.data.local

import android.content.Context
import com.example.neurolens.data.model.ChatSession
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File

class LocalChatStore(private val context: Context) {
    private val json = Json { 
        ignoreUnknownKeys = true 
        prettyPrint = true 
        coerceInputValues = true
    }
    
    private val historyFile: File
        get() = File(context.filesDir, "chat_history.json")

    fun getSessions(): List<ChatSession> {
        if (!historyFile.exists()) return emptyList()
        return try {
            val content = historyFile.readText()
            json.decodeFromString<List<ChatSession>>(content)
        } catch (e: Exception) {
            e.printStackTrace()
            emptyList()
        }
    }

    fun saveSessions(sessions: List<ChatSession>) {
        try {
            val content = json.encodeToString(sessions)
            historyFile.writeText(content)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    fun clearSessions() {
        if (historyFile.exists()) {
            historyFile.delete()
        }
    }
}
