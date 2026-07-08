import { useState } from 'react';
import { safeStorage } from '../utils/storage';

const PROVIDERS = {
  groq: {
    name: 'Groq',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768']
  },
  openai: {
    name: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo']
  },
  huggingface: {
    name: 'Hugging Face',
    defaultModel: 'meta-llama/Llama-3.2-3B-Instruct',
    models: [
      'meta-llama/Llama-3.2-3B-Instruct',
      'mistralai/Mistral-7B-Instruct-v0.3',
      'microsoft/Phi-3-mini-4k-instruct'
    ]
  }
};

export default function SettingsModal({ isOpen, onClose, settings, onSave, onOpenAuthor, onClear, hasDocuments }) {
  const [provider, setProvider] = useState(settings.provider || 'groq');
  const [apiKey, setApiKey] = useState(settings.apiKey || '');
  const [modelName, setModelName] = useState(settings.modelName || 'llama-3.3-70b-versatile');
  const [temperature, setTemperature] = useState(settings.temperature || 0.3);
  const [k, setK] = useState(settings.k || 5);
  const [showKey, setShowKey] = useState(false);

  // Load API keys stored in localStorage for convenience
  const [savedKeys, setSavedKeys] = useState({
    groq: safeStorage.getItem('neurolens_key_groq') || '',
    openai: safeStorage.getItem('neurolens_key_openai') || '',
    huggingface: safeStorage.getItem('neurolens_key_huggingface') || ''
  });

  // Update the model list and apiKey when provider changes
  const handleProviderChange = (newProvider) => {
    setProvider(newProvider);
    const currentProviderKeys = savedKeys[newProvider] || '';
    setApiKey(currentProviderKeys);
    
    // Set default model for selected provider if the current modelName doesn't belong to the provider
    if (!PROVIDERS[newProvider].models.includes(modelName)) {
      setModelName(PROVIDERS[newProvider].defaultModel);
    }
  };

  // Keep savedKeys state in sync when apiKey is modified
  const handleKeyChange = (val) => {
    setApiKey(val);
    setSavedKeys(prev => ({ ...prev, [provider]: val }));
  };

  const handleSave = () => {
    // Save to local storage for convenience
    safeStorage.setItem(`neurolens_key_${provider}`, apiKey);
    
    onSave({
      provider,
      apiKey,
      modelName,
      temperature: parseFloat(temperature),
      k: parseInt(k),
      backendUrl: settings.backendUrl,
      elevenLabsApiKey: settings.elevenLabsApiKey
    });
    onClose();
  };

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
                    <span style={{
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
                    }}>FREE</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Masked API Key Input */}
          <div style={styles.formGroup}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={styles.label}>{PROVIDERS[provider].name} API Key</label>
              <span style={styles.infoSpan}>Stored locally in browser</span>
            </div>
            <div style={styles.inputContainer}>
              <input
                type={showKey ? 'text' : 'password'}
                placeholder={`Paste your ${PROVIDERS[provider].name} API Key here...`}
                value={apiKey}
                onChange={(e) => handleKeyChange(e.target.value)}
                style={styles.input}
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
            <p style={styles.helperText}>
              {provider === 'groq' ? (
                <>
                  <span style={{ color: '#4ade80', fontWeight: '600' }}>Groq API is free to use — no charges apply.</span>{' '}
                  Leaving this blank will use the environment fallback key.
                </>
              ) : (
                <>Leaving this blank will use the environment fallback key.</>
              )}
            </p>
          </div>

          {/* Model Selection */}
          <div style={styles.formGroup}>
            <label style={styles.label}>Model Selection</label>
            <select
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              style={styles.select}
            >
              {PROVIDERS[provider].models.map(m => (
                <option key={m} value={m} style={styles.option}>
                  {m}
                </option>
              ))}
            </select>
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
    gap: '6px'
  },
  label: {
    fontFamily: 'var(--font-heading)',
    fontSize: '14px',
    fontWeight: '600',
    color: '#e2e8f0',
    letterSpacing: '0.5px'
  },
  infoSpan: {
    fontSize: '11px',
    color: 'var(--color-secondary)',
    opacity: 0.8
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
