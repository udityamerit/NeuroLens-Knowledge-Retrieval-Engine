import React, { useState, useRef } from 'react';
import Logo from './Logo';

export default function Sidebar({ documents, onUpload, onClear, onOpenSettings, onOpenAuthor, isUploading }) {
  const [isDragActive, setIsDragActive] = useState(false);
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

  const getFileIcon = (filename) => {
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
          accept=".pdf,.docx,.txt"
          onChange={handleFileChange}
          style={{ display: 'none' }}
          onClick={(e) => e.stopPropagation()}
        />
        
        {isUploading ? (
          <div style={styles.uploadInner}>
            <div style={styles.spinner} className="animate-spin" />
            <p style={styles.uploadText}>Indexing document...</p>
            <p style={styles.uploadSubtext}>Structuring in FAISS database</p>
          </div>
        ) : (
          <div style={styles.uploadInner}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-secondary)" strokeWidth="2" style={{ marginBottom: '8px' }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p style={styles.uploadText}>Drag & Drop documents</p>
            <p style={styles.uploadSubtext}>Supports PDF, DOCX, TXT</p>
          </div>
        )}
      </div>

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
                className="animate-fade-in"
                style={{
                  ...styles.docCard,
                  animationDelay: `${idx * 0.05}s`
                }}
              >
                <div style={styles.docIcon}>
                  {getFileIcon(doc)}
                </div>
                <div style={styles.docInfo}>
                  <p style={styles.docName} title={doc}>{doc}</p>
                  <div style={styles.docStatusRow}>
                    <span style={styles.statusDot} />
                    <span style={styles.statusText}>Indexed</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Bottom Controls */}
      <div style={styles.bottomSection}>
        <button onClick={onOpenSettings} style={styles.settingsBtn}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          LLM Settings
        </button>

        <button onClick={onOpenAuthor} style={styles.authorBtn}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          Meet the Author
        </button>

        {documents.length > 0 && (
          <button onClick={onClear} style={styles.clearBtn}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            Clear Database
          </button>
        )}
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
    marginBottom: '24px'
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
  bottomSection: {
    borderTop: '1px solid rgba(255, 255, 255, 0.06)',
    paddingTop: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  settingsBtn: {
    width: '100%',
    padding: '12px',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    color: '#e2e8f0',
    fontFamily: 'var(--font-sans)',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    transition: 'all 0.2s'
  },
  authorBtn: {
    width: '100%',
    padding: '12px',
    borderRadius: '8px',
    background: 'rgba(0, 245, 212, 0.05)',
    border: '1px solid rgba(0, 245, 212, 0.2)',
    color: 'var(--color-secondary)',
    fontFamily: 'var(--font-sans)',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    transition: 'all 0.2s'
  },
  clearBtn: {
    width: '100%',
    padding: '10px',
    borderRadius: '8px',
    background: 'transparent',
    border: '1px solid rgba(239, 68, 68, 0.2)',
    color: '#f87171',
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    transition: 'all 0.2s'
  },
  spinner: {
    width: '24px',
    height: '24px',
    border: '2px solid rgba(0, 245, 212, 0.15)',
    borderTopColor: 'var(--color-secondary)',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginBottom: '8px'
  }
};
