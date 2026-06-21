package com.example.neurolens.ui.components

import androidx.compose.foundation.text.ClickableText
import androidx.compose.material3.LocalTextStyle
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import java.util.regex.Pattern

@Composable
fun MarkdownText(
    text: String,
    modifier: Modifier = Modifier,
    style: TextStyle = LocalTextStyle.current,
    onCitationClick: (Int) -> Unit = {}
) {
    val annotatedString = parseMarkdown(text, style)
    
    ClickableText(
        text = annotatedString,
        modifier = modifier,
        style = style.copy(color = Color(0xFFE2E8F0)),
        onClick = { offset ->
            annotatedString.getStringAnnotations(tag = "citation", start = offset, end = offset)
                .firstOrNull()?.let { annotation ->
                    val citationIndex = annotation.item.toIntOrNull()
                    if (citationIndex != null) {
                        onCitationClick(citationIndex)
                    }
                }
        }
    )
}

fun parseMarkdown(text: String, baseStyle: TextStyle): AnnotatedString {
    // Clean text by replacing system prefix markers
    val cleanedText = text
        .replace("📥 **System:**", "System:")
        .replace("❌ **Error running query:**", "Error:")
        
    return buildAnnotatedString {
        val lines = cleanedText.split("\n")
        lines.forEachIndexed { lineIdx, line ->
            var isHeader = false
            var headerStyle: SpanStyle? = null
            var lineContent = line
            
            if (line.startsWith("# ")) {
                lineContent = line.substring(2)
                isHeader = true
                headerStyle = SpanStyle(
                    fontSize = baseStyle.fontSize * 1.3f, 
                    fontWeight = FontWeight.Bold, 
                    color = Color.White
                )
            } else if (line.startsWith("## ")) {
                lineContent = line.substring(3)
                isHeader = true
                headerStyle = SpanStyle(
                    fontSize = baseStyle.fontSize * 1.2f, 
                    fontWeight = FontWeight.Bold, 
                    color = Color.White
                )
            } else if (line.startsWith("### ")) {
                lineContent = line.substring(4)
                isHeader = true
                headerStyle = SpanStyle(
                    fontSize = baseStyle.fontSize * 1.1f, 
                    fontWeight = FontWeight.Bold, 
                    color = Color.White
                )
            } else if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
                // Bullet item alignment
                append("• ")
                lineContent = if (line.trim().startsWith("- ")) line.trim().substring(2) else line.trim().substring(2)
            }
            
            val startLineIdx = this.length
            
            parseInline(lineContent, this)
            
            val endLineIdx = this.length
            if (headerStyle != null) {
                addStyle(headerStyle, startLineIdx, endLineIdx)
            }
            
            if (lineIdx < lines.size - 1) {
                append("\n")
            }
        }
    }
}

private fun parseInline(text: String, builder: AnnotatedString.Builder) {
    val pattern = Pattern.compile("(\\*\\*.*?\\*\\*|\\*.*?\\*|`.*?`|\\[Source \\d+\\])")
    val matcher = pattern.matcher(text)
    
    var lastIdx = 0
    while (matcher.find()) {
        builder.append(text.substring(lastIdx, matcher.start()))
        
        val match = matcher.group()
        val matchStart = builder.length
        
        if (match.startsWith("**") && match.endsWith("**")) {
            builder.append(match.substring(2, match.length - 2))
            builder.addStyle(SpanStyle(fontWeight = FontWeight.Bold, color = Color.White), matchStart, builder.length)
        } else if (match.startsWith("*") && match.endsWith("*")) {
            builder.append(match.substring(1, match.length - 1))
            builder.addStyle(SpanStyle(fontStyle = FontStyle.Italic, color = Color(0xFFCBD5E1)), matchStart, builder.length)
        } else if (match.startsWith("`") && match.endsWith("`")) {
            builder.append(match.substring(1, match.length - 1))
            builder.addStyle(SpanStyle(
                fontFamily = FontFamily.Monospace,
                background = Color(0x3DFFFFFF),
                color = Color(0xFF00F5D4)
            ), matchStart, builder.length)
        } else if (match.startsWith("[Source ") && match.endsWith("]")) {
            val sourceNumStr = match.substring(8, match.length - 1)
            val sourceNum = sourceNumStr.toIntOrNull() ?: 1
            
            builder.append(match)
            builder.addStringAnnotation("citation", (sourceNum - 1).toString(), matchStart, builder.length)
            builder.addStyle(SpanStyle(
                color = Color(0xFF00F5D4),
                fontWeight = FontWeight.Bold,
                background = Color(0x2200F5D4),
                textDecoration = TextDecoration.Underline
            ), matchStart, builder.length)
        }
        
        lastIdx = matcher.end()
    }
    
    if (lastIdx < text.length) {
        builder.append(text.substring(lastIdx))
    }
}
