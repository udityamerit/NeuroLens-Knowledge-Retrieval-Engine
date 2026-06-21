package com.example.neurolens.ui.main

import android.app.Activity
import android.content.Intent
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.*
import androidx.compose.foundation.text.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.*
import androidx.compose.ui.platform.*
import androidx.compose.ui.text.*
import androidx.compose.ui.text.font.*
import androidx.compose.ui.text.input.*
import androidx.compose.ui.text.style.*
import androidx.compose.ui.unit.*
import androidx.compose.ui.window.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation3.runtime.NavKey
import com.example.neurolens.data.model.AppSettings
import com.example.neurolens.data.model.RAGSource
import com.example.neurolens.ui.components.*
import kotlinx.coroutines.launch
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(
    onItemClick: (NavKey) -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val vm: MainScreenViewModel = viewModel(
        factory = androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.getInstance(
            context.applicationContext as android.app.Application
        )
    )
    val uiState by vm.uiState.collectAsStateWithLifecycle()

    // Dialog visibility state
    var showSettings by remember { mutableStateOf(false) }
    var showDocManager by remember { mutableStateOf(false) }
    var citationSource by remember { mutableStateOf<RAGSource?>(null) }

    // Compose scroll state for chat
    val listState = rememberLazyListState()
    val coroutineScope = rememberCoroutineScope()

    // Query input state
    var inputText by remember { mutableStateOf("") }

    // Keep input in sync with STT transcription
    LaunchedEffect(uiState.transcribedText) {
        if (uiState.transcribedText.isNotEmpty()) {
            inputText = uiState.transcribedText
        }
    }

    // Auto-scroll to bottom when messages change
    LaunchedEffect(uiState.messages.size) {
        if (uiState.messages.isNotEmpty()) {
            coroutineScope.launch {
                listState.animateScrollToItem(uiState.messages.size - 1)
            }
        }
    }

    // STT Launcher
    val sttLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result ->
        vm.setListening(false)
        if (result.resultCode == Activity.RESULT_OK) {
            val results = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
            val transcribed = results?.firstOrNull() ?: ""
            if (transcribed.isNotBlank()) {
                inputText = transcribed
                vm.onTranscriptUpdate(transcribed)
            }
        }
    }

    fun launchSpeechRecognition() {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
            putExtra(RecognizerIntent.EXTRA_PROMPT, "Say your question...")
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        try {
            vm.setListening(true)
            sttLauncher.launch(intent)
        } catch (e: Exception) {
            vm.setListening(false)
        }
    }

    // Bottom sheet scaffold state for documents
    val scaffoldState = rememberBottomSheetScaffoldState()

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color(0xFF060814))
    ) {
        // ── Layer 0: Animated Synapse background ──────────────────────────
        SynapseBackground(modifier = Modifier.fillMaxSize())

        // ── Layer 1: Full app scaffold ────────────────────────────────────
        Column(modifier = Modifier.fillMaxSize()) {

            // ── Top App Bar ───────────────────────────────────────────────
            NeuroLensTopBar(
                documents = uiState.documents,
                backendReachable = uiState.backendReachable,
                onSettingsClick = { showSettings = true },
                onDocManagerClick = { showDocManager = true; vm.loadDocumentList() },
                onClearChat = { vm.clearChat() }
            )

            // ── Chat message list ─────────────────────────────────────────
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = PaddingValues(vertical = 12.dp)
            ) {
                // Empty state
                if (uiState.messages.isEmpty()) {
                    item {
                        EmptyStateView(
                            hasDocuments = uiState.documents.isNotEmpty(),
                            onDocManagerClick = { showDocManager = true; vm.loadDocumentList() }
                        )
                    }
                }

                items(uiState.messages, key = { it.id }) { message ->
                    MessageBubble(
                        message = message,
                        onCitationClick = { idx ->
                            citationSource = message.sources.getOrNull(idx)
                        },
                        onSpeakClick = { vm.toggleTts(message) }
                    )
                }

                // Generating indicator
                if (uiState.isGenerating) {
                    item { ThinkingIndicator() }
                }
            }

            // ── Input Row ─────────────────────────────────────────────────
            InputRow(
                inputText = inputText,
                onInputChange = {
                    inputText = it
                    vm.clearTranscript()
                },
                onSend = {
                    if (inputText.isNotBlank() && !uiState.isGenerating) {
                        vm.sendQuery(inputText)
                        inputText = ""
                    }
                },
                onMicClick = { launchSpeechRecognition() },
                isGenerating = uiState.isGenerating,
                isListening = uiState.isListening
            )
        }

        // ── Error snackbar overlay ────────────────────────────────────────
        uiState.errorMessage?.let { msg ->
            Snackbar(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(16.dp),
                action = {
                    TextButton(onClick = { vm.dismissError() }) {
                        Text("Dismiss", color = Color(0xFF00F5D4))
                    }
                },
                containerColor = Color(0xFF1E0A2E),
                contentColor = Color.White
            ) {
                Text(msg, maxLines = 3)
            }
        }
    }

    // ── Dialogs ───────────────────────────────────────────────────────────────

    if (showSettings) {
        SettingsDialog(
            currentSettings = uiState.settings,
            onDismiss = { showSettings = false },
            onSave = { newSettings ->
                vm.saveSettings(newSettings)
                showSettings = false
            }
        )
    }

    if (showDocManager) {
        DocumentManagerDialog(
            documents = uiState.documents,
            onUploadFiles = { uris -> vm.uploadFiles(uris) },
            onFetchUrl = { url -> vm.fetchUrl(url) },
            onClearDatabase = { vm.clearDatabase() },
            onDismiss = { showDocManager = false },
            isUploading = uiState.isUploading,
            isFetching = uiState.isFetchingUrl
        )
    }

    citationSource?.let { source ->
        CitationDetailDialog(
            source = source,
            onDismiss = { citationSource = null }
        )
    }
}

// ── Top App Bar ────────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NeuroLensTopBar(
    documents: List<String>,
    backendReachable: Boolean?,
    onSettingsClick: () -> Unit,
    onDocManagerClick: () -> Unit,
    onClearChat: () -> Unit
) {
    val infiniteTransition = rememberInfiniteTransition(label = "logo_glow")
    val glowAlpha by infiniteTransition.animateFloat(
        initialValue = 0.5f,
        targetValue = 1.0f,
        animationSpec = infiniteRepeatable(
            animation = tween(1800, easing = EaseInOutSine),
            repeatMode = RepeatMode.Reverse
        ),
        label = "glow_alpha"
    )

    val statusColor = when (backendReachable) {
        true -> Color(0xFF4ADE80)  // Green
        false -> Color(0xFFEF4444) // Red
        null -> Color(0xFFFBBF24)  // Amber – unknown
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                Brush.verticalGradient(
                    colors = listOf(Color(0xCC0A0F1E), Color(0x000A0F1E))
                )
            )
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // NL Logo / Brand
        Text(
            text = "NeuroLens",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.ExtraBold,
            color = Color(0xFF00F5D4).copy(alpha = glowAlpha),
            modifier = Modifier.shadow(
                elevation = 8.dp,
                ambientColor = Color(0xFF00F5D4).copy(alpha = 0.4f),
                spotColor = Color(0xFF00F5D4).copy(alpha = 0.4f)
            )
        )

        Spacer(modifier = Modifier.width(8.dp))

        // Backend status indicator
        Box(
            modifier = Modifier
                .size(8.dp)
                .background(statusColor, CircleShape)
        )

        Spacer(modifier = Modifier.weight(1f))

        // Document count badge
        if (documents.isNotEmpty()) {
            Card(
                onClick = onDocManagerClick,
                colors = CardDefaults.cardColors(containerColor = Color(0x2200F5D4)),
                border = BorderStroke(1.dp, Color(0x6600F5D4)),
                shape = RoundedCornerShape(16.dp)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        Icons.Default.Folder,
                        contentDescription = "Documents",
                        tint = Color(0xFF00F5D4),
                        modifier = Modifier.size(14.dp)
                    )
                    Spacer(Modifier.width(5.dp))
                    Text(
                        "${documents.size}",
                        color = Color(0xFF00F5D4),
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
            Spacer(modifier = Modifier.width(8.dp))
        }

        // Action icons
        IconButton(onClick = onDocManagerClick, modifier = Modifier.size(36.dp)) {
            Icon(Icons.Default.UploadFile, contentDescription = "Documents", tint = Color(0xFF9D4EDD))
        }
        IconButton(onClick = onClearChat, modifier = Modifier.size(36.dp)) {
            Icon(Icons.Default.RestartAlt, contentDescription = "Clear Chat", tint = Color.Gray)
        }
        IconButton(onClick = onSettingsClick, modifier = Modifier.size(36.dp)) {
            Icon(Icons.Default.Settings, contentDescription = "Settings", tint = Color(0xFF00F5D4))
        }
    }
    HorizontalDivider(color = Color(0xFF1A2540), thickness = 1.dp)
}

// ── Empty State View ───────────────────────────────────────────────────────────

@Composable
private fun EmptyStateView(
    hasDocuments: Boolean,
    onDocManagerClick: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        // Animated pulsating ring
        val infiniteTransition = rememberInfiniteTransition(label = "pulse")
        val scale by infiniteTransition.animateFloat(
            initialValue = 0.85f,
            targetValue = 1.15f,
            animationSpec = infiniteRepeatable(
                animation = tween(2000, easing = EaseInOutSine),
                repeatMode = RepeatMode.Reverse
            ),
            label = "scale"
        )
        val alpha by infiniteTransition.animateFloat(
            initialValue = 0.3f,
            targetValue = 0.9f,
            animationSpec = infiniteRepeatable(
                animation = tween(2000, easing = EaseInOutSine),
                repeatMode = RepeatMode.Reverse
            ),
            label = "alpha"
        )

        Box(contentAlignment = Alignment.Center) {
            Box(
                modifier = Modifier
                    .size(100.dp)
                    .scale(scale)
                    .background(
                        Brush.radialGradient(
                            colors = listOf(
                                Color(0xFF00F5D4).copy(alpha = alpha * 0.15f),
                                Color.Transparent
                            )
                        ),
                        CircleShape
                    )
            )
            Icon(
                imageVector = Icons.Default.Psychology,
                contentDescription = "Brain",
                tint = Color(0xFF00F5D4).copy(alpha = alpha),
                modifier = Modifier.size(48.dp)
            )
        }

        Spacer(modifier = Modifier.height(20.dp))

        Text(
            text = "NeuroLens",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.ExtraBold,
            color = Color.White
        )
        Spacer(modifier = Modifier.height(6.dp))
        Text(
            text = "AI-Powered Knowledge Retrieval Engine",
            style = MaterialTheme.typography.bodySmall,
            color = Color(0xFF9D4EDD),
            fontWeight = FontWeight.SemiBold
        )
        Spacer(modifier = Modifier.height(20.dp))

        if (!hasDocuments) {
            Text(
                text = "Upload documents or paste a URL\nto start semantic search",
                style = MaterialTheme.typography.bodyMedium,
                color = Color.Gray,
                textAlign = TextAlign.Center
            )
            Spacer(modifier = Modifier.height(16.dp))
            Button(
                onClick = onDocManagerClick,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF00F5D4))
            ) {
                Icon(Icons.Default.Upload, contentDescription = null, tint = Color.Black)
                Spacer(Modifier.width(8.dp))
                Text("Open Document Library", color = Color.Black, fontWeight = FontWeight.Bold)
            }
        } else {
            Text(
                text = "Documents loaded. Ask me anything.",
                style = MaterialTheme.typography.bodyMedium,
                color = Color.Gray,
                textAlign = TextAlign.Center
            )
        }
    }
}

// ── Thinking Indicator ─────────────────────────────────────────────────────────

@Composable
private fun ThinkingIndicator() {
    val infiniteTransition = rememberInfiniteTransition(label = "dots")
    Row(
        modifier = Modifier
            .padding(start = 12.dp, top = 4.dp, bottom = 4.dp)
            .background(Color(0x1F00F5D4), RoundedCornerShape(12.dp))
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        repeat(3) { idx ->
            val yOffset by infiniteTransition.animateFloat(
                initialValue = 0f,
                targetValue = -6f,
                animationSpec = infiniteRepeatable(
                    animation = tween(400, delayMillis = idx * 120, easing = EaseInOutSine),
                    repeatMode = RepeatMode.Reverse
                ),
                label = "dot_$idx"
            )
            Box(
                modifier = Modifier
                    .size(7.dp)
                    .offset(y = yOffset.dp)
                    .background(Color(0xFF00F5D4), CircleShape)
            )
            if (idx < 2) Spacer(Modifier.width(5.dp))
        }
        Spacer(Modifier.width(10.dp))
        Text(
            "Thinking…",
            style = MaterialTheme.typography.bodySmall,
            color = Color(0xFF00F5D4).copy(alpha = 0.75f)
        )
    }
}

// ── Input Row ──────────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InputRow(
    inputText: String,
    onInputChange: (String) -> Unit,
    onSend: () -> Unit,
    onMicClick: () -> Unit,
    isGenerating: Boolean,
    isListening: Boolean
) {
    val micColor by animateColorAsState(
        targetValue = if (isListening) Color(0xFFEF4444) else Color(0xFF9D4EDD),
        animationSpec = tween(300),
        label = "mic_color"
    )

    Surface(
        color = Color(0xCC070C1A),
        tonalElevation = 0.dp,
        shadowElevation = 8.dp
    ) {
        Column(modifier = Modifier.navigationBarsPadding()) {
            HorizontalDivider(color = Color(0xFF1A2540), thickness = 1.dp)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedTextField(
                    value = inputText,
                    onValueChange = onInputChange,
                    placeholder = {
                        Text(
                            if (isListening) "Listening…" else "Ask anything…",
                            color = Color.Gray
                        )
                    },
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(24.dp),
                    maxLines = 4,
                    colors = TextFieldDefaults.colors(
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White,
                        focusedContainerColor = Color(0x22FFFFFF),
                        unfocusedContainerColor = Color(0x11FFFFFF),
                        focusedIndicatorColor = Color(0xFF00F5D4),
                        unfocusedIndicatorColor = Color(0x33FFFFFF),
                        cursorColor = Color(0xFF00F5D4)
                    ),
                    keyboardActions = KeyboardActions(
                        onSend = { onSend() }
                    ),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send)
                )

                Spacer(Modifier.width(8.dp))

                // Mic button
                IconButton(
                    onClick = onMicClick,
                    modifier = Modifier
                        .size(46.dp)
                        .background(micColor.copy(alpha = 0.15f), CircleShape)
                        .border(1.dp, micColor.copy(alpha = 0.4f), CircleShape)
                ) {
                    Icon(
                        imageVector = if (isListening) Icons.Default.MicOff else Icons.Default.Mic,
                        contentDescription = "Voice Input",
                        tint = micColor,
                        modifier = Modifier.size(20.dp)
                    )
                }

                Spacer(Modifier.width(8.dp))

                // Send button
                val sendColor = if (inputText.isNotBlank() && !isGenerating) Color(0xFF00F5D4) else Color(0xFF2A3550)
                IconButton(
                    onClick = onSend,
                    enabled = inputText.isNotBlank() && !isGenerating,
                    modifier = Modifier
                        .size(46.dp)
                        .background(sendColor, CircleShape)
                ) {
                    if (isGenerating) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp,
                            color = Color.White
                        )
                    } else {
                        Icon(
                            Icons.AutoMirrored.Filled.Send,
                            contentDescription = "Send",
                            tint = if (inputText.isNotBlank()) Color.Black else Color.Gray,
                            modifier = Modifier.size(20.dp)
                        )
                    }
                }
            }
        }
    }
}
