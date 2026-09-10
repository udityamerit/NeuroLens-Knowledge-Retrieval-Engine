import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env from project root directory as well as frontend directory
  const rootEnvDir = path.resolve(__dirname, '..')
  const rootEnv = loadEnv(mode, rootEnvDir, '')
  const localEnv = loadEnv(mode, __dirname, '')
  const env = { ...rootEnv, ...localEnv }

  const groqKey = env.VITE_GROQ_API_KEY || env.GROQ_API_KEY || ''
  const openaiKey = env.VITE_OPENAI_API_KEY || env.OPENAI_API_KEY || ''
  const hfToken = env.VITE_HF_TOKEN || env.HF_TOKEN || env.HUGGINGFACEHUB_API_TOKEN || ''
  const elevenKey = env.VITE_ELEVENLABS_API_KEY || env.ELEVENLABS_API_KEY || ''

  return {
    plugins: [
      react(),
      legacy()
    ],
    base: mode === 'production' ? '/NeuroLens-Knowledge-Retrieval-Engine/' : '/',
    envDir: '../',
    define: {
      'import.meta.env.VITE_GROQ_API_KEY': JSON.stringify(groqKey),
      'import.meta.env.VITE_OPENAI_API_KEY': JSON.stringify(openaiKey),
      'import.meta.env.VITE_HF_TOKEN': JSON.stringify(hfToken),
      'import.meta.env.VITE_ELEVENLABS_API_KEY': JSON.stringify(elevenKey),
    }
  }
})
