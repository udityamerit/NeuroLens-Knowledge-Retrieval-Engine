import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatPanel from './components/ChatPanel';
import SettingsModal from './components/SettingsModal';
import AuthorModal from './components/AuthorModal';
import CameraModal from './components/CameraModal';
import DocPreviewModal from './components/DocPreviewModal';

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

// Helper to call vision API for a single model
async function callVisionAPI(url, model, apiKey, file, base64Data) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "You are an advanced document analyst and OCR engine. Describe this image in detail, transcribing all text, labels, structures, charts, graphs, or tables word-for-word. Provide a clear, structured textual description without repeating sentences or phrases. Avoid looping or duplicating descriptive statements."
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${file.type};base64,${base64Data}`
              }
            }
          ]
        }
      ],
      temperature: 0.5
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || `${model} vision completions failed.`);
  }

  const resData = await response.json();
  return resData.choices[0].message.content;
}

// Describe/transcribe image content using Vision LLM (Groq Llama 4/3.2 Vision / OpenAI GPT-4o-mini)
async function extractTextFromImage(file, provider, apiKey, modelName) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const dataUrl = reader.result;
        const base64Data = dataUrl.split(',')[1];
        
        if (provider === 'groq') {
          const url = "https://api.groq.com/openai/v1/chat/completions";
          // Try newer vision models first, then fallback to others
          const groqVisionModels = [
            'meta-llama/llama-4-scout-17b-16e-instruct',
            'qwen/qwen3.6-27b'
          ];
          
          let lastError = null;
          for (const model of groqVisionModels) {
            try {
              console.log(`Trying Groq vision model: ${model}`);
              const resText = await callVisionAPI(url, model, apiKey, file, base64Data);
              resolve(resText);
              return;
            } catch (e) {
              console.warn(`Groq vision model ${model} failed, trying next fallback:`, e);
              lastError = e;
            }
          }
          reject(lastError || new Error("All Groq vision models failed. Please verify API key permissions."));
          return;
        } else if (provider === 'openai') {
          const url = "https://api.openai.com/v1/chat/completions";
          const visionModel = modelName.startsWith('gpt-4') ? modelName : 'gpt-4o-mini';
          const resText = await callVisionAPI(url, visionModel, apiKey, file, base64Data);
          resolve(resText);
        } else {
          reject(new Error("Image analysis is supported on Groq and OpenAI providers. Please switch provider in settings."));
          return;
        }
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (e) => reject(new Error("Failed to read image file."));
    reader.readAsDataURL(file);
  });
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
  const [isMobile, setIsMobile] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [sessionImageUrls, setSessionImageUrls] = useState({});

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) setIsSidebarOpen(false);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  // Initialize settings with fallback defaults, locally stored API keys and backend URL
  const [settings, setSettings] = useState(() => {
    const provider = 'groq';
    return {
      provider,
      apiKey: localStorage.getItem(`neurolens_key_${provider}`) || '',
      modelName: 'llama-3.3-70b-versatile',
      temperature: 0.3,
      k: 5,
      backendUrl: localStorage.getItem('neurolens_backend_url') || '',
      elevenLabsApiKey: localStorage.getItem('neurolens_key_elevenlabs') || ''
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
        const dotIndex = filename.lastIndexOf('.');
        const ext = dotIndex !== -1 ? filename.substring(dotIndex).toLowerCase() : '';
        const cleanExt = dotIndex !== -1 ? filename.substring(dotIndex + 1).toLowerCase() : 'txt';
        
        let pagesText = []; // array of {text, page}
        
        const isImage = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext);
        if (isImage) {
          // Read as data URL to store in sessionImageUrls for previewing
          try {
            const dataUrl = await new Promise((resolve, reject) => {
              const r = new FileReader();
              r.onload = () => resolve(r.result);
              r.onerror = reject;
              r.readAsDataURL(file);
            });
            setSessionImageUrls(prev => ({ ...prev, [filename]: dataUrl }));
          } catch (e) {
            console.warn("Failed to read image as Data URL for preview", e);
          }

          let resolvedKey = settings.apiKey;
          if (!resolvedKey) {
            if (settings.provider === 'groq') {
              resolvedKey = import.meta.env.VITE_GROQ_API_KEY || (typeof __GROQ_API_KEY__ !== 'undefined' ? __GROQ_API_KEY__ : '') || '';
            } else if (settings.provider === 'openai') {
              resolvedKey = import.meta.env.VITE_OPENAI_API_KEY || (typeof __OPENAI_API_KEY__ !== 'undefined' ? __OPENAI_API_KEY__ : '') || '';
            }
          }
          if (!resolvedKey) {
            throw new Error(`API Key for ${settings.provider.toUpperCase()} is required to analyze image documents. Please open settings and add your API key.`);
          }
          if (settings.provider !== 'groq' && settings.provider !== 'openai') {
            throw new Error("Image analysis requires Groq or OpenAI provider. Please configure their credentials in Settings.");
          }
          
          const extractedText = await extractTextFromImage(file, settings.provider, resolvedKey, settings.modelName);
          pagesText = [{ text: extractedText, page: null }];
        } else {
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
        }

        // Split pages/blocks into chunks
        pagesText.forEach(item => {
          const chunks = splitTextIntoChunks(item.text, filename, cleanExt, item.page, 800, 150);
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

  const handleFetchUrl = async (url) => {
    setIsFetchingUrl(true);
    try {
      let pageTitle = url;
      let pageText = '';

      // Helper: extract clean text from raw HTML string using DOMParser
      const extractTextFromHtml = (html) => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Extract title
        const titleEl = doc.querySelector('title');
        const extractedTitle = titleEl ? titleEl.textContent.trim() : url;

        // Remove non-content elements
        const removeTags = ['script', 'style', 'nav', 'footer', 'header', 'aside', 'form', 'iframe', 'noscript', 'svg', 'img', 'video', 'audio'];
        removeTags.forEach(tag => {
          doc.querySelectorAll(tag).forEach(el => el.remove());
        });

        // Get clean text from body
        const body = doc.body;
        const text = body ? body.innerText || body.textContent : '';
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        return { title: extractedTitle, text: lines.join('\n') };
      };

      // Helper: extract title from Jina Reader markdown output
      const extractTitleFromMarkdown = (md) => {
        // Jina returns "Title: ...\n" at the top
        const titleMatch = md.match(/^Title:\s*(.+)$/m);
        if (titleMatch && titleMatch[1].trim()) return titleMatch[1].trim();
        // Fallback: use first heading
        const headingMatch = md.match(/^#+\s+(.+)$/m);
        if (headingMatch && headingMatch[1].trim()) return headingMatch[1].trim();
        return url;
      };

      let fetched = false;

      // Strategy 1: Jina Reader API — renders JavaScript, returns clean markdown (best for SPAs)
      try {
        const jinaUrl = `https://r.jina.ai/${url}`;
        const res = await fetch(jinaUrl, {
          headers: { 'Accept': 'text/plain' },
          signal: AbortSignal.timeout(20000)
        });
        if (res.ok) {
          const markdown = await res.text();
          if (markdown && markdown.length > 30) {
            // Strip markdown image/link syntax but keep text
            const cleanText = markdown
              .replace(/!\[.*?\]\(.*?\)/g, '')  // remove images
              .replace(/\[([^\]]*)\]\(.*?\)/g, '$1')  // keep link text
              .trim();
            if (cleanText.length > 30) {
              pageTitle = extractTitleFromMarkdown(markdown);
              pageText = cleanText;
              fetched = true;
            }
          }
        }
      } catch (e) {
        console.warn("Jina Reader API failed:", e);
      }

      // Strategy 2: allorigins.win CORS proxy
      if (!fetched) {
        try {
          const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
          const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(12000) });
          if (res.ok) {
            const html = await res.text();
            if (html && html.length > 100) {
              const result = extractTextFromHtml(html);
              if (result.text.length > 30) {
                pageTitle = result.title;
                pageText = result.text;
                fetched = true;
              }
            }
          }
        } catch (e) {
          console.warn("allorigins.win proxy failed:", e);
        }
      }

      // Strategy 3: corsproxy.io fallback
      if (!fetched) {
        try {
          const proxyUrl2 = `https://corsproxy.io/?${encodeURIComponent(url)}`;
          const res = await fetch(proxyUrl2, { signal: AbortSignal.timeout(12000) });
          if (res.ok) {
            const html = await res.text();
            if (html && html.length > 100) {
              const result = extractTextFromHtml(html);
              if (result.text.length > 30) {
                pageTitle = result.title;
                pageText = result.text;
                fetched = true;
              }
            }
          }
        } catch (e) {
          console.warn("corsproxy.io proxy failed:", e);
        }
      }

      // Strategy 4: Backend /api/fetch-url fallback
      if (!fetched) {
        try {
          const backendBase = settings.backendUrl || 'http://127.0.0.1:8000';
          const res = await fetch(`${backendBase}/api/fetch-url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
            signal: AbortSignal.timeout(15000)
          });
          if (res.ok) {
            const data = await res.json();
            if (data.content && data.content.length > 30) {
              pageTitle = data.title || url;
              pageText = data.content;
              fetched = true;
            }
          }
        } catch (e) {
          console.warn("Backend /api/fetch-url fallback failed:", e);
        }
      }

      if (!fetched || !pageText) {
        throw new Error("Could not fetch readable content from this URL. The page may be blocking automated access or may be empty.");
      }

      // Build a display name for the source
      const displayName = pageTitle.length > 60 ? pageTitle.substring(0, 57) + '...' : pageTitle;
      const sourceName = `🌐 ${displayName}`;

      // Chunk the extracted text
      const newChunks = splitTextIntoChunks(pageText, sourceName, 'url', null, 800, 150);

      if (newChunks.length === 0) {
        throw new Error("No meaningful text content extracted from this URL.");
      }

      const updatedDocs = [...documents];
      if (!updatedDocs.includes(sourceName)) updatedDocs.push(sourceName);

      const updatedChunks = [...allChunks, ...newChunks];

      setDocuments(updatedDocs);
      setAllChunks(updatedChunks);

      // Persist
      localStorage.setItem('neurolens_docs', JSON.stringify(updatedDocs));
      localStorage.setItem('neurolens_chunks', JSON.stringify(updatedChunks));

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `🌐 **System:** Successfully fetched and indexed content from **${displayName}**. Extracted **${newChunks.length}** text chunks. You can now ask questions about this page.`,
          sources: []
        }
      ]);
    } catch (error) {
      console.error("URL fetch error:", error);
      alert(`URL fetch failed: ${error.message}`);
    } finally {
      setIsFetchingUrl(false);
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
          resolvedKey = import.meta.env.VITE_GROQ_API_KEY || (typeof __GROQ_API_KEY__ !== 'undefined' ? __GROQ_API_KEY__ : '') || '';
        } else if (settings.provider === 'openai') {
          resolvedKey = import.meta.env.VITE_OPENAI_API_KEY || (typeof __OPENAI_API_KEY__ !== 'undefined' ? __OPENAI_API_KEY__ : '') || '';
        } else if (settings.provider === 'huggingface') {
          resolvedKey = import.meta.env.VITE_HF_TOKEN || import.meta.env.VITE_HUGGINGFACE_API_KEY || (typeof __HF_TOKEN__ !== 'undefined' ? __HF_TOKEN__ : '') || '';
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
        "Respond in the same language as the user's question (e.g., if the user asks in Hindi, translate the relevant context facts and answer in Hindi). " +
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

  const handleDeleteDocument = (docName) => {
    if (!window.confirm(`Are you sure you want to delete "${docName}" from the library?`)) {
      return;
    }
    const updatedDocs = documents.filter(d => d !== docName);
    const updatedChunks = allChunks.filter(c => c.metadata.source !== docName);

    setDocuments(updatedDocs);
    setAllChunks(updatedChunks);

    localStorage.setItem('neurolens_docs', JSON.stringify(updatedDocs));
    localStorage.setItem('neurolens_chunks', JSON.stringify(updatedChunks));

    setMessages(prev => [
      ...prev,
      {
        role: 'assistant',
        content: `🗑️ **System:** Removed **${docName}** and its corresponding text chunks from the library database.`,
        sources: []
      }
    ]);
  };

  const handleSaveSettings = (newSettings) => {
    setSettings(newSettings);
  };

  return (
    <div style={styles.appContainer} className="hologram-overlay">
      <div className="hologram-scanline" />
      
      {/* Mobile Sidebar Overlay/Backdrop */}
      {isSidebarOpen && (
        <div 
          onClick={() => setIsSidebarOpen(false)}
          className="responsive-backdrop animate-fade-in"
        />
      )}

      {/* Sidebar - File upload & listing */}
      <div className={`sidebar-wrapper ${isSidebarOpen ? 'open' : ''}`}>
        <button 
          onClick={() => setIsSidebarOpen(false)}
          className="mobile-sidebar-close-btn"
          title="Close Library"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <Sidebar 
          documents={documents}
          onUpload={(files) => {
            handleUpload(files);
            setIsSidebarOpen(false); // Close sidebar after upload on mobile
          }}
          onFetchUrl={(url) => {
            handleFetchUrl(url);
          }}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenCamera={() => setIsCameraOpen(true)}
          onPreviewDocument={(docName) => setPreviewDoc(docName)}
          onDeleteDocument={handleDeleteDocument}
          isUploading={isUploading}
          isFetchingUrl={isFetchingUrl}
        />
      </div>

      {/* Main Panel - Interactive Chat */}
      <ChatPanel 
        messages={messages}
        onSendQuery={handleSendQuery}
        isGenerating={isGenerating}
        activeModel={`${settings.provider.toUpperCase()} (${settings.modelName})`}
        hasDocuments={documents.length > 0}
        isMobile={isMobile}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        backendUrl={settings.backendUrl}
        elevenLabsApiKey={settings.elevenLabsApiKey}
      />

      {/* Settings Modal overlay */}
      <SettingsModal 
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSave={handleSaveSettings}
        onOpenAuthor={() => setIsAuthorOpen(true)}
        onClear={handleClear}
        hasDocuments={documents.length > 0}
      />

      {/* Author Modal overlay */}
      <AuthorModal 
        isOpen={isAuthorOpen}
        onClose={() => setIsAuthorOpen(false)}
      />

      {/* Camera Scanner Modal overlay */}
      <CameraModal 
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onCapture={(file) => {
          handleUpload([file]);
        }}
      />

      {/* Document Preview Modal overlay */}
      <DocPreviewModal 
        isOpen={!!previewDoc}
        onClose={() => setPreviewDoc(null)}
        docName={previewDoc}
        chunks={allChunks}
        imageUrl={sessionImageUrls[previewDoc]}
      />
    </div>
  );
}

const styles = {
  appContainer: {
    display: 'flex',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    position: 'relative'
  }
};
