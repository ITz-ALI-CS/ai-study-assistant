import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import "./Workspace.css";
import TabContent from "./TabContent";
import { PdfViewer, TextViewer } from "./Viewers";

const STYLES = [
  ["simple", "Simple"],
  ["exam", "Exam"],
  ["deep", "Deep"],
];

const TABS = [
  ["chat", "Chat"],
  ["summary", "Summary"],
  ["quiz", "Quiz"],
  ["cards", "Cards"],
  ["dashboard", "Dashboard"],
];

export default function Workspace({ user, onLogout, onUserChange }) {
  const [docs, setDocs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [doc, setDoc] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState("");
  const [style, setStyle] = useState("exam");
  const [tab, setTab] = useState("chat");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const fileRef = useRef(null);
  const endRef = useRef(null);

  function refreshUser() {
    api
      .me()
      .then(onUserChange)
      .catch(() => {});
  }

  async function loadDocs(selectId) {
    try {
      const list = await api.documents();
      setDocs(list);
      if (selectId !== undefined) setActiveId(selectId);
      else if (list.length)
        setActiveId((cur) => (cur === null ? list[0].id : cur));
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDocs();
  }, []);

  useEffect(() => {
    if (activeId === null) return;
    let cancelled = false;
    let url = null;

    async function load() {
      setDoc(null);
      setMessages([]);
      setPdfUrl(null);
      setPage(1);
      setZoom(1);
      try {
        const [d, history] = await Promise.all([
          api.document(activeId),
          api.chatHistory(activeId),
        ]);
        if (cancelled) return;
        setDoc(d);
        setMessages(history);
        if (d.has_file) {
          url = await api.fileBlobUrl(activeId);
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          setPdfUrl(url);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    }

    load();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [activeId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, asking]);

  async function onFile(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.upload(file);
      await loadDocs(res.id);
      refreshUser();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function savePaste() {
    if (!pasteTitle.trim() || !pasteText.trim()) {
      setError("Enter a title and some notes");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await api.paste(pasteTitle.trim(), pasteText);
      setShowPaste(false);
      setPasteTitle("");
      setPasteText("");
      await loadDocs(res.id);
      refreshUser();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeDoc(id) {
    if (!window.confirm("Delete this document?")) return;
    try {
      await api.remove(id);
      const list = await api.documents();
      setDocs(list);
      if (id === activeId) {
        if (list.length) {
          setActiveId(list[0].id);
        } else {
          setActiveId(null);
          setDoc(null);
          setMessages([]);
          setPdfUrl(null);
        }
      }
    } catch (e) {
      setError(e.message);
    }
  }

  async function ask(text) {
    const q = (text ?? question).trim();
    if (!q || !doc || asking) return;
    setError("");
    setQuestion("");
    setMessages((m) => [...m, { role: "user", content: q, sources: [] }]);
    setAsking(true);
    try {
      const res = await api.chat(doc.id, q, style);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: res.answer, sources: res.sources },
      ]);
      refreshUser();
    } catch (e) {
      setError(e.message);
    } finally {
      setAsking(false);
    }
  }

  const totalPages = doc?.pages || 1;

  return (
    <div className="ws">
      <header className="topbar">
        <span className="logo">
          <span className="logo-dot" />
          Study Assistant
        </span>
        <span className="doc-title">{doc ? doc.title : ""}</span>
        <span className="spacer" />
        <span className="pill">Streak {user.streak}</span>
        <span className="pill">{user.xp} XP</span>
        <span className="muted">{user.name}</span>
        <button className="btn" onClick={onLogout}>
          Log out
        </button>
      </header>

      {error && (
        <div className="error banner">
          <span>{error}</span>
          <button className="x" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}

      <div className="ws-body">
        <aside className="panel">
          <div className="panel-head">Documents</div>
          <div className="panel-body">
            {docs.length === 0 && (
              <div className="muted small">No documents yet.</div>
            )}
            {docs.map((d) => (
              <div
                key={d.id}
                className={"doc-item" + (d.id === activeId ? " active" : "")}
                onClick={() => setActiveId(d.id)}
              >
                <span className="name">{d.title}</span>
                <button
                  className="x"
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeDoc(d.id);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="side-actions">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.txt"
              hidden
              onChange={onFile}
            />
            <button
              className="btn"
              disabled={busy}
              onClick={() => fileRef.current.click()}
            >
              {busy ? "Working…" : "Upload file"}
            </button>
            <div className="muted small" style={{ textAlign: "center" }}>
              PDF, Word (.docx) or TXT
            </div>
            <button className="btn" onClick={() => setShowPaste(!showPaste)}>
              Paste notes
            </button>
            {showPaste && (
              <div className="paste-box">
                <input
                  placeholder="Title"
                  value={pasteTitle}
                  onChange={(e) => setPasteTitle(e.target.value)}
                />
                <textarea
                  placeholder="Paste your notes here"
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                />
                <button
                  className="btn-primary"
                  disabled={busy}
                  onClick={savePaste}
                >
                  Save notes
                </button>
              </div>
            )}
          </div>
        </aside>

        <section className="panel">
          <div className="panel-head">
            <button
              className="btn"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ‹
            </button>
            <span>
              Page {page} / {totalPages}
            </span>
            <button
              className="btn"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              ›
            </button>
            {doc && doc.has_file && (
              <div className="zoom-group">
                <button
                  className="btn"
                  disabled={zoom <= 0.6}
                  onClick={() =>
                    setZoom((z) => Math.max(0.6, +(z - 0.2).toFixed(1)))
                  }
                >
                  −
                </button>
                <span>{Math.round(zoom * 100)}%</span>
                <button
                  className="btn"
                  disabled={zoom >= 2.4}
                  onClick={() =>
                    setZoom((z) => Math.min(2.4, +(z + 0.2).toFixed(1)))
                  }
                >
                  +
                </button>
                <button className="btn" onClick={() => setZoom(1)}>
                  Fit
                </button>
              </div>
            )}
          </div>
          {!doc && (
            <div className="empty">
              {docs.length
                ? "Loading…"
                : "Upload a PDF, Word file or paste notes to start."}
            </div>
          )}
          {doc && doc.has_file && !pdfUrl && (
            <div className="empty">Loading PDF…</div>
          )}
          {doc && doc.has_file && pdfUrl && (
            <PdfViewer key={pdfUrl} url={pdfUrl} page={page} zoom={zoom} />
          )}
          {doc && !doc.has_file && (
            <TextViewer key={doc.id} docId={doc.id} page={page} />
          )}
        </section>

        <section className="panel">
          <div className="tabs">
            {TABS.map(([key, label]) => (
              <button
                key={key}
                className={"tab" + (tab === key ? " active" : "")}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "chat" ? (
            <>
              <div className="stylebar">
                <span className="muted">Answer style</span>
                <div className="seg">
                  {STYLES.map(([key, label]) => (
                    <button
                      key={key}
                      className={style === key ? "on" : ""}
                      onClick={() => setStyle(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="msgs">
                {!doc && (
                  <div className="empty">
                    Pick a document to start chatting.
                  </div>
                )}
                {doc && messages.length === 0 && (
                  <div className="empty">
                    Ask anything about your notes.
                    <div className="suggest">
                      {[
                        "Summarize the main idea",
                        "What are the key terms?",
                      ].map((s) => (
                        <button key={s} className="btn" onClick={() => ask(s)}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={"bubble " + (m.role === "user" ? "user" : "ai")}
                  >
                    {m.content}
                    {m.sources?.length > 0 && (
                      <div className="sources">
                        {m.sources.map((p) => (
                          <button
                            key={p}
                            className="chip"
                            onClick={() => setPage(p)}
                          >
                            Page {p}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {asking && <div className="bubble ai muted">Thinking…</div>}
                <div ref={endRef} />
              </div>

              <div className="composer">
                <input
                  placeholder="Ask about your notes"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && ask()}
                />
                <button
                  className="btn-primary"
                  disabled={asking || !doc}
                  onClick={() => ask()}
                >
                  Send
                </button>
              </div>
            </>
          ) : (
            <TabContent
              key={doc ? doc.id : "none"}
              tab={tab}
              doc={doc}
              onChange={refreshUser}
              onError={setError}
              onDocUpdate={(patch) => setDoc((d) => ({ ...d, ...patch }))}
            />
          )}
        </section>
      </div>
    </div>
  );
}
