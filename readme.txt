# Quivly — AI Revision Assistant

Full-stack revision web app for students: manage notes, chat with an AI in note context, generate podcasts (TTS), flashcards, and quizzes. Includes authentication, autosave, optional note locks, reminders, and a recycle bin.

## Features

- **Accounts** — Register, login, password hashing (Werkzeug), session-based auth (Flask-Login)
- **Notes** — Dashboard, rich note editor, autosave
- **AI chat** — Per-note conversation history backed by OpenAI
- **Podcasts** — Script generation + MP3 via OpenAI Speech; served from `/static/uploads/podcasts`
- **Study aids** — Flashcards and quiz generation from note content
- **Reminders & locks** — Optional idle-based reminders and per-note passwords
- **Recycle bin** — Soft delete, restore, permanent delete, bulk trash

## Tech stack

| Layer        | Details |
|-------------|---------|
| **Backend** | Python 3, Flask 3, Flask-Login, Flask-SQLAlchemy, Werkzeug |
| **Frontend**| Jinja2 templates, CSS, vanilla JavaScript |
| **Database**| SQLite locally (`database.db`), PostgreSQL optional via `DATABASE_URL` |
| **AI / TTS**| OpenAI API (`openai` Python SDK) |

## How to run (simple)

1. Open the project folder in a terminal.
2. Install dependencies: `pip install -r requirements.txt`
3. Create a `.env` file with:
   - `SECRET_KEY=your_secret_key`
   - `OPENAI_API_KEY=your_openai_key`
4. Start the app: `python app.py`
5. Open `http://127.0.0.1:5000` in your browser.

## Project layout

```
├── app.py              # Flask app & routes
├── models.py           # SQLAlchemy models (User, Note)
├── requirements.txt    # Python dependencies
├── templates/          # HTML (Jinja2)
├── static/
│   ├── css/
│   ├── js/
│   └── uploads/        # Podcast MP3 cache (written at runtime)
└── assets/             # Static images / icons
```

## Author

**Adam H. Ahmadi** — 3rd Year Computer Science

---

*Viewing this repository is allowed; redistribution or reuse of project materials may require the author’s permission.*
