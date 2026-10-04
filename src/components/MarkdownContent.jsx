import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { isSafeHttpUrl } from '../utils/safeUrl.js';

/**
 * Renders AI Markdown (bold, italic, lists, tables, code, links) instead of
 * showing raw ** / | / ` markers. Used for QuantumAI chat bubbles + panel.
 */
export default function MarkdownContent({ text, className = '' }) {
  const source = String(text || '');
  if (!source.trim()) return null;

  return (
    <div className={`md-content ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const url = typeof href === 'string' ? href : '';
            if (!isSafeHttpUrl(url) && !url.startsWith('mailto:')) {
              return <span>{children}</span>;
            }
            return (
              <a href={url} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
          // Avoid nested <p> layout fights inside chat bubbles.
          p: ({ children }) => <p className="md-p">{children}</p>,
          table: ({ children }) => (
            <div className="md-table-wrap">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

export function isAiMarkdownMessage(message) {
  if (!message) return false;
  if (
    message.kind === 'ai' ||
    message.quantumAI === true ||
    message.fromQuantumAI === true
  ) {
    return true;
  }
  // Incoming QuantumAI DM/group rows may only carry systemRole on the peer.
  const role =
    message.fromUser?.systemRole ||
    message.sender?.systemRole ||
    message.fromSystemRole;
  return role === 'quantum_ai';
}
