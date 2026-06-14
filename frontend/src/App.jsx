import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatPanel from './components/ChatPanel';
import SettingsModal from './components/SettingsModal';
import AuthorModal from './components/AuthorModal';

// --- Client-Side RAG Helper Functions ---

// Parse PDF file using PDF.js CDN library loaded in index.html
async function parsePDF(arrayBuffer) {
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib) {
    throw new Error("PDF.js library is not loaded. Please verify internet connection.");
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
  
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const pagesText = [];
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(item => item.str).join(' ');
    if (text.trim()) {
      pagesText.push({ text, page: i });
    }
  }
  return pagesText;
}

// Parse Word Document using Mammoth CDN library loaded in index.html
async function parseDOCX(arrayBuffer) {
  const mammoth = window.mammoth;
  if (!mammoth) {
    throw new Error("Mammoth.js library is not loaded. Please verify internet connection.");
  }
  const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
  return [{ text: result.value, page: null }];
}

// Chunking: Recursive Character Text Splitter equivalent
function splitTextIntoChunks(text, sourceName, docType, pageNum = null, chunkSize = 800, chunkOverlap = 150) {
  const chunks = [];
  let start = 0;
  
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    let chunkText = text.substring(start, end);
    
    // Adjust boundary to sentence/paragraph end space if possible
    if (end < text.length) {
      const lastSpace = chunkText.lastIndexOf(' ');
      if (lastSpace > chunkSize - 150) {
        chunkText = chunkText.substring(0, lastSpace);
      }
    }
    
    chunks.push({
      content: chunkText,
      metadata: {
        source: sourceName,
        type: docType,
        page: pageNum
      }
    });
    
    start += (chunkText.length - chunkOverlap);
    if (chunkText.length <= chunkOverlap) {
      break;
    }
  }
  return chunks;
}

// TF-IDF / BM25 Search Engine in pure JS
function searchChunks(query, chunks, k = 5) {
  if (chunks.length === 0) return [];
  
  // Tokenize and clean query
  const queryTerms = query.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
  if (queryTerms.length === 0) return chunks.slice(0, k);

  const scores = chunks.map(chunk => {
    const contentLower = chunk.content.toLowerCase();
    let score = 0;
    
    queryTerms.forEach(term => {
      // Find term occurrences
      const occurrences = (contentLower.match(new RegExp(term, 'g')) || []).length;
      if (occurrences > 0) {
        // Term Frequency (TF) term - logarithmic scaling
        const tf = 1 + Math.log(occurrences);
        
        // Inverse Document Frequency (IDF) term
        const docsWithTerm = chunks.filter(c => c.content.toLowerCase().includes(term)).length;
        const idf = Math.log(1 + chunks.length / (docsWithTerm || 1));
        
        score += tf * idf;
      }
    });
    
    return { chunk, score };
  });

  // Sort and filter chunks that have some match
  const matched = scores
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.chunk);

  // Fallback to top k chunks if no keyword matches
  if (matched.length === 0) {
    return chunks.slice(0, k);
  }
  
  return matched.slice(0, k);
}

// Call External LLM API directly from the browser
async function callLLM(provider, apiKey, modelName, messages, temperature) {
  if (provider === 'groq') {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: modelName,
        messages: messages,
        temperature: temperature
      })
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || "Groq API error");
    }
    const data = await response.json();
    return data.choices[0].message.content;
  } 
  else if (provider === 'openai') {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: modelName,
        messages: messages,
        temperature: temperature
      })
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || "OpenAI API error");
    }
    const data = await response.json();
    return data.choices[0].message.content;
  }
  else if (provider === 'huggingface') {
    // Construct formatted text containing prompt history
    const promptText = messages.map(m => `${m.role === 'system' ? 'System' : m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join("\n") + "\nAssistant:";
    const response = await fetch(`https://api-inference.huggingface.co/models/${modelName}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        inputs: promptText,
        parameters: { temperature: temperature, max_new_tokens: 1000 }
      })
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(err || "Hugging Face Hub API error");
    }
    const data = await response.json();
    if (Array.isArray(data)) {
      let generatedText = data[0].generated_text || "";
      if (generatedText.startsWith(promptText)) {
        generatedText = generatedText.substring(promptText.length);
      }
      return generatedText;
    }
    return data.generated_text || JSON.stringify(data);
  }
  else {
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}

// Rewrites user query into self-contained search query using recent chat history context
async function generateStandaloneQuery(query, history, provider, apiKey, modelName) {
  if (!history || history.length === 0) return query;
  
  const historyMsgs = history.filter(m => m.role === 'user' || m.role === 'assistant');
  if (historyMsgs.length === 0) return query;

  const recentHistory = historyMsgs.slice(-4);
  let historyStr = "";
  recentHistory.forEach(msg => {
    const role = msg.role === 'user' ? "User" : "Assistant";
    let content = msg.content;
    if (content.length > 300) content = content.substring(0, 300) + "...";
    historyStr += `${role}: ${content}\n`;
  });

  const rephrasePrompt = 
    "Given the following chat history and a follow-up question, " +
    "rephrase the follow-up question to be a self-contained standalone search query. " +
    "Do NOT answer the question. Just rephrase it to include necessary details " +
    "from the history so that it can be searched in a vector database.\n" +
    "Return ONLY the raw standalone question string and absolutely nothing else.\n\n" +
    `Chat History:\n${historyStr}\n` +
    `Follow-up Question: ${query}\n` +
    "Standalone Question:";

  try {
    const rephrased = await callLLM(provider, apiKey, modelName, [{ role: "user", content: rephrasePrompt }], 0.0);
    const cleaned = rephrased.trim().replace(/^['"]|['"]$/g, '');
    return cleaned || query;
  } catch (err) {
    console.warn("Failed to generate standalone query, falling back to raw query:", err);
    return query;
  }
}

// --- Main App Component ---

export default function App() {
  const [documents, setDocuments] = useState([]);
  const [allChunks, setAllChunks] = useState([]);
  const [messages, setMessages] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAuthorOpen, setIsAuthorOpen] = useState(false);
  
  // Initialize settings with fallback defaults, locally stored API keys and backend URL
  const [settings, setSettings] = useState(() => {
    const provider = 'groq';
    return {
      provider,
      apiKey: localStorage.getItem(`neurolens_key_${provider}`) || '',
      modelName: 'llama-3.3-70b-versatile',
      temperature: 0.3,
      k: 5
    };
  });

  // Load documents and chunks from session storage or local storage if desired
  useEffect(() => {
    const storedDocs = localStorage.getItem('neurolens_docs');
    const storedChunks = localStorage.getItem('neurolens_chunks');
    if (storedDocs && storedChunks) {
      try {
        setDocuments(JSON.parse(storedDocs));
        setAllChunks(JSON.parse(storedChunks));
      } catch (e) {
        console.error("Failed to restore indexed files:", e);
      }
    }
  }, []);

  const handleUpload = async (files) => {
    setIsUploading(true);
    try {
      const newDocs = [];
      const newChunks = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const filename = file.name;
        const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
        
        let pagesText = []; // array of {text, page}
        
        const arrayBuffer = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsArrayBuffer(file);
        });

        if (ext === '.pdf') {
          pagesText = await parsePDF(arrayBuffer);
        } else if (ext === '.docx' || ext === '.doc') {
          pagesText = await parseDOCX(arrayBuffer);
        } else {
          // Default to plain text parsing
          const text = new TextDecoder("utf-8").decode(arrayBuffer);
          pagesText = [{ text, page: null }];
        }

        // Split pages/blocks into chunks
        pagesText.forEach(item => {
          const chunks = splitTextIntoChunks(item.text, filename, ext.substring(1), item.page, 800, 150);
          newChunks.push(...chunks);
        });

        newDocs.push(filename);
      }

      const updatedDocs = [...documents];
      newDocs.forEach(d => {
        if (!updatedDocs.includes(d)) updatedDocs.push(d);
      });

      const updatedChunks = [...allChunks, ...newChunks];

      setDocuments(updatedDocs);
      setAllChunks(updatedChunks);

      // Persist documents in localStorage
      localStorage.setItem('neurolens_docs', JSON.stringify(updatedDocs));
      localStorage.setItem('neurolens_chunks', JSON.stringify(updatedChunks));

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `📥 **System:** Successfully processed and indexed **${files.length}** new document(s) directly in your browser. You can now ask questions based on these files.`,
          sources: []
        }
      ]);
    } catch (error) {
      console.error("Upload error:", error);
      alert(`Upload failed: ${error.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSendQuery = async (queryText) => {
    const userMessage = { role: 'user', content: queryText };
    setMessages(prev => [...prev, userMessage]);
    setIsGenerating(true);

    try {
      // Resolve API key: check settings first, then check build-time env vars as fallbacks
      let resolvedKey = settings.apiKey;
      if (!resolvedKey) {
        if (settings.provider === 'groq') {
          resolvedKey = import.meta.env.VITE_GROQ_API_KEY || '';
        } else if (settings.provider === 'openai') {
          resolvedKey = import.meta.env.VITE_OPENAI_API_KEY || '';
        } else if (settings.provider === 'huggingface') {
          resolvedKey = import.meta.env.VITE_HF_TOKEN || import.meta.env.VITE_HUGGINGFACE_API_KEY || '';
        }
      }

      if (!resolvedKey) {
        throw new Error(`API Key for ${settings.provider.toUpperCase()} is missing. Please click the Settings gear icon in the sidebar and enter your API key to query.`);
      }

      if (allChunks.length === 0) {
        throw new Error("No documents indexed. Please upload files in the sidebar before searching.");
      }

      // 1. Generate standalone query using chat history context
      const searchQuery = await generateStandaloneQuery(
        queryText,
        messages,
        settings.provider,
        resolvedKey,
        settings.modelName
      );

      // 2. Perform client-side retrieval
      const relevantChunks = searchChunks(searchQuery, allChunks, settings.k);

      // 3. Format system prompt context
      let contextStr = "";
      relevantChunks.forEach((chunk, i) => {
        const source = chunk.metadata.source || "Unknown";
        const pageInfo = chunk.metadata.page ? ` (Page ${chunk.metadata.page})` : "";
        contextStr += `--- Source ${i + 1}: ${source}${pageInfo} ---\n${chunk.content}\n\n`;
      });

      const systemPrompt = 
        "You are NeuroLens, an advanced AI document analyst. " +
        "Your task is to answer the user's question based strictly on the provided context source blocks. " +
        "For each statement you make, try to cite which Source (e.g., [Source 1], [Source 2]) you retrieved the information from. " +
        "If the context does not contain the information needed to answer the question, state that you cannot find the answer in the provided documents.\n\n" +
        `Here is the context retrieved from the documents:\n\n${contextStr}`;

      // 4. Build message logs incorporating chat history
      const promptMessages = [{ role: "system", content: systemPrompt }];
      messages.forEach(msg => {
        const role = msg.role;
        const content = msg.content;
        if (role && content && !content.startsWith("📥 **System:**") && !content.startsWith("❌ **Error")) {
          promptMessages.push({ role, content });
        }
      });
      promptMessages.push({ role: "user", content: queryText });

      // 5. Query LLM endpoint directly from the browser
      const answer = await callLLM(
        settings.provider,
        resolvedKey,
        settings.modelName,
        promptMessages,
        settings.temperature
      );

      // 6. Update message thread
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: answer,
          sources: relevantChunks.map(chunk => ({
            content: chunk.content,
            source: chunk.metadata.source,
            page: chunk.metadata.page,
            type: chunk.metadata.type
          }))
        }
      ]);

    } catch (error) {
      console.error("Query error:", error);
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `❌ **Error running query:** ${error.message}\n\nPlease check your internet connection or verify your API keys in settings.`,
          sources: []
        }
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClear = async () => {
    if (!window.confirm("Are you sure you want to clear the vector index? This will remove all loaded documents.")) {
      return;
    }
    setDocuments([]);
    setAllChunks([]);
    setMessages([]);
    localStorage.removeItem('neurolens_docs');
    localStorage.removeItem('neurolens_chunks');
  };

  const handleSaveSettings = (newSettings) => {
    setSettings(newSettings);
  };

  return (
    <div style={styles.appContainer} className="hologram-overlay">
      <div className="hologram-scanline" />
      
      {/* Sidebar - File upload & listing */}
      <Sidebar 
        documents={documents}
        onUpload={handleUpload}
        onClear={handleClear}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenAuthor={() => setIsAuthorOpen(true)}
        isUploading={isUploading}
      />

      {/* Main Panel - Interactive Chat */}
      <ChatPanel 
        messages={messages}
        onSendQuery={handleSendQuery}
        isGenerating={isGenerating}
        activeModel={`${settings.provider.toUpperCase()} (${settings.modelName})`}
        hasDocuments={documents.length > 0}
      />

      {/* Settings Modal overlay */}
      <SettingsModal 
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSave={handleSaveSettings}
      />

      {/* Author Modal overlay */}
      <AuthorModal 
        isOpen={isAuthorOpen}
        onClose={() => setIsAuthorOpen(false)}
      />
    </div>
  );
}

const styles = {
  appContainer: {
    display: 'flex',
    width: '100vw',
    height: '100vh',
    overflow: 'hidden',
    position: 'relative'
  }
};
