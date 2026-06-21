package com.example.neurolens.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.example.neurolens.data.model.AppSettings

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsDialog(
    currentSettings: AppSettings,
    onDismiss: () -> Unit,
    onSave: (AppSettings) -> Unit
) {
    var provider by remember { mutableStateOf(currentSettings.provider) }
    var apiKey by remember { mutableStateOf(currentSettings.apiKey) }
    var modelName by remember { mutableStateOf(currentSettings.modelName) }
    var temperature by remember { mutableFloatStateOf(currentSettings.temperature) }
    var k by remember { mutableIntStateOf(currentSettings.k) }
    var backendUrl by remember { mutableStateOf(currentSettings.backendUrl) }
    var elevenLabsApiKey by remember { mutableStateOf(currentSettings.elevenLabsApiKey) }

    var showKey by remember { mutableStateOf(false) }
    var showElevenKey by remember { mutableStateOf(false) }
    var modelDropdownExpanded by remember { mutableStateOf(false) }

    val providerModels = mapOf(
        "groq" to listOf("llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"),
        "openai" to listOf("gpt-4o-mini", "gpt-4o", "gpt-3.5-turbo"),
        "huggingface" to listOf("meta-llama/Llama-3.2-3B-Instruct", "mistralai/Mistral-7B-Instruct-v0.3", "microsoft/Phi-3-mini-4k-instruct")
    )
    val providerNames = mapOf("groq" to "Groq (Free)", "openai" to "OpenAI", "huggingface" to "HuggingFace")

    LaunchedEffect(provider) {
        val models = providerModels[provider] ?: emptyList()
        if (!models.contains(modelName)) modelName = models.firstOrNull() ?: ""
        apiKey = currentSettings.apiKey.takeIf { currentSettings.provider == provider } ?: ""
    }

    Dialog(onDismissRequest = onDismiss) {
        GlassmorphicCard(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 8.dp)
        ) {
            Column(
                modifier = Modifier
                    .background(Color(0xFF0D1124))
                    .padding(20.dp)
                    .verticalScroll(rememberScrollState())
            ) {
                // Header
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text("Settings", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = Color.White)
                    TextButton(onClick = onDismiss) { Text("Cancel", color = Color.Gray) }
                }
                Spacer(Modifier.height(16.dp))

                // Backend URL
                SectionLabel("Backend Server URL")
                OutlinedTextField(
                    value = backendUrl,
                    onValueChange = { backendUrl = it },
                    placeholder = { Text("e.g. 10.0.2.2:8000", color = Color.Gray) },
                    colors = fieldColors(),
                    modifier = Modifier.fillMaxWidth()
                )
                Text("Use 10.0.2.2:8000 in Android Emulator for localhost.", style = MaterialTheme.typography.labelSmall, color = Color.Gray)
                Spacer(Modifier.height(16.dp))

                // Provider
                SectionLabel("LLM Provider")
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("groq", "openai", "huggingface").forEach { pid ->
                        val selected = provider == pid
                        Card(
                            colors = CardDefaults.cardColors(containerColor = if (selected) Color(0x4D9D4EDD) else Color(0x1AFFFFFF)),
                            border = if (selected) BorderStroke(1.dp, Color(0xFF9D4EDD)) else BorderStroke(1.dp, Color(0x22FFFFFF)),
                            modifier = Modifier.weight(1f).clickable { provider = pid }
                        ) {
                            Box(Modifier.fillMaxWidth().padding(8.dp), contentAlignment = Alignment.Center) {
                                Text(providerNames[pid] ?: pid, style = MaterialTheme.typography.labelSmall, color = if (selected) Color.White else Color.Gray, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
                Spacer(Modifier.height(12.dp))

                // API Key
                SectionLabel("${providerNames[provider] ?: provider} API Key")
                OutlinedTextField(
                    value = apiKey,
                    onValueChange = { apiKey = it },
                    placeholder = { Text("Paste API key here…", color = Color.Gray) },
                    visualTransformation = if (showKey) VisualTransformation.None else PasswordVisualTransformation(),
                    trailingIcon = {
                        IconButton(onClick = { showKey = !showKey }) {
                            Icon(if (showKey) Icons.Default.VisibilityOff else Icons.Default.Visibility, null, tint = Color.Gray)
                        }
                    },
                    colors = fieldColors(),
                    modifier = Modifier.fillMaxWidth()
                )
                Text("If blank, the server's environment API key will be used.", style = MaterialTheme.typography.labelSmall, color = Color.Gray)
                Spacer(Modifier.height(16.dp))

                // Model dropdown
                SectionLabel("Model")
                Box(Modifier.fillMaxWidth()) {
                    OutlinedButton(onClick = { modelDropdownExpanded = true }, modifier = Modifier.fillMaxWidth()) {
                        Text(modelName, color = Color.White)
                    }
                    DropdownMenu(expanded = modelDropdownExpanded, onDismissRequest = { modelDropdownExpanded = false }, modifier = Modifier.background(Color(0xFF0D1124))) {
                        (providerModels[provider] ?: emptyList()).forEach { model ->
                            DropdownMenuItem(text = { Text(model, color = Color.White) }, onClick = { modelName = model; modelDropdownExpanded = false })
                        }
                    }
                }
                Spacer(Modifier.height(16.dp))

                // Temperature
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    SectionLabel("Temperature")
                    Text(String.format("%.1f", temperature), color = Color.White, style = MaterialTheme.typography.bodySmall)
                }
                Slider(value = temperature, onValueChange = { temperature = it }, valueRange = 0f..1f,
                    colors = SliderDefaults.colors(thumbColor = Color(0xFF9D4EDD), activeTrackColor = Color(0xFF00F5D4)))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Precise", style = MaterialTheme.typography.labelSmall, color = Color.Gray)
                    Text("Creative", style = MaterialTheme.typography.labelSmall, color = Color.Gray)
                }
                Spacer(Modifier.height(16.dp))

                // Retrieval K
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    SectionLabel("Retrieve Size (K)")
                    Text("$k chunks", color = Color.White, style = MaterialTheme.typography.bodySmall)
                }
                Slider(value = k.toFloat(), onValueChange = { k = it.toInt() }, valueRange = 1f..10f, steps = 8,
                    colors = SliderDefaults.colors(thumbColor = Color(0xFF9D4EDD), activeTrackColor = Color(0xFF00F5D4)))
                Spacer(Modifier.height(16.dp))

                // ElevenLabs Key
                SectionLabel("ElevenLabs API Key (TTS Voice)")
                OutlinedTextField(
                    value = elevenLabsApiKey,
                    onValueChange = { elevenLabsApiKey = it },
                    placeholder = { Text("ElevenLabs Voice key…", color = Color.Gray) },
                    visualTransformation = if (showElevenKey) VisualTransformation.None else PasswordVisualTransformation(),
                    trailingIcon = {
                        IconButton(onClick = { showElevenKey = !showElevenKey }) {
                            Icon(if (showElevenKey) Icons.Default.VisibilityOff else Icons.Default.Visibility, null, tint = Color.Gray)
                        }
                    },
                    colors = fieldColors(),
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(24.dp))

                // Save button
                Button(
                    onClick = { onSave(AppSettings(provider, apiKey, modelName, temperature, k, backendUrl, elevenLabsApiKey)) },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF00F5D4)),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Save Settings", color = Color.Black, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = Color(0xFF00F5D4), fontWeight = FontWeight.Bold)
    Spacer(Modifier.height(4.dp))
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun fieldColors() = TextFieldDefaults.colors(
    focusedTextColor = Color.White,
    unfocusedTextColor = Color.White,
    focusedContainerColor = Color(0x33000000),
    unfocusedContainerColor = Color(0x1A000000),
    focusedIndicatorColor = Color(0xFF00F5D4),
    unfocusedIndicatorColor = Color(0x33FFFFFF)
)
