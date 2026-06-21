import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load environment variables from the parent root folder
  const env = loadEnv(mode, '../', ['VITE_', 'GROQ_', 'OPENAI_', 'HF_', 'ELEVENLABS_'])
  
  return {
    plugins: [
      react(),
      legacy()
    ],
    base: '',
    define: {
      '__GROQ_API_KEY__': JSON.stringify(env.GROQ_API_KEY || ''),
      '__OPENAI_API_KEY__': JSON.stringify(env.OPENAI_API_KEY || ''),
      '__HF_TOKEN__': JSON.stringify(env.HF_TOKEN || ''),
      '__ELEVENLABS_API_KEY__': JSON.stringify(env.ELEVENLABS_API_KEY || ''),
    }
  }
})
