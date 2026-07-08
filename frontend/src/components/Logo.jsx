
export default function Logo({ size = 40, className = "" }) {
  return (
    <div className={`flex items-center gap-3 ${className}`} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <svg 
        width={size} 
        height={size} 
        viewBox="0 0 100 100" 
        fill="none" 
        xmlns="http://www.w3.org/2000/svg"
        style={{ filter: 'drop-shadow(0px 0px 8px rgba(0, 245, 212, 0.4))' }}
      >
        <defs>
          <linearGradient id="neurolens-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#9d4edd" />   {/* Violet */}
            <stop offset="100%" stopColor="#00f5d4" />  {/* Cyan */}
          </linearGradient>
          <radialGradient id="glow-grad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#00f5d4" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#9d4edd" stopOpacity="0" />
          </radialGradient>
        </defs>
        
        {/* Glow backdrop */}
        <circle cx="50%" cy="50%" r="40%" fill="url(#glow-grad)" />

        {/* Outer Tech Ring */}
        <circle 
          cx="50%" 
          cy="50%" 
          r="42%" 
          stroke="url(#neurolens-gradient)" 
          strokeWidth="3" 
          strokeDasharray="10 15 30 15" 
        />
        
        {/* Inner Aperture Circle */}
        <circle 
          cx="50%" 
          cy="50%" 
          r="26%" 
          stroke="url(#neurolens-gradient)" 
          strokeWidth="2.5" 
          strokeDasharray="4 4"
        />

        {/* Neural Network Nodes and Connections */}
        {/* Center Iris/Lens Dot */}
        <circle cx="50%" cy="50%" r="8%" fill="#00f5d4" />
        
        {/* Surrounding Nodes */}
        <circle cx="28%" cy="35%" r="4%" fill="#9d4edd" />
        <circle cx="72%" cy="35%" r="4%" fill="#9d4edd" />
        <circle cx="35%" cy="70%" r="4%" fill="#00f5d4" />
        <circle cx="65%" cy="70%" r="4%" fill="#00f5d4" />

        {/* Neural connections (lines) */}
        <line x1="50%" y1="50%" x2="28%" y2="35%" stroke="#9d4edd" strokeWidth="1.5" strokeOpacity="0.7" />
        <line x1="50%" y1="50%" x2="72%" y2="35%" stroke="#9d4edd" strokeWidth="1.5" strokeOpacity="0.7" />
        <line x1="50%" y1="50%" x2="35%" y2="70%" stroke="#00f5d4" strokeWidth="1.5" strokeOpacity="0.7" />
        <line x1="50%" y1="50%" x2="65%" y2="70%" stroke="#00f5d4" strokeWidth="1.5" strokeOpacity="0.7" />
        
        <line x1="28%" y1="35%" x2="72%" y2="35%" stroke="#9d4edd" strokeWidth="1" strokeOpacity="0.4" strokeDasharray="3 3" />
        <line x1="35%" y1="70%" x2="65%" y2="70%" stroke="#00f5d4" strokeWidth="1" strokeOpacity="0.4" strokeDasharray="3 3" />
      </svg>
      <span style={{ 
        fontFamily: 'var(--font-heading)', 
        fontSize: size * 0.55 + 'px', 
        fontWeight: '800', 
        letterSpacing: '1px',
        background: 'linear-gradient(135deg, #ffffff 30%, #a78bfa 70%, #00f5d4 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        textTransform: 'uppercase'
      }}>
        NeuroLens
      </span>
    </div>
  );
}
