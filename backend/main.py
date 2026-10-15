import io
import os
import json
import time
from datetime import datetime, date, timedelta

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from pypdf import PdfReader
from sqlalchemy import func
from sqlalchemy.orm import Session

import ai
import models
import readers
from auth import hash_password, verify_password, create_token, get_current_user
from database import Base, engine, get_db

Base.metadata.create_all(bind=engine)
os.makedirs("uploads", exist_ok=True)

app = FastAPI(title="AI Study Assistant")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

STYLES = {
    "simple": "Explain in very simple words.",
    "exam": "Give a short exam-style answer with the key points.",
    "deep": "Give a detailed explanation with an example.",
}


class SignupIn(BaseModel):
    name: str
    email: str
    password: str


class PasteIn(BaseModel):
    title: str
    text: str


class ChatIn(BaseModel):
    question: str
    style: str = "exam"


class SubmitIn(BaseModel):
    answers: list[int]


class ReviewIn(BaseModel):
    correct: bool


def safe(fn, *args):
    try:
        return fn(*args)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"AI error: {e}")


def touch_streak(user):
    today = date.today()
    if user.last_active == today:
        return
    if user.last_active == today - timedelta(days=1):
        user.streak += 1
    else:
        user.streak = 1
    user.last_active = today


def user_out(u):
    return {"id": u.id, "name": u.name, "email": u.email, "xp": u.xp, "streak": u.streak}


def get_doc(db, doc_id, user):
    doc = db.query(models.Document).filter(
        models.Document.id == doc_id, models.Document.user_id == user.id
    ).first()
    if not doc:
        raise HTTPException(404, "Document not found")
    return doc


def save_document(db, user, title, pages, file_path=None):
    chunks = ai.chunk_pages(pages)
    if not chunks:
        raise HTTPException(400, "No readable text found. Scanned PDFs are not supported yet.")
    doc = models.Document(
        user_id=user.id,
        title=title,
        text="\n".join(t for _, t in pages),
        pages=len(pages),
        file_path=file_path,
    )
    doc.chunks = [models.Chunk(page=p, content=c) for p, c in chunks]
    doc.doc_pages = [models.DocPage(page=p, text=t) for p, t in pages]
    user.xp += 10
    touch_streak(user)
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return {"id": doc.id, "title": doc.title, "pages": doc.pages, "chunks": len(chunks)}


# ---------- Auth ----------
@app.post("/auth/signup")
def signup(data: SignupIn, db: Session = Depends(get_db)):
    email = data.email.strip().lower()
    if "@" not in email or len(data.password) < 6:
        raise HTTPException(400, "Enter a valid email and a password of at least 6 characters")
    if db.query(models.User).filter(models.User.email == email).first():
        raise HTTPException(400, "Email already registered")
    user = models.User(name=data.name.strip(), email=email, password_hash=hash_password(data.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"access_token": create_token(user.id), "token_type": "bearer", "user": user_out(user)}


@app.post("/auth/login")
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    email = form.username.strip().lower()
    user = db.query(models.User).filter(models.User.email == email).first()
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(401, "Wrong email or password")
    return {"access_token": create_token(user.id), "token_type": "bearer", "user": user_out(user)}


@app.get("/auth/me")
def me(user=Depends(get_current_user)):
    return user_out(user)


# ---------- Documents ----------
@app.post("/documents/upload")
def upload(
    file: UploadFile = File(...),
    title: str = Form(None),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    name = file.filename or "notes"
    lower = name.lower()
    data = file.file.read()
    path = None
    if lower.endswith(".pdf"):
        try:
            reader = PdfReader(io.BytesIO(data))
            pages = [(i + 1, p.extract_text() or "") for i, p in enumerate(reader.pages)]
        except Exception:
            raise HTTPException(400, "Could not read this PDF")
        path = os.path.join("uploads", f"{user.id}_{int(time.time())}.pdf")
        with open(path, "wb") as f:
            f.write(data)
    elif lower.endswith(".docx"):
        try:
            pages = readers.docx_to_pages(data)
        except Exception:
            raise HTTPException(400, "Could not read this Word file")
    elif lower.endswith(".txt"):
        pages = readers.text_to_pages(data.decode("utf-8", errors="ignore"))
    elif lower.endswith(".doc"):
        raise HTTPException(400, "Old .doc files are not supported. Save it as .docx and upload again.")
    else:
        raise HTTPException(400, "Upload a PDF, Word (.docx) or TXT file")
    return save_document(db, user, title or name, pages, path)


@app.post("/documents/paste")
def paste(data: PasteIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    return save_document(db, user, data.title, readers.text_to_pages(data.text))


@app.get("/documents")
def list_documents(db: Session = Depends(get_db), user=Depends(get_current_user)):
    docs = (
        db.query(models.Document)
        .filter(models.Document.user_id == user.id)
        .order_by(models.Document.created_at.desc())
        .all()
    )
    return [{"id": d.id, "title": d.title, "pages": d.pages, "created_at": d.created_at} for d in docs]


@app.get("/documents/{doc_id}")
def get_document(doc_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    d = get_doc(db, doc_id, user)
    return {"id": d.id, "title": d.title, "pages": d.pages, "summary": d.summary,
            "has_file": bool(d.file_path), "created_at": d.created_at}


@app.get("/documents/{doc_id}/pages")
def get_pages(doc_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    d = get_doc(db, doc_id, user)
    rows = (
        db.query(models.DocPage)
        .filter(models.DocPage.document_id == d.id)
        .order_by(models.DocPage.page)
        .all()
    )
    if not rows:
        return [{"page": 1, "text": d.text}]
    return [{"page": r.page, "text": r.text} for r in rows]


@app.get("/documents/{doc_id}/file")
def get_file(doc_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    d = get_doc(db, doc_id, user)
    if not d.file_path or not os.path.exists(d.file_path):
        raise HTTPException(404, "No file for this document")
    return FileResponse(d.file_path, media_type="application/pdf")


@app.delete("/documents/{doc_id}")
def delete_document(doc_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    d = get_doc(db, doc_id, user)
    if d.file_path and os.path.exists(d.file_path):
        os.remove(d.file_path)
    db.delete(d)
    db.commit()
    return {"deleted": True}


# ---------- Summary ----------
@app.post("/documents/{doc_id}/summary")
def summarize(doc_id: int, mode: str = "short", db: Session = Depends(get_db), user=Depends(get_current_user)):
    d = get_doc(db, doc_id, user)
    styles = {
        "short": "Write a short summary in 5 to 6 sentences.",
        "detailed": "Write a detailed summary with clear headings.",
        "bullets": "Write the key points as bullet points.",
    }
    system = "You are a study assistant. Summarize only the given notes. " + styles.get(mode, styles["short"])
    d.summary = safe(ai.ask_llm, system, d.text[:12000])
    touch_streak(user)
    db.commit()
    return {"summary": d.summary}


# ---------- Chat ----------
@app.post("/documents/{doc_id}/chat")
def chat(doc_id: int, data: ChatIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    d = get_doc(db, doc_id, user)
    question = data.question.strip()
    if not question:
        raise HTTPException(400, "Enter a question")

    picked = ai.build_context(question, d.chunks)
    if not picked:
        answer, pages = "I couldn't find that in your notes.", []
    else:
        context = "\n\n".join(f"[Page {c.page}] {c.content}" for c in picked)
        recent = (
            db.query(models.ChatMessage)
            .filter(models.ChatMessage.document_id == d.id)
            .order_by(models.ChatMessage.id.desc())
            .limit(6)
            .all()
        )
        history = [{"role": m.role, "content": m.content} for m in reversed(recent)]
        system = (
            "You are a careful study assistant. Answer ONLY from the notes provided, "
            "which are labelled with page numbers. Be accurate and complete: cover every relevant "
            "point in the notes and never invent facts. If the notes do not contain the answer, say so. "
            "Write in plain text only: no markdown symbols such as ** or #. Use short lines, and a dash "
            "for list items. " + STYLES.get(data.style, STYLES["exam"]) + " "
            "On the very last line write exactly PAGES: followed by the page numbers you used, "
            "separated by commas, for example PAGES: 1, 3. If you used none, write PAGES: none."
        )
        raw = safe(ai.ask_llm, system, f"Notes:\n{context}\n\nQuestion: {question}", False, history)
        answer, pages = ai.split_answer(raw)
        valid = {c.page for c in picked}
        if pages is None:
            pages = sorted({c.page for c in picked[:3]})
        pages = [p for p in pages if p in valid]

    db.add(models.ChatMessage(document_id=d.id, role="user", content=question))
    db.add(models.ChatMessage(document_id=d.id, role="assistant", content=answer,
                              sources=",".join(str(p) for p in pages)))
    user.xp += 2
    touch_streak(user)
    db.commit()
    return {"answer": answer, "sources": pages}


@app.get("/documents/{doc_id}/chat")
def chat_history(doc_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    d = get_doc(db, doc_id, user)
    msgs = (
        db.query(models.ChatMessage)
        .filter(models.ChatMessage.document_id == d.id)
        .order_by(models.ChatMessage.id)
        .all()
    )
    return [{"role": m.role, "content": m.content,
             "sources": [int(p) for p in m.sources.split(",") if p]} for m in msgs]


# ---------- Quiz ----------
@app.post("/documents/{doc_id}/quiz")
def make_quiz(doc_id: int, difficulty: str = "medium", count: int = 5,
              db: Session = Depends(get_db), user=Depends(get_current_user)):
    d = get_doc(db, doc_id, user)
    questions = safe(ai.generate_quiz, d.text, count, difficulty)
    quiz = models.Quiz(document_id=d.id, difficulty=difficulty, data=json.dumps(questions))
    db.add(quiz)
    db.commit()
    db.refresh(quiz)
    return {
        "quiz_id": quiz.id,
        "difficulty": difficulty,
        "questions": [{"question": q["question"], "options": q["options"]} for q in questions],
    }


@app.post("/quizzes/{quiz_id}/submit")
def submit_quiz(quiz_id: int, data: SubmitIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    quiz = (
        db.query(models.Quiz)
        .join(models.Document)
        .filter(models.Quiz.id == quiz_id, models.Document.user_id == user.id)
        .first()
    )
    if not quiz:
        raise HTTPException(404, "Quiz not found")
    questions = json.loads(quiz.data)
    results, score = [], 0
    for i, q in enumerate(questions):
        chosen = data.answers[i] if i < len(data.answers) else -1
        ok = chosen == q["answer_index"]
        score += 1 if ok else 0
        results.append({
            "question": q["question"],
            "chosen": chosen,
            "correct_index": q["answer_index"],
            "correct": ok,
            "explanation": q.get("explanation", ""),
        })
    db.add(models.QuizAttempt(quiz_id=quiz.id, user_id=user.id, score=score, total=len(questions)))
    user.xp += score * 5
    touch_streak(user)
    db.commit()
    return {"score": score, "total": len(questions), "results": results}


# ---------- Flashcards ----------
@app.post("/documents/{doc_id}/flashcards")
def make_cards(doc_id: int, count: int = 10, db: Session = Depends(get_db), user=Depends(get_current_user)):
    d = get_doc(db, doc_id, user)
    cards = safe(ai.generate_flashcards, d.text, count)
    rows = [models.Flashcard(document_id=d.id, question=c["question"], answer=c["answer"]) for c in cards]
    db.add_all(rows)
    db.commit()
    return [{"id": r.id, "question": r.question, "answer": r.answer} for r in rows]


@app.get("/documents/{doc_id}/flashcards")
def list_cards(doc_id: int, due_only: bool = False, db: Session = Depends(get_db), user=Depends(get_current_user)):
    d = get_doc(db, doc_id, user)
    q = db.query(models.Flashcard).filter(models.Flashcard.document_id == d.id)
    if due_only:
        q = q.filter(models.Flashcard.next_review <= datetime.utcnow())
    return [{"id": c.id, "question": c.question, "answer": c.answer, "box": c.box,
             "next_review": c.next_review} for c in q.all()]


@app.post("/flashcards/{card_id}/review")
def review_card(card_id: int, data: ReviewIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    card = (
        db.query(models.Flashcard)
        .join(models.Document)
        .filter(models.Flashcard.id == card_id, models.Document.user_id == user.id)
        .first()
    )
    if not card:
        raise HTTPException(404, "Card not found")
    gaps = [0, 1, 2, 4, 7, 14]
    card.box = min(card.box + 1, 5) if data.correct else 1
    card.next_review = datetime.utcnow() + timedelta(days=gaps[card.box])
    if data.correct:
        user.xp += 1
    touch_streak(user)
    db.commit()
    return {"box": card.box, "next_review": card.next_review}


# ---------- Dashboard ----------
@app.get("/dashboard")
def dashboard(db: Session = Depends(get_db), user=Depends(get_current_user)):
    docs = db.query(func.count(models.Document.id)).filter(models.Document.user_id == user.id).scalar()
    attempts = db.query(models.QuizAttempt).filter(models.QuizAttempt.user_id == user.id).all()
    total_q = sum(a.total for a in attempts)
    avg = round(sum(a.score for a in attempts) / total_q * 100) if total_q else 0
    due = (
        db.query(models.Flashcard)
        .join(models.Document)
        .filter(models.Document.user_id == user.id, models.Flashcard.next_review <= datetime.utcnow())
        .count()
    )
    return {"user": user_out(user), "documents": docs, "quizzes_taken": len(attempts),
            "average_score": avg, "cards_due": due}