import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load environment variables from the parent root folder
  const env = loadEnv(mode, '../', ['VITE_', 'GROQ_', 'OPENAI_', 'HF_'])
  
  return {
    plugins: [react()],
    base: '/NeuroLens-Knowledge-Retrieval-Engine/',
    define: {
      '__GROQ_API_KEY__': JSON.stringify(env.GROQ_API_KEY || ''),
      '__OPENAI_API_KEY__': JSON.stringify(env.OPENAI_API_KEY || ''),
      '__HF_TOKEN__': JSON.stringify(env.HF_TOKEN || ''),
    }
  }
})
