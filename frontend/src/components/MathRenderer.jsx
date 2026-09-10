import { useState } from 'react';
import katex from 'katex';

/**
 * Safely renders LaTeX string into KaTeX HTML string
 */
function getKatexHtml(latex, displayMode = false) {
  try {
    return katex.renderToString(latex, {
      displayMode: displayMode,
      throwOnError: false,
      output: 'htmlAndMathml'
    });
  } catch (err) {
    console.warn("KaTeX render error:", err);
    return null;
  }
}

/**
 * Display Math Card with copy button and sci-fi holographic container
 */
export function DisplayMathBlock({ formula, rawMatch }) {
  const [copied, setCopied] = useState(false);

  // Clean formula if needed
  let cleaned = formula ? formula.trim() : '';
  if (cleaned.startsWith('$$') && cleaned.endsWith('$$')) {
    cleaned = cleaned.slice(2, -2).trim();
  } else if (cleaned.startsWith('\\[') && cleaned.endsWith('\\]')) {
    cleaned = cleaned.slice(2, -2).trim();
  }

  const html = getKatexHtml(cleaned, true);

  const handleCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(cleaned || formula || rawMatch || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="katex-math-card animate-fade-in" role="region" aria-label="Mathematical formula">
      <div className="katex-math-header">
        <div className="katex-math-badge">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M4 19h16" />
            <path d="M4 5h16" />
            <path d="M14 5v14" />
            <path d="M10 5l4 14" />
          </svg>
          Formula
        </div>
        <button 
          type="button" 
          onClick={handleCopy} 
          className="katex-copy-btn"
          title="Copy LaTeX formula"
        >
          {copied ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span style={{ color: '#22c55e' }}>Copied!</span>
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy LaTeX
            </>
          )}
        </button>
      </div>

      {html ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre style={{ color: '#f87171', fontFamily: 'var(--font-mono)', fontSize: '13px', whiteSpace: 'pre-wrap' }}>
          {cleaned}
        </pre>
      )}
    </div>
  );
}

/**
 * Inline Math renderer with KaTeX
 */
export function InlineMath({ formula }) {
  let cleaned = formula ? formula.trim() : '';
  if (cleaned.startsWith('$') && cleaned.endsWith('$')) {
    cleaned = cleaned.slice(1, -1).trim();
  } else if (cleaned.startsWith('\\(') && cleaned.endsWith('\\)')) {
    cleaned = cleaned.slice(2, -2).trim();
  }

  const html = getKatexHtml(cleaned, false);

  if (!html) {
    return <code className="katex-inline-math">{cleaned}</code>;
  }

  return (
    <span 
      className="katex-inline-math" 
      dangerouslySetInnerHTML={{ __html: html }} 
    />
  );
}

/**
 * Fenced Code Block Card with copy functionality
 */
export function CodeBlockCard({ code, language = '' }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="code-block-card animate-fade-in">
      <div className="code-block-header">
        <span>{language ? language.toUpperCase() : 'CODE'}</span>
        <button 
          type="button" 
          onClick={handleCopy} 
          className="katex-copy-btn"
          title="Copy code"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <div className="code-block-body">
        <code>{code}</code>
      </div>
    </div>
  );
}

/**
 * Markdown Table Renderer
 */
export function MarkdownTable({ rows }) {
  if (!rows || rows.length < 2) return null;

  const parseRow = (line) => {
    return line
      .split('|')
      .map(c => c.trim())
      .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
  };

  const headerCells = parseRow(rows[0]);
  const bodyRows = rows.slice(2).map(parseRow);

  return (
    <div className="markdown-table-card animate-fade-in">
      <table className="markdown-table">
        <thead>
          <tr>
            {headerCells.map((cell, idx) => (
              <th key={idx}>{renderInlineMarkdown(cell)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, rIdx) => (
            <tr key={rIdx}>
              {row.map((cell, cIdx) => (
                <td key={cIdx}>{renderInlineMarkdown(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Parses inline formatting:
 * - Inline LaTeX Math: $...$ or \(...\)
 * - Bold: **...**
 * - Italic: *...*
 * - Inline Code: `...`
 * - Source Citations: [Source X]
 * - Markdown Links: [text](url)
 */
export function renderInlineMarkdown(inlineText) {
  if (!inlineText) return '';

  // Regex splitting on inline tokens
  // 1: Inline math $...$ or \(...\)
  // 2: Bold **...**
  // 3: Italic *...*
  // 4: Code `...`
  // 5: Source tag [Source X]
  // 6: Markdown link [label](url)
  const inlineRegex = /(\$(?!\s)(?:[^\$\n]+?)(?<!\s)\$|\\\([\s\S]*?\\\)|(?:\*\*.*?\*\*)|(?:\*.*?\*)|(?:`.*?`)|(?:\[Source \d+\])|(?:\[[^\]]+\]\([^)]+\)))/g;

  const parts = inlineText.split(inlineRegex);

  return parts.map((part, idx) => {
    if (!part) return null;

    // 1. Inline Math: $...$ or \(...\)
    if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
      const inside = part.slice(1, -1);
      // Avoid matching pure numbers/currency e.g. $100
      if (!/^\d+(?:\.\d+)?$/.test(inside.trim())) {
        return <InlineMath key={`math-${idx}`} formula={inside} />;
      }
    }
    if (part.startsWith('\\(') && part.endsWith('\\)')) {
      const inside = part.slice(2, -2);
      return <InlineMath key={`math-paren-${idx}`} formula={inside} />;
    }

    // 2. Bold: **...**
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <strong key={`b-${idx}`} style={{ color: '#ffffff', fontWeight: '700' }}>
          {renderInlineMarkdown(part.slice(2, -2))}
        </strong>
      );
    }

    // 3. Italic: *...*
    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      return (
        <em key={`em-${idx}`} style={{ color: '#cbd5e1', fontStyle: 'italic' }}>
          {renderInlineMarkdown(part.slice(1, -1))}
        </em>
      );
    }

    // 4. Code: `...`
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <code 
          key={`code-${idx}`} 
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

    // 5. Source Citation: [Source X]
    if (part.match(/^\[Source \d+\]$/)) {
      return (
        <span 
          key={`src-${idx}`} 
          style={{
            background: 'rgba(0, 245, 212, 0.12)',
            border: '1px solid rgba(0, 245, 212, 0.3)',
            color: 'var(--color-secondary)',
            padding: '1px 6px',
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: '600',
            margin: '0 2px',
            display: 'inline-block',
            boxShadow: '0 0 6px rgba(0, 245, 212, 0.25)'
          }}
        >
          {part}
        </span>
      );
    }

    // 6. Markdown Link: [label](url)
    if (part.startsWith('[') && part.includes('](')) {
      const closingBracketIdx = part.indexOf('](');
      const label = part.substring(1, closingBracketIdx);
      const url = part.substring(closingBracketIdx + 2, part.length - 1);
      return (
        <a
          key={`link-${idx}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: '#00f5d4',
            textDecoration: 'underline',
            fontWeight: '600',
            transition: 'color 0.2s'
          }}
          onMouseOver={(e) => e.target.style.color = '#9d4edd'}
          onMouseOut={(e) => e.target.style.color = '#00f5d4'}
        >
          {label}
        </a>
      );
    }

    return part;
  });
}

/**
 * Top-level Message Formatter that parses:
 * - Code Blocks (```lang ... ```)
 * - LaTeX Display Math ($$ ... $$, \[ ... \], \begin{cases/align/matrix/...} ... \end{...})
 * - Tables
 * - Headers (#, ##, ###)
 * - Lists (unordered, ordered)
 * - Paragraphs with inline markdown & math
 */
export function formatStructuredMessage(text) {
  if (!text) return null;

  // Pattern to extract display math and fenced code blocks
  // 1: Fenced code blocks ```lang ... ```
  // 2: Display math $$ ... $$
  // 3: Display math \[ ... \]
  // 4: LaTeX environments \begin{...} ... \end{...}
  const blockRegex = /(```(?:[a-zA-Z0-9_-]*)\n[\s\S]*?```|\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\begin\{(?:equation|align|gather|cases|matrix|pmatrix|bmatrix|vmatrix)\*?\}[\s\S]*?\\end\{(?:equation|align|gather|cases|matrix|pmatrix|bmatrix|vmatrix)\*?\})/g;

  const topSegments = text.split(blockRegex);
  const elements = [];

  topSegments.forEach((segment, segIdx) => {
    if (!segment) return;

    // Check if segment is Fenced Code Block
    if (segment.startsWith('```') && segment.endsWith('```')) {
      const firstNewline = segment.indexOf('\n');
      const lang = segment.slice(3, firstNewline).trim();
      const code = segment.slice(firstNewline + 1, -3);

      // If code block language is math or latex, render as math formula
      if (lang === 'latex' || lang === 'math' || lang === 'katex') {
        elements.push(<DisplayMathBlock key={`block-code-math-${segIdx}`} formula={code} rawMatch={segment} />);
      } else {
        elements.push(<CodeBlockCard key={`code-${segIdx}`} code={code} language={lang} />);
      }
      return;
    }

    // Check if segment is Display Math: $$ ... $$
    if (segment.startsWith('$$') && segment.endsWith('$$') && segment.length >= 4) {
      const formula = segment.slice(2, -2);
      elements.push(<DisplayMathBlock key={`math-double-${segIdx}`} formula={formula} rawMatch={segment} />);
      return;
    }

    // Check if segment is Display Math: \[ ... \]
    if (segment.startsWith('\\[') && segment.endsWith('\\]') && segment.length >= 4) {
      const formula = segment.slice(2, -2);
      elements.push(<DisplayMathBlock key={`math-bracket-${segIdx}`} formula={formula} rawMatch={segment} />);
      return;
    }

    // Check if segment is LaTeX environment: \begin{...} ... \end{...}
    if (segment.startsWith('\\begin{')) {
      elements.push(<DisplayMathBlock key={`math-env-${segIdx}`} formula={segment} rawMatch={segment} />);
      return;
    }

    // Otherwise, segment is Markdown Text — process line-by-line (Headers, Lists, Tables, Paragraphs)
    const lines = segment.split('\n');
    let listItems = [];
    let insideList = false;
    let listType = null;
    let tableLines = [];
    let insideTable = false;

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

    const flushTable = (key) => {
      if (tableLines.length >= 2) {
        elements.push(<MarkdownTable key={key} rows={tableLines} />);
      }
      tableLines = [];
      insideTable = false;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Table line detection
      if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.split('|').length > 2) {
        flushList(`list-before-table-${segIdx}-${i}`);
        insideTable = true;
        tableLines.push(trimmed);
        continue;
      } else if (insideTable) {
        flushTable(`table-${segIdx}-${i}`);
      }

      // Headers (###, ##, #)
      if (trimmed.startsWith('### ')) {
        flushList(`list-before-h3-${segIdx}-${i}`);
        elements.push(
          <h3 key={`h3-${segIdx}-${i}`} style={{ fontFamily: 'var(--font-heading)', color: '#ffffff', fontSize: '15.5px', fontWeight: '700', marginTop: '16px', marginBottom: '8px' }}>
            {renderInlineMarkdown(trimmed.substring(4))}
          </h3>
        );
        continue;
      }
      if (trimmed.startsWith('## ')) {
        flushList(`list-before-h2-${segIdx}-${i}`);
        elements.push(
          <h2 key={`h2-${segIdx}-${i}`} style={{ fontFamily: 'var(--font-heading)', color: '#ffffff', fontSize: '17.5px', fontWeight: '700', marginTop: '18px', marginBottom: '10px' }}>
            {renderInlineMarkdown(trimmed.substring(3))}
          </h2>
        );
        continue;
      }
      if (trimmed.startsWith('# ')) {
        flushList(`list-before-h1-${segIdx}-${i}`);
        elements.push(
          <h1 key={`h1-${segIdx}-${i}`} style={{ fontFamily: 'var(--font-heading)', color: '#ffffff', fontSize: '19.5px', fontWeight: '800', marginTop: '20px', marginBottom: '12px' }}>
            {renderInlineMarkdown(trimmed.substring(2))}
          </h1>
        );
        continue;
      }

      // Lists (Unordered & Ordered)
      const isBulletList = trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('• ');
      const isOrderedList = /^\d+\.\s/.test(trimmed);

      if (isBulletList || isOrderedList) {
        const currentType = isOrderedList ? 'ordered' : 'unordered';
        if (insideList && listType !== currentType) {
          flushList(`list-type-change-${segIdx}-${i}`);
        }
        
        insideList = true;
        listType = currentType;
        
        const content = isOrderedList 
          ? trimmed.substring(trimmed.indexOf('.') + 1).trim()
          : trimmed.substring(2).trim();
          
        listItems.push(
          <li key={`li-${segIdx}-${i}`} style={{ fontSize: '14px', lineHeight: '165%', color: 'var(--text-main)', paddingLeft: '4px' }}>
            {renderInlineMarkdown(content)}
          </li>
        );
      } else if (trimmed === '') {
        flushList(`list-empty-${segIdx}-${i}`);
        elements.push(<div key={`spacer-${segIdx}-${i}`} style={{ height: '8px' }} />);
      } else {
        flushList(`list-text-${segIdx}-${i}`);
        elements.push(
          <p key={`p-${segIdx}-${i}`} style={{ fontSize: '14px', lineHeight: '165%', color: 'var(--text-main)', marginBottom: '8px' }}>
            {renderInlineMarkdown(line)}
          </p>
        );
      }
    }

    flushList(`list-end-${segIdx}`);
    flushTable(`table-end-${segIdx}`);
  });

  return elements;
}
