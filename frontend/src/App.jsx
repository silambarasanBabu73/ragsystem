import { useState, useEffect, useRef, useCallback } from "react";

const API = "http://localhost:8000";

const ICONS = { pdf: "📕", docx: "📘", txt: "📄" };

function formatTime(iso) {
  return new Date(iso || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ── SourcePanel ─────────────────────────────────────────────
function SourcePanel({ sources, onClose }) {
  return (
    <div style={styles.sourceOverlay}>
      <div style={styles.sourcePanel}>
        <div style={styles.sourcePanelHeader}>
          <span style={styles.sourcePanelTitle}>📎 Source Excerpts</span>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>
        <div style={styles.sourcePanelBody}>
          {sources.map((s, i) => (
            <div key={i} style={styles.sourceChunk}>
              <div style={styles.sourceChunkMeta}>
                <span style={styles.sourceChunkNum}>Excerpt {i + 1}</span>
                <span style={styles.sourceChunkPage}>{s.approx_page}</span>
                <span style={styles.sourceChunkSim}>{s.similarity}% match</span>
              </div>
              <p style={styles.sourceChunkText}>{s.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Message ──────────────────────────────────────────────────
function Message({ msg, onShowSources }) {
  const isUser = msg.role === "user";
  return (
    <div style={{ ...styles.msgRow, justifyContent: isUser ? "flex-end" : "flex-start" }}>
      {!isUser && <div style={styles.botAvatar}>🤖</div>}
      <div style={{ maxWidth: "70%", display: "flex", flexDirection: "column", gap: 4, alignItems: isUser ? "flex-end" : "flex-start" }}>
        <div style={{
          ...styles.bubble,
          ...(isUser ? styles.userBubble : styles.botBubble),
          ...(msg.noAnswer ? styles.noAnswerBubble : {}),
        }}>
          {msg.loading
            ? <TypingDots />
            : <span style={{ whiteSpace: "pre-wrap", lineHeight: 1.65 }}>{msg.text}</span>
          }
        </div>
        <div style={styles.msgMeta}>
          {!isUser && msg.model && <span style={styles.metaTag}>🦙 {msg.model}</span>}
          {!isUser && msg.sources?.length > 0 && (
            <button style={styles.sourcesBtn} onClick={() => onShowSources(msg.sources)}>
              📎 {msg.sources.length} source{msg.sources.length > 1 ? "s" : ""}
            </button>
          )}
          <span style={styles.metaTime}>{formatTime(msg.ts)}</span>
        </div>
      </div>
      {isUser && <div style={styles.userAvatar}>👤</div>}
    </div>
  );
}

function TypingDots() {
  return (
    <div style={styles.typingDots}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{ ...styles.dot, animationDelay: `${i * 0.2}s` }} />
      ))}
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────
export default function App() {
  const [docs, setDocs] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("llama3");
  const [ollamaOk, setOllamaOk] = useState(null);
  const [showSources, setShowSources] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [sidebarTab, setSidebarTab] = useState("docs");
  const messagesEndRef = useRef(null);
  const fileRef = useRef(null);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });

  useEffect(() => { scrollToBottom(); }, [messages]);

  const fetchDocs = useCallback(async () => {
    try {
      const r = await fetch(`${API}/documents`);
      setDocs(await r.json());
    } catch {}
  }, []);

  const fetchHealth = useCallback(async () => {
    try {
      const r = await fetch(`${API}/health`);
      const d = await r.json();
      setOllamaOk(d.ollama);
      setModels(d.models || []);
      if (d.models?.length) setSelectedModel(d.models[0]);
    } catch { setOllamaOk(false); }
  }, []);

  useEffect(() => {
    fetchDocs();
    fetchHealth();
    const t = setInterval(fetchHealth, 10000);
    return () => clearInterval(t);
  }, [fetchDocs, fetchHealth]);

  const uploadFiles = async (files) => {
    setUploading(true);
    for (const file of files) {
      const form = new FormData();
      form.append("file", file);
      try {
        const r = await fetch(`${API}/upload`, { method: "POST", body: form });
        const d = await r.json();
        if (r.ok) {
          setMessages(m => [...m, {
            role: "bot", text: `✅ **${d.name}** indexed — ${d.chunks} chunks ready.`,
            ts: new Date().toISOString(), model: null, sources: []
          }]);
        } else {
          setMessages(m => [...m, {
            role: "bot", text: `❌ Failed to upload "${file.name}": ${d.detail}`,
            ts: new Date().toISOString(), noAnswer: true, sources: []
          }]);
        }
      } catch (e) {
        setMessages(m => [...m, {
          role: "bot", text: `❌ Upload error: ${e.message}`,
          ts: new Date().toISOString(), noAnswer: true, sources: []
        }]);
      }
      await fetchDocs();
    }
    setUploading(false);
  };

  const handleFileChange = (e) => {
    if (e.target.files.length) uploadFiles([...e.target.files]);
    e.target.value = "";
  };

  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    uploadFiles([...e.dataTransfer.files]);
  };

  const deleteDoc = async (id) => {
    await fetch(`${API}/documents/${id}`, { method: "DELETE" });
    fetchDocs();
  };

  const sendMessage = async () => {
    const q = input.trim();
    if (!q || loading) return;
    setInput("");

    const userMsg = { role: "user", text: q, ts: new Date().toISOString() };
    const botMsg = { role: "bot", text: "", loading: true, ts: new Date().toISOString(), sources: [] };
    setMessages(m => [...m, userMsg, botMsg]);
    setLoading(true);

    try {
      const r = await fetch(`${API}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, model: selectedModel }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "Server error");
      setMessages(m => [
        ...m.slice(0, -1),
        { role: "bot", text: d.answer, ts: new Date().toISOString(), model: d.model, sources: d.sources || [], noAnswer: d.answer?.startsWith("I don't have") }
      ]);
    } catch (e) {
      setMessages(m => [
        ...m.slice(0, -1),
        { role: "bot", text: `⚠️ ${e.message}`, ts: new Date().toISOString(), noAnswer: true, sources: [] }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const activeDoc = docs.find(d => d.is_active);

  return (
    <div style={styles.root}>
      {/* SIDEBAR */}
      <aside style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
          <div style={styles.logo}>RAG<span style={styles.logoDim}>bot</span></div>
          <div style={styles.tagline}>LOCAL · PRIVATE · VECTOR SEARCH</div>
          <div style={styles.ollamaStatus}>
            <span style={{ ...styles.statusDot, background: ollamaOk ? "#7bff8b" : "#ff6b6b", boxShadow: ollamaOk ? "0 0 6px #7bff8b" : "none" }} />
            <span style={styles.statusLabel}>{ollamaOk === null ? "Checking Ollama…" : ollamaOk ? "Ollama connected" : "Ollama offline"}</span>
          </div>
        </div>

        {/* Upload Zone */}
        <div
          style={{ ...styles.uploadZone, ...(dragOver ? styles.uploadZoneHover : {}) }}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept=".pdf,.docx,.txt" multiple hidden onChange={handleFileChange} />
          <span style={styles.uploadIcon}>{uploading ? "⏳" : "📤"}</span>
          <strong style={styles.uploadTitle}>{uploading ? "Processing…" : "Upload Document"}</strong>
          <span style={styles.uploadSub}>PDF · DOCX · TXT — drop or click</span>
        </div>

        {/* Docs list */}
        <div style={styles.docListTitle}>DOCUMENTS</div>
        <div style={styles.docList}>
          {docs.length === 0 && <div style={styles.emptyDocs}>No documents yet</div>}
          {docs.map(doc => (
            <div key={doc.id} style={{ ...styles.docItem, ...(doc.is_active ? styles.docItemActive : styles.docItemInactive) }}>
              <span style={styles.docItemIcon}>{ICONS[doc.ext] || "📄"}</span>
              <div style={styles.docItemInfo}>
                <div style={styles.docItemName} title={doc.name}>{doc.name}</div>
                <div style={styles.docItemMeta}>{doc.chunk_count} chunks · {new Date(doc.uploaded_at).toLocaleDateString()}</div>
              </div>
              {doc.is_active && <span style={styles.activeBadge}>ACTIVE</span>}
              <button style={styles.delBtn} onClick={() => deleteDoc(doc.id)} title="Remove">✕</button>
            </div>
          ))}
        </div>

        {/* Model selector */}
        {models.length > 0 && (
          <div style={styles.modelSection}>
            <div style={styles.docListTitle}>MODEL</div>
            <select
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              style={styles.modelSelect}
            >
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        )}

        <div style={styles.sidebarFooter}>
          🔒 100% local — ChromaDB + Ollama<br/>No data leaves your machine
        </div>
      </aside>

      {/* MAIN */}
      <main style={styles.main}>
        {/* Header */}
        <div style={styles.chatHeader}>
          <div style={styles.headerLeft}>
            <div style={{ ...styles.headerDot, background: activeDoc ? "#7bff8b" : "#555", boxShadow: activeDoc ? "0 0 8px #7bff8b" : "none" }} />
            <div>
              <div style={styles.headerDocLabel}>Active Document</div>
              <div style={styles.headerDocName}>{activeDoc?.name || "No document loaded"}</div>
            </div>
          </div>
          {activeDoc && (
            <div style={styles.headerStats}>
              <span style={styles.statPill}>{activeDoc.chunk_count} chunks</span>
              <span style={styles.statPill}>🦙 {selectedModel}</span>
            </div>
          )}
        </div>

        {/* Messages */}
        <div style={styles.messages}>
          {messages.length === 0 && (
            <div style={styles.welcome}>
              <div style={styles.welcomeIcon}>🗂️</div>
              <h2 style={styles.welcomeH2}>Upload a document to begin</h2>
              <p style={styles.welcomeP}>Your questions are answered using vector search + a local LLM.<br/>No API keys. No internet. Fully private.</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <Message key={i} msg={msg} onShowSources={setShowSources} />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div style={styles.inputArea}>
          <div style={styles.inputRow}>
            <div style={styles.inputWrap}>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder={activeDoc ? `Ask about "${activeDoc.name}"…` : "Upload a document first…"}
                disabled={!activeDoc || loading}
                rows={1}
                style={styles.textarea}
              />
            </div>
            <button onClick={sendMessage} disabled={!activeDoc || loading || !input.trim()} style={styles.sendBtn}>
              {loading ? "⏳" : "➤"}
            </button>
          </div>
          <div style={styles.inputHint}>Enter to send · Shift+Enter for newline · Answers only from the latest document</div>
        </div>
      </main>

      {/* Source panel */}
      {showSources && <SourcePanel sources={showSources} onClose={() => setShowSources(null)} />}
    </div>
  );
}

// ── STYLES ────────────────────────────────────────────────────
const C = {
  bg: "#0c0e0c", surface: "#121512", surface2: "#181d18",
  border: "#252a25", accent: "#7bff8b", accentDim: "#3a7042",
  text: "#e6ede6", muted: "#728072", danger: "#ff6b6b",
};

const styles = {
  root: { display: "flex", height: "100vh", background: C.bg, color: C.text, fontFamily: "'DM Mono', 'Courier New', monospace", overflow: "hidden" },
  sidebar: { width: 290, minWidth: 290, background: C.surface, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column" },
  sidebarHeader: { padding: "24px 20px 16px", borderBottom: `1px solid ${C.border}` },
  logo: { fontFamily: "Georgia, serif", fontSize: 24, color: C.accent, letterSpacing: -1 },
  logoDim: { color: C.muted, fontStyle: "italic" },
  tagline: { fontSize: 9, color: C.muted, letterSpacing: 2, textTransform: "uppercase", marginTop: 4 },
  ollamaStatus: { display: "flex", alignItems: "center", gap: 7, marginTop: 12 },
  statusDot: { width: 7, height: 7, borderRadius: "50%", flexShrink: 0 },
  statusLabel: { fontSize: 10, color: C.muted },
  uploadZone: { margin: "16px 12px", border: `1.5px dashed ${C.border}`, borderRadius: 10, padding: "18px 12px", textAlign: "center", cursor: "pointer", transition: "all 0.2s" },
  uploadZoneHover: { borderColor: C.accent, background: "rgba(123,255,139,0.04)" },
  uploadIcon: { display: "block", fontSize: 24, marginBottom: 6 },
  uploadTitle: { display: "block", fontSize: 11, color: C.accent, marginBottom: 3 },
  uploadSub: { fontSize: 10, color: C.muted },
  docListTitle: { fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: C.muted, padding: "0 20px 8px" },
  docList: { flex: 1, overflowY: "auto", padding: "0 10px" },
  emptyDocs: { textAlign: "center", fontSize: 11, color: C.muted, padding: 20 },
  docItem: { display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 8, marginBottom: 3, border: "1px solid transparent", transition: "all 0.15s", position: "relative" },
  docItemActive: { background: "rgba(123,255,139,0.06)", borderColor: C.accentDim },
  docItemInactive: { opacity: 0.4 },
  docItemIcon: { fontSize: 16, flexShrink: 0 },
  docItemInfo: { flex: 1, minWidth: 0 },
  docItemName: { fontSize: 11, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  docItemMeta: { fontSize: 9, color: C.muted, marginTop: 2 },
  activeBadge: { fontSize: 8, background: C.accent, color: "#000", padding: "2px 6px", borderRadius: 10, fontWeight: 700, flexShrink: 0 },
  delBtn: { background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 13, padding: "1px 4px", borderRadius: 4, flexShrink: 0 },
  modelSection: { padding: "10px 12px 4px" },
  modelSelect: { width: "100%", background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 7, color: C.text, padding: "7px 10px", fontSize: 11, fontFamily: "inherit", outline: "none" },
  sidebarFooter: { padding: "12px 20px", borderTop: `1px solid ${C.border}`, fontSize: 9, color: C.muted, lineHeight: 1.7 },
  main: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
  chatHeader: { padding: "16px 28px", borderBottom: `1px solid ${C.border}`, background: C.surface, display: "flex", alignItems: "center", justifyContent: "space-between" },
  headerLeft: { display: "flex", alignItems: "center", gap: 12 },
  headerDot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
  headerDocLabel: { fontSize: 10, color: C.muted },
  headerDocName: { fontSize: 13, fontWeight: 500 },
  headerStats: { display: "flex", gap: 8 },
  statPill: { fontSize: 10, background: C.surface2, border: `1px solid ${C.border}`, padding: "4px 10px", borderRadius: 20, color: C.muted },
  messages: { flex: 1, overflowY: "auto", padding: "24px 28px", display: "flex", flexDirection: "column", gap: 14 },
  welcome: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, textAlign: "center", padding: 40, marginTop: "auto", marginBottom: "auto" },
  welcomeIcon: { fontSize: 48, opacity: 0.35 },
  welcomeH2: { fontFamily: "Georgia, serif", fontSize: 20, color: C.text, opacity: 0.5, fontWeight: "normal" },
  welcomeP: { fontSize: 12, color: C.muted, lineHeight: 1.8, maxWidth: 380 },
  msgRow: { display: "flex", gap: 10, alignItems: "flex-end" },
  botAvatar: { fontSize: 20, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, flexShrink: 0 },
  userAvatar: { fontSize: 20, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(123,255,139,0.1)", borderRadius: 8, flexShrink: 0 },
  bubble: { padding: "11px 15px", borderRadius: 12, fontSize: 13 },
  userBubble: { background: "#1b2a1b", border: `1px solid ${C.accentDim}`, borderRadius: "12px 4px 12px 12px" },
  botBubble: { background: C.surface2, border: `1px solid ${C.border}`, borderRadius: "4px 12px 12px 12px" },
  noAnswerBubble: { borderColor: "rgba(255,107,107,0.3)", color: C.muted },
  msgMeta: { display: "flex", alignItems: "center", gap: 8, padding: "0 4px" },
  metaTag: { fontSize: 9, color: C.muted, background: C.surface2, padding: "2px 7px", borderRadius: 10, border: `1px solid ${C.border}` },
  metaTime: { fontSize: 9, color: C.muted },
  sourcesBtn: { fontSize: 9, color: C.accent, background: "rgba(123,255,139,0.08)", border: `1px solid ${C.accentDim}`, padding: "2px 8px", borderRadius: 10, cursor: "pointer" },
  typingDots: { display: "flex", gap: 5, padding: "4px 0" },
  dot: { width: 6, height: 6, borderRadius: "50%", background: C.muted, animation: "bounce 1.2s infinite", display: "inline-block" },
  inputArea: { padding: "16px 28px 20px", borderTop: `1px solid ${C.border}`, background: C.surface },
  inputRow: { display: "flex", gap: 10, alignItems: "flex-end" },
  inputWrap: { flex: 1, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 12, padding: "11px 15px" },
  textarea: { width: "100%", background: "none", border: "none", outline: "none", color: C.text, fontFamily: "inherit", fontSize: 13, resize: "none", lineHeight: 1.5, minHeight: 20, maxHeight: 120 },
  sendBtn: { width: 44, height: 44, borderRadius: 10, border: "none", background: C.accent, color: "#000", fontSize: 17, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  inputHint: { fontSize: 9, color: C.muted, marginTop: 8 },
  sourceOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" },
  sourcePanel: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, width: "90%", maxWidth: 680, maxHeight: "80vh", display: "flex", flexDirection: "column" },
  sourcePanelHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 24px", borderBottom: `1px solid ${C.border}` },
  sourcePanelTitle: { fontWeight: 600, fontSize: 14 },
  closeBtn: { background: "none", border: "none", color: C.muted, fontSize: 18, cursor: "pointer" },
  sourcePanelBody: { overflowY: "auto", padding: "16px 24px", display: "flex", flexDirection: "column", gap: 16 },
  sourceChunk: { background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px" },
  sourceChunkMeta: { display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" },
  sourceChunkNum: { fontSize: 10, fontWeight: 700, color: C.accent },
  sourceChunkPage: { fontSize: 10, color: C.muted },
  sourceChunkSim: { fontSize: 10, background: "rgba(123,255,139,0.1)", color: C.accent, padding: "1px 8px", borderRadius: 10, border: `1px solid ${C.accentDim}` },
  sourceChunkText: { fontSize: 12, lineHeight: 1.7, color: C.text },
};
