import React from 'react';

export default function AuthorModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div
        className="glass-panel animate-slide-up"
        style={styles.modal}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button onClick={onClose} style={styles.closeBtn} title="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Profile Card Header */}
        <div style={styles.profileHeader}>
          <div style={styles.imageGlowContainer}>
            <img
              src="https://avatars.githubusercontent.com/udityamerit"
              alt="Uditya Narayan Tiwari"
              style={styles.profileImage}
              onError={(e) => {
                // Fallback image if there's any loading failure
                e.target.src = "https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=256";
              }}
            />
          </div>
          <h2 style={styles.name}>Uditya Narayan Tiwari</h2>
          <p style={styles.tagline}>Machine Learning Engineer &  Generative AI Developer</p>
        </div>

        {/* Info Grid / Link List */}
        <div style={styles.linksContainer}>
          {/* Portfolio */}
          <a
            href="https://udityanarayantiwari.netlify.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="author-link-card"
            style={{ ...styles.linkCard, borderColor: 'var(--color-secondary)' }}
          >
            <div style={styles.iconWrapper}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-secondary)" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            </div>
            <div style={styles.linkInfo}>
              <span style={styles.linkLabel}>Personal Portfolio</span>
              <span style={styles.linkUrl}>udityanarayantiwari.netlify.app</span>
            </div>
            <div className="arrow-icon" style={styles.arrowIcon}>→</div>
          </a>

          {/* Knowledge Base */}
          <a
            href="https://udityaknowledgebase.netlify.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="author-link-card"
            style={{ ...styles.linkCard, borderColor: 'var(--color-primary)' }}
          >
            <div style={styles.iconWrapper}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5v-15z" />
              </svg>
            </div>
            <div style={styles.linkInfo}>
              <span style={styles.linkLabel}>Knowledge Base</span>
              <span style={styles.linkUrl}>udityaknowledgebase.netlify.app</span>
            </div>
            <div className="arrow-icon" style={styles.arrowIcon}>→</div>
          </a>

          {/* LinkedIn */}
          <a
            href="https://www.linkedin.com/in/uditya-narayan-tiwari-562332289/"
            target="_blank"
            rel="noopener noreferrer"
            className="author-link-card"
            style={{ ...styles.linkCard, borderColor: '#0077b5' }}
          >
            <div style={styles.iconWrapper}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ fill: '#0077b5' }}>
                <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.779-1.75-1.75s.784-1.75 1.75-1.75 1.75.779 1.75 1.75-.784 1.75-1.75 1.75zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
              </svg>
            </div>
            <div style={styles.linkInfo}>
              <span style={styles.linkLabel}>LinkedIn Profile</span>
              <span style={styles.linkUrl}>linkedin.com/in/uditya-narayan-tiwari</span>
            </div>
            <div className="arrow-icon" style={styles.arrowIcon}>→</div>
          </a>

          {/* GitHub */}
          <a
            href="https://github.com/udityamerit"
            target="_blank"
            rel="noopener noreferrer"
            className="author-link-card"
            style={{ ...styles.linkCard, borderColor: '#ffffff' }}
          >
            <div style={styles.iconWrapper}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ fill: '#ffffff' }}>
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
            </div>
            <div style={styles.linkInfo}>
              <span style={styles.linkLabel}>GitHub Profile</span>
              <span style={styles.linkUrl}>github.com/udityamerit</span>
            </div>
            <div className="arrow-icon" style={styles.arrowIcon}>→</div>
          </a>
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
    maxWidth: '430px',
    background: '#0a0d1d',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '24px',
    padding: '36px 24px 28px 24px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    position: 'relative',
    boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)'
  },
  closeBtn: {
    position: 'absolute',
    top: '18px',
    right: '18px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 0.2s',
    zIndex: 10
  },
  profileHeader: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    marginBottom: '28px',
    textAlign: 'center'
  },
  imageGlowContainer: {
    width: '100px',
    height: '100px',
    borderRadius: '50%',
    padding: '3px',
    background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))',
    boxShadow: '0 0 24px rgba(0, 245, 212, 0.35)',
    marginBottom: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  profileImage: {
    width: '100%',
    height: '100%',
    borderRadius: '50%',
    objectFit: 'cover',
    border: '3px solid #0a0d1d'
  },
  name: {
    fontFamily: 'var(--font-heading)',
    fontSize: '21px',
    fontWeight: '800',
    color: '#ffffff',
    margin: '0 0 6px 0',
    letterSpacing: '0.2px'
  },
  tagline: {
    fontSize: '13.5px',
    color: 'var(--color-secondary)',
    margin: 0,
    fontWeight: '700',
    letterSpacing: '0.2px'
  },
  subTagline: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    marginTop: '6px',
    fontWeight: '500',
    letterSpacing: '0.3px'
  },
  linksContainer: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  linkCard: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 16px',
    borderRadius: '12px',
    background: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    textDecoration: 'none',
    color: '#ffffff',
    cursor: 'pointer'
  },
  iconWrapper: {
    marginRight: '14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px'
  },
  linkInfo: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1
  },
  linkLabel: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#ffffff'
  },
  linkUrl: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    marginTop: '2px',
    fontFamily: 'var(--font-sans)'
  },
  arrowIcon: {
    fontSize: '15px',
    color: 'var(--text-muted)',
    transition: 'all 0.2s',
    fontWeight: '600'
  },
  taglinesContainer: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    justifyContent: 'center',
    marginTop: '10px'
  },
  taglinePill: {
    fontSize: '10px',
    fontWeight: '700',
    color: '#cbd5e1',
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    padding: '3px 10px',
    borderRadius: '20px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  }
};
