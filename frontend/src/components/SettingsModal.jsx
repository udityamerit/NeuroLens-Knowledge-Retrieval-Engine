import { useState } from 'react';
import { safeStorage } from '../utils/storage';

const PROVIDERS = {
  groq: {
    name: 'Groq',
    defaultModel: 'qwen/qwen3.8-27b',
    models: [
      { id: 'qwen/qwen3.8-27b', name: 'Qwen 3.8 27B (Latest Multimodal Vision + Text • 131k Context • Free)', tag: 'RECOMMENDED' },
      { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B by OpenAI (Flagship Reasoning • 131k Context • Free)', tag: 'POWERFUL' },
      { id: 'qwen/qwen3.6-27b', name: 'Qwen 3.6 27B (High-Speed Multimodal • 131k Context • Free)', tag: 'FAST' },
      { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B by OpenAI (Fast Reasoning • 131k Context • Free)', tag: 'FAST' },
      { id: 'groq/compound-mini', name: 'Groq Compound Mini (Agentic Multi-Step • 131k Context • Free)', tag: 'REASONING' },
      { id: 'groq/compound', name: 'Groq Compound Full (Advanced Agentic • 131k Context • Free)', tag: 'REASONING' },
      { id: 'allam-2-7b', name: 'ALLaM 2 7B (Bilingual Arabic/English • 131k Context • Free)', tag: 'BILINGUAL' }
    ]
  },
  openai: {
    name: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    models: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Fast & Cost-Efficient)', tag: 'RECOMMENDED' },
      { id: 'gpt-4o', name: 'GPT-4o (Omni Multimodal Flagship)', tag: 'FLAGSHIP' },
      { id: 'o3-mini', name: 'o3-mini (High-Intelligence Reasoning)', tag: 'REASONING' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', tag: 'LEGACY' }
    ]
  },
  openrouter: {
    name: 'OpenRouter',
    defaultModel: 'deepseek/deepseek-chat',
    models: [
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3 (State of the Art • 64k Context)', tag: 'RECOMMENDED' },
      { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1 (Advanced Reasoning • 100% Free)', tag: 'FREE' },
      { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B Instruct (High Capacity • 100% Free)', tag: 'FREE' },
      { id: 'google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash (Next-Gen Multimodal • 100% Free)', tag: 'FREE' },
      { id: 'google/gemini-2.0-flash-thinking-exp:free', name: 'Gemini 2.0 Flash Thinking (Deep Reasoning • 100% Free)', tag: 'FREE' },
      { id: 'meta-llama/llama-3.2-3b-instruct:free', name: 'Llama 3.2 3B Instruct (Ultra-Fast • 100% Free)', tag: 'FREE' },
      { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet (Leading Reasoning & Code)', tag: 'FLAGSHIP' },
      { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku (Fast & Intelligent)', tag: 'FAST' },
      { id: 'openai/gpt-4o', name: 'GPT-4o (Omni Multimodal Flagship)', tag: 'FLAGSHIP' },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini (Fast & Cost Efficient)', tag: 'FAST' },
      { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1 (Flagship Deep Reasoning)', tag: 'REASONING' },
      { id: 'qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B Instruct (Top Open Weights)', tag: 'POWERFUL' },
      { id: 'mistralai/mistral-large-2411', name: 'Mistral Large 2411 (Advanced Reasoning)', tag: 'POWERFUL' }
    ]
  }
};

export default function SettingsModal({ isOpen, onClose, settings, onSave, onOpenAuthor, onClear, hasDocuments }) {
  const envKeys = {
    groq: (import.meta.env.VITE_GROQ_API_KEY || '').trim(),
    openai: (import.meta.env.VITE_OPENAI_API_KEY || '').trim(),
    openrouter: (import.meta.env.VITE_OPENROUTER_API_KEY || import.meta.env.OPENROUTER_API_KEY || '').trim()
  };

  const [provider, setProvider] = useState(() => {
    let p = settings.provider || safeStorage.getItem('neurolens_provider') || 'groq';
    if (p === 'huggingface') return 'openrouter';
    return p;
  });

  // Load API keys stored in localStorage for convenience with fallback to env keys
  const [savedKeys, setSavedKeys] = useState(() => {
    const groqKey = (safeStorage.getItem('neurolens_key_groq') || '').trim() || envKeys.groq;
    const openaiKey = (safeStorage.getItem('neurolens_key_openai') || '').trim() || envKeys.openai;
    const openrouterKey = (safeStorage.getItem('neurolens_key_openrouter') || '').trim() || envKeys.openrouter;
    return { groq: groqKey, openai: openaiKey, openrouter: openrouterKey };
  });

  const [apiKey, setApiKey] = useState(() => {
    const p = (settings.provider === 'huggingface' ? 'openrouter' : (settings.provider || 'groq'));
    const directKey = (settings.apiKey || '').trim();
    const stored = (safeStorage.getItem(`neurolens_key_${p}`) || '').trim();
    const envK = envKeys[p] || '';
    if (directKey && directKey !== envK) return directKey;
    if (stored && stored !== envK) return stored;
    return '';
  });
  
  // Auto-migrate any deprecated model names from previous session cache
  const [modelName, setModelName] = useState(() => {
    const current = settings.modelName || 'qwen/qwen3.8-27b';
    if (!current || current.includes('llama-3.3') || current.includes('llama-3.1') || current.includes('llama-4-scout') || current.includes('mixtral') || current.includes('meta-llama/Llama-3.2-3B') || current.includes('Mistral-7B') || current.includes('DeepSeek-R1-Distill-Qwen-32B')) {
      if (settings.provider === 'openrouter') return 'deepseek/deepseek-chat';
      return 'qwen/qwen3.8-27b';
    }
    return current;
  });

  const [temperature, setTemperature] = useState(settings.temperature || 0.3);
  const [k, setK] = useState(settings.k || 5);
  const [showKey, setShowKey] = useState(false);

  // Dynamic OpenRouter Models state
  const [openRouterModels, setOpenRouterModels] = useState(() => {
    try {
      const cached = safeStorage.getItem('neurolens_openrouter_models');
      if (cached) return JSON.parse(cached);
    } catch (e) {
      // ignore
    }
    return null;
  });
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [isCustomModel, setIsCustomModel] = useState(false);

  // Update the model list and apiKey when provider changes
  const handleProviderChange = (newProvider) => {
    setProvider(newProvider);
    setModelSearch(''); // reset search term when changing provider
    const stored = (safeStorage.getItem(`neurolens_key_${newProvider}`) || '').trim();
    const envK = envKeys[newProvider] || '';
    if (stored && stored !== envK) {
      setApiKey(stored);
    } else {
      setApiKey('');
    }
    
    // Set default model for selected provider if the current modelName doesn't belong to the provider
    const availableModelIds = PROVIDERS[newProvider].models.map(m => typeof m === 'string' ? m : m.id);
    if (!availableModelIds.includes(modelName)) {
      setModelName(PROVIDERS[newProvider].defaultModel);
      setIsCustomModel(false);
    }
  };

  // Keep savedKeys state in sync when apiKey is modified
  const handleKeyChange = (val) => {
    setApiKey(val);
    setSavedKeys(prev => ({ ...prev, [provider]: val }));
  };

  // Fetch live model catalog directly from OpenRouter API
  const handleFetchOpenRouterModels = async () => {
    setIsFetchingModels(true);
    try {
      const res = await fetch("https://openrouter.ai/api/v1/models");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data && Array.isArray(data.data)) {
        const formatted = data.data.map(m => {
          const isFree = m.id.endsWith(':free') || (m.pricing && m.pricing.prompt === '0' && m.pricing.completion === '0');
          let tag = isFree ? 'FREE' : '';
          if (!tag && m.id.includes('r1')) tag = 'REASONING';
          else if (!tag && (m.id.includes('claude-3.5-sonnet') || m.id.includes('gpt-4o'))) tag = 'FLAGSHIP';
          
          return {
            id: m.id,
            name: `${m.name || m.id}${isFree ? ' (100% Free)' : ''}`,
            tag: tag || (isFree ? 'FREE' : undefined),
            contextLength: m.context_length
          };
        });
        
        // Sort: Free models and popular models first
        formatted.sort((a, b) => {
          if (a.tag === 'FREE' && b.tag !== 'FREE') return -1;
          if (b.tag === 'FREE' && a.tag !== 'FREE') return 1;
          return a.name.localeCompare(b.name);
        });

        setOpenRouterModels(formatted);
        safeStorage.setItem('neurolens_openrouter_models', JSON.stringify(formatted));
      }
    } catch (err) {
      console.warn("Could not fetch live OpenRouter models:", err);
      alert("Failed to fetch live models from OpenRouter. Please verify your internet connection. Default curated models remain available.");
    } finally {
      setIsFetchingModels(false);
    }
  };

  const handleSave = () => {
    const customKey = (apiKey || '').trim();
    const effectiveKey = customKey || envKeys[provider] || (safeStorage.getItem(`neurolens_key_${provider}`) || '').trim();
    
    // Save to local storage for convenience
    safeStorage.setItem('neurolens_provider', provider);
    if (customKey) {
      safeStorage.setItem(`neurolens_key_${provider}`, customKey);
    }
    safeStorage.setItem('neurolens_model_name', modelName);
    
    onSave({
      provider,
      apiKey: effectiveKey,
      modelName,
      temperature: parseFloat(temperature),
      k: parseInt(k),
      backendUrl: settings.backendUrl,
      elevenLabsApiKey: settings.elevenLabsApiKey
    });
    onClose();
  };

  // Determine list of displayed models for current provider across ALL providers
  let allProviderModels = PROVIDERS[provider]?.models || [];
  if (provider === 'openrouter' && openRouterModels && openRouterModels.length > 0) {
    // Merge curated models at the beginning, followed by all live models
    const curatedIds = new Set(PROVIDERS.openrouter.models.map(m => m.id));
    const additional = openRouterModels.filter(m => !curatedIds.has(m.id));
    allProviderModels = [...PROVIDERS.openrouter.models, ...additional];
  }

  // Filter with search term across ALL providers
  let displayedModels = allProviderModels;
  if (modelSearch.trim()) {
    const q = modelSearch.trim().toLowerCase();
    displayedModels = allProviderModels.filter(m => {
      const id = typeof m === 'string' ? m : m.id;
      const name = typeof m === 'string' ? m : m.name;
      const tag = typeof m === 'object' && m.tag ? m.tag : '';
      return id.toLowerCase().includes(q) || 
             name.toLowerCase().includes(q) || 
             tag.toLowerCase().includes(q);
    });
  }

  if (!isOpen) return null;

  return (
    <div style={styles.overlay}>
      <div className="glass-panel animate-slide-up" style={styles.modal}>
        
        {/* Header */}
        <div style={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-secondary)" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-heading)', color: 'var(--text-main)' }}>Settings</h2>
          </div>
          <button onClick={onClose} style={styles.closeBtn}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div style={styles.body}>
          
          {/* Provider Selection */}
          <div style={styles.formGroup}>
            <label style={styles.label}>LLM API Provider</label>
            <div style={styles.providerGrid}>
              {Object.entries(PROVIDERS).map(([id, info]) => (
                <button
                  key={id}
                  onClick={() => handleProviderChange(id)}
                  style={{
                    ...styles.providerBtn,
                    borderColor: provider === id ? 'var(--color-primary)' : 'var(--border-light)',
                    background: provider === id ? 'rgba(157, 78, 221, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                    color: provider === id ? '#ffffff' : 'var(--text-muted)',
                    position: 'relative'
                  }}
                >
                  {info.name}
                  {id === 'groq' && (
                    <span style={styles.freeBadge}>FREE</span>
                  )}
                  {id === 'openrouter' && (
                    <span style={{
                      ...styles.freeBadge,
                      color: '#38bdf8',
                      background: 'rgba(56, 189, 248, 0.15)',
                      border: '1px solid rgba(56, 189, 248, 0.35)',
                      boxShadow: '0 0 10px rgba(56, 189, 248, 0.2)'
                    }}>ROUTER</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Masked API Key Input */}
          <div style={styles.formGroup}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={styles.label}>{PROVIDERS[provider].name} API Key</label>
              <span style={{ fontSize: '11px', color: '#22c55e', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
                Protected & Masked
              </span>
            </div>
            <div style={styles.inputContainer}>
              <input
                type={showKey ? 'text' : 'password'}
                placeholder={envKeys[provider] ? '•••••••••••••••••••••••••••••••• (Active via Environment)' : `Enter ${PROVIDERS[provider].name} API Key...`}
                value={apiKey}
                onChange={(e) => handleKeyChange(e.target.value)}
                style={styles.input}
                autoComplete="off"
                spellCheck="false"
              />
              <button 
                type="button" 
                onClick={() => setShowKey(!showKey)} 
                style={styles.toggleShowBtn}
                title={showKey ? "Hide API Key" : "Show API Key"}
              >
                {showKey ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
            <div style={{ marginTop: '7px', fontSize: '11.5px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {provider === 'groq' ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 8px #22c55e' }}></span>
                    <span style={{ color: '#4ade80', fontWeight: '700' }}>Groq Free Tier Active</span>
                    <span style={{ color: '#94a3b8' }}>— 100% free with ultra-low latency.</span>
                  </div>
                  {(apiKey || envKeys.groq) ? (
                    <span style={{ color: '#38bdf8', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                      <span style={{ color: '#94a3b8' }}>API Key Status:</span>
                      <span style={{ color: '#22c55e', fontWeight: '600' }}>Connected & Fully Masked</span>
                      <span style={{ color: '#64748b' }}>• Hidden from public view</span>
                    </span>
                  ) : (
                    <span style={{ color: '#94a3b8' }}>No API key configured. Enter a key above or configure it in .env.</span>
                  )}
                </>
              ) : provider === 'openrouter' ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: '#38bdf8', boxShadow: '0 0 8px #38bdf8' }}></span>
                    <span style={{ color: '#38bdf8', fontWeight: '700' }}>OpenRouter Unified Hub</span>
                    <span style={{ color: '#94a3b8' }}>— Use any model (DeepSeek, Llama, Claude, Gemini).</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '2px', flexWrap: 'wrap', gap: '4px' }}>
                    <span style={{ color: '#94a3b8' }}>
                      {(apiKey || envKeys.openrouter) ? '✓ Key connected & masked' : 'Key format: sk-or-v1-...'}
                    </span>
                    <a 
                      href="https://openrouter.ai/keys" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      style={{ color: '#38bdf8', textDecoration: 'none', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '600' }}
                    >
                      Get OpenRouter API Key
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                        <polyline points="15 3 21 3 21 9"></polyline>
                        <line x1="10" y1="14" x2="21" y2="3"></line>
                      </svg>
                    </a>
                  </div>
                </>
              ) : (
                <span style={{ color: '#94a3b8' }}>
                  {(apiKey || envKeys[provider]) ? '✓ Connected & Masked (Hidden for privacy)' : 'Leaving blank will use the environment fallback key if configured.'}
                </span>
              )}
            </div>
          </div>

          {/* Model Selection */}
          <div style={styles.formGroup}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap', gap: '6px' }}>
              <label style={styles.label}>Model Selection</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {provider === 'openrouter' && (
                  <button
                    type="button"
                    onClick={handleFetchOpenRouterModels}
                    disabled={isFetchingModels}
                    style={{
                      background: 'rgba(56, 189, 248, 0.1)',
                      border: '1px solid rgba(56, 189, 248, 0.3)',
                      borderRadius: '4px',
                      color: '#38bdf8',
                      fontSize: '11px',
                      fontWeight: '600',
                      padding: '2px 8px',
                      cursor: isFetchingModels ? 'wait' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                    title="Fetch all dynamic models available on OpenRouter"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M23 4v6h-6"></path>
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                    </svg>
                    {isFetchingModels ? 'Fetching...' : openRouterModels ? `Live Models (${openRouterModels.length})` : 'Fetch Live Catalog'}
                  </button>
                )}
                <span style={{ fontSize: '11px', color: 'var(--color-primary)', fontWeight: '600' }}>
                  {allProviderModels.length} Models Available
                </span>
              </div>
            </div>

            {/* Universal Search Bar for Models across all providers */}
            <div style={{ position: 'relative', marginBottom: '8px', display: 'flex', alignItems: 'center' }}>
              <div style={{ position: 'absolute', left: '12px', display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
              </div>
              <input
                type="text"
                placeholder={`Search ${PROVIDERS[provider].name} models by name or id (e.g. ${
                  provider === 'groq' ? 'qwen, oss, compound...' :
                  provider === 'openai' ? 'gpt-4o, o3-mini...' :
                  'deepseek, free, claude, gemini...'
                })`}
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (displayedModels.length > 0) {
                      const first = displayedModels[0];
                      const firstId = typeof first === 'string' ? first : first.id;
                      setModelName(firstId);
                      setIsCustomModel(false);
                    } else if (provider === 'openrouter' && modelSearch.trim()) {
                      setModelName(modelSearch.trim());
                      setIsCustomModel(true);
                    }
                  }
                }}
                style={{
                  ...styles.input,
                  padding: '9px 36px 9px 34px',
                  fontSize: '12.5px',
                  borderRadius: '8px'
                }}
              />
              {modelSearch && (
                <button
                  type="button"
                  onClick={() => setModelSearch('')}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    padding: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  title="Clear search"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              )}
            </div>

            {/* Quick-select pills when searching */}
            {modelSearch && displayedModels.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginRight: '2px' }}>
                  Matches ({displayedModels.length}):
                </span>
                {displayedModels.slice(0, 6).map(m => {
                  const id = typeof m === 'string' ? m : m.id;
                  const isSelected = modelName === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setModelName(id);
                        setIsCustomModel(false);
                      }}
                      style={{
                        background: isSelected ? 'rgba(157, 78, 221, 0.3)' : 'rgba(255, 255, 255, 0.05)',
                        border: `1px solid ${isSelected ? 'var(--color-primary)' : 'rgba(255, 255, 255, 0.12)'}`,
                        borderRadius: '6px',
                        color: isSelected ? '#ffffff' : '#94a3b8',
                        fontSize: '11px',
                        padding: '3px 8px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        transition: 'all 0.15s'
                      }}
                      title={id}
                    >
                      <span style={{ maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {id}
                      </span>
                      {isSelected && (
                        <span style={{ color: '#22c55e', fontWeight: 'bold' }}>✓</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* If 0 matches found */}
            {modelSearch && displayedModels.length === 0 && (
              <div style={{
                padding: '10px 14px',
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                borderRadius: '8px',
                fontSize: '12px',
                color: '#fca5a5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '8px'
              }}>
                <span>No models found matching "<strong>{modelSearch}</strong>".</span>
                <button
                  type="button"
                  onClick={() => setModelSearch('')}
                  style={{
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: 'none',
                    borderRadius: '4px',
                    color: '#ffffff',
                    padding: '2px 8px',
                    fontSize: '11px',
                    cursor: 'pointer'
                  }}
                >
                  Reset Filter
                </button>
              </div>
            )}

            <select
              value={isCustomModel ? '__custom__' : modelName}
              onChange={(e) => {
                if (e.target.value === '__custom__') {
                  setIsCustomModel(true);
                } else {
                  setIsCustomModel(false);
                  setModelName(e.target.value);
                }
              }}
              style={styles.select}
            >
              {displayedModels.map(m => {
                const id = typeof m === 'string' ? m : m.id;
                const label = typeof m === 'string' ? m : m.name;
                const tag = m.tag ? ` [${m.tag}]` : '';
                return (
                  <option key={id} value={id} style={styles.option}>
                    {label}{tag}
                  </option>
                );
              })}
              {provider === 'openrouter' && (
                <option value="__custom__" style={styles.option}>
                  ✏️ Enter Custom Model ID...
                </option>
              )}
            </select>

            {/* Custom Model ID text field */}
            {isCustomModel && provider === 'openrouter' && (
              <div style={{ marginTop: '8px' }}>
                <label style={{ ...styles.label, fontSize: '11px', color: '#38bdf8' }}>
                  Custom OpenRouter Model Identifier:
                </label>
                <input
                  type="text"
                  placeholder="e.g. mistralai/mistral-nemo or google/gemini-flash-1.5"
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value.trim())}
                  style={{
                    ...styles.input,
                    marginTop: '4px',
                    padding: '8px 12px',
                    borderColor: '#38bdf8'
                  }}
                />
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Enter any valid model ID listed on <a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer" style={{ color: '#38bdf8' }}>openrouter.ai/models</a>.
                </div>
              </div>
            )}

            {/* Active Model Indicator */}
            {modelName && (
              <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--text-muted)' }}>Selected:</span>
                <code style={{ background: 'rgba(255, 255, 255, 0.05)', padding: '2px 6px', borderRadius: '4px', color: '#c084fc', fontSize: '11px' }}>
                  {modelName}
                </code>
                {modelName.includes(':free') && (
                  <span style={{ color: '#22c55e', fontWeight: '700', fontSize: '10px', background: 'rgba(34, 197, 94, 0.1)', padding: '1px 6px', borderRadius: '4px', border: '1px solid rgba(34, 197, 94, 0.3)' }}>
                    100% FREE (0 CREDITS)
                  </span>
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }} className="responsive-grid">
            {/* Temperature Slider */}
            <div style={styles.formGroup}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <label style={styles.label}>Temperature</label>
                <span style={styles.valueDisplay}>{temperature}</span>
              </div>
              <input
                type="range"
                min="0.0"
                max="1.0"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                style={styles.rangeInput}
              />
              <div style={styles.rangeLabels}>
                <span>Precise</span>
                <span>Creative</span>
              </div>
            </div>

            {/* Chunk Retrieve slider */}
            <div style={styles.formGroup}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <label style={styles.label}>Sources count (K)</label>
                <span style={styles.valueDisplay}>{k} chunks</span>
              </div>
              <input
                type="range"
                min="1"
                max="10"
                step="1"
                value={k}
                onChange={(e) => setK(parseInt(e.target.value))}
                style={styles.rangeInput}
              />
              <div style={styles.rangeLabels}>
                <span>Faster</span>
                <span>More Context</span>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div style={styles.divider} />

          {/* Resources & Utilities */}
          <div style={styles.formGroup}>
            <label style={styles.label}>Resources & Utilities</label>
            <div style={styles.actionGrid}>
              <button 
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAuthor();
                }} 
                style={styles.actionBtnAuthor}
                className="settings-action-btn"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                Author Profile
              </button>

              <a 
                href="https://github.com/udityamerit/NeuroLens-Knowledge-Retrieval-Engine" 
                target="_blank" 
                rel="noopener noreferrer" 
                style={styles.actionBtnRepo}
                className="settings-action-btn"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                GitHub Repo
              </a>

              {hasDocuments && (
                <button 
                  type="button"
                  onClick={onClear} 
                  style={styles.actionBtnClear}
                  className="settings-action-btn"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  Clear Library
                </button>
              )}
            </div>
          </div>

        </div>

        {/* Footer Actions */}
        <div style={styles.footer}>
          <button onClick={onClose} style={styles.cancelBtn}>
            Cancel
          </button>
          <button onClick={handleSave} style={styles.saveBtn}>
            Save Changes
          </button>
        </div>

      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(2, 3, 9, 0.75)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    padding: '20px'
  },
  modal: {
    width: '100%',
    maxWidth: '540px',
    background: '#0d1124',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)'
  },
  header: {
    padding: '18px 24px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 0.2s'
  },
  body: {
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    maxHeight: '70svh',
    overflowY: 'auto'
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  label: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  providerGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '10px'
  },
  providerBtn: {
    padding: '12px 6px',
    borderRadius: '8px',
    border: '1px solid',
    fontFamily: 'var(--font-sans)',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  freeBadge: {
    position: 'absolute',
    top: '-7px',
    right: '-4px',
    fontSize: '8px',
    fontWeight: '800',
    color: '#22c55e',
    background: 'rgba(34, 197, 94, 0.15)',
    border: '1px solid rgba(34, 197, 94, 0.35)',
    padding: '1px 5px',
    borderRadius: '4px',
    letterSpacing: '0.8px',
    textTransform: 'uppercase',
    boxShadow: '0 0 10px rgba(34, 197, 94, 0.2)',
    lineHeight: '1.3'
  },
  inputContainer: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center'
  },
  input: {
    width: '100%',
    padding: '12px 42px 12px 14px',
    borderRadius: '8px',
    background: 'rgba(2, 3, 9, 0.5)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    color: '#ffffff',
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    outline: 'none',
    transition: 'border-color 0.2s, box-shadow 0.2s'
  },
  toggleShowBtn: {
    position: 'absolute',
    right: '12px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  helperText: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    lineHeight: '140%',
    marginTop: '2px'
  },
  select: {
    width: '100%',
    padding: '12px',
    borderRadius: '8px',
    background: 'rgba(2, 3, 9, 0.5)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    color: '#ffffff',
    fontFamily: 'var(--font-sans)',
    fontSize: '14px',
    outline: 'none',
    cursor: 'pointer'
  },
  option: {
    background: '#0d1124',
    color: '#ffffff',
    padding: '8px'
  },
  valueDisplay: {
    fontSize: '13px',
    fontWeight: '600',
    color: 'var(--color-secondary)'
  },
  rangeInput: {
    width: '100%',
    accentColor: 'var(--color-secondary)',
    background: 'rgba(255, 255, 255, 0.1)',
    height: '6px',
    borderRadius: '3px',
    cursor: 'pointer',
    marginTop: '8px'
  },
  rangeLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '11px',
    color: 'var(--text-muted)',
    marginTop: '4px'
  },
  footer: {
    padding: '16px 24px',
    borderTop: '1px solid rgba(255, 255, 255, 0.06)',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px'
  },
  cancelBtn: {
    padding: '10px 18px',
    borderRadius: '8px',
    background: 'transparent',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
    fontWeight: '500',
    fontSize: '14px',
    transition: 'all 0.2s'
  },
  saveBtn: {
    padding: '10px 18px',
    borderRadius: '8px',
    background: 'linear-gradient(135deg, var(--color-primary), #7b2cbf)',
    border: 'none',
    color: '#ffffff',
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
    fontWeight: '600',
    fontSize: '14px',
    boxShadow: '0 4px 12px rgba(157, 78, 221, 0.3)',
    transition: 'all 0.2s'
  },
  divider: {
    height: '1px',
    background: 'rgba(255, 255, 255, 0.06)',
    margin: '8px 0'
  },
  actionGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
    gap: '12px',
    marginTop: '6px'
  },
  actionBtnAuthor: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '10px 14px',
    borderRadius: '8px',
    background: 'rgba(0, 245, 212, 0.05)',
    border: '1px solid rgba(0, 245, 212, 0.2)',
    color: 'var(--color-secondary)',
    fontFamily: 'var(--font-sans)',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  actionBtnRepo: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '10px 14px',
    borderRadius: '8px',
    background: 'rgba(157, 78, 221, 0.05)',
    border: '1px solid rgba(157, 78, 221, 0.2)',
    color: '#c084fc',
    fontFamily: 'var(--font-sans)',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    textDecoration: 'none',
    transition: 'all 0.2s'
  },
  actionBtnClear: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '10px 14px',
    borderRadius: '8px',
    background: 'rgba(239, 68, 68, 0.05)',
    border: '1px solid rgba(239, 68, 68, 0.2)',
    color: '#f87171',
    fontFamily: 'var(--font-sans)',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s'
  }
};
