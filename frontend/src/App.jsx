import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatPanel from './components/ChatPanel';
import SettingsModal from './components/SettingsModal';
import AuthorModal from './components/AuthorModal';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000';

export default function App() {
  const [documents, setDocuments] = useState([]);
  const [messages, setMessages] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAuthorOpen, setIsAuthorOpen] = useState(false);
  
  // Initialize settings with fallback defaults and locally stored API keys
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

  // Fetch already uploaded files on load
  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/documents`);
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
      const response = await fetch(`${API_BASE}/api/upload`, {
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
      alert(`Upload failed: ${error.message}`);
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
      const response = await fetch(`${API_BASE}/api/query`, {
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

    try {
      const response = await fetch(`${API_BASE}/api/clear`, {
        method: "POST"
      });
      
      if (response.ok) {
        setDocuments([]);
        setMessages([]);
        alert("Database cleared successfully.");
      }
    } catch (error) {
      console.error("Error clearing index:", error);
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
