package com.example.neurolens.ui.speech

import android.content.Context
import android.media.MediaPlayer
import android.speech.tts.TextToSpeech
import android.util.Base64
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.util.Locale

class TTSPlayer(private val context: Context) : TextToSpeech.OnInitListener {
    private var mediaPlayer: MediaPlayer? = null
    private var systemTts: TextToSpeech? = null
    private var isSystemTtsReady = false
    private var onCompletionListener: (() -> Unit)? = null

    init {
        systemTts = TextToSpeech(context, this)
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            systemTts?.let { tts ->
                val result = tts.setLanguage(Locale.US)
                if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                    Log.e("TTSPlayer", "System TTS language not supported.")
                } else {
                    isSystemTtsReady = true
                }
            }
        } else {
            Log.e("TTSPlayer", "System TTS Initialization failed.")
        }
    }

    fun playBase64(base64Audio: String, onComplete: () -> Unit) {
        stop()
        onCompletionListener = onComplete
        try {
            val audioBytes = Base64.decode(base64Audio, Base64.DEFAULT)
            val tempFile = File.createTempFile("tts_audio", ".wav", context.cacheDir)
            tempFile.deleteOnExit()

            FileOutputStream(tempFile).use { fos ->
                fos.write(audioBytes)
            }

            mediaPlayer = MediaPlayer().apply {
                setDataSource(tempFile.absolutePath)
                setOnCompletionListener {
                    onComplete()
                    tempFile.delete()
                }
                setOnErrorListener { _, _, _ ->
                    tempFile.delete()
                    onComplete()
                    false
                }
                prepare()
                start()
            }
        } catch (e: Exception) {
            e.printStackTrace()
            onComplete()
        }
    }

    fun speakSystem(text: String, onComplete: () -> Unit) {
        stop()
        onCompletionListener = onComplete
        if (isSystemTtsReady && systemTts != null) {
            systemTts?.setOnUtteranceProgressListener(object : android.speech.tts.UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {}
                override fun onDone(utteranceId: String?) {
                    onComplete()
                }
                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) {
                    onComplete()
                }
            })
            val params = android.os.Bundle().apply {
                putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, "neurolens_tts")
            }
            // Strip markdown notations before voice synthesis
            val cleanText = text
                .replace("📥 **System:**", "")
                .replace("❌ **Error running query:**", "")
                .replace(Regex("\\[Source \\d+\\]"), "")
                .replace(Regex("\\*\\*|`|\\*"), "")
                .trim()
            systemTts?.speak(cleanText, TextToSpeech.QUEUE_FLUSH, params, "neurolens_tts")
        } else {
            onComplete()
        }
    }

    fun stop() {
        try {
            mediaPlayer?.let { player ->
                if (player.isPlaying) {
                    player.stop()
                }
                player.release()
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        mediaPlayer = null

        try {
            systemTts?.stop()
        } catch (e: Exception) {
            e.printStackTrace()
        }
        
        onCompletionListener?.invoke()
        onCompletionListener = null
    }

    fun release() {
        stop()
        systemTts?.shutdown()
        systemTts = null
    }
}
