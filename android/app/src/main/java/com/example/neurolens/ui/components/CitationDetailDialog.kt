package com.example.neurolens.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.example.neurolens.data.model.RAGSource

@Composable
fun CitationDetailDialog(
    source: RAGSource,
    onDismiss: () -> Unit
) {
    Dialog(onDismissRequest = onDismiss) {
        GlassmorphicCard(
            modifier = Modifier
                .fillMaxWidth()
                .wrapContentHeight()
        ) {
            Column(
                modifier = Modifier
                    .background(Color(0xFF0D1124))
                    .padding(20.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Source Reference",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = Color.White
                    )
                    TextButton(onClick = onDismiss) {
                        Text("Close", color = Color(0xFF00F5D4))
                    }
                }

                Spacer(modifier = Modifier.height(12.dp))

                Text(
                    text = "Origin: ${source.source}" + (source.page?.let { " (Page $it)" } ?: ""),
                    style = MaterialTheme.typography.bodySmall,
                    color = Color(0xFF9D4EDD),
                    fontWeight = FontWeight.SemiBold
                )

                Spacer(modifier = Modifier.height(8.dp))
                HorizontalDivider(color = Color.White.copy(alpha = 0.1f))
                Spacer(modifier = Modifier.height(8.dp))

                Box(
                    modifier = Modifier
                        .heightIn(max = 280.dp)
                        .verticalScroll(rememberScrollState())
                ) {
                    Text(
                        text = source.content,
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color(0xFFCBD5E1)
                    )
                }
            }
        }
    }
}
