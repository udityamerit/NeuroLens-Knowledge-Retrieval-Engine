package com.example.neurolens.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeMute
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.neurolens.data.model.ChatMessage

@Composable
fun MessageBubble(
    message: ChatMessage,
    onCitationClick: (Int) -> Unit,
    onSpeakClick: () -> Unit
) {
    val isUser = message.role == "user"
    
    val bubbleShape = if (isUser) {
        RoundedCornerShape(12.dp, 12.dp, 2.dp, 12.dp)
    } else {
        RoundedCornerShape(12.dp, 12.dp, 12.dp, 2.dp)
    }

    val backgroundBrush = if (isUser) {
        Color(0x339D4EDD) // Translucent Purple
    } else {
        Color(0x1F00F5D4) // Translucent Teal
    }

    val borderColor = if (isUser) {
        Color(0x669D4EDD)
    } else {
        Color(0x6600F5D4)
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
    ) {
        if (!isUser) {
            // Assistant avatar placeholder
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .background(Color(0xFF0D1124), RoundedCornerShape(16.dp))
                    .align(Alignment.Top),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "NL",
                    color = Color(0xFF00F5D4),
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.Bold
                )
            }
            Spacer(modifier = Modifier.width(8.dp))
        }

        Column(
            modifier = Modifier
                .widthIn(max = 280.dp)
                .background(backgroundBrush, bubbleShape)
                .border(1.dp, borderColor, bubbleShape)
                .padding(12.dp)
        ) {
            if (!isUser) {
                // Header with TTS Button
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "NeuroLens RAG",
                        style = MaterialTheme.typography.labelSmall,
                        color = Color(0xFF00F5D4),
                        fontWeight = FontWeight.Bold
                    )
                    IconButton(
                        onClick = onSpeakClick,
                        modifier = Modifier.size(24.dp)
                    ) {
                        Icon(
                            imageVector = if (message.isTtsPlaying) Icons.AutoMirrored.Filled.VolumeMute else Icons.AutoMirrored.Filled.VolumeUp,
                            contentDescription = "Text to Speech",
                            tint = Color(0xFF00F5D4),
                            modifier = Modifier.size(16.dp)
                        )
                    }
                }
                Spacer(modifier = Modifier.height(4.dp))
            }

            // Message text body
            if (isUser) {
                Text(
                    text = message.content,
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color.White
                )
            } else {
                MarkdownText(
                    text = message.content,
                    style = MaterialTheme.typography.bodyMedium,
                    onCitationClick = onCitationClick
                )
            }
        }

        if (isUser) {
            Spacer(modifier = Modifier.width(8.dp))
            // User avatar placeholder
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .background(Color(0xFF0D1124), RoundedCornerShape(16.dp))
                    .align(Alignment.Top),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "U",
                    color = Color(0xFF9D4EDD),
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.Bold
                )
            }
        }
    }
}
