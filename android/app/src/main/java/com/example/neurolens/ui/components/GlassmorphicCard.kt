package com.example.neurolens.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

@Composable
fun GlassmorphicCard(
    modifier: Modifier = Modifier,
    cornerRadius: Dp = 12.dp,
    borderWidth: Dp = 1.dp,
    glowColor: Color = Color(0xFF00F5D4),
    content: @Composable BoxScope.() -> Unit
) {
    val shape = RoundedCornerShape(cornerRadius)
    val backgroundBrush = Brush.verticalGradient(
        colors = listOf(
            Color(0x2A0D1124),
            Color(0x3D0D1124)
        )
    )
    
    val borderBrush = Brush.linearGradient(
        colors = listOf(
            Color(0xFF00F5D4).copy(alpha = 0.3f),
            Color(0xFF9D4EDD).copy(alpha = 0.2f),
            Color(0xFF00F5D4).copy(alpha = 0.05f)
        )
    )

    Box(
        modifier = modifier
            .clip(shape)
            .background(backgroundBrush)
            .border(BorderStroke(borderWidth, borderBrush), shape),
        content = content
    )
}
