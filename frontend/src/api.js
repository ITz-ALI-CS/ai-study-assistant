const API = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://127.0.0.1:8000" : "");

export function getToken() {
  return localStorage.getItem("token");
}
export function setToken(token) {
  localStorage.setItem("token", token);
}
export function clearToken() {
  localStorage.removeItem("token");
}

// Removes markdown symbols (**, ##, `, * bullets) so text shows clean
function clean(text) {
  return String(text ?? "")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*\*[ \t]+/gm, "- ")
    .replace(/\*/g, "")
    .replace(/`/g, "");
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(API + path, { ...options, headers });
  } catch {
    throw new Error("Can't reach the server. Is the backend running?");
  }

  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    if (res.status === 401 && token) clearToken();
    throw new Error(typeof data?.detail === "string" ? data.detail : "Something went wrong");
  }
  return data;
}

const json = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  signup: (name, email, password) => request("/auth/signup", json("POST", { name, email, password })),

  login: (email, password) => {
    const body = new URLSearchParams();
    body.append("username", email);
    body.append("password", password);
    return request("/auth/login", { method: "POST", body });
  },

  me: () => request("/auth/me"),

  documents: () => request("/documents"),
  document: async (id) => {
    const d = await request(`/documents/${id}`);
    return { ...d, summary: d.summary ? clean(d.summary) : d.summary };
  },
  pages: (id) => request(`/documents/${id}/pages`),
  paste: (title, text) => request("/documents/paste", json("POST", { title, text })),
  upload: (file) => {
    const form = new FormData();
    form.append("file", file);
    return request("/documents/upload", { method: "POST", body: form });
  },
  remove: (id) => request(`/documents/${id}`, { method: "DELETE" }),

  chatHistory: async (id) => {
    const list = await request(`/documents/${id}/chat`);
    return list.map((m) => ({ ...m, content: clean(m.content) }));
  },
  chat: async (id, question, style) => {
    const res = await request(`/documents/${id}/chat`, json("POST", { question, style }));
    return { ...res, answer: clean(res.answer) };
  },

  summary: async (id, mode) => {
    const res = await request(`/documents/${id}/summary?mode=${mode}`, { method: "POST" });
    return { ...res, summary: clean(res.summary) };
  },

  quiz: (id, difficulty, count) =>
    request(`/documents/${id}/quiz?difficulty=${difficulty}&count=${count}`, { method: "POST" }),
  submitQuiz: (quizId, answers) => request(`/quizzes/${quizId}/submit`, json("POST", { answers })),

  cards: (id, dueOnly) => request(`/documents/${id}/flashcards?due_only=${dueOnly ? "true" : "false"}`),
  makeCards: (id, count) => request(`/documents/${id}/flashcards?count=${count}`, { method: "POST" }),
  reviewCard: (cardId, correct) => request(`/flashcards/${cardId}/review`, json("POST", { correct })),

  dashboard: () => request("/dashboard"),

  fileBlobUrl: async (id) => {
    let res;
    try {
      res = await fetch(`${API}/documents/${id}/file`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
    } catch {
      throw new Error("Can't reach the server. Is the backend running?");
    }
    if (!res.ok) throw new Error("Could not load the PDF");
    return URL.createObjectURL(await res.blob());
  },
};