package com.example.neurolens.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlin.math.sqrt
import kotlin.random.Random

private data class NeuronNode(
    var x: Float,
    var y: Float,
    var vx: Float,
    var vy: Float,
    val radius: Float,
    val color: Color,
    var pulse: Float = 0f
)

private data class ElectricalSignal(
    val path: List<Int>,
    var currentStep: Int = 0,
    var progress: Float = 0f,
    val speed: Float,
    val color: Color,
    val history: MutableList<Offset> = mutableListOf()
)

@Composable
fun SynapseBackground(modifier: Modifier = Modifier) {
    var sizeInitialized by remember { mutableStateOf(false) }
    var width by remember { mutableStateOf(0f) }
    var height by remember { mutableStateOf(0f) }

    val nodes = remember { mutableStateListOf<NeuronNode>() }
    val signals = remember { mutableStateListOf<ElectricalSignal>() }

    val maxNodes = 40
    val maxConnectionDist = 350f // pixels

    // Colors matching NeuroLens identity (Teal/Cyan and Purple/Violet)
    val cyanColor = Color(0xFF00F5D4)
    val violetColor = Color(0xFF9D4EDD)

    // Helper to find a pathway for signal traversal
    fun buildSignalPath(startIdx: Int, nodesCount: Int): List<Int> {
        val path = mutableListOf(startIdx)
        var current = startIdx
        val pathLength = Random.nextInt(3, 7) // 3 to 6 nodes

        for (step in 0 until pathLength) {
            val neighbors = mutableListOf<Int>()
            for (idx in 0 until nodesCount) {
                if (path.contains(idx)) continue
                val dx = nodes[current].x - nodes[idx].x
                val dy = nodes[current].y - nodes[idx].y
                val dist = sqrt(dx * dx + dy * dy)
                if (dist < maxConnectionDist) {
                    neighbors.add(idx)
                }
            }
            if (neighbors.isEmpty()) break
            val nextNode = neighbors[Random.nextInt(neighbors.size)]
            path.add(nextNode)
            current = nextNode
        }
        return path
    }

    // Initialize nodes when size changes
    LaunchedEffect(width, height) {
        if (width > 0f && height > 0f && !sizeInitialized) {
            nodes.clear()
            signals.clear()
            for (i in 0 until maxNodes) {
                nodes.add(
                    NeuronNode(
                        x = Random.nextFloat() * width,
                        y = Random.nextFloat() * height,
                        vx = (Random.nextFloat() - 0.5f) * 0.8f,
                        vy = (Random.nextFloat() - 0.5f) * 0.8f,
                        radius = Random.nextFloat() * 1.5f + 1.2f,
                        color = if (Random.nextFloat() > 0.45f) cyanColor else violetColor
                    )
                )
            }
            sizeInitialized = true
        }
    }

    // Game loop for updates (running at ~60fps)
    LaunchedEffect(sizeInitialized) {
        if (!sizeInitialized) return@LaunchedEffect
        while (true) {
            // Update node positions
            for (node in nodes) {
                node.x += node.vx
                node.y += node.vy

                // Boundary bounce
                if (node.x < 0 || node.x > width) {
                    node.vx *= -1f
                    node.x = node.x.coerceIn(0f, width)
                }
                if (node.y < 0 || node.y > height) {
                    node.vy *= -1f
                    node.y = node.y.coerceIn(0f, height)
                }

                // Decay node pulse
                if (node.pulse > 0f) {
                    node.pulse -= 0.04f
                    if (node.pulse < 0f) node.pulse = 0f
                }
            }

            // Spawn electrical signals randomly
            if (signals.size < 8 && Random.nextFloat() < 0.03f && nodes.isNotEmpty()) {
                val startIdx = Random.nextInt(nodes.size)
                val path = buildSignalPath(startIdx, nodes.size)
                if (path.size > 1) {
                    signals.add(
                        ElectricalSignal(
                            path = path,
                            speed = Random.nextFloat() * 0.015f + 0.015f,
                            color = nodes[startIdx].color
                        )
                    )
                }
            }

            // Update electrical signals
            val iterator = signals.iterator()
            while (iterator.hasNext()) {
                val sig = iterator.next()
                val nodeFrom = nodes.getOrNull(sig.path[sig.currentStep])
                val nodeTo = nodes.getOrNull(sig.path[sig.currentStep + 1])

                if (nodeFrom == null || nodeTo == null) {
                    iterator.remove()
                    continue
                }

                // Current position on the path
                val currentX = nodeFrom.x + (nodeTo.x - nodeFrom.x) * sig.progress
                val currentY = nodeFrom.y + (nodeTo.y - nodeFrom.y) * sig.progress
                val currentPos = Offset(currentX, currentY)

                sig.history.add(currentPos)
                if (sig.history.size > 7) {
                    sig.history.removeAt(0)
                }

                // Advance progress
                sig.progress += sig.speed
                if (sig.progress >= 1f) {
                    // Pulse the destination node
                    nodes.getOrNull(sig.path[sig.currentStep + 1])?.pulse = 1.0f

                    sig.currentStep += 1
                    sig.progress = 0f

                    // Remove if path completed
                    if (sig.currentStep >= sig.path.size - 1) {
                        iterator.remove()
                    }
                }
            }

            delay(16) // ~60fps
        }
    }

    Canvas(
        modifier = modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                detectTapGestures { offset ->
                    // User click/touch interaction: pulse all nodes in proximity
                    for (node in nodes) {
                        val dx = node.x - offset.x
                        val dy = node.y - offset.y
                        val dist = sqrt(dx * dx + dy * dy)
                        if (dist < 200f) {
                            node.pulse = 1.0f
                            // Push away gently
                            node.vx += (dx / dist) * 0.5f
                            node.vy += (dy / dist) * 0.5f
                        }
                    }
                }
            }
    ) {
        if (sizeInitialized) {
            width = size.width
            height = size.height
        } else {
            width = size.width
            height = size.height
            return@Canvas
        }

        // 1. Draw synapses connections
        for (i in 0 until nodes.size) {
            val nodeA = nodes[i]
            for (j in (i + 1) until nodes.size) {
                val nodeB = nodes[j]
                val dx = nodeA.x - nodeB.x
                val dy = nodeA.y - nodeB.y
                val dist = sqrt(dx * dx + dy * dy)

                if (dist < maxConnectionDist) {
                    val alpha = (1f - dist / maxConnectionDist) * 0.12f
                    // Draw synapse line
                    drawLine(
                        color = Color.White.copy(alpha = alpha),
                        start = Offset(nodeA.x, nodeA.y),
                        end = Offset(nodeB.x, nodeB.y),
                        strokeWidth = 1f
                    )
                }
            }
        }

        // 2. Draw nodes with glowing pulse effects
        for (node in nodes) {
            val radius = node.radius + (node.pulse * 3.5f)
            val alpha = 0.35f + (node.pulse * 0.65f)

            // Draw outer glow circle if pulsed
            if (node.pulse > 0f) {
                drawCircle(
                    color = node.color.copy(alpha = node.pulse * 0.25f),
                    radius = radius * 3f,
                    center = Offset(node.x, node.y)
                )
            }

            drawCircle(
                color = node.color.copy(alpha = alpha),
                radius = radius,
                center = Offset(node.x, node.y)
            )
        }

        // 3. Draw electrical signals
        for (sig in signals) {
            if (sig.history.size > 1) {
                // Draw trailing line
                for (h in 0 until (sig.history.size - 1)) {
                    val start = sig.history[h]
                    val end = sig.history[h + 1]
                    val alpha = (h.toFloat() / sig.history.size) * 0.8f
                    drawLine(
                        color = sig.color.copy(alpha = alpha),
                        start = start,
                        end = end,
                        strokeWidth = 3f
                    )
                }

                // Draw glowing head dot
                val head = sig.history.last()
                drawCircle(
                    color = Color.White,
                    radius = 4f,
                    center = head
                )
                drawCircle(
                    color = sig.color.copy(alpha = 0.4f),
                    radius = 9f,
                    center = head
                )
            }
        }
    }
}
