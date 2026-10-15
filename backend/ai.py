import os
import re
import json
from dotenv import load_dotenv
from groq import Groq
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

load_dotenv()
client = Groq(api_key=os.getenv("GROQ_API_KEY"))
MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")

# If the whole document is shorter than this many characters, send all of it.
# Lower this number if you ever see a rate-limit / "too many tokens" error.
WHOLE_DOC_LIMIT = 16000


def ask_llm(system: str, user: str, json_mode: bool = False, history=None) -> str:
    messages = [{"role": "system", "content": system}]
    for m in history or []:
        messages.append({"role": m["role"], "content": m["content"]})
    messages.append({"role": "user", "content": user})
    extra = {"response_format": {"type": "json_object"}} if json_mode else {}
    res = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        temperature=0.2,
        **extra,
    )
    return res.choices[0].message.content


def chunk_pages(pages, size=1200, overlap=200):
    chunks = []
    for page_no, text in pages:
        text = " ".join(text.split())
        start = 0
        while start < len(text):
            piece = text[start:start + size]
            if piece.strip():
                chunks.append((page_no, piece))
            start += size - overlap
    return chunks


def top_chunks(question, chunks, k=8):
    if not chunks:
        return []
    try:
        vec = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), sublinear_tf=True)
        matrix = vec.fit_transform([c.content for c in chunks] + [question])
    except ValueError:
        return []
    scores = cosine_similarity(matrix[-1], matrix[:-1]).flatten()
    best = scores.argsort()[::-1][:k]
    return [chunks[i] for i in best if scores[i] > 0]


def build_context(question, chunks):
    """Whole document if it is small, otherwise the best matching pieces in reading order."""
    if not chunks:
        return []
    total = sum(len(c.content) for c in chunks)
    if total <= WHOLE_DOC_LIMIT:
        picked = list(chunks)
    else:
        picked = top_chunks(question, chunks, k=8)
    return sorted(picked, key=lambda c: c.id)


def split_answer(raw):
    """Separates the answer from the final 'PAGES: 1, 3' line the AI writes."""
    text = raw.strip()
    match = re.search(r"PAGES:\s*([^\n]*)\s*$", text)
    if not match:
        return text, None
    answer = text[:match.start()].strip()
    pages = sorted({int(p) for p in re.findall(r"\d+", match.group(1))})
    return answer, pages


def generate_quiz(text, count, difficulty):
    system = (
        "You create multiple-choice quizzes from study notes. Return ONLY JSON like "
        '{"questions":[{"question":"...","options":["A","B","C","D"],"answer_index":0,"explanation":"..."}]}. '
        f"Make exactly {count} {difficulty} questions. Each has 4 options and one correct answer. Use only the notes."
    )
    data = json.loads(ask_llm(system, text[:12000], json_mode=True))
    good = []
    for q in data.get("questions", []):
        opts = q.get("options")
        idx = q.get("answer_index")
        if q.get("question") and isinstance(opts, list) and len(opts) == 4 and isinstance(idx, int) and 0 <= idx < 4:
            good.append(q)
    if not good:
        raise RuntimeError("AI returned an invalid quiz. Try again.")
    return good


def generate_flashcards(text, count):
    system = (
        "You create flashcards from study notes. Return ONLY JSON like "
        '{"cards":[{"question":"...","answer":"..."}]}. '
        f"Make {count} short, clear flashcards. Use only the notes."
    )
    data = json.loads(ask_llm(system, text[:12000], json_mode=True))
    cards = [c for c in data.get("cards", []) if c.get("question") and c.get("answer")]
    if not cards:
        raise RuntimeError("AI returned no flashcards. Try again.")
    return cards