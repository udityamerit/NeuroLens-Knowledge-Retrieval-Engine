import React, { useState, useEffect, useRef } from 'react';

export default function CameraModal({ isOpen, onClose, onCapture }) {
  const [stream, setStream] = useState(null);
  const [facingMode, setFacingMode] = useState('environment'); // 'environment' (back) or 'user' (front)
  const [errorMsg, setErrorMsg] = useState('');
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // Initialize camera stream
  useEffect(() => {
    if (!isOpen) return;

    let activeStream = null;

    async function startCamera() {
      try {
        setErrorMsg('');
        if (activeStream) {
          activeStream.getTracks().forEach(track => track.stop());
        }

        const constraints = {
          video: {
            facingMode: facingMode,
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          },
          audio: false
        };

        const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        activeStream = mediaStream;
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch (err) {
        console.error("Camera access error:", err);
        setErrorMsg("Could not access camera. Please verify camera permissions in your browser settings.");
      }
    }

    startCamera();

    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [isOpen, facingMode]);

  const handleClose = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    setStream(null);
    onClose();
  };

  const toggleFacingMode = () => {
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
  };

  const handleCapture = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    // Set canvas dimensions to match actual video stream dimensions
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    canvas.width = width;
    canvas.height = height;

    // If using front camera (user), mirror the image horizontally
    if (facingMode === 'user') {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(video, 0, 0, width, height);

    // Reset mirroring transformation
    if (facingMode === 'user') {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    // Convert to jpeg blob
    canvas.toBlob((blob) => {
      if (blob) {
        // Create a File object
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const file = new File([blob], `camera-scan-${timestamp}.jpg`, { type: 'image/jpeg' });
        onCapture(file);
        handleClose();
      }
    }, 'image/jpeg', 0.95);
  };

  if (!isOpen) return null;

  return (
    <div style={styles.overlay}>
      <div className="glass-panel animate-slide-up" style={styles.modal}>
        
        {/* Header */}
        <div style={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-secondary)" strokeWidth="2.5">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-heading)', color: 'var(--text-main)', fontSize: '18px' }}>
              Document Camera Scanner
            </h2>
          </div>
          <button onClick={handleClose} style={styles.closeBtn}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Viewfinder Body */}
        <div style={styles.viewfinderContainer}>
          {errorMsg ? (
            <div style={styles.errorContainer}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" style={{ marginBottom: '12px' }}>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <p style={styles.errorText}>{errorMsg}</p>
            </div>
          ) : (
            <div style={styles.videoWrapper}>
              <video 
                ref={videoRef}
                autoPlay 
                playsInline 
                muted
                style={{
                  ...styles.video,
                  transform: facingMode === 'user' ? 'scaleX(-1)' : 'none'
                }}
              />
              
              {/* High-Tech Document Scanner HUD Guides */}
              <div style={styles.hudOverlay}>
                <div style={{ ...styles.corner, ...styles.topLeft }} />
                <div style={{ ...styles.corner, ...styles.topRight }} />
                <div style={{ ...styles.corner, ...styles.bottomLeft }} />
                <div style={{ ...styles.corner, ...styles.bottomRight }} />
                <div style={styles.scannerLine} className="animate-pulse-glow" />
              </div>
            </div>
          )}
        </div>

        {/* Controls Footer */}
        <div style={styles.footer}>
          {!errorMsg && (
            <>
              <button 
                type="button"
                onClick={toggleFacingMode} 
                style={styles.flipBtn}
                title="Switch Camera (Front/Back)"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                </svg>
                Flip
              </button>

              <button 
                type="button"
                onClick={handleCapture} 
                style={styles.captureBtn}
                title="Capture Document"
              >
                <div style={styles.captureInner} />
              </button>
            </>
          )}
          
          <button onClick={handleClose} style={styles.cancelBtn}>
            Cancel
          </button>
        </div>

        {/* Offscreen canvas for grabbing snapshot */}
        <canvas ref={canvasRef} style={{ display: 'none' }} />
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
    background: 'rgba(2, 3, 9, 0.85)',
    backdropFilter: 'blur(10px)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1100,
    padding: '20px'
  },
  modal: {
    width: '100%',
    maxWidth: '560px',
    background: '#0a0d1d',
    border: '1px solid rgba(0, 245, 212, 0.15)',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 0 30px rgba(0, 245, 212, 0.15)',
    borderRadius: '16px',
    overflow: 'hidden'
  },
  header: {
    padding: '16px 20px',
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
  viewfinderContainer: {
    width: '100%',
    aspectRatio: '4/3',
    background: '#000000',
    position: 'relative',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden'
  },
  errorContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '24px',
    textAlign: 'center'
  },
  errorText: {
    color: '#94a3b8',
    fontSize: '14px',
    maxWidth: '320px',
    lineHeight: '1.5'
  },
  videoWrapper: {
    width: '100%',
    height: '100%',
    position: 'relative'
  },
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  hudOverlay: {
    position: 'absolute',
    top: '10%',
    left: '10%',
    right: '10%',
    bottom: '10%',
    border: '1px dashed rgba(0, 245, 212, 0.3)',
    pointerEvents: 'none'
  },
  corner: {
    position: 'absolute',
    width: '20px',
    height: '20px',
    borderColor: 'var(--color-secondary)',
    borderStyle: 'solid',
    borderWidth: '0'
  },
  topLeft: {
    top: '-2px',
    left: '-2px',
    borderTopWidth: '3px',
    borderLeftWidth: '3px'
  },
  topRight: {
    top: '-2px',
    right: '-2px',
    borderTopWidth: '3px',
    borderRightWidth: '3px'
  },
  bottomLeft: {
    bottom: '-2px',
    left: '-2px',
    borderBottomWidth: '3px',
    borderLeftWidth: '3px'
  },
  bottomRight: {
    bottom: '-2px',
    right: '-2px',
    borderBottomWidth: '3px',
    borderRightWidth: '3px'
  },
  scannerLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: '2px',
    background: 'var(--color-secondary)',
    opacity: 0.6,
    boxShadow: '0 0 8px var(--color-secondary)',
    animation: 'scanline 4s linear infinite',
    top: '50%' // Default placement, scanning handled by CSS animation
  },
  footer: {
    padding: '16px 20px',
    borderTop: '1px solid rgba(255, 255, 255, 0.06)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px'
  },
  captureBtn: {
    width: '64px',
    height: '64px',
    borderRadius: '50%',
    border: '4px solid #ffffff',
    background: 'transparent',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    transition: 'transform 0.1s, border-color 0.2s',
    boxShadow: '0 0 16px rgba(255, 255, 255, 0.2)',
    outline: 'none'
  },
  captureInner: {
    width: '46px',
    height: '46px',
    borderRadius: '50%',
    background: '#ffffff',
    transition: 'transform 0.1s, background-color 0.2s'
  },
  flipBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 16px',
    borderRadius: '8px',
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    color: '#cbd5e1',
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
    fontSize: '13px',
    fontWeight: '600',
    transition: 'all 0.2s'
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
    fontSize: '13px',
    transition: 'all 0.2s'
  }
};
