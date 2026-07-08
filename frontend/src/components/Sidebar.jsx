import { useState, useRef } from 'react';
import Logo from './Logo';

export default function Sidebar({ documents, onUpload, onFetchUrl, onOpenSettings, onOpenCamera, onPreviewDocument, onDeleteDocument, isUploading, isFetchingUrl }) {
  const [isDragActive, setIsDragActive] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const fileInputRef = useRef(null);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onUpload(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      onUpload(e.target.files);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current.click();
  };

  const handleUrlSubmit = (e) => {
    e.preventDefault();
    const url = urlInput.trim();
    if (!url) return;
    
    // Basic URL validation
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.includes('.')) {
      alert('Please enter a valid URL (e.g., https://example.com)');
      return;
    }

    const fullUrl = (!url.startsWith('http://') && !url.startsWith('https://')) ? `https://${url}` : url;
    onFetchUrl(fullUrl);
    setUrlInput('');
  };

  const getFileIcon = (filename) => {
    // Check if this is a URL source (starts with globe emoji)
    if (filename.startsWith('🌐')) {
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      );
    }

    const ext = filename.split('.').pop().toLowerCase();
    if (ext === 'pdf') {
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      );
    } else if (ext === 'docx' || ext === 'doc') {
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <line x1="10" y1="9" x2="8" y2="9" />
        </svg>
      );
    } else if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      );
    } else {
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00f5d4" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      );
    }
  };

  return (
    <div className="glass-panel" style={styles.sidebar}>
      {/* Brand & Logo */}
      <div style={styles.logoContainer}>
        <Logo size={42} />
      </div>

      {/* Upload Zone */}
      <div 
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        onClick={triggerFileInput}
        className={`animate-pulse-glow ${isDragActive ? 'glow-cyan' : ''}`}
        style={{
          ...styles.uploadZone,
          borderColor: isDragActive ? 'var(--color-secondary)' : isUploading ? 'var(--color-primary-glow)' : 'var(--border-light)',
          background: isDragActive ? 'rgba(0, 245, 212, 0.05)' : isUploading ? 'rgba(157, 78, 221, 0.03)' : 'rgba(255, 255, 255, 0.01)'
        }}
      >
        <input 
          ref={fileInputRef}
          type="file" 
          multiple
          accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp,.gif"
          onChange={handleFileChange}
          style={{ display: 'none' }}
          onClick={(e) => e.stopPropagation()}
        />
        
        {isUploading ? (
          <div style={styles.uploadInner}>
            <div style={styles.spinner} className="animate-spin" />
            <p style={styles.uploadText}>Analyzing & indexing source...</p>
            <p style={styles.uploadSubtext}>Running Vision LLM / extracting facts</p>
          </div>
        ) : (
          <div style={styles.uploadInner}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-secondary)" strokeWidth="2" style={{ marginBottom: '8px' }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p style={styles.uploadText}>Drag & Drop documents</p>
            <p style={styles.uploadSubtext}>Supports PDF, DOCX, TXT, Images</p>
          </div>
        )}
      </div>

      {/* Camera Button Container */}
      <div style={styles.uploadButtonsRow}>
        <button 
          onClick={onOpenCamera} 
          style={styles.cameraSubBtn}
          disabled={isUploading}
          className="sidebar-camera-btn"
          title="Scan Document with Camera"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: '6px' }}>
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          Use Camera
        </button>
      </div>

      {/* URL Fetch Section */}
      <form onSubmit={handleUrlSubmit} style={styles.urlSection}>
        <div style={styles.urlHeader}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          <span style={styles.urlLabel}>Add from URL</span>
        </div>
        <div style={styles.urlInputRow}>
          <input
            type="text"
            placeholder="Paste a webpage URL..."
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            disabled={isFetchingUrl}
            style={styles.urlInput}
          />
          <button
            type="submit"
            disabled={isFetchingUrl || !urlInput.trim()}
            style={{
              ...styles.urlFetchBtn,
              opacity: (isFetchingUrl || !urlInput.trim()) ? 0.4 : 1,
              cursor: (isFetchingUrl || !urlInput.trim()) ? 'not-allowed' : 'pointer'
            }}
          >
            {isFetchingUrl ? (
              <div style={styles.urlSpinner} className="animate-spin" />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                <polyline points="22 4 12 12 9 9" />
              </svg>
            )}
          </button>
        </div>
        {isFetchingUrl && (
          <p style={styles.urlFetchingText} className="animate-fade-in">
            Fetching & parsing web content...
          </p>
        )}
      </form>

      {/* Document Registry List */}
      <div style={styles.docsSection}>
        <div style={styles.sectionHeader}>
          <h3 style={styles.sectionTitle}>Knowledge Library</h3>
          <span style={styles.badge}>{documents.length} files</span>
        </div>

        <div style={styles.docList}>
          {documents.length === 0 ? (
            <div style={styles.emptyState}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2" style={{ marginBottom: '8px' }}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Library is empty</p>
            </div>
          ) : (
            documents.map((doc, idx) => (
              <div 
                key={idx} 
                onClick={() => onPreviewDocument(doc)}
                className="animate-fade-in doc-card-item"
                style={{
                  ...styles.docCard,
                  animationDelay: `${idx * 0.05}s`,
                  cursor: 'pointer'
                }}
              >
                <div style={styles.docIcon}>
                  {getFileIcon(doc)}
                </div>
                <div style={styles.docInfo}>
                  <p style={styles.docName} title={doc}>{doc}</p>
                  <div style={styles.docStatusRow}>
                    <span style={{
                      ...styles.statusDot,
                      background: doc.startsWith('🌐') ? '#38bdf8' : 'var(--color-secondary)',
                      boxShadow: doc.startsWith('🌐') ? '0 0 6px #38bdf8' : '0 0 6px var(--color-secondary)'
                    }} />
                    <span style={styles.statusText}>{doc.startsWith('🌐') ? 'URL Indexed' : 'Indexed'}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteDocument(doc);
                  }}
                  className="doc-delete-btn"
                  style={styles.deleteDocBtn}
                  title="Remove this source"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Bottom Controls */}
      <div style={styles.bottomSection}>
        <div style={styles.controlsRow}>
          {/* Groq Free API Banner */}
          <div
            style={styles.groqBannerCompact}
            className="groq-free-banner"
          >
            <div style={styles.groqBannerInner}>
              <div style={styles.groqBadgeRow}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
                <span style={styles.groqBannerTitleCompact}>Groq API</span>
                <span style={styles.freeBadgeCompact}>FREE</span>
              </div>
              <span style={styles.groqBannerSubCompact}>Free model execution</span>
            </div>
          </div>

          <button 
            onClick={onOpenSettings} 
            className="sidebar-settings-icon-btn"
            style={styles.settingsIconBtn}
            title="Open LLM & System Settings"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  sidebar: {
    width: '100%',
    height: '100%',
    background: 'var(--bg-sidebar)',
    borderRight: '1px solid var(--border-light)',
    display: 'flex',
    flexDirection: 'column',
    padding: '24px 16px',
    borderRadius: '0',
    flexShrink: 0
  },
  logoContainer: {
    marginBottom: '28px',
    paddingLeft: '8px'
  },
  uploadZone: {
    border: '2px dashed',
    borderRadius: '12px',
    padding: '24px 12px',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    marginBottom: '12px'
  },
  uploadInner: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center'
  },
  uploadText: {
    fontFamily: 'var(--font-heading)',
    fontSize: '13px',
    fontWeight: '600',
    color: '#e2e8f0',
    marginBottom: '4px'
  },
  uploadSubtext: {
    fontSize: '11px',
    color: 'var(--text-muted)'
  },
  // URL Section styles
  urlSection: {
    marginBottom: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  urlHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    paddingLeft: '2px'
  },
  urlLabel: {
    fontFamily: 'var(--font-heading)',
    fontSize: '12px',
    fontWeight: '600',
    color: '#38bdf8',
    letterSpacing: '0.3px'
  },
  urlInputRow: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center'
  },
  urlInput: {
    flex: 1,
    padding: '10px 12px',
    borderRadius: '8px',
    background: 'rgba(2, 3, 9, 0.5)',
    border: '1px solid rgba(56, 189, 248, 0.15)',
    color: '#ffffff',
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
    outline: 'none',
    transition: 'border-color 0.2s, box-shadow 0.2s',
    width: '100%',
    minWidth: 0
  },
  urlFetchBtn: {
    padding: '10px 12px',
    borderRadius: '8px',
    background: 'rgba(56, 189, 248, 0.12)',
    border: '1px solid rgba(56, 189, 248, 0.25)',
    color: '#38bdf8',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s',
    flexShrink: 0
  },
  urlSpinner: {
    width: '14px',
    height: '14px',
    border: '2px solid rgba(56, 189, 248, 0.2)',
    borderTopColor: '#38bdf8',
    borderRadius: '50%'
  },
  urlFetchingText: {
    fontSize: '10px',
    color: '#38bdf8',
    fontStyle: 'italic',
    paddingLeft: '2px',
    margin: 0
  },
  // Documents section
  docsSection: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    marginBottom: '16px'
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
    paddingHorizontal: '8px'
  },
  sectionTitle: {
    fontFamily: 'var(--font-heading)',
    fontSize: '14px',
    fontWeight: '600',
    color: '#e2e8f0',
    letterSpacing: '0.5px'
  },
  badge: {
    fontSize: '10px',
    fontWeight: '700',
    color: 'var(--color-secondary)',
    background: 'rgba(0, 245, 212, 0.08)',
    border: '1px solid rgba(0, 245, 212, 0.15)',
    padding: '2px 8px',
    borderRadius: '20px'
  },
  docList: {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    paddingRight: '4px'
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    border: '1px solid rgba(255,255,255,0.03)',
    borderRadius: '12px',
    background: 'rgba(255,255,255,0.01)',
    padding: '24px 0'
  },
  docCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    background: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid rgba(255, 255, 255, 0.04)',
    borderRadius: '8px',
    padding: '10px 12px',
    transition: 'all 0.2s'
  },
  deleteDocBtn: {
    background: 'transparent',
    border: 'none',
    color: '#94a3b8',
    cursor: 'pointer',
    padding: '6px',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s',
    opacity: 0,
    flexShrink: 0
  },
  docIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  docInfo: {
    flex: 1,
    overflow: 'hidden'
  },
  docName: {
    fontSize: '12px',
    fontWeight: '500',
    color: '#e2e8f0',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  docStatusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    marginTop: '2px'
  },
  statusDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: 'var(--color-secondary)',
    boxShadow: '0 0 6px var(--color-secondary)'
  },
  statusText: {
    fontSize: '9px',
    color: 'var(--text-muted)'
  },
  // Groq Banner
  groqBannerCompact: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    background: 'rgba(34, 197, 94, 0.04)',
    border: '1px solid rgba(34, 197, 94, 0.15)',
    borderRadius: '10px',
    padding: '8px 12px',
    minWidth: 0
  },
  groqBannerInner: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    width: '100%',
    minWidth: 0
  },
  groqBadgeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    width: '100%'
  },
  groqBannerTitleCompact: {
    fontFamily: 'var(--font-heading)',
    fontSize: '11px',
    fontWeight: '700',
    color: '#e2e8f0',
    letterSpacing: '0.3px',
    whiteSpace: 'nowrap'
  },
  freeBadgeCompact: {
    fontSize: '8px',
    fontWeight: '800',
    color: '#22c55e',
    background: 'rgba(34, 197, 94, 0.15)',
    border: '1px solid rgba(34, 197, 94, 0.3)',
    padding: '1px 5px',
    borderRadius: '3px',
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
    boxShadow: '0 0 6px rgba(34, 197, 94, 0.15)',
    marginLeft: 'auto'
  },
  groqBannerSubCompact: {
    fontSize: '9px',
    color: '#4ade80',
    opacity: 0.8,
    marginTop: '0px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  // Bottom section
  bottomSection: {
    borderTop: '1px solid rgba(255, 255, 255, 0.06)',
    paddingTop: '16px',
    display: 'flex',
    flexDirection: 'column'
  },
  controlsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    width: '100%'
  },
  settingsIconBtn: {
    width: '40px',
    height: '40px',
    borderRadius: '10px',
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    color: '#cbd5e1',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s',
    flexShrink: 0
  },
  spinner: {
    width: '24px',
    height: '24px',
    border: '2px solid rgba(0, 245, 212, 0.15)',
    borderTopColor: 'var(--color-secondary)',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginBottom: '8px'
  },
  uploadButtonsRow: {
    display: 'flex',
    gap: '8px',
    marginBottom: '16px',
    width: '100%'
  },
  uploadSubBtn: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '10px 8px',
    borderRadius: '8px',
    background: 'rgba(157, 78, 221, 0.06)',
    border: '1px solid rgba(157, 78, 221, 0.2)',
    color: '#c084fc',
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.25s ease'
  },
  cameraSubBtn: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '10px 8px',
    borderRadius: '8px',
    background: 'rgba(0, 245, 212, 0.06)',
    border: '1px solid rgba(0, 245, 212, 0.2)',
    color: 'var(--color-secondary)',
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.25s ease'
  }
};
