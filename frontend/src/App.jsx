import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatPanel from './components/ChatPanel';
import SettingsModal from './components/SettingsModal';
import AuthorModal from './components/AuthorModal';

export default function App() {
  const [documents, setDocuments] = useState([]);
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
      k: 5,
      apiBase: localStorage.getItem('neurolens_api_base') || import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000'
    };
  });

  // Fetch already uploaded files on load or when backend API base changes
  useEffect(() => {
    fetchDocuments();
  }, [settings.apiBase]);

  const fetchDocuments = async () => {
    try {
      const response = await fetch(`${settings.apiBase}/api/documents`);
      if (response.ok) {
        const data = await response.json();
        setDocuments(data.documents || []);
      }
    } catch (error) {
      console.error("Error fetching documents:", error);
    }
  };

  const handleUpload = async (files) => {
    setIsUploading(true);
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append("files", files[i]);
    }

    try {
      const response = await fetch(`${settings.apiBase}/api/upload`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || "Upload failed");
      }

      const data = await response.json();
      setDocuments(data.documents || []);
      
      // Add a system announcement to chat indicating successful document load
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `📥 **System:** Successfully processed and indexed **${files.length}** new document(s) in the FAISS vector database. You can now ask questions based on these files.`,
          sources: []
        }
      ]);

    } catch (error) {
      console.error("Upload error:", error);
      if (error.message.includes('Failed to fetch') && window.location.protocol === 'https:' && settings.apiBase.startsWith('http:')) {
        alert(`Upload failed: Failed to fetch.\n\nThis is likely a Mixed Content security issue because you are running the frontend on HTTPS (github.io) but trying to connect to a local HTTP backend (${settings.apiBase}).\n\nTo resolve this:\n1. Run the frontend locally (e.g. via run.bat or npm run dev) so both frontend and backend are HTTP.\n2. Or use an HTTPS tunnel (e.g. ngrok) for your local backend and configure the secure URL in Settings.`);
      } else {
        alert(`Upload failed: ${error.message}`);
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleSendQuery = async (queryText) => {
    // 1. Add user query to chat feed
    const userMessage = { role: 'user', content: queryText };
    setMessages(prev => [...prev, userMessage]);
    setIsGenerating(true);

    try {
      // 2. Query RAG backend
      const response = await fetch(`${settings.apiBase}/api/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: queryText,
          history: messages,
          provider: settings.provider,
          apiKey: settings.apiKey,
          modelName: settings.modelName,
          temperature: settings.temperature,
          k: settings.k
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || "Query failed");
      }

      const data = await response.json();
      
      // 3. Add assistant response to chat feed
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: data.answer,
          sources: data.sources || []
        }
      ]);

    } catch (error) {
      console.error("Query error:", error);
      let errMsg = `❌ **Error running query:** ${error.message}\n\nPlease check your internet connection or verify your API keys in settings.`;
      if (error.message.includes('Failed to fetch') && window.location.protocol === 'https:' && settings.apiBase.startsWith('http:')) {
        errMsg += `\n\n*Note: This is likely a Mixed Content security block because this site is hosted on HTTPS, but your backend API URL is configured to HTTP (${settings.apiBase}). Run the frontend locally (http://localhost:5173) or configure an HTTPS backend URL in Settings.*`;
      }
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: errMsg,
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

    try {
      const response = await fetch(`${settings.apiBase}/api/clear`, {
        method: "POST"
      });
      
      if (response.ok) {
        setDocuments([]);
        setMessages([]);
        alert("Database cleared successfully.");
      }
    } catch (error) {
      console.error("Error clearing index:", error);
      alert(`Failed to clear database: ${error.message}`);
    }
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
