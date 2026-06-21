package com.example.neurolens.data.local

import android.content.Context
import com.example.neurolens.data.model.AppSettings

class LocalSettingsStore(context: Context) {
    private val prefs = context.getSharedPreferences("neurolens_settings", Context.MODE_PRIVATE)

    fun getSettings(): AppSettings {
        val provider = prefs.getString("provider", "groq") ?: "groq"
        val apiKey = prefs.getString("api_key_$provider", "") ?: ""
        val modelName = prefs.getString("model_name_$provider", getDefaultModel(provider)) ?: getDefaultModel(provider)
        val temperature = prefs.getFloat("temperature", 0.3f)
        val k = prefs.getInt("k", 5)
        val backendUrl = prefs.getString("backend_url", "http://10.0.2.2:8000") ?: "http://10.0.2.2:8000"
        val elevenLabsApiKey = prefs.getString("elevenlabs_api_key", "") ?: ""

        return AppSettings(
            provider = provider,
            apiKey = apiKey,
            modelName = modelName,
            temperature = temperature,
            k = k,
            backendUrl = backendUrl,
            elevenLabsApiKey = elevenLabsApiKey
        )
    }

    fun saveSettings(settings: AppSettings) {
        prefs.edit().apply {
            putString("provider", settings.provider)
            // Save provider-specific key and model so they aren't lost when switching provider
            putString("api_key_${settings.provider}", settings.apiKey)
            putString("model_name_${settings.provider}", settings.modelName)
            putFloat("temperature", settings.temperature)
            putInt("k", settings.k)
            putString("backend_url", settings.backendUrl)
            putString("elevenlabs_api_key", settings.elevenLabsApiKey)
            apply()
        }
    }

    private fun getDefaultModel(provider: String): String {
        return when (provider.lowercase()) {
            "groq" -> "llama-3.3-70b-versatile"
            "openai" -> "gpt-4o-mini"
            "huggingface" -> "meta-llama/Llama-3.2-3B-Instruct"
            else -> "llama-3.3-70b-versatile"
        }
    }
}
