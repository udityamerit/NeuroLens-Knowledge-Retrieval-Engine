import { useState, useMemo } from 'react';
import { formatStructuredMessage } from './MathRenderer';

export default function DocPreviewModal({ isOpen, onClose, docName, chunks = [], imageUrl }) {
  const [activeTab, setActiveTab] = useState('text'); // 'text' or 'image'
  const [viewMode, setViewMode] = useState('document'); // 'document' or 'chunks'
  const [searchTerm, setSearchTerm] = useState('');
  const [chunkPage, setChunkPage] = useState(1);
  const CHUNKS_PER_PAGE = 15;

  // Filter chunks belonging to this document
  const docChunks = useMemo(() => {
    return chunks.filter(c => c.metadata && c.metadata.source === docName);
  }, [chunks, docName]);
  
  // Sort chunks if page numbers are present to ensure logical order
  const sortedChunks = useMemo(() => {
    return [...docChunks].sort((a, b) => {
      const pageA = a.metadata ? a.metadata.page : null;
      const pageB = b.metadata ? b.metadata.page : null;
      if (pageA !== null && pageB !== null) {
        return pageA - pageB;
      }
      return 0;
    });
  }, [docChunks]);

  const uniquePages = useMemo(() => {
    return new Set(sortedChunks.map(c => c.metadata?.page).filter(Boolean));
  }, [sortedChunks]);

  const fullText = useMemo(() => {
    return sortedChunks.map(c => c.content).join('\n\n');
  }, [sortedChunks]);

  const wordCount = useMemo(() => {
    return fullText.split(/\s+/).filter(Boolean).length;
  }, [fullText]);

  const charCount = fullText.length;
  const chunkCount = sortedChunks.length;

  // Filter chunks by search term
  const filteredChunks = useMemo(() => {
    if (!searchTerm.trim()) return sortedChunks;
    const term = searchTerm.toLowerCase();
    return sortedChunks.filter(c => c.content.toLowerCase().includes(term));
  }, [sortedChunks, searchTerm]);

  // Paginate filtered chunks
  const totalChunkPages = Math.max(1, Math.ceil(filteredChunks.length / CHUNKS_PER_PAGE));
  const paginatedChunks = useMemo(() => {
    const start = (chunkPage - 1) * CHUNKS_PER_PAGE;
    return filteredChunks.slice(start, start + CHUNKS_PER_PAGE);
  }, [filteredChunks, chunkPage]);

  if (!isOpen || !docName) return null;

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
              <span style={styles.subtitle}>
                {docType} • {uniquePages.size > 0 ? `${uniquePages.size} pages • ` : ''}{chunkCount} chunks
              </span>
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

        {/* Search and View Mode Toolbar */}
        {(!isImage || activeTab === 'text') && (
          <div style={styles.toolbar}>
            <div style={styles.searchBox}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input 
                type="text"
                placeholder="Search within document..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setChunkPage(1);
                }}
                style={styles.searchInput}
              />
              {searchTerm && (
                <button 
                  onClick={() => setSearchTerm('')} 
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
                >
                  ✕
                </button>
              )}
            </div>

            <div style={styles.modeToggleGroup}>
              <button
                onClick={() => setViewMode('document')}
                style={{
                  ...styles.modeToggleBtn,
                  background: viewMode === 'document' ? 'rgba(0, 245, 212, 0.15)' : 'transparent',
                  color: viewMode === 'document' ? 'var(--color-secondary)' : 'var(--text-muted)'
                }}
              >
                Document
              </button>
              <button
                onClick={() => setViewMode('chunks')}
                style={{
                  ...styles.modeToggleBtn,
                  background: viewMode === 'chunks' ? 'rgba(0, 245, 212, 0.15)' : 'transparent',
                  color: viewMode === 'chunks' ? 'var(--color-secondary)' : 'var(--text-muted)'
                }}
              >
                Chunks ({filteredChunks.length})
              </button>
            </div>
          </div>
        )}

        {/* Modal Content Body */}
        <div style={styles.body}>
          {isImage && imageUrl && activeTab === 'image' ? (
            <div style={styles.imageContainer}>
              <img src={imageUrl} alt={docName} style={styles.image} />
            </div>
          ) : viewMode === 'chunks' ? (
            <div style={styles.chunksViewerContainer}>
              {paginatedChunks.length === 0 ? (
                <div style={styles.emptyState}>
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                    {searchTerm ? `No chunks match "${searchTerm}".` : 'No chunks available.'}
                  </p>
                </div>
              ) : (
                paginatedChunks.map((chunk, idx) => {
                  const globalIdx = (chunkPage - 1) * CHUNKS_PER_PAGE + idx + 1;
                  return (
                    <div key={idx} style={styles.chunkCard}>
                      <div style={styles.chunkHeader}>
                        <span style={styles.chunkIndexBadge}>Chunk #{globalIdx}</span>
                        {chunk.metadata?.page && (
                          <span style={styles.chunkPageBadge}>Page {chunk.metadata.page}</span>
                        )}
                        <span style={styles.chunkLengthBadge}>{chunk.content.length} chars</span>
                      </div>
                      <div style={{ ...styles.chunkContent, whiteSpace: 'normal' }}>
                        {formatStructuredMessage(chunk.content)}
                      </div>
                    </div>
                  );
                })
              )}

              {/* Chunk Pagination Controls */}
              {totalChunkPages > 1 && (
                <div style={styles.paginationRow}>
                  <button
                    onClick={() => setChunkPage(p => Math.max(1, p - 1))}
                    disabled={chunkPage === 1}
                    style={{ ...styles.pageBtn, opacity: chunkPage === 1 ? 0.4 : 1 }}
                  >
                    ◀ Prev
                  </button>
                  <span style={styles.pageIndicator}>
                    Page {chunkPage} of {totalChunkPages}
                  </span>
                  <button
                    onClick={() => setChunkPage(p => Math.min(totalChunkPages, p + 1))}
                    disabled={chunkPage === totalChunkPages}
                    style={{ ...styles.pageBtn, opacity: chunkPage === totalChunkPages ? 0.4 : 1 }}
                  >
                    Next ▶
                  </button>
                </div>
              )}
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
            {uniquePages.size > 0 && (
              <div style={styles.statItem}>
                <span style={styles.statLabel}>Pages</span>
                <span style={styles.statVal}>{uniquePages.size}</span>
              </div>
            )}
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
    maxWidth: '780px',
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
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 20px',
    background: 'rgba(255, 255, 255, 0.02)',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
    gap: '12px'
  },
  searchBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'rgba(0, 0, 0, 0.3)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '6px',
    padding: '6px 10px',
    flex: 1,
    maxWidth: '320px'
  },
  searchInput: {
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#ffffff',
    fontSize: '12px',
    width: '100%',
    fontFamily: 'var(--font-sans)'
  },
  modeToggleGroup: {
    display: 'flex',
    background: 'rgba(0, 0, 0, 0.3)',
    borderRadius: '6px',
    padding: '2px',
    border: '1px solid rgba(255, 255, 255, 0.06)'
  },
  modeToggleBtn: {
    border: 'none',
    borderRadius: '4px',
    padding: '5px 12px',
    fontSize: '11px',
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
    minHeight: '280px'
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
  chunksViewerContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    flex: 1
  },
  chunkCard: {
    background: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: '8px',
    padding: '12px 14px'
  },
  chunkHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px'
  },
  chunkIndexBadge: {
    fontSize: '10px',
    fontWeight: '700',
    color: 'var(--color-secondary)',
    background: 'rgba(0, 245, 212, 0.1)',
    padding: '2px 6px',
    borderRadius: '4px'
  },
  chunkPageBadge: {
    fontSize: '10px',
    fontWeight: '600',
    color: '#38bdf8',
    background: 'rgba(56, 189, 248, 0.1)',
    padding: '2px 6px',
    borderRadius: '4px'
  },
  chunkLengthBadge: {
    fontSize: '10px',
    color: 'var(--text-muted)',
    marginLeft: 'auto'
  },
  chunkContent: {
    margin: 0,
    fontSize: '12px',
    lineHeight: '150%',
    color: '#cbd5e1',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word'
  },
  paginationRow: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '14px',
    padding: '12px 0 4px 0'
  },
  pageBtn: {
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    color: '#e2e8f0',
    borderRadius: '6px',
    padding: '6px 12px',
    fontSize: '11px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  pageIndicator: {
    fontSize: '12px',
    color: 'var(--text-muted)'
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
    gap: '16px',
    flexWrap: 'wrap'
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
