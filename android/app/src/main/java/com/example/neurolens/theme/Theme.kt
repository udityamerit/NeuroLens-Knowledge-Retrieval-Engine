package com.example.neurolens.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// NeuroLens sci-fi cyber dark theme
private val NeuroLensDarkColorScheme = darkColorScheme(
    primary = Color(0xFF00F5D4),          // Teal/Cyan
    onPrimary = Color(0xFF060814),
    primaryContainer = Color(0xFF003D35),
    onPrimaryContainer = Color(0xFF00F5D4),
    secondary = Color(0xFF9D4EDD),         // Electric Violet
    onSecondary = Color.White,
    secondaryContainer = Color(0xFF2A0060),
    onSecondaryContainer = Color(0xFFD9B3FF),
    tertiary = Color(0xFF3A86FF),          // Electric Blue
    onTertiary = Color.White,
    background = Color(0xFF060814),        // Deep space black
    onBackground = Color(0xFFE2E8F0),
    surface = Color(0xFF0D1124),           // Deep navy card
    onSurface = Color(0xFFE2E8F0),
    surfaceVariant = Color(0xFF1A2540),
    onSurfaceVariant = Color(0xFF94A3B8),
    outline = Color(0xFF2A3550),
    error = Color(0xFFEF4444),
    onError = Color.White
)

@Composable
fun NeuroLensTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = NeuroLensDarkColorScheme,
        typography = Typography,
        content = content
    )
}
