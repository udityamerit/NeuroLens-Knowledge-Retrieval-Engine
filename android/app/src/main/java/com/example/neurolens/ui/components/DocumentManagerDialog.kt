package com.example.neurolens.ui.components

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Language
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DocumentManagerDialog(
    documents: List<String>,
    onUploadFiles: (List<Uri>) -> Unit,
    onFetchUrl: (String) -> Unit,
    onClearDatabase: () -> Unit,
    onDismiss: () -> Unit,
    isUploading: Boolean = false,
    isFetching: Boolean = false
) {
    var webUrl by remember { mutableStateOf("") }

    val filePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenMultipleDocuments()
    ) { uris ->
        if (uris.isNotEmpty()) onUploadFiles(uris)
    }

    Dialog(onDismissRequest = onDismiss) {
        GlassmorphicCard(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 16.dp)
        ) {
            Column(
                modifier = Modifier
                    .background(Color(0xFF0D1124))
                    .padding(20.dp)
            ) {
                // Header
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        "Document Library",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = Color.White
                    )
                    TextButton(onClick = onDismiss) {
                        Text("Close", color = Color.Gray)
                    }
                }
                Spacer(Modifier.height(16.dp))

                // Web URL fetch
                Text("Index Web Page", style = MaterialTheme.typography.bodySmall, color = Color(0xFF00F5D4), fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(6.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    OutlinedTextField(
                        value = webUrl,
                        onValueChange = { webUrl = it },
                        placeholder = { Text("Enter webpage URL…", color = Color.Gray) },
                        singleLine = true,
                        colors = TextFieldDefaults.colors(
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color.White,
                            focusedContainerColor = Color(0x33000000),
                            unfocusedContainerColor = Color(0x1A000000)
                        ),
                        modifier = Modifier.weight(1f)
                    )
                    Spacer(Modifier.width(8.dp))
                    Button(
                        onClick = {
                            if (webUrl.isNotBlank()) {
                                onFetchUrl(webUrl)
                                webUrl = ""
                            }
                        },
                        enabled = !isFetching && webUrl.isNotBlank(),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF9D4EDD))
                    ) {
                        if (isFetching) {
                            CircularProgressIndicator(modifier = Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp)
                        } else {
                            Icon(Icons.Default.Language, contentDescription = "Fetch", tint = Color.White)
                        }
                    }
                }
                Spacer(Modifier.height(16.dp))

                // Upload / Clear actions
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Button(
                        onClick = {
                            filePickerLauncher.launch(
                                arrayOf(
                                    "application/pdf",
                                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                                    "text/plain",
                                    "image/*"
                                )
                            )
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF00F5D4)),
                        modifier = Modifier.weight(1.5f),
                        enabled = !isUploading
                    ) {
                        if (isUploading) {
                            CircularProgressIndicator(modifier = Modifier.size(18.dp), color = Color.Black, strokeWidth = 2.dp)
                            Spacer(Modifier.width(8.dp))
                            Text("Indexing…", color = Color.Black, fontWeight = FontWeight.Bold)
                        } else {
                            Icon(Icons.Default.CloudUpload, contentDescription = "Upload", tint = Color.Black)
                            Spacer(Modifier.width(6.dp))
                            Text("Upload Files", color = Color.Black, fontWeight = FontWeight.Bold)
                        }
                    }
                    if (documents.isNotEmpty()) {
                        Button(
                            onClick = onClearDatabase,
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFEF4444)),
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(Icons.Default.Delete, contentDescription = "Clear", tint = Color.White)
                            Spacer(Modifier.width(4.dp))
                            Text("Clear All", color = Color.White)
                        }
                    }
                }

                Spacer(Modifier.height(20.dp))
                Text("Indexed Files (${documents.size})", style = MaterialTheme.typography.bodySmall, color = Color(0xFF00F5D4), fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))

                if (documents.isEmpty()) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(120.dp)
                            .border(1.dp, Color.White.copy(alpha = 0.06f), RoundedCornerShape(8.dp)),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            "No documents indexed yet.\nUpload files to start semantic search.",
                            color = Color.Gray,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                } else {
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 200.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        items(documents) { docName ->
                            Card(
                                colors = CardDefaults.cardColors(containerColor = Color(0x0AFFFFFF)),
                                border = BorderStroke(1.dp, Color.White.copy(alpha = 0.06f))
                            ) {
                                Text(
                                    text = docName,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = Color.White,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(horizontal = 12.dp, vertical = 8.dp)
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
