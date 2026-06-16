import React, { useState, useRef, useEffect } from 'react';

export default function ChatPanel({ messages, onSendQuery, isGenerating, activeModel, hasDocuments, isMobile, onToggleSidebar, backendUrl, elevenLabsApiKey }) {
  const [query, setQuery] = useState('');
  const [expandedSources, setExpandedSources] = useState({});
  const chatEndRef = useRef(null);
  const canvasRef = useRef(null);
  const inputRef = useRef(null);

  const [isListening, setIsListening] = useState(false);
  const [speechLang, setSpeechLang] = useState('en-US'); // 'en-US' or 'hi-IN'
  const [speakingIndex, setSpeakingIndex] = useState(null);
  const recognitionRef = useRef(null);
  const initialQueryRef = useRef('');
  const audioRef = useRef(null);

  // Resolve backend URL, defaulting to local network IP or localhost dynamically
  const resolvedBackendUrl = (() => {
    if (backendUrl) return backendUrl;
    
    // Auto-detect local host IP if served over local network
    const host = window.location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1' || /^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host);
    if (isLocal) {
      return `http://${host}:8000`;
    }
    return 'http://127.0.0.1:8000';
  })();
  const speakingSessionRef = useRef({
    sentences: [],
    currentIndex: 0,
    cancelled: false,
    nextAudioPromise: null
  });

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      speakingSessionRef.current.cancelled = true;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {}
      }
      if (audioRef.current && audioRef.current !== "loading") {
        try {
          audioRef.current.pause();
        } catch (e) {}
      }
    };
  }, []);

  const toggleListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser. Try Chrome, Edge, or Safari.");
      return;
    }
    
    if (isListening) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {}
      }
      setIsListening(false);
    } else {
      // Prevent running duplicate instances
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {}
      }

      // Cancel any active speech/audio output before starting microphone capture
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      if (audioRef.current && audioRef.current !== "loading") {
        try {
          audioRef.current.pause();
        } catch (e) {}
      }
      audioRef.current = null;
      setSpeakingIndex(null);
      speakingSessionRef.current.cancelled = true;
      
      if (inputRef.current) {
        inputRef.current.blur();
      }

      initialQueryRef.current = query;
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = speechLang === 'en-US' ? 'en-IN' : speechLang;
        
        recognition.onstart = () => {
          setIsListening(true);
        };
        
        recognition.onresult = (event) => {
          let sessionTranscript = '';
          for (let i = 0; i < event.results.length; ++i) {
            if (event.results[i] && event.results[i][0]) {
              sessionTranscript += event.results[i][0].transcript;
            }
          }
          
          const cleanedTranscript = sessionTranscript.trim();
          if (cleanedTranscript) {
            const prefix = initialQueryRef.current ? initialQueryRef.current.trim() : '';
            setQuery(prefix ? `${prefix} ${cleanedTranscript}` : cleanedTranscript);
          }
        };
        
        recognition.onerror = (event) => {
          console.error("Speech recognition error:", event.error);
          setIsListening(false);
          if (event.error === 'not-allowed') {
            alert("Microphone access is blocked. Please allow microphone permissions in your browser settings.");
          } else if (event.error === 'audio-capture') {
            alert("Microphone not found or busy. Please check your connection and system microphone settings.");
          } else if (event.error !== 'no-speech') {
            alert("Speech recognition error: " + event.error);
          }
        };
        
        recognition.onend = () => {
          setIsListening(false);
          recognitionRef.current = null;
        };
        
        recognitionRef.current = recognition;
        setIsListening(true); // set state immediately for fast feedback
        recognition.start();
      } catch (err) {
        console.error("Failed to start speech recognition:", err);
        alert("Failed to start speech recognition: " + err.message);
        setIsListening(false);
      }
    }
  };

  const toggleSpeechLanguage = () => {
    const nextLang = speechLang === 'en-US' ? 'hi-IN' : 'en-US';
    setSpeechLang(nextLang);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.lang = nextLang === 'en-US' ? 'en-IN' : nextLang;
      } catch (e) {
        console.error("Failed to change active speech lang:", e);
      }
    }
  };

  const fetchSentenceAudio = (text) => {
    const resolvedElevenLabsKey = elevenLabsApiKey || import.meta.env.VITE_ELEVENLABS_API_KEY || (typeof __ELEVENLABS_API_KEY__ !== 'undefined' ? __ELEVENLABS_API_KEY__ : '') || '';

    if (resolvedElevenLabsKey) {
      const voiceId = "ErXwobaYiN019PkySvjV"; // Antoni (Male - warm, professional)
      return fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": resolvedElevenLabsKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text: text,
          model_id: "eleven_v3",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75
          }
        })
      })
      .then(res => {
        if (!res.ok) throw new Error("ElevenLabs Direct API returned status " + res.status);
        return res.blob();
      })
      .then(blob => {
        return URL.createObjectURL(blob);
      })
      .catch(err => {
        console.warn("Direct ElevenLabs API fetch failed, falling back to local/default speech:", err);
        return null;
      });
    }

    return fetch(`${resolvedBackendUrl}/api/tts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text: text,
        language_code: speechLang
      })
    })
    .then(res => {
      if (!res.ok) throw new Error("Status " + res.status);
      return res.json();
    })
    .then(data => {
      if (data.audio) {
        return `data:audio/wav;base64,${data.audio}`;
      }
      return null;
    })
    .catch(err => {
      console.warn("Fetch failed for sentence:", text, err);
      return null;
    });
  };

  const speakSentenceLocal = (text, onEndCallback) => {
    if (!window.speechSynthesis) {
      onEndCallback();
      return;
    }
    
    const utterance = new SpeechSynthesisUtterance(text);
    const containsHindi = /[\u0900-\u097F]/.test(text);
    if (containsHindi) {
      utterance.lang = 'hi-IN';
      const voices = window.speechSynthesis.getVoices();
      const hiVoice = voices.find(voice => voice.lang.includes('hi') || voice.lang.includes('HI'));
      if (hiVoice) utterance.voice = hiVoice;
    } else {
      utterance.lang = 'en-US';
      const voices = window.speechSynthesis.getVoices();
      const enVoice = voices.find(voice => voice.lang.includes('en-US') || voice.lang.includes('en_US') || voice.lang.includes('en-GB') || voice.lang.includes('en_GB'));
      if (enVoice) utterance.voice = enVoice;
    }
    
    utterance.onend = () => {
      onEndCallback();
    };
    
    utterance.onerror = (e) => {
      console.error("Local Speech synthesis error:", e);
      onEndCallback();
    };
    
    window.speechSynthesis.speak(utterance);
  };

  const playSessionSentence = (index) => {
    const session = speakingSessionRef.current;
    if (session.cancelled) return;
    
    if (index >= session.sentences.length) {
      setSpeakingIndex(null);
      if (audioRef.current && audioRef.current !== "loading") {
        try {
          audioRef.current.pause();
        } catch (e) {}
      }
      audioRef.current = null;
      return;
    }
    
    session.currentIndex = index;
    
    let audioPromise = session.nextAudioPromise;
    if (!audioPromise || index === 0) {
      audioPromise = fetchSentenceAudio(session.sentences[index]);
    }
    
    audioPromise.then(audioUrl => {
      if (session.cancelled) return;
      
      if (!audioUrl) {
        speakSentenceLocal(session.sentences[index], () => {
          playSessionSentence(index + 1);
        });
        return;
      }
      
      // Pre-fetch the next sentence immediately
      if (index + 1 < session.sentences.length) {
        session.nextAudioPromise = fetchSentenceAudio(session.sentences[index + 1]);
      } else {
        session.nextAudioPromise = null;
      }
      
      const audio = audioRef.current;
      if (!audio || audio === "loading") {
        speakSentenceLocal(session.sentences[index], () => {
          playSessionSentence(index + 1);
        });
        return;
      }
      
      audio.onended = null;
      audio.onerror = null;
      
      audio.src = audioUrl;
      
      audio.onended = () => {
        if (session.cancelled) return;
        playSessionSentence(index + 1);
      };
      
      audio.onerror = (e) => {
        console.error("Audio error during playback, trying next sentence:", e);
        if (session.cancelled) return;
        playSessionSentence(index + 1);
      };
      
      audio.play().catch(playErr => {
        console.error("Playback error:", playErr);
        speakSentenceLocal(session.sentences[index], () => {
          playSessionSentence(index + 1);
        });
      });
    });
  };

  const speakLocal = (cleanText, index) => {
    if (!window.speechSynthesis) {
      setSpeakingIndex(null);
      return;
    }
    
    const utterance = new SpeechSynthesisUtterance(cleanText);
    const containsHindi = /[\u0900-\u097F]/.test(cleanText);
    if (containsHindi) {
      utterance.lang = 'hi-IN';
      const voices = window.speechSynthesis.getVoices();
      const hiVoice = voices.find(voice => voice.lang.includes('hi') || voice.lang.includes('HI'));
      if (hiVoice) utterance.voice = hiVoice;
    } else {
      utterance.lang = 'en-US';
      const voices = window.speechSynthesis.getVoices();
      const enVoice = voices.find(voice => voice.lang.includes('en-US') || voice.lang.includes('en_US') || voice.lang.includes('en-GB') || voice.lang.includes('en_GB'));
      if (enVoice) utterance.voice = enVoice;
    }
    
    utterance.onend = () => {
      setSpeakingIndex(null);
    };
    
    utterance.onerror = (e) => {
      console.error("Local Speech synthesis error:", e);
      setSpeakingIndex(null);
    };
    
    setSpeakingIndex(index);
    window.speechSynthesis.speak(utterance);
  };

  const toggleSpeak = (text, index) => {
    if (speakingIndex === index) {
      speakingSessionRef.current.cancelled = true;
      if (audioRef.current && audioRef.current !== "loading") {
        try {
          audioRef.current.pause();
        } catch (e) {}
      }
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      audioRef.current = null;
      setSpeakingIndex(null);
    } else {
      speakingSessionRef.current.cancelled = true; // cancel any previous session
      if (audioRef.current && audioRef.current !== "loading") {
        try {
          audioRef.current.pause();
        } catch (e) {}
      }
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }

      let cleanText = text
        .replace(/📥 \*\*System:\*\*/g, '')
        .replace(/❌ \*\*Error running query:\*\*/g, '')
        .replace(/\[Source \d+\]/g, '')
        .replace(/\*\*|`|\*/g, '')
        .replace(/###|##|#/g, '')
        .trim();
        
      if (!cleanText) {
        audioRef.current = null;
        setSpeakingIndex(null);
        return;
      }

      // Split into sentences based on punctuation, ignoring empty strings
      const sentences = cleanText
        .split(/(?<=[.?!।\n])\s+/)
        .map(s => s.trim())
        .filter(s => s.length > 0);

      if (sentences.length === 0) {
        audioRef.current = null;
        setSpeakingIndex(null);
        return;
      }

      speakingSessionRef.current = {
        sentences: sentences,
        currentIndex: 0,
        cancelled: false,
        nextAudioPromise: null
      };

      // Create and play a dummy sound/unlock the audio element immediately under the user gesture
      const audioInstance = new Audio();
      audioInstance.play().catch(() => {});
      audioRef.current = audioInstance;

      setSpeakingIndex(index);
      playSessionSentence(0);
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGenerating]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    let animationFrameId;
    let width = 0;
    let height = 0;
    
    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
    };
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    // Set up neuron nodes based on area size
    const nodes = [];
    const maxNodes = 65; // Denser network spanning the entire panel
    
    // Create random nodes
    for (let i = 0; i < maxNodes; i++) {
      nodes.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.15, // slower drift for cleaner background feel
        vy: (Math.random() - 0.5) * 0.15,
        radius: Math.random() * 1.5 + 1.2, // 1.2 to 2.7px radius
        color: Math.random() > 0.45 ? '#00f5d4' : '#9d4edd', // Cyan or Violet
        pulse: 0
      });
    }
    
    let signals = [];
    const maxDist = 145; // slightly wider connection radius

    // Helper to generate a multi-node pathway for electrical impulses to travel
    const buildSignalPath = (startIdx, length) => {
      const path = [startIdx];
      let current = startIdx;
      
      for (let step = 0; step < length; step++) {
        const neighbors = [];
        nodes.forEach((n, idx) => {
          if (path.includes(idx)) return; // prevent backtracking loops
          const dx = nodes[current].x - n.x;
          const dy = nodes[current].y - n.y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < maxDist) {
            neighbors.push(idx);
          }
        });
        
        if (neighbors.length === 0) break;
        const nextNode = neighbors[Math.floor(Math.random() * neighbors.length)];
        path.push(nextNode);
        current = nextNode;
      }
      return path;
    };
    
    const animate = () => {
      ctx.clearRect(0, 0, width, height);
      
      // 1. Draw connections (synapses) first, in background
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          
          if (dist < maxDist) {
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            
            // Faded link line matching average distance
            const alpha = (1 - dist / maxDist) * 0.05;
            ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
            ctx.lineWidth = 0.55;
            ctx.stroke();
          }
        }
      }
      
      // 2. Update & draw nodes
      nodes.forEach(node => {
        node.x += node.vx;
        node.y += node.vy;
        
        // Gentle bounce off boundaries
        if (node.x < 0 || node.x > width) node.vx *= -1;
        if (node.y < 0 || node.y > height) node.vy *= -1;
        
        // Draw node circle
        ctx.beginPath();
        const currentRadius = node.radius + (node.pulse * 2.0);
        ctx.arc(node.x, node.y, currentRadius, 0, Math.PI * 2);
        
        if (node.pulse > 0) {
          node.pulse -= 0.04; // decay pulse
          if (node.pulse < 0) node.pulse = 0;
          ctx.shadowBlur = 8;
          ctx.shadowColor = node.color;
        } else {
          ctx.shadowBlur = 0;
        }
        
        ctx.fillStyle = node.color;
        ctx.fill();
        ctx.shadowBlur = 0;
      });
      
      // 3. Spawn random electrical signals traversing multiple nodes
      if (signals.length < 15 && Math.random() < 0.04) {
        const startIdx = Math.floor(Math.random() * nodes.length);
        const pathLength = Math.floor(Math.random() * 4) + 3; // travel along 3 to 6 nodes
        const path = buildSignalPath(startIdx, pathLength);
        
        if (path.length > 1) {
          signals.push({
            path,
            currentStep: 0, // moving from path[currentStep] to path[currentStep+1]
            progress: 0,
            speed: Math.random() * 0.016 + 0.014, // speed of movement along synapse
            color: nodes[startIdx].color,
            history: [] // stores previous coordinates to draw a trailing lightning/laser line
          });
        }
      }
      
      // 4. Update and draw electrical signals
      for (let s = signals.length - 1; s >= 0; s--) {
        const sig = signals[s];
        
        const nodeFrom = nodes[sig.path[sig.currentStep]];
        const nodeTo = nodes[sig.path[sig.currentStep + 1]];
        
        // Calculate current position along the synapse path
        const currentX = nodeFrom.x + (nodeTo.x - nodeFrom.x) * sig.progress;
        const currentY = nodeFrom.y + (nodeTo.y - nodeFrom.y) * sig.progress;
        
        // Add to coordinate trail history
        sig.history.push({ x: currentX, y: currentY });
        if (sig.history.length > 7) {
          sig.history.shift(); // keep trail length at 7 points
        }
        
        // Draw trailing electrical signal line
        if (sig.history.length > 1) {
          ctx.beginPath();
          ctx.moveTo(sig.history[0].x, sig.history[0].y);
          for (let h = 1; h < sig.history.length; h++) {
            ctx.lineTo(sig.history[h].x, sig.history[h].y);
          }
          
          // Draw trail with glow
          ctx.strokeStyle = sig.color;
          ctx.lineWidth = 1.6;
          ctx.lineCap = 'round';
          ctx.shadowBlur = 8;
          ctx.shadowColor = sig.color;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
        
        // Draw the leading glowing head dot
        ctx.beginPath();
        ctx.arc(currentX, currentY, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff'; // white head for electrical flash effect
        ctx.shadowBlur = 10;
        ctx.shadowColor = sig.color;
        ctx.fill();
        ctx.shadowBlur = 0;
        
        // Advance progress
        sig.progress += sig.speed;
        
        if (sig.progress >= 1) {
          // Reached node in path: trigger node pulse glow
          nodes[sig.path[sig.currentStep + 1]].pulse = 1.0;
          
          // Move to next step in path
          sig.currentStep += 1;
          sig.progress = 0;
          
          // If path completed, remove signal
          if (sig.currentStep >= sig.path.length - 1) {
            signals.splice(s, 1);
          }
        }
      }
      
      animationFrameId = requestAnimationFrame(animate);
    };
    
    animate();
    
    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resizeCanvas);
    };
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!query.trim() || isGenerating) return;
    onSendQuery(query);
    setQuery('');
  };

  const toggleSources = (msgIndex) => {
    setExpandedSources(prev => ({
      ...prev,
      [msgIndex]: !prev[msgIndex]
    }));
  };

  const handleSuggestionClick = (text) => {
    if (isGenerating) return;
    onSendQuery(text);
  };

  // Helper to format source tags in text (e.g., converting [Source 1] into a glowing tag)
  const formatMessageText = (text) => {
    if (!text) return '';
    
    // Helper to render inline formatting: bold (**), italic (*), code (`), and source tags ([Source X])
    const renderInline = (inlineText) => {
      if (!inlineText) return '';
      
      const inlineRegex = /(\*\*.*?\*\*|\*.*?\*|`.*?`|\[Source \d+\])/g;
      const parts = inlineText.split(inlineRegex);
      
      return parts.map((part, idx) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={idx} style={{ color: '#ffffff', fontWeight: '700' }}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('*') && part.endsWith('*')) {
          return <em key={idx} style={{ color: '#cbd5e1', fontStyle: 'italic' }}>{part.slice(1, -1)}</em>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code 
              key={idx} 
              style={{
                fontFamily: 'var(--font-mono)',
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                padding: '2px 6px',
                borderRadius: '4px',
                fontSize: '12.5px',
                color: 'var(--color-secondary)',
                wordBreak: 'break-all'
              }}
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.match(/^\[Source \d+\]$/)) {
          return (
            <span 
              key={idx} 
              style={{
                background: 'rgba(0, 245, 212, 0.12)',
                border: '1px solid rgba(0, 245, 212, 0.3)',
                color: 'var(--color-secondary)',
                padding: '1px 5px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: '600',
                margin: '0 2px',
                display: 'inline-block',
                boxShadow: '0 0 4px rgba(0, 245, 212, 0.2)'
              }}
            >
              {part}
            </span>
          );
        }
        return part;
      });
    };

    // Split text into lines to process block structures
    const lines = text.split('\n');
    const elements = [];
    let listItems = [];
    let insideList = false;
    let listType = null; // 'unordered' or 'ordered'

    const flushList = (key) => {
      if (listItems.length > 0) {
        if (listType === 'ordered') {
          elements.push(
            <ol key={key} style={{ marginLeft: '20px', marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {listItems}
            </ol>
          );
        } else {
          elements.push(
            <ul key={key} style={{ marginLeft: '20px', marginBottom: '12px', listStyleType: 'disc', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {listItems}
            </ul>
          );
        }
        listItems = [];
        insideList = false;
        listType = null;
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Check for headers (e.g., ### header)
      if (trimmed.startsWith('### ')) {
        flushList(`list-before-h3-${i}`);
        elements.push(
          <h3 key={`h3-${i}`} style={{ fontFamily: 'var(--font-heading)', color: '#ffffff', fontSize: '15px', fontWeight: '700', marginTop: '14px', marginBottom: '8px' }}>
            {renderInline(trimmed.substring(4))}
          </h3>
        );
        continue;
      }
      if (trimmed.startsWith('## ')) {
        flushList(`list-before-h2-${i}`);
        elements.push(
          <h2 key={`h2-${i}`} style={{ fontFamily: 'var(--font-heading)', color: '#ffffff', fontSize: '17px', fontWeight: '700', marginTop: '18px', marginBottom: '10px' }}>
            {renderInline(trimmed.substring(3))}
          </h2>
        );
        continue;
      }
      if (trimmed.startsWith('# ')) {
        flushList(`list-before-h1-${i}`);
        elements.push(
          <h1 key={`h1-${i}`} style={{ fontFamily: 'var(--font-heading)', color: '#ffffff', fontSize: '19px', fontWeight: '800', marginTop: '20px', marginBottom: '12px' }}>
            {renderInline(trimmed.substring(2))}
          </h1>
        );
        continue;
      }

      // Check for bullet lists
      const isBulletList = trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('• ');
      // Check for ordered lists
      const isOrderedList = /^\d+\.\s/.test(trimmed);

      if (isBulletList || isOrderedList) {
        const currentType = isOrderedList ? 'ordered' : 'unordered';
        if (insideList && listType !== currentType) {
          flushList(`list-type-change-${i}`);
        }
        
        insideList = true;
        listType = currentType;
        
        const content = isOrderedList 
          ? trimmed.substring(trimmed.indexOf('.') + 1).trim()
          : trimmed.substring(2).trim();
          
        listItems.push(
          <li key={`li-${i}`} style={{ fontSize: '14px', lineHeight: '160%', color: 'var(--text-main)', paddingLeft: '4px' }}>
            {renderInline(content)}
          </li>
        );
      } else if (trimmed === '') {
        flushList(`list-empty-${i}`);
        // Add a line break spacer for paragraphs
        elements.push(<div key={`spacer-${i}`} style={{ height: '8px' }} />);
      } else {
        flushList(`list-text-${i}`);
        elements.push(
          <p key={`p-${i}`} style={{ fontSize: '14px', lineHeight: '160%', color: 'var(--text-main)', marginBottom: '8px' }}>
            {renderInline(line)}
          </p>
        );
      }
    }

    flushList('list-end');
    return elements;
  };

  return (
    <div style={styles.container}>
      <canvas ref={canvasRef} style={styles.canvasBackground} />
      
      {/* Top Banner */}
      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button 
              onClick={onToggleSidebar}
              className="mobile-hamburger-btn"
              title="Toggle Knowledge Library"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-secondary)" strokeWidth="2.5">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          <div style={styles.headerTitle}>
            <div style={styles.pulseDot} />
            <span style={{ fontSize: '13px', fontWeight: '600', color: '#e2e8f0' }}>NeuroLens Session</span>
          </div>
        </div>
        
        <div style={{
          ...styles.modelTag,
          fontSize: isMobile ? '10px' : '11px',
          padding: isMobile ? '3px 8px' : '4px 10px'
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px' }}>
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
          {activeModel}
        </div>
      </div>

      {/* Messages Feed */}
      <div style={styles.feed} className="responsive-feed">
        {messages.length === 0 ? (
          <div style={styles.welcomeContainer} className="animate-fade-in">
            <div style={styles.welcomeIcon} className="animate-float">
              <svg width="48" height="48" viewBox="0 0 100 100" fill="none">
                <circle cx="50" cy="50" r="40" stroke="url(#welcome-grad)" strokeWidth="3" strokeDasharray="5 5" />
                <path d="M50 30 V70 M30 50 H70" stroke="#00f5d4" strokeWidth="4" strokeLinecap="round" />
                <defs>
                  <linearGradient id="welcome-grad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#9d4edd" />
                    <stop offset="100%" stopColor="#00f5d4" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <h1 style={styles.welcomeTitle} className="responsive-welcome-title">Unveil Document Insights</h1>
            <p style={styles.welcomeSub}>
              NeuroLens leverages semantic vector mapping (FAISS) to scan your uploads and synthesize answers using state-of-the-art LLMs.
            </p>
            
            {!hasDocuments && (
              <div style={styles.actionPromptCard} className="animate-pulse-glow">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-secondary)" strokeWidth="2" style={{ marginTop: '2px' }}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <div style={{ textAlign: 'left' }}>
                  <p style={{ fontWeight: '600', fontSize: '13px', color: '#ffffff' }}>To get started:</p>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Upload text, PDF, or Word files in the left sidebar, then write your question below!
                  </p>
                </div>
              </div>
            )}

            {hasDocuments && (
              <div style={styles.suggestions}>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700', marginBottom: '10px' }}>
                  Quick Queries
                </p>
                <div style={styles.suggestionGrid}>
                  <button onClick={() => handleSuggestionClick("Summarize the uploaded documents")} style={styles.suggestionBtn}>
                    Summarize the documents
                  </button>
                  <button onClick={() => handleSuggestionClick("What are the key points in these files?")} style={styles.suggestionBtn}>
                    List key findings
                  </button>
                  <button onClick={() => handleSuggestionClick("Are there any action items mentioned?")} style={styles.suggestionBtn}>
                    Extract action items
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div 
              key={idx} 
              style={{
                ...styles.messageWrapper,
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start'
              }}
            >
              {/* Message Bubble */}
              <div 
                className="animate-slide-up responsive-bubble"
                style={{
                  ...styles.messageBubble,
                  ...(msg.role === 'user' ? styles.userBubble : styles.assistantBubble)
                }}
              >
                {/* Bubble Text */}
                <div style={styles.bubbleText}>
                  {msg.role === 'user' ? msg.content : formatMessageText(msg.content)}
                </div>

                {/* Assistant Control Actions (Speak & Sources) */}
                {msg.role === 'assistant' && (
                  <div style={styles.assistantActionsRow}>
                    {msg.sources && msg.sources.length > 0 && (
                      <button 
                        onClick={() => toggleSources(idx)} 
                        style={styles.sourcesToggleBtn}
                      >
                        <svg 
                          width="12" 
                          height="12" 
                          viewBox="0 0 24 24" 
                          fill="none" 
                          stroke="currentColor" 
                          strokeWidth="2.5"
                          style={{
                            transform: expandedSources[idx] ? 'rotate(180deg)' : 'rotate(0deg)',
                            transition: 'transform 0.2s',
                            marginRight: '6px'
                          }}
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                        {expandedSources[idx] ? 'Hide retrieved sources' : `Show retrieved sources (${msg.sources.length})`}
                      </button>
                    )}
                    
                    <button
                      onClick={() => toggleSpeak(msg.content, idx)}
                      style={styles.speakBtn}
                      className={`speak-btn ${speakingIndex === idx ? 'speaking' : ''}`}
                    >
                      {speakingIndex === idx ? (
                        <>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-secondary)" strokeWidth="2.5" className="voice-waves" style={{ marginRight: '6px' }}>
                            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                          </svg>
                          <span style={{ color: 'var(--color-secondary)' }}>Mute Voice</span>
                        </>
                      ) : (
                        <>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: '6px' }}>
                            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                          </svg>
                          <span>Speak Response</span>
                        </>
                      )}
                    </button>
                  </div>
                )}

                {/* Sources Citation List Details */}
                {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && expandedSources[idx] && (
                  <div style={styles.sourcesList} className="animate-fade-in">
                    {msg.sources.map((src, srcIdx) => (
                      <div key={srcIdx} style={styles.sourceCard}>
                        <div style={styles.sourceCardHeader}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={styles.sourceBadge}>Source {srcIdx + 1}</span>
                            <span style={styles.sourceDocName} title={src.source}>{src.source}</span>
                          </div>
                          {src.page && <span style={styles.sourcePage}>Page {src.page}</span>}
                        </div>
                        <p style={styles.sourceContent}>"{src.content}"</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        {/* Generating Animation */}
        {isGenerating && (
          <div style={styles.messageWrapper} className="animate-slide-up">
            <div 
              className="responsive-bubble"
              style={{ 
                ...styles.messageBubble, 
                ...styles.assistantBubble, 
                padding: isMobile ? '12px 14px' : '16px',
                maxWidth: isMobile ? '90%' : '75%'
              }}
            >
              <div style={styles.typingContainer}>
                <span style={styles.typingDot} />
                <span style={{ ...styles.typingDot, animationDelay: '0.2s' }} />
                <span style={{ ...styles.typingDot, animationDelay: '0.4s' }} />
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '8px', fontFamily: 'var(--font-heading)' }}>
                  Scanning FAISS index & analyzing...
                </span>
              </div>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input Form Footer */}
      <form onSubmit={handleSubmit} style={styles.form} className="responsive-form">
        <div style={styles.inputWrapper} className="glow-cyan">
          {/* Language Toggle Button */}
          <button
            type="button"
            onClick={toggleSpeechLanguage}
            disabled={!hasDocuments}
            className="voice-lang-toggle-btn"
            style={{
              ...styles.langToggleBtn,
              opacity: !hasDocuments ? 0.35 : 1,
              cursor: !hasDocuments ? 'not-allowed' : 'pointer'
            }}
            title={!hasDocuments ? "Upload documents first to enable voice" : `Speech Recognition Language: ${speechLang === 'en-US' ? 'English' : 'Hindi'}. Click to toggle.`}
          >
            {speechLang === 'en-US' ? 'EN' : 'HI'}
          </button>

          <input
            ref={inputRef}
            type="text"
            placeholder={
              !hasDocuments 
                ? "Upload documents first to start analyzing..." 
                : "Ask NeuroLens anything about your documents..."
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={isGenerating || !hasDocuments}
            readOnly={isListening}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            className="responsive-input"
            style={{
              ...styles.input,
              cursor: isListening ? 'default' : (!hasDocuments ? 'not-allowed' : 'text')
            }}
          />

          {/* Voice Input Microphone Button */}
          <button
            type="button"
            onClick={toggleListening}
            disabled={isGenerating || !hasDocuments}
            className={`voice-mic-btn ${isListening ? 'listening' : ''}`}
            style={{
              ...styles.micBtn,
              opacity: !hasDocuments ? 0.35 : 1,
              cursor: !hasDocuments ? 'not-allowed' : 'pointer'
            }}
            title={!hasDocuments ? "Upload documents first to enable voice" : isListening ? "Listening... Click to stop." : "Voice Input (Speech-to-Text)"}
          >
            <svg 
              width="18" 
              height="18" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke={isListening ? "var(--color-secondary)" : "currentColor"} 
              strokeWidth="2.5"
              className={isListening ? "mic-listening-pulse" : ""}
            >
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>

          <button 
            type="submit" 
            disabled={isGenerating || !query.trim() || !hasDocuments}
            style={{
              ...styles.sendBtn,
              background: (!query.trim() || isGenerating || !hasDocuments) ? 'rgba(255,255,255,0.03)' : 'linear-gradient(135deg, var(--color-primary), #7b2cbf)',
              color: (!query.trim() || isGenerating || !hasDocuments) ? 'var(--text-muted)' : '#ffffff',
              cursor: (!query.trim() || isGenerating || !hasDocuments) ? 'not-allowed' : 'pointer'
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}

const styles = {
  container: {
    flex: 1,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: `radial-gradient(circle, rgba(6, 8, 20, 0.4) 0%, rgba(6, 8, 20, 0.88) 100%), url("${import.meta.env.BASE_URL}neural_bg.png") center/cover no-repeat`,
    position: 'relative',
    overflow: 'hidden'
  },
  canvasBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    zIndex: 0,
    pointerEvents: 'none',
    opacity: 0.55
  },
  header: {
    height: '64px',
    borderBottom: '1px solid var(--border-light)',
    padding: '0 24px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: 'rgba(7, 9, 19, 0.6)',
    backdropFilter: 'var(--glass-effect)',
    position: 'relative',
    zIndex: 2
  },
  headerTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  pulseDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: 'var(--color-secondary)',
    boxShadow: '0 0 8px var(--color-secondary)'
  },
  modelTag: {
    background: 'rgba(157, 78, 221, 0.08)',
    border: '1px solid rgba(157, 78, 221, 0.15)',
    color: '#c084fc',
    fontSize: '11px',
    fontWeight: '700',
    padding: '4px 10px',
    borderRadius: '20px',
    display: 'flex',
    alignItems: 'center',
    fontFamily: 'var(--font-heading)',
    letterSpacing: '0.5px'
  },
  feed: {
    flex: 1,
    overflowY: 'auto',
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    position: 'relative',
    zIndex: 1
  },
  welcomeContainer: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    maxWidth: '540px',
    margin: 'auto',
    padding: '40px 20px'
  },
  welcomeIcon: {
    marginBottom: '24px'
  },
  welcomeTitle: {
    fontFamily: 'var(--font-heading)',
    fontSize: '32px',
    fontWeight: '800',
    marginBottom: '12px',
    background: 'linear-gradient(135deg, #ffffff 40%, #00f5d4 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    letterSpacing: '-0.5px'
  },
  welcomeSub: {
    fontSize: '14px',
    color: 'var(--text-muted)',
    lineHeight: '160%',
    marginBottom: '28px'
  },
  actionPromptCard: {
    background: 'rgba(0, 245, 212, 0.03)',
    border: '1px solid rgba(0, 245, 212, 0.1)',
    borderRadius: '12px',
    padding: '16px 20px',
    display: 'flex',
    gap: '14px',
    width: '100%',
    boxShadow: '0 4px 20px rgba(0, 245, 212, 0.02)'
  },
  suggestions: {
    width: '100%'
  },
  suggestionGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    width: '100%'
  },
  suggestionBtn: {
    width: '100%',
    padding: '12px 16px',
    textAlign: 'left',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: '8px',
    color: '#e2e8f0',
    fontFamily: 'var(--font-sans)',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s',
    outline: 'none'
  },
  messageWrapper: {
    display: 'flex',
    width: '100%'
  },
  messageBubble: {
    maxWidth: '75%',
    borderRadius: '16px',
    padding: '16px 20px',
    lineHeight: '160%',
    fontSize: '14.5px',
    fontFamily: 'var(--font-sans)',
    boxShadow: '0 4px 20px rgba(0,0,0,0.15)'
  },
  userBubble: {
    background: 'linear-gradient(135deg, #7b2cbf, #5a189a)',
    color: '#ffffff',
    borderTopRightRadius: '2px',
    border: '1px solid rgba(255, 255, 255, 0.08)'
  },
  assistantBubble: {
    background: 'rgba(13, 20, 38, 0.88)',
    color: '#e2e8f0',
    borderTopLeftRadius: '2px',
    border: '1px solid var(--border-light)',
    borderLeft: '3px solid var(--color-primary)',
    backdropFilter: 'var(--glass-effect)'
  },
  bubbleText: {
    whiteSpace: 'pre-wrap'
  },
  sourcesWrapper: {
    marginTop: '14px',
    borderTop: '1px solid rgba(255, 255, 255, 0.06)',
    paddingTop: '10px'
  },
  sourcesToggleBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--color-secondary)',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    outline: 'none',
    opacity: 0.9,
    padding: '2px 0'
  },
  assistantActionsRow: {
    marginTop: '14px',
    borderTop: '1px solid rgba(255, 255, 255, 0.06)',
    paddingTop: '10px',
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    flexWrap: 'wrap'
  },
  speakBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-muted)',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    outline: 'none',
    opacity: 0.9,
    padding: '2px 0',
    transition: 'color 0.2s, opacity 0.2s'
  },
  sourcesList: {
    marginTop: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  sourceCard: {
    background: 'rgba(2, 3, 9, 0.4)',
    border: '1px solid rgba(255, 255, 255, 0.04)',
    borderRadius: '8px',
    padding: '10px 12px'
  },
  sourceCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '6px'
  },
  sourceBadge: {
    fontSize: '9px',
    fontWeight: '700',
    textTransform: 'uppercase',
    color: 'var(--color-primary)',
    background: 'rgba(157, 78, 221, 0.1)',
    padding: '1px 6px',
    borderRadius: '4px'
  },
  sourceDocName: {
    fontSize: '11px',
    fontWeight: '600',
    color: '#cbd5e1',
    maxWidth: '200px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  sourcePage: {
    fontSize: '10px',
    fontWeight: '600',
    color: 'var(--color-secondary)'
  },
  sourceContent: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    fontStyle: 'italic',
    lineHeight: '140%'
  },
  form: {
    padding: '16px 24px 24px 24px',
    background: 'rgba(7, 9, 19, 0.3)',
    position: 'relative',
    zIndex: 2
  },
  inputWrapper: {
    background: 'rgba(13, 18, 36, 0.6)',
    backdropFilter: 'var(--glass-effect)',
    border: '1px solid var(--border-light)',
    borderRadius: '14px',
    padding: '6px',
    display: 'flex',
    alignItems: 'center',
    boxShadow: 'var(--shadow-premium)',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
  },
  input: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    color: '#ffffff',
    padding: '12px 16px',
    fontSize: '14px',
    fontFamily: 'var(--font-sans)',
    outline: 'none'
  },
  langToggleBtn: {
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid var(--border-light)',
    borderRadius: '8px',
    color: 'var(--color-secondary)',
    fontSize: '11px',
    fontWeight: '700',
    padding: '6px 10px',
    cursor: 'pointer',
    marginLeft: '6px',
    fontFamily: 'var(--font-heading)',
    transition: 'all 0.2s',
    outline: 'none',
    flexShrink: 0
  },
  micBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-muted)',
    padding: '12px',
    borderRadius: '10px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: '6px',
    transition: 'all 0.2s',
    outline: 'none',
    flexShrink: 0
  },
  sendBtn: {
    padding: '12px',
    borderRadius: '10px',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s',
    outline: 'none',
    flexShrink: 0
  },
  typingContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px'
  },
  typingDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: 'var(--color-secondary)',
    opacity: 0.4,
    animation: 'pulseGlow 1.2s infinite ease-in-out'
  }
};
