import React, { useState, useEffect } from 'react';

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

export default function SettingsModal({ isOpen, onClose, settings, onSave }) {
  const [provider, setProvider] = useState(settings.provider || 'groq');
  const [apiKey, setApiKey] = useState(settings.apiKey || '');
  const [modelName, setModelName] = useState(settings.modelName || 'llama-3.3-70b-versatile');
  const [temperature, setTemperature] = useState(settings.temperature || 0.3);
  const [k, setK] = useState(settings.k || 5);
  const [showKey, setShowKey] = useState(false);

  // Load API keys stored in localStorage for convenience
  const [savedKeys, setSavedKeys] = useState({
    groq: localStorage.getItem('neurolens_key_groq') || '',
    openai: localStorage.getItem('neurolens_key_openai') || '',
    huggingface: localStorage.getItem('neurolens_key_huggingface') || ''
  });

  // Whenever provider changes, update the model list and modelName
  useEffect(() => {
    const currentProviderKeys = savedKeys[provider] || '';
    setApiKey(currentProviderKeys);
    
    // Set default model for selected provider if the current modelName doesn't belong to the provider
    if (!PROVIDERS[provider].models.includes(modelName)) {
      setModelName(PROVIDERS[provider].defaultModel);
    }
  }, [provider]);

  // Keep savedKeys state in sync when apiKey is modified
  const handleKeyChange = (val) => {
    setApiKey(val);
    setSavedKeys(prev => ({ ...prev, [provider]: val }));
  };

  const handleSave = () => {
    // Save to local storage for convenience
    localStorage.setItem(`neurolens_key_${provider}`, apiKey);
    
    onSave({
      provider,
      apiKey,
      modelName,
      temperature: parseFloat(temperature),
      k: parseInt(k)
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
                  onClick={() => setProvider(id)}
                  style={{
                    ...styles.providerBtn,
                    borderColor: provider === id ? 'var(--color-primary)' : 'var(--border-light)',
                    background: provider === id ? 'rgba(157, 78, 221, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                    color: provider === id ? '#ffffff' : 'var(--text-muted)'
                  }}
                >
                  {info.name}
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
              Leaving this blank will prompt the server to check for the `{provider === 'groq' ? 'GROQ_API_KEY' : provider === 'openai' ? 'OPENAI_API_KEY' : 'HF_TOKEN'}` in the project's backend env.
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
  }
};
