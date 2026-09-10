import { useState, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ChatPanel from './components/ChatPanel';
import SettingsModal from './components/SettingsModal';
import AuthorModal from './components/AuthorModal';
import CameraModal from './components/CameraModal';
import DocPreviewModal from './components/DocPreviewModal';
import { safeStorage } from './utils/storage';
import { indexedStorage } from './utils/indexedStorage';
import { buildInvertedIndex, searchBM25, searchBM25MultiDoc, isSummaryQuery, isMultiDocQuery, getStratifiedSummaryChunks, getMultiDocStratifiedSummaryChunks } from './utils/bm25Engine';

// --- Client-Side RAG Helper Functions ---

// High-Speed Concurrent Batched PDF Parser
async function parsePDF(arrayBuffer, onProgress) {
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib) {
    throw new Error("PDF.js library is not loaded. Please verify internet connection.");
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
  
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  const pagesText = [];

  // Extract in non-blocking batches of 6 pages concurrently
  const BATCH_SIZE = 6;
  const startTime = Date.now();

  for (let batchStart = 1; batchStart <= numPages; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, numPages);
    const batchPromises = [];

    for (let pageNum = batchStart; pageNum <= batchEnd; pageNum++) {
      batchPromises.push(
        (async (pNum) => {
          try {
            const page = await pdf.getPage(pNum);
            const content = await page.getTextContent();
            
            // Reconstruct text with space/line awareness
            let pageRaw = content.items.map(item => item.str).join(' ');
            
            // Clean hyphenated word splits across line wraps: e.g. "com-\nputing" -> "computing"
            pageRaw = pageRaw.replace(/(\w+)-\s+(\w+)/g, '$1$2');
            
            // Normalize excessive whitespace
            pageRaw = pageRaw.replace(/\s+/g, ' ').trim();

            if (pageRaw) {
              return { text: pageRaw, page: pNum };
            }
          } catch (err) {
            console.warn(`Failed to extract page ${pNum}:`, err);
          }
          return null;
        })(pageNum)
      );
    }

    const batchResults = await Promise.all(batchPromises);
    batchResults.forEach(res => {
      if (res) pagesText.push(res);
    });

    // Report real-time progress
    if (onProgress) {
      const elapsedSec = Math.max(0.1, (Date.now() - startTime) / 1000);
      const speed = Math.round(batchEnd / elapsedSec);
      onProgress({
        current: batchEnd,
        total: numPages,
        percent: Math.min(100, Math.round((batchEnd / numPages) * 100)),
        speed: `${speed} p/s`
      });
    }

    // Yield control to browser event loop to maintain 60 FPS rendering
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  // Sort pages in ascending order to guarantee chronological alignment
  pagesText.sort((a, b) => a.page - b.page);
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
  let effectiveApiKey = (apiKey || '').trim();
  if (!effectiveApiKey) {
    effectiveApiKey = (import.meta.env.VITE_GROQ_API_KEY || '').trim() || (safeStorage.getItem('neurolens_key_groq') || '').trim();
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${effectiveApiKey}`,
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
              text: "You are an advanced document analyst and OCR engine. Describe this image in detail, transcribing all text, mathematical formulas, labels, structures, charts, graphs, or tables word-for-word. When transcribing mathematical formulas, equations, or expressions, transcribe them in standard LaTeX syntax (using $$ ... $$ for display equations and $ ... $ for inline math). Provide a clear, structured textual description without repeating sentences or phrases. Avoid looping or duplicating descriptive statements."
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
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `${model} vision completions failed.`);
  }

  const resData = await response.json();
  return resData.choices[0].message.content;
}

// Describe/transcribe image content using Vision LLM (Groq Qwen 3.8/3.6 Vision / OpenAI GPT-4o-mini)
async function extractTextFromImage(file, provider, apiKey, modelName) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const dataUrl = reader.result;
        const base64Data = dataUrl.split(',')[1];
        
        if (provider === 'groq') {
          const url = "https://api.groq.com/openai/v1/chat/completions";
          const groqVisionModels = [
            'qwen/qwen3.8-27b',
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
    reader.onerror = () => reject(new Error("Failed to read image file."));
    reader.readAsDataURL(file);
  });
}

// Context-Aware Recursive Character Text Splitter with Page Boundary Support
function splitTextIntoChunks(text, sourceName, docType, pageNum = null, chunkSize = 800, chunkOverlap = 150) {
  const chunks = [];
  if (!text || !text.trim()) return chunks;

  let start = 0;
  const textLen = text.length;
  
  while (start < textLen) {
    const end = Math.min(start + chunkSize, textLen);
    let chunkText = text.substring(start, end);
    
    // Adjust boundary to sentence/paragraph end space if possible
    if (end < textLen) {
      const lastDoubleBreak = chunkText.lastIndexOf('\n\n');
      const lastPeriod = chunkText.lastIndexOf('. ');
      const lastSpace = chunkText.lastIndexOf(' ');
      
      if (lastDoubleBreak > chunkSize - 200) {
        chunkText = chunkText.substring(0, lastDoubleBreak);
      } else if (lastPeriod > chunkSize - 180) {
        chunkText = chunkText.substring(0, lastPeriod + 1);
      } else if (lastSpace > chunkSize - 150) {
        chunkText = chunkText.substring(0, lastSpace);
      }
    }

    const trimmed = chunkText.trim();
    if (trimmed.length > 20) {
      chunks.push({
        content: trimmed,
        metadata: {
          source: sourceName,
          type: docType,
          page: pageNum
        }
      });
    }
    
    start += Math.max(1, chunkText.length - chunkOverlap);
    if (chunkText.length <= chunkOverlap) {
      break;
    }
  }
  return chunks;
}

// Call External LLM API directly from the browser
async function callLLM(provider, apiKey, modelName, messages, temperature) {
  let effectiveApiKey = (apiKey || '').trim();
  if (!effectiveApiKey) {
    if (provider === 'groq') {
      effectiveApiKey = (import.meta.env.VITE_GROQ_API_KEY || '').trim() || (safeStorage.getItem('neurolens_key_groq') || '').trim();
    } else if (provider === 'openai') {
      effectiveApiKey = (import.meta.env.VITE_OPENAI_API_KEY || '').trim() || (safeStorage.getItem('neurolens_key_openai') || '').trim();
    } else if (provider === 'huggingface') {
      effectiveApiKey = (import.meta.env.VITE_HF_TOKEN || import.meta.env.VITE_HUGGINGFACE_API_KEY || '').trim() || (safeStorage.getItem('neurolens_key_huggingface') || '').trim();
    }
  }

  if (provider === 'groq') {
    let effectiveModel = modelName;
    // Auto-migrate any deprecated model names
    if (!effectiveModel || effectiveModel.includes('llama-3.3') || effectiveModel.includes('llama-3.1') || effectiveModel.includes('llama-4-scout') || effectiveModel.includes('mixtral')) {
      effectiveModel = 'qwen/qwen3.8-27b';
    }

    const payload = {
      model: effectiveModel,
      messages: messages,
      temperature: temperature
    };

    let response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${effectiveApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    // If selected model fails or is unavailable on Groq, fallback to qwen/qwen3.8-27b
    if (!response.ok && effectiveModel !== 'qwen/qwen3.8-27b') {
      console.warn(`Model ${effectiveModel} returned status ${response.status}. Falling back to qwen/qwen3.8-27b...`);
      response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${effectiveApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...payload,
          model: 'qwen/qwen3.8-27b'
        })
      });
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `Groq API error (${response.status})`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
  }
  else if (provider === 'openai') {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${effectiveApiKey}`,
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

// Helper to detect internal system notices (upload, removal, url ingestion, errors)
// System messages must NEVER pollute LLM conversation history
function isSystemMessage(msg) {
  if (!msg) return true;
  if (msg.isSystem) return true;
  if (msg.role !== 'user' && msg.role !== 'assistant') return true;
  const content = typeof msg.content === 'string' ? msg.content.trim() : '';
  if (!content) return true;
  if (content.includes('**System:**') || content.includes('**Error')) return true;
  if (/^(📥|🗑️|🌐|❌|⚠️)/.test(content)) return true;
  if (/^Removed\s+.*from the library/i.test(content)) return true;
  return false;
}

// Rewrites user query into self-contained search query using recent chat history context
async function generateStandaloneQuery(query, history, provider, apiKey, modelName, documents = []) {
  if (!history || history.length === 0) return query;
  
  const historyMsgs = history.filter(m => !isSystemMessage(m));
  if (historyMsgs.length === 0) return query;

  const recentHistory = historyMsgs.slice(-4);
  let historyStr = "";
  recentHistory.forEach(msg => {
    const role = msg.role === 'user' ? "User" : "Assistant";
    let content = msg.content;
    if (content.length > 300) content = content.substring(0, 300) + "...";
    historyStr += `${role}: ${content}\n`;
  });

  const docsListStr = documents && documents.length > 0 ? documents.join(", ") : "";
  const docGuidance = docsListStr 
    ? `Available uploaded files in knowledge base: [${docsListStr}]. If the user refers to "the other pdf", "the first file", or a specific document topic, incorporate the matching filename.\n`
    : "";

  const rephrasePrompt = 
    "Given the following chat history and a follow-up question, " +
    "rephrase the follow-up question to be a self-contained standalone search query. " +
    docGuidance +
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

// Build structured Master Knowledge Library Catalog for full multi-document awareness
function buildLibraryCatalog(documents, allChunks) {
  if (!documents || documents.length === 0) return "";
  let catalog = "=== ACTIVE KNOWLEDGE BASE CATALOG (Total Sources: " + documents.length + ") ===\n";
  documents.forEach((doc, idx) => {
    const docChunks = allChunks.filter(c => c.metadata && c.metadata.source === doc);
    const uniquePages = new Set(docChunks.map(c => c.metadata?.page).filter(Boolean));
    const pageStr = uniquePages.size > 0 ? `${uniquePages.size} pages, ` : '';
    
    // Extract first 160 characters of first chunk as opening synopsis
    let preview = "";
    if (docChunks.length > 0 && docChunks[0].content) {
      preview = docChunks[0].content.replace(/\s+/g, ' ').trim().substring(0, 160);
      if (docChunks[0].content.length > 160) preview += "...";
    }

    catalog += `${idx + 1}. 📄 "${doc}" (${pageStr}${docChunks.length} chunks)\n`;
    if (preview) {
      catalog += `   Overview: "${preview}"\n`;
    }
  });
  catalog += "=================================================================\n\n";
  return catalog;
}

// --- Main App Component ---

export default function App() {
  const [documents, setDocuments] = useState([]);
  const [allChunks, setAllChunks] = useState([]);
  const [activeFilter, setActiveFilter] = useState('ALL'); // 'ALL' or specific filename
  const [messages, setMessages] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAuthorOpen, setIsAuthorOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [sessionImageUrls, setSessionImageUrls] = useState({});

  // Inverted index reference for sub-millisecond BM25 retrieval
  const invertedIndexRef = useRef(null);

  useEffect(() => {
    if (allChunks.length > 0) {
      invertedIndexRef.current = buildInvertedIndex(allChunks);
    } else {
      invertedIndexRef.current = null;
    }
  }, [allChunks]);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) setIsSidebarOpen(false);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    
    console.log("NeuroLens React app successfully mounted");
    
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  // Initialize settings with fallback defaults, locally stored API keys, env vars, and backend URL
  const [settings, setSettings] = useState(() => {
    const provider = 'groq';
    const envKey = (import.meta.env.VITE_GROQ_API_KEY || '').trim();
    const envElevenKey = (import.meta.env.VITE_ELEVENLABS_API_KEY || '').trim();
    
    // Auto-migrate legacy model name
    let storedModel = safeStorage.getItem('neurolens_model_name') || 'qwen/qwen3.8-27b';
    if (!storedModel || storedModel.includes('llama-3.3') || storedModel.includes('llama-3.1') || storedModel.includes('llama-4-scout') || storedModel.includes('mixtral')) {
      storedModel = 'qwen/qwen3.8-27b';
      safeStorage.setItem('neurolens_model_name', storedModel);
    }

    const storedKey = (safeStorage.getItem(`neurolens_key_${provider}`) || '').trim();
    const effectiveKey = storedKey || envKey;
    if (effectiveKey && !storedKey) {
      safeStorage.setItem(`neurolens_key_${provider}`, effectiveKey);
    }

    return {
      provider,
      apiKey: effectiveKey,
      modelName: storedModel,
      temperature: 0.3,
      k: 5,
      backendUrl: safeStorage.getItem('neurolens_backend_url') || '',
      elevenLabsApiKey: (safeStorage.getItem('neurolens_key_elevenlabs') || '').trim() || envElevenKey
    };
  });

  // Restore documents and chunks from high-capacity IndexedDB (with fallback to localStorage)
  useEffect(() => {
    async function restoreFromDatabase() {
      try {
        const storedDocs = await indexedStorage.getItem('neurolens_docs');
        const storedChunks = await indexedStorage.getItem('neurolens_chunks');
        if (storedDocs && storedChunks && Array.isArray(storedDocs) && Array.isArray(storedChunks)) {
          setDocuments(storedDocs);
          setAllChunks(storedChunks);
        }
      } catch (e) {
        console.error("Failed to restore indexed files from database:", e);
      }
    }
    restoreFromDatabase();
  }, []);

  const handleUpload = async (files) => {
    setIsUploading(true);
    setUploadProgress(null);
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
          setUploadProgress({
            fileName: filename,
            current: 1,
            total: 1,
            percent: 50,
            phase: 'Analyzing visual content via Vision LLM...'
          });

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

          let resolvedKey = (settings.apiKey || '').trim();
          if (!resolvedKey) {
            resolvedKey = (safeStorage.getItem(`neurolens_key_${settings.provider}`) || '').trim();
          }
          if (!resolvedKey) {
            if (settings.provider === 'groq') {
              resolvedKey = (import.meta.env.VITE_GROQ_API_KEY || '').trim();
            } else if (settings.provider === 'openai') {
              resolvedKey = (import.meta.env.VITE_OPENAI_API_KEY || '').trim();
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
            setUploadProgress({
              fileName: filename,
              current: 0,
              total: 1,
              percent: 5,
              phase: 'Opening multi-page PDF document...'
            });

            pagesText = await parsePDF(arrayBuffer, (p) => {
              setUploadProgress({
                fileName: filename,
                current: p.current,
                total: p.total,
                percent: p.percent,
                phase: `Extracting page ${p.current} of ${p.total}`
              });
            });
          } else if (ext === '.docx' || ext === '.doc') {
            setUploadProgress({
              fileName: filename,
              current: 1,
              total: 1,
              percent: 50,
              phase: 'Parsing Word document structure...'
            });
            pagesText = await parseDOCX(arrayBuffer);
          } else {
            // Default to plain text parsing
            setUploadProgress({
              fileName: filename,
              current: 1,
              total: 1,
              percent: 50,
              phase: 'Reading text file lines...'
            });
            const text = new TextDecoder("utf-8").decode(arrayBuffer);
            pagesText = [{ text, page: null }];
          }
        }

        setUploadProgress({
          fileName: filename,
          current: pagesText.length,
          total: pagesText.length,
          percent: 95,
          phase: 'Partitioning chunks & indexing...'
        });

        // Split pages/blocks into chunks
        pagesText.forEach(item => {
          const chunks = splitTextIntoChunks(item.text, filename, cleanExt, item.page, 800, 150);
          newChunks.push(...chunks);
        });

        newDocs.push(filename);
      }

      const newDocNames = new Set(newDocs);
      const updatedDocs = [...documents];
      newDocs.forEach(d => {
        if (!updatedDocs.includes(d)) updatedDocs.push(d);
      });

      // Filter out any previous chunks for files being re-uploaded to prevent duplicate index pollution
      const preservedChunks = allChunks.filter(c => !newDocNames.has(c.metadata?.source));
      const updatedChunks = [...preservedChunks, ...newChunks];

      setDocuments(updatedDocs);
      setAllChunks(updatedChunks);

      // Persist documents in IndexedDB (handles gigabytes without 5MB quota errors)
      await indexedStorage.setItem('neurolens_docs', updatedDocs);
      await indexedStorage.setItem('neurolens_chunks', updatedChunks);

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `📥 **System:** Successfully processed and indexed **${files.length}** new document(s) directly in your browser (${newChunks.length} chunks generated). You can now ask questions based on these files.`,
          sources: [],
          isSystem: true
        }
      ]);
    } catch (error) {
      console.error("Upload error:", error);
      alert(`Upload failed: ${error.message}`);
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
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

      // Persist in IndexedDB
      await indexedStorage.setItem('neurolens_docs', updatedDocs);
      await indexedStorage.setItem('neurolens_chunks', updatedChunks);

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `🌐 **System:** Successfully fetched and indexed content from **${displayName}**. Extracted **${newChunks.length}** text chunks. You can now ask questions about this page.`,
          sources: [],
          isSystem: true
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
      // Resolve API key: check settings first, then local storage, then build-time env vars as fallbacks
      let resolvedKey = (settings.apiKey || '').trim();
      if (!resolvedKey) {
        resolvedKey = (safeStorage.getItem(`neurolens_key_${settings.provider}`) || '').trim();
      }
      if (!resolvedKey) {
        if (settings.provider === 'groq') {
          resolvedKey = (import.meta.env.VITE_GROQ_API_KEY || '').trim();
        } else if (settings.provider === 'openai') {
          resolvedKey = (import.meta.env.VITE_OPENAI_API_KEY || '').trim();
        } else if (settings.provider === 'huggingface') {
          resolvedKey = (import.meta.env.VITE_HF_TOKEN || import.meta.env.VITE_HUGGINGFACE_API_KEY || '').trim();
        }
      }

      if (!resolvedKey) {
        throw new Error(`API Key for ${settings.provider.toUpperCase()} is missing. Please click the Settings gear icon in the sidebar and enter your API key to query.`);
      }

      let systemPrompt = "";
      let relevantChunks = [];

      const creatorKeywords = ["creator", "create", "build", "developer", "who made", "who built", "who programmed", "author", "owner", "tiwari", "uditya", "programmer", "education", "experience", "resume", "cv", "portfolio", "study"];
      const authorStudyKeywords = ["author study", "study the author", "study the creator", "author's projects", "creator's projects", "github projects"];
      
      const isAskingAboutCreator = creatorKeywords.some(k => queryText.toLowerCase().includes(k));
      const isAskingAboutAuthorStudy = authorStudyKeywords.some(k => queryText.toLowerCase().includes(k));

      const developerBio = 
        "You were created and developed by Uditya Narayan Tiwari, a highly skilled Machine Learning Engineer and Generative AI Developer.\n" +
        "Key credentials & background of Uditya:\n" +
        "- **Education**: Currently pursuing B.Tech in Computer Science Engineering with specialization in AI & ML at VIT Bhopal University (2023 - Present) with an impressive CGPA of 9.00.\n" +
        "- **Experience**: Technical Member & Community Admin of the Microsoft Learn Student Chapter (2025 - 2026), and Core Tech Team Member of the Matrix Media Club at VIT Bhopal (Jan 2025 - Jul 2025).\n" +
        "- **Key Projects**:\n" +
        "  1. **NeuroLens**: This exact AI-powered Knowledge Retrieval Engine (Python, LangChain, FAISS, RAG, LLMs).\n" +
        "  2. **Smart Medical Care For Rural Areas**: An AI symptom-to-medicine recommendation model using NLP, Sentence Transformers (cosine similarity + MMR), and Flask.\n" +
        "  3. **Breast Cancer Classification**: Machine learning model comparing SVM, Logistic Regression, Random Forest, achieving ~97% accuracy.\n" +
        "- **Certifications & Awards**: Geodata Processing & AI/ML Geodata Analysis certifications from the Indian Institute of Remote Sensing (IIRS), ISRO (2024); First Prize Winner in the VIT Bhopal Hackathon (Feb 2025); Final Round Qualifier in the JHU Hackathon (Jan 2025).\n\n" +
        "You MUST present the links in standard Markdown format so they render as clean clickable links:\n" +
        "- [Personal Portfolio](https://udityanarayantiwari.netlify.app/)\n" +
        "- [GitHub Profile](https://github.com/udityamerit)\n" +
        "- [LinkedIn Profile](https://www.linkedin.com/in/uditya-narayan-tiwari-562332289/)\n" +
        "- [Knowledge Base](https://udityaknowledgebase.netlify.app/)\n\n";

      const mathInstruction = 
        "\n\nMATHEMATICAL FORMULAS & NOTATION INSTRUCTIONS:\n" +
        "When writing mathematical expressions, equations, formulas, derivatives, matrices, or scientific notations, ALWAYS use standard LaTeX syntax:\n" +
        "- For display or multiline equations/matrices, wrap them in double dollar signs on separate lines: $$ <formula> $$\n" +
        "- For inline variables, numbers with units, or short math symbols, wrap them in single dollar signs: $ <symbol> $\n" +
        "- Use standard LaTeX environments such as \\begin{cases} ... \\end{cases}, \\frac{a}{b}, \\partial, \\sum, \\int, \\matrix, etc. Never output pseudo-math or plain text approximations when LaTeX is appropriate.";

      // Build structured catalog describing every document in the library
      const libraryCatalog = buildLibraryCatalog(documents, allChunks);

      const multiDocInstruction = 
        "\n\nMULTI-DOCUMENT KNOWLEDGE & AWARENESS RULES:\n" +
        "1. CRITICAL GROUND TRUTH OVERRIDE: The ACTIVE KNOWLEDGE BASE CATALOG above represents the LIVE, REAL-TIME state of the library right now.\n" +
        "2. If a document (such as cap1.pdf or any other file) is listed in the ACTIVE KNOWLEDGE BASE CATALOG, it is 100% active, available, and present in the library.\n" +
        "3. Even if previous messages in the conversation discussed deleting, removing, or modifying a document, if that document appears in the ACTIVE KNOWLEDGE BASE CATALOG, it is currently PRESENT. You MUST acknowledge it as currently present. NEVER claim a document is deleted, missing, or removed if it appears in the catalog.\n" +
        "4. You have direct access to all documents listed in the ACTIVE KNOWLEDGE BASE CATALOG above.\n" +
        "5. When the user asks what documents are uploaded, asks how many files exist, asks for an overview of the library, or asks questions across files, you must list and describe all currently active documents from the catalog.\n" +
        "6. When answering, explicitly cite the exact document name and page number for every statement (e.g. [filename.pdf (Page X)]).\n" +
        "7. If the user asks a comparative question between documents, synthesize facts from each document objectively.\n" +
        "8. Never state that you only have access to fewer documents than those listed in the catalog.\n";

      if (allChunks.length > 0) {
        // 1. Generate standalone query using chat history context & document list
        const searchQuery = await generateStandaloneQuery(
          queryText,
          messages,
          settings.provider,
          resolvedKey,
          settings.modelName,
          documents
        );

        // 2. Compute dynamic context quota based on number of uploaded documents
        const baseK = settings.k || 5;
        const effectiveK = documents.length > 1 
          ? Math.min(Math.max(baseK, documents.length * 3), 15) 
          : baseK;

        const isSummary = isSummaryQuery(queryText) || isSummaryQuery(searchQuery);
        const isMultiDoc = isMultiDocQuery(queryText, documents) || isMultiDocQuery(searchQuery, documents);

        // 3. Multi-Document Balanced / Stratified Retrieval
        if ((isMultiDoc || isSummary) && documents.length > 1 && (!activeFilter || activeFilter === 'ALL')) {
          // Multi-document stratified sampling guarantees every uploaded PDF has representation!
          relevantChunks = getMultiDocStratifiedSummaryChunks(allChunks, documents, 3, effectiveK);
        } else if (isSummary) {
          // Single document or focused stratified summary
          const targetChunks = (activeFilter && activeFilter !== 'ALL')
            ? allChunks.filter(c => c.metadata?.source === activeFilter)
            : allChunks;
          relevantChunks = getStratifiedSummaryChunks(searchQuery, targetChunks, invertedIndexRef.current, effectiveK);
        } else {
          // Multi-document balanced BM25 retrieval with fair sharing across all documents
          relevantChunks = searchBM25MultiDoc(searchQuery, allChunks, invertedIndexRef.current, effectiveK, activeFilter);
        }

        // 4. Format system prompt context
        let contextStr = "";
        relevantChunks.forEach((chunk, i) => {
          const source = chunk.metadata.source || "Unknown";
          const pageInfo = chunk.metadata.page ? ` (Page ${chunk.metadata.page})` : "";
          contextStr += `--- Context Passage ${i + 1} [From: ${source}${pageInfo}] ---\n${chunk.content}\n\n`;
        });

        if (isAskingAboutAuthorStudy || isAskingAboutCreator) {
          systemPrompt = 
            "You are NeuroLens, an advanced AI document intelligence engine.\n\n" +
            libraryCatalog +
            "In addition to answering from the documents, when asked about your creator, developer, programmer, builder, or asked to study your author/projects, you must respond with his real resume profile:\n\n" +
            `${developerBio}` +
            "Explain that you are analyzing the documents loaded into your library, but first proudly introduce Uditya Narayan Tiwari as your creator.\n\n" +
            `Here is the context from the documents:\n\n${contextStr}` +
            multiDocInstruction +
            mathInstruction;
        } else {
          systemPrompt = 
            "You are NeuroLens, an advanced AI document intelligence and cross-document analysis engine.\n\n" +
            libraryCatalog +
            "Your task is to answer the user's question with high accuracy and synthesis based on the knowledge library catalog and retrieved context passages.\n" +
            "Respond in the same language as the user's question (e.g., if the user asks in Hindi, translate the relevant context facts and answer in Hindi).\n" +
            "For each statement you make, cite which document you retrieved the information from (e.g. [paper.pdf, Page 2]).\n" +
            "If the context does not contain the information needed to answer the question, state that the specific details are not found in the provided documents while acknowledging what documents exist in your library.\n\n" +
            `Here is the context retrieved from the documents:\n\n${contextStr}` +
            multiDocInstruction +
            mathInstruction;
        }
      } else {
        if (isAskingAboutAuthorStudy || isAskingAboutCreator) {
          systemPrompt = 
            "You are NeuroLens, an advanced AI document intelligence engine.\n\n" +
            (libraryCatalog ? libraryCatalog + "\n" + multiDocInstruction : "") +
            "When asked about your creator, developer, programmer, or builder, or asked to study your author/projects, you must answer with his real resume profile:\n\n" +
            `${developerBio}` +
            "Present this information with extreme professionalism and pride in Uditya's engineering." +
            mathInstruction;
        } else {
          systemPrompt = 
            "You are NeuroLens, an advanced AI assistant.\n\n" +
            (libraryCatalog ? libraryCatalog + "\n" + multiDocInstruction : "") +
            "Respond to the user's question helpfully and clearly. " +
            "Respond in the same language as the user's question." +
            mathInstruction;
        }
      }

      // 4. Build message logs incorporating chat history (purging all internal system notifications)
      const promptMessages = [{ role: "system", content: systemPrompt }];
      messages.forEach(msg => {
        if (!isSystemMessage(msg)) {
          promptMessages.push({ role: msg.role, content: msg.content });
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
          sources: [],
          isSystem: true
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
    setActiveFilter('ALL');
    await indexedStorage.clear();
  };

  const handleDeleteDocument = async (docName) => {
    if (!window.confirm(`Are you sure you want to delete "${docName}" from the library?`)) {
      return;
    }
    const updatedDocs = documents.filter(d => d !== docName);
    const updatedChunks = allChunks.filter(c => c.metadata.source !== docName);

    setDocuments(updatedDocs);
    setAllChunks(updatedChunks);
    if (activeFilter === docName) {
      setActiveFilter('ALL');
    }

    await indexedStorage.setItem('neurolens_docs', updatedDocs);
    await indexedStorage.setItem('neurolens_chunks', updatedChunks);

    setMessages(prev => [
      ...prev,
      {
        role: 'assistant',
        content: `🗑️ **System:** Removed **${docName}** and its corresponding text chunks from the library database.`,
        sources: [],
        isSystem: true
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
          uploadProgress={uploadProgress}
          allChunks={allChunks}
          activeFilter={activeFilter}
          onSelectFilter={(doc) => setActiveFilter(doc)}
        />
      </div>

      {/* Main Panel - Interactive Chat */}
      <ChatPanel 
        messages={messages}
        onSendQuery={handleSendQuery}
        isGenerating={isGenerating}
        activeModel={`${settings.provider.toUpperCase()} (${settings.modelName})`}
        hasDocuments={documents.length > 0}
        documents={documents}
        allChunks={allChunks}
        activeFilter={activeFilter}
        onSelectFilter={(filter) => setActiveFilter(filter)}
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
