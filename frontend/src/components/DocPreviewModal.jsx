import { useState } from 'react';

export default function DocPreviewModal({ isOpen, onClose, docName, chunks = [], imageUrl }) {
  const [activeTab, setActiveTab] = useState('text'); // 'text' or 'image'

  if (!isOpen || !docName) return null;

  // Filter chunks belonging to this document
  const docChunks = chunks.filter(c => c.metadata && c.metadata.source === docName);
  
  // Sort chunks if page numbers are present to ensure logical order
  const sortedChunks = [...docChunks].sort((a, b) => {
    const pageA = a.metadata ? a.metadata.page : null;
    const pageB = b.metadata ? b.metadata.page : null;
    if (pageA !== null && pageB !== null) {
      return pageA - pageB;
    }
    return 0; // maintain original array index order
  });

  const fullText = sortedChunks.map(c => c.content).join('\n\n');
  const wordCount = fullText.split(/\s+/).filter(Boolean).length;
  const charCount = fullText.length;
  const chunkCount = sortedChunks.length;

  // Determine document type
  let docType = 'Text File';
  let isWeb = false;
  let isImage = false;

  if (docName.startsWith('🌐')) {
    docType = 'Webpage';
    isWeb = true;
  } else {
    const ext = docName.split('.').pop().toLowerCase();
    if (ext === 'pdf') docType = 'PDF Document';
    else if (ext === 'docx' || ext === 'doc') docType = 'Word Document';
    else if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
      docType = 'Image';
      isImage = true;
    }
  }

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div style={styles.overlay} onClick={handleOverlayClick}>
      <div className="glass-panel animate-slide-up" style={styles.modal}>
        
        {/* Header */}
        <div style={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
            <div style={styles.iconContainer}>
              {isWeb ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              ) : isImage ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-secondary)" strokeWidth="2.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              )}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h2 style={styles.title} title={docName}>{docName}</h2>
              <span style={styles.subtitle}>{docType} • {chunkCount} index chunks</span>
            </div>
          </div>
          <button onClick={onClose} style={styles.closeBtn} title="Close Preview">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tab Controls for Images */}
        {isImage && imageUrl && (
          <div style={styles.tabContainer}>
            <button
              onClick={() => setActiveTab('image')}
              style={{
                ...styles.tabBtn,
                color: activeTab === 'image' ? 'var(--color-secondary)' : 'var(--text-muted)',
                borderBottomColor: activeTab === 'image' ? 'var(--color-secondary)' : 'transparent',
                background: activeTab === 'image' ? 'rgba(0, 245, 212, 0.05)' : 'transparent'
              }}
            >
              Captured Image
            </button>
            <button
              onClick={() => setActiveTab('text')}
              style={{
                ...styles.tabBtn,
                color: activeTab === 'text' ? 'var(--color-secondary)' : 'var(--text-muted)',
                borderBottomColor: activeTab === 'text' ? 'var(--color-secondary)' : 'transparent',
                background: activeTab === 'text' ? 'rgba(0, 245, 212, 0.05)' : 'transparent'
              }}
            >
              Extracted OCR Text
            </button>
          </div>
        )}

        {/* Modal Content Body */}
        <div style={styles.body}>
          {isImage && imageUrl && activeTab === 'image' ? (
            <div style={styles.imageContainer}>
              <img src={imageUrl} alt={docName} style={styles.image} />
            </div>
          ) : (
            <div style={styles.textViewerContainer}>
              {isWeb && (
                <div style={styles.webInfoRow}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" style={{ flexShrink: 0 }}>
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Source URL:</span>
                  <a
                    href={docName.replace(/^🌐\s*/, '')}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={styles.webLink}
                  >
                    {docName.replace(/^🌐\s*/, '')}
                  </a>
                </div>
              )}
              {fullText ? (
                <pre style={styles.preContent}>
                  {fullText}
                </pre>
              ) : (
                <div style={styles.emptyState}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2" style={{ marginBottom: '12px' }}>
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No extracted text available for this document.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Metadata Footer */}
        <div style={styles.footer}>
          <div style={styles.metaStats}>
            <div style={styles.statItem}>
              <span style={styles.statLabel}>Words</span>
              <span style={styles.statVal}>{wordCount.toLocaleString()}</span>
            </div>
            <div style={styles.statItem}>
              <span style={styles.statLabel}>Characters</span>
              <span style={styles.statVal}>{charCount.toLocaleString()}</span>
            </div>
            <div style={styles.statItem}>
              <span style={styles.statLabel}>Chunks</span>
              <span style={styles.statVal}>{chunkCount}</span>
            </div>
          </div>
          <button onClick={onClose} style={styles.closeActionBtn}>
            Close
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
    background: 'rgba(2, 3, 9, 0.8)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1200,
    padding: '20px'
  },
  modal: {
    width: '100%',
    maxWidth: '720px',
    background: '#0a0d1d',
    border: '1px solid rgba(0, 245, 212, 0.15)',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 0 30px rgba(0, 245, 212, 0.12)',
    borderRadius: '16px',
    maxHeight: '85vh',
    overflow: 'hidden'
  },
  header: {
    padding: '16px 20px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px'
  },
  iconContainer: {
    width: '36px',
    height: '36px',
    borderRadius: '8px',
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  },
  title: {
    margin: 0,
    fontFamily: 'var(--font-heading)',
    color: '#ffffff',
    fontSize: '16px',
    fontWeight: '600',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  subtitle: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    marginTop: '2px',
    display: 'block'
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: '6px',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 0.2s',
    flexShrink: 0
  },
  tabContainer: {
    display: 'flex',
    background: 'rgba(2, 3, 9, 0.3)',
    borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
    padding: '0 12px'
  },
  tabBtn: {
    padding: '12px 16px',
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  body: {
    padding: '20px',
    overflowY: 'auto',
    flex: 1,
    background: 'rgba(2, 3, 9, 0.2)',
    display: 'flex',
    flexDirection: 'column',
    minHeight: '260px'
  },
  imageContainer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    flex: 1,
    background: '#04060d',
    borderRadius: '10px',
    border: '1px solid rgba(255, 255, 255, 0.04)',
    padding: '12px',
    maxHeight: '450px',
    overflow: 'hidden'
  },
  image: {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
    borderRadius: '6px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)'
  },
  textViewerContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    flex: 1
  },
  webInfoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    background: 'rgba(56, 189, 248, 0.05)',
    border: '1px solid rgba(56, 189, 248, 0.15)',
    borderRadius: '6px',
    padding: '8px 12px'
  },
  webLink: {
    fontSize: '11px',
    color: '#38bdf8',
    textDecoration: 'none',
    fontWeight: '500',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1
  },
  preContent: {
    margin: 0,
    padding: '16px',
    background: 'rgba(2, 3, 9, 0.65)',
    border: '1px solid rgba(255, 255, 255, 0.05)',
    borderRadius: '10px',
    color: '#e2e8f0',
    fontFamily: 'var(--font-sans)',
    fontSize: '13px',
    lineHeight: '160%',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    overflowY: 'auto',
    flex: 1,
    maxHeight: '450px'
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    padding: '40px 0'
  },
  footer: {
    padding: '16px 20px',
    borderTop: '1px solid rgba(255, 255, 255, 0.06)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '16px'
  },
  metaStats: {
    display: 'flex',
    gap: '20px'
  },
  statItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px'
  },
  statLabel: {
    fontSize: '9px',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    fontWeight: '700'
  },
  statVal: {
    fontSize: '13px',
    color: '#ffffff',
    fontWeight: '600'
  },
  closeActionBtn: {
    padding: '8px 18px',
    borderRadius: '8px',
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    color: '#e2e8f0',
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
    fontWeight: '600',
    fontSize: '13px',
    transition: 'all 0.2s'
  }
};
