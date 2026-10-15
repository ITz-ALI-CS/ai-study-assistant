import { useEffect, useState } from "react";
import { api } from "./api";
import "./Extras.css";

const MODES = [
  ["short", "Short"],
  ["detailed", "Detailed"],
  ["bullets", "Bullets"],
];

const LEVELS = [
  ["easy", "Easy"],
  ["medium", "Medium"],
  ["hard", "Hard"],
];

const COUNTS = [3, 5, 10];
const CARD_COUNTS = [5, 10, 15];
const LETTERS = ["A", "B", "C", "D"];

function SummaryTab({ doc, onChange, onError, onDocUpdate }) {
  const [mode, setMode] = useState("short");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setLoading(true);
    onError("");
    try {
      const res = await api.summary(doc.id, mode);
      onDocUpdate({ summary: res.summary });
      onChange();
    } catch (e) {
      onError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(doc.summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      onError("Could not copy");
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
      }}
    >
      <div className="stylebar" style={{ paddingBottom: 8 }}>
        <span className="muted">Style</span>
        <div className="seg">
          {MODES.map(([key, label]) => (
            <button
              key={key}
              className={mode === key ? "on" : ""}
              onClick={() => setMode(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button
          className="btn-primary"
          style={{ padding: "0 14px" }}
          disabled={loading}
          onClick={generate}
        >
          {loading ? "Working…" : doc.summary ? "Regenerate" : "Generate"}
        </button>
      </div>

      <div className="msgs">
        {!doc.summary && !loading && (
          <div className="empty">
            Choose a style and click Generate to summarize this document.
          </div>
        )}
        {loading && <div className="empty">Writing your summary…</div>}
        {doc.summary && !loading && (
          <div className="bubble ai" style={{ maxWidth: "100%" }}>
            {doc.summary}
          </div>
        )}
      </div>

      {doc.summary && !loading && (
        <div className="composer" style={{ justifyContent: "flex-end" }}>
          <button className="btn" onClick={copy}>
            {copied ? "Copied" : "Copy summary"}
          </button>
        </div>
      )}
    </div>
  );
}

function QuizTab({ doc, onChange, onError }) {
  const [level, setLevel] = useState("medium");
  const [count, setCount] = useState(5);
  const [quiz, setQuiz] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  async function start() {
    setLoading(true);
    onError("");
    try {
      const q = await api.quiz(doc.id, level, count);
      setQuiz(q);
      setAnswers(new Array(q.questions.length).fill(-1));
      setResult(null);
    } catch (e) {
      onError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function pick(qi, oi) {
    if (result) return;
    setAnswers((a) => a.map((v, i) => (i === qi ? oi : v)));
  }

  async function submit() {
    setLoading(true);
    onError("");
    try {
      const res = await api.submitQuiz(quiz.quiz_id, answers);
      setResult(res);
      onChange();
    } catch (e) {
      onError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setQuiz(null);
    setResult(null);
    setAnswers([]);
  }

  if (!quiz) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
        }}
      >
        <div className="empty">
          <div style={{ marginBottom: 14 }}>
            Make a quiz from this document.
          </div>
          <div
            className="stylebar"
            style={{ justifyContent: "center", padding: "0 0 10px" }}
          >
            <span className="muted">Difficulty</span>
            <div className="seg">
              {LEVELS.map(([key, label]) => (
                <button
                  key={key}
                  className={level === key ? "on" : ""}
                  onClick={() => setLevel(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div
            className="stylebar"
            style={{ justifyContent: "center", padding: "0 0 16px" }}
          >
            <span className="muted">Questions</span>
            <div className="seg">
              {COUNTS.map((n) => (
                <button
                  key={n}
                  className={count === n ? "on" : ""}
                  onClick={() => setCount(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <button
            className="btn-primary"
            style={{ padding: "0 22px" }}
            disabled={loading}
            onClick={start}
          >
            {loading ? "Creating quiz…" : "Start quiz"}
          </button>
        </div>
      </div>
    );
  }

  const answered = answers.filter((a) => a >= 0).length;
  const total = quiz.questions.length;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
      }}
    >
      <div className="msgs">
        {result && (
          <div className="score-box">
            Score: {result.score} / {result.total}
          </div>
        )}

        {quiz.questions.map((q, qi) => {
          const r = result ? result.results[qi] : null;
          return (
            <div className="qcard" key={qi}>
              <div className="qtext">
                {qi + 1}. {q.question}
              </div>
              {q.options.map((opt, oi) => {
                let cls = "opt";
                if (r) {
                  if (oi === r.correct_index) cls += " right";
                  else if (oi === r.chosen) cls += " wrong";
                } else if (answers[qi] === oi) {
                  cls += " sel";
                }
                return (
                  <button key={oi} className={cls} onClick={() => pick(qi, oi)}>
                    {LETTERS[oi]}. {opt}
                  </button>
                );
              })}
              {r && r.explanation && (
                <div className="explain">{r.explanation}</div>
              )}
            </div>
          );
        })}
      </div>

      <div
        className="composer"
        style={{ justifyContent: "space-between", alignItems: "center" }}
      >
        {result ? (
          <>
            <span className="muted small">+{result.score * 5} XP earned</span>
            <button
              className="btn-primary"
              style={{ padding: "0 18px" }}
              onClick={reset}
            >
              New quiz
            </button>
          </>
        ) : (
          <>
            <span className="muted small">
              Answered {answered} / {total}
            </span>
            <button
              className="btn-primary"
              style={{ padding: "0 18px" }}
              disabled={loading || answered < total}
              onClick={submit}
            >
              {loading ? "Checking…" : "Submit answers"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function CardsTab({ doc, onChange, onError }) {
  const [total, setTotal] = useState(0);
  const [due, setDue] = useState([]);
  const [count, setCount] = useState(10);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [studying, setStudying] = useState(false);
  const [queue, setQueue] = useState([]);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState(0);
  const [finished, setFinished] = useState(null);

  async function load() {
    try {
      const [all, dueList] = await Promise.all([
        api.cards(doc.id, false),
        api.cards(doc.id, true),
      ]);
      setTotal(all.length);
      setDue(dueList);
    } catch (e) {
      onError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function generate() {
    setWorking(true);
    onError("");
    try {
      await api.makeCards(doc.id, count);
      await load();
    } catch (e) {
      onError(e.message);
    } finally {
      setWorking(false);
    }
  }

  function startStudy() {
    setQueue(due);
    setIdx(0);
    setFlipped(false);
    setKnown(0);
    setFinished(null);
    setStudying(true);
  }

  async function answer(correct) {
    if (saving) return;
    const card = queue[idx];
    setSaving(true);
    try {
      await api.reviewCard(card.id, correct);
    } catch (e) {
      onError(e.message);
      setSaving(false);
      return;
    }
    setSaving(false);
    const newKnown = known + (correct ? 1 : 0);
    setKnown(newKnown);
    onChange();
    if (idx + 1 >= queue.length) {
      setFinished({ known: newKnown, total: queue.length });
      setStudying(false);
      await load();
    } else {
      setIdx(idx + 1);
      setFlipped(false);
    }
  }

  if (loading) return <div className="empty">Loading cards…</div>;

  if (studying) {
    const card = queue[idx];
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
        }}
      >
        <div className="msgs" style={{ justifyContent: "center" }}>
          <div className="muted small" style={{ textAlign: "center" }}>
            Card {idx + 1} of {queue.length}
          </div>
          <div className="flash" onClick={() => setFlipped(true)}>
            <div className="flash-label">{flipped ? "Answer" : "Question"}</div>
            <div className="flash-text">
              {flipped ? card.answer : card.question}
            </div>
            {!flipped && (
              <div className="muted small">Click to show the answer</div>
            )}
          </div>
          {flipped ? (
            <div className="flash-actions">
              <button
                className="btn"
                disabled={saving}
                onClick={() => answer(false)}
              >
                Again
              </button>
              <button
                className="btn-primary"
                disabled={saving}
                onClick={() => answer(true)}
              >
                Got it
              </button>
            </div>
          ) : (
            <div className="flash-actions">
              <button className="btn" onClick={() => setFlipped(true)}>
                Show answer
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
      }}
    >
      <div className="msgs">
        <div className="stats-row">
          <div className="stat-mini">
            <b>{total}</b>
            <span>Total cards</span>
          </div>
          <div className="stat-mini">
            <b>{due.length}</b>
            <span>Due now</span>
          </div>
        </div>

        {finished && (
          <div className="score-box">
            Session done: {finished.known} / {finished.total} remembered
          </div>
        )}

        {total === 0 && (
          <div className="empty" style={{ padding: 10 }}>
            No flashcards yet. Generate some from this document.
          </div>
        )}
        {total > 0 && due.length === 0 && !finished && (
          <div className="empty" style={{ padding: 10 }}>
            All caught up. Cards you miss come back sooner, and cards you know
            come back later.
          </div>
        )}

        <button
          className="btn-primary"
          style={{ height: 40 }}
          disabled={due.length === 0}
          onClick={startStudy}
        >
          {due.length
            ? `Study ${due.length} due card${due.length === 1 ? "" : "s"}`
            : "No cards due"}
        </button>

        <div className="stylebar" style={{ padding: 0, marginTop: 6 }}>
          <span className="muted">New cards</span>
          <div className="seg">
            {CARD_COUNTS.map((n) => (
              <button
                key={n}
                className={count === n ? "on" : ""}
                onClick={() => setCount(n)}
              >
                {n}
              </button>
            ))}
          </div>
          <span className="spacer" />
          <button className="btn" disabled={working} onClick={generate}>
            {working ? "Creating…" : "Generate"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DashboardTab({ onError }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .dashboard()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => onError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) return <div className="empty">Loading dashboard…</div>;

  const xp = data.user.xp;
  const level = Math.floor(xp / 100) + 1;
  const into = xp % 100;
  const badges = [
    ["First document", data.documents >= 1],
    ["Quiz taker", data.quizzes_taken >= 1],
    ["3 day streak", data.user.streak >= 3],
    [
      "Sharp mind (80%+ average)",
      data.quizzes_taken >= 1 && data.average_score >= 80,
    ],
    ["100 XP", xp >= 100],
  ];

  return (
    <div className="msgs">
      <div className="level-box">
        <div className="row">
          <span>Level {level}</span>
          <span>{into} / 100 XP to next level</span>
        </div>
        <div className="bar">
          <div style={{ width: `${into}%` }} />
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-tile">
          <b>{xp}</b>
          <span>Total XP</span>
        </div>
        <div className="stat-tile">
          <b>{data.user.streak}</b>
          <span>Day streak</span>
        </div>
        <div className="stat-tile">
          <b>{data.documents}</b>
          <span>Documents</span>
        </div>
        <div className="stat-tile">
          <b>{data.quizzes_taken}</b>
          <span>Quizzes taken</span>
        </div>
        <div className="stat-tile">
          <b>{data.average_score}%</b>
          <span>Average score</span>
        </div>
        <div className="stat-tile">
          <b>{data.cards_due}</b>
          <span>Cards due</span>
        </div>
      </div>

      <div className="section-title">Badges</div>
      <div className="badges">
        {badges.map(([label, on]) => (
          <span key={label} className={"badge" + (on ? " on" : "")}>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function TabContent({
  tab,
  doc,
  onChange,
  onError,
  onDocUpdate,
}) {
  if (tab === "dashboard") return <DashboardTab onError={onError} />;
  if (!doc) return <div className="empty">Pick a document first.</div>;
  if (tab === "summary") {
    return (
      <SummaryTab
        doc={doc}
        onChange={onChange}
        onError={onError}
        onDocUpdate={onDocUpdate}
      />
    );
  }
  if (tab === "quiz") {
    return <QuizTab doc={doc} onChange={onChange} onError={onError} />;
  }
  if (tab === "cards") {
    return <CardsTab doc={doc} onChange={onChange} onError={onError} />;
  }
  return <div className="empty">Pick a tab.</div>;
}
