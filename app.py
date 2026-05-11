# Author: Adam H. Ahmadi ID: 23160330
import html
import importlib
import json
import os
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path

from flask import Flask, render_template, redirect, url_for, request, flash, jsonify, send_file, send_from_directory, abort, session
from flask_login import LoginManager, login_user, login_required, logout_user, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from sqlalchemy.exc import IntegrityError
from models import db, User, Note

_env_dir = Path(__file__).resolve().parent
_env_file = _env_dir / ".env"
try:
    _dotenv = importlib.import_module("dotenv")
    _dotenv.load_dotenv(_env_dir / ".env")
    _dotenv.load_dotenv()
except ImportError:
    pass

_parsed_openai_from_file = None
if _env_file.exists():
    with open(_env_file, encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            if line.startswith("export "):
                line = line[7:].lstrip()
            key, val = line.split("=", 1)
            if key.strip() != "OPENAI_API_KEY":
                continue
            val = val.strip().strip('"').strip("'")
            if " #" in val and not val.startswith('"'):
                val = val.split(" #", 1)[0].strip()
            if val:
                _parsed_openai_from_file = val
            break

if _parsed_openai_from_file:
    _host_key = (os.environ.get("OPENAI_API_KEY") or "").strip()
    _on_render = bool(os.environ.get("RENDER"))
    if _on_render:
        if not _host_key or len(_parsed_openai_from_file) > len(_host_key):
            os.environ["OPENAI_API_KEY"] = _parsed_openai_from_file
    else:
        os.environ["OPENAI_API_KEY"] = _parsed_openai_from_file

_openai_raw = os.environ.get("OPENAI_API_KEY")
if _openai_raw:
    os.environ["OPENAI_API_KEY"] = _openai_raw.strip()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY') or 'your_secret_key'
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL') or 'sqlite:///database.db'
app.config['OPENAI_API_KEY'] = (os.environ.get('OPENAI_API_KEY') or '').strip()

if app.config['SQLALCHEMY_DATABASE_URI'].startswith('postgres://'):
    app.config['SQLALCHEMY_DATABASE_URI'] = app.config['SQLALCHEMY_DATABASE_URI'].replace('postgres://', 'postgresql://', 1)

db.init_app(app)

def _safe_note_alter(sql):
    """Run one ALTER TABLE note … for legacy SQLite DBs; ignore duplicate column."""
    from sqlalchemy import text
    try:
        db.session.execute(text(sql))
        db.session.commit()
    except Exception as e:
        if "duplicate column name" not in str(e).lower():
            raise
        db.session.rollback()


def _ensure_updated_at_column():
    _safe_note_alter("ALTER TABLE note ADD COLUMN updated_at DATETIME")


def _ensure_note_feature_columns():
    _safe_note_alter("ALTER TABLE note ADD COLUMN podcast_script TEXT DEFAULT ''")
    _safe_note_alter("ALTER TABLE note ADD COLUMN flashcards_json TEXT DEFAULT ''")


def _ensure_note_locked_column():
    _safe_note_alter("ALTER TABLE note ADD COLUMN is_locked BOOLEAN DEFAULT 0")


def _ensure_chat_history_json_column():
    _safe_note_alter("ALTER TABLE note ADD COLUMN chat_history_json TEXT DEFAULT ''")


def _ensure_chat_features_json_column():
    _safe_note_alter("ALTER TABLE note ADD COLUMN chat_features_json TEXT DEFAULT ''")


def _ensure_note_lock_password_hash_column():
    _safe_note_alter("ALTER TABLE note ADD COLUMN lock_password_hash VARCHAR(255) DEFAULT ''")


def _ensure_note_reminder_columns():
    for sql in (
        "ALTER TABLE note ADD COLUMN reminder_enabled BOOLEAN DEFAULT 0",
        "ALTER TABLE note ADD COLUMN last_interaction_at DATETIME",
        "ALTER TABLE note ADD COLUMN reminder_idle_hours INTEGER DEFAULT 24",
        "ALTER TABLE note ADD COLUMN reminder_target_at DATETIME",
    ):
        _safe_note_alter(sql)


def _ensure_user_tutorial_column():
    """Existing SQLite DBs: default tutorial_completed=1 so current users skip the tour; new rows use the model default."""
    _safe_note_alter("ALTER TABLE user ADD COLUMN tutorial_completed BOOLEAN DEFAULT 1")


def _ensure_user_password_length():
    """PostgreSQL only: widen user.password from VARCHAR(150) to VARCHAR(255).

    Werkzeug scrypt hashes are ~162 chars and overflow the original 150 column.
    SQLite ignores VARCHAR limits so this is a no-op there.
    """
    from sqlalchemy import text
    uri = (app.config.get("SQLALCHEMY_DATABASE_URI") or "").lower()
    if not uri.startswith("postgres"):
        return
    try:
        db.session.execute(text('ALTER TABLE "user" ALTER COLUMN password TYPE VARCHAR(255)'))
        db.session.commit()
    except Exception:
        db.session.rollback()


REMINDER_IDLE_HOURS = 24
MIN_REMINDER_IDLE_HOURS = 1
MAX_REMINDER_IDLE_HOURS = 8760  


def _clamp_reminder_idle_hours(raw):
    try:
        h = int(raw)
    except (TypeError, ValueError):
        return REMINDER_IDLE_HOURS
    return max(MIN_REMINDER_IDLE_HOURS, min(MAX_REMINDER_IDLE_HOURS, h))


def _note_reminder_idle_hours(note):
    try:
        h = getattr(note, "reminder_idle_hours", None)
        if h is None:
            return REMINDER_IDLE_HOURS
        return _clamp_reminder_idle_hours(h)
    except (TypeError, ValueError):
        return REMINDER_IDLE_HOURS


def _parse_reminder_target_at_iso(raw):
    """Parse JSON ISO datetime (from browser toISOString) to aware UTC."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _note_should_show_reminder(note):
    """True when reminder is on and idle threshold or scheduled target is met."""
    try:
        if not getattr(note, "reminder_enabled", False):
            return False
        now = datetime.now(timezone.utc)
        tgt = getattr(note, "reminder_target_at", None)
        if tgt is not None:
            if tgt.tzinfo is None:
                tgt = tgt.replace(tzinfo=timezone.utc)
            if now < tgt:
                return False
            last = getattr(note, "last_interaction_at", None) or note.updated_at or note.created_at
            if last is None:
                return True
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)

            return last <= tgt
        last = getattr(note, "last_interaction_at", None) or note.updated_at or note.created_at
        if last is None:
            return False
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        delta = now - last
        return delta >= timedelta(hours=_note_reminder_idle_hours(note))
    except Exception:
        return False


def _sidebar_reminder_nudge_text(note, show_reminder):
    if not show_reminder:
        return ""
    if getattr(note, "reminder_target_at", None) is not None:
        return "Check in: scheduled reminder"
    h = _note_reminder_idle_hours(note)
    if h == 168:
        return "Check in: no edits or chat for 1+ week."
    if h == 1:
        return "Check in: no edits or chat for 1+ hr."
    return f"Check in: no edits or chat for {h}+ hrs."


def _turn_off_reminder_if_firing_was_cleared(note, show_before):
    """If the reminder was firing before this request and is no longer, disable it (sidebar alarm + schedule)."""
    if not show_before:
        return False
    if not getattr(note, "reminder_enabled", False):
        return False
    if _note_should_show_reminder(note):
        return False
    note.reminder_enabled = False
    note.reminder_target_at = None
    return True


def _reminder_api_fields(note, show=None):
    """Shared JSON fragment for dashboard / iframe reminder sync."""
    if show is None:
        show = _note_should_show_reminder(note)
    return {
        "reminder_enabled": bool(getattr(note, "reminder_enabled", False)),
        "show_reminder": show,
        "reminder_nudge_text": _sidebar_reminder_nudge_text(note, show),
    }


_migration_done = False


def _do_note_migration():
    """Create tables and run column migrations for both SQLite and PostgreSQL."""
    db.create_all()
    uri = (app.config.get("SQLALCHEMY_DATABASE_URI") or "").lower()
    if uri.startswith("sqlite"):
        _ensure_updated_at_column()
        _ensure_note_feature_columns()
        _ensure_note_locked_column()
        _ensure_note_lock_password_hash_column()
        _ensure_chat_history_json_column()
        _ensure_chat_features_json_column()
        _ensure_note_reminder_columns()
        _ensure_user_tutorial_column()
    _ensure_user_password_length()


try:
    with app.app_context():
        _do_note_migration()
        _migration_done = True
except Exception:
    pass


def _session_note_unlock_ids():
    return list(session.get("unlocked_note_ids") or [])


def _session_note_is_unlocked(note_id):
    try:
        nid = int(note_id)
    except (TypeError, ValueError):
        return False
    return nid in _session_note_unlock_ids()


def _session_unlock_note(note_id):
    try:
        nid = int(note_id)
    except (TypeError, ValueError):
        return
    ids = _session_note_unlock_ids()
    if nid not in ids:
        ids.append(nid)
    session["unlocked_note_ids"] = ids


def _session_remove_note_unlock(note_id):
    try:
        nid = int(note_id)
    except (TypeError, ValueError):
        return
    ids = _session_note_unlock_ids()
    session["unlocked_note_ids"] = [x for x in ids if x != nid]

login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = "login"


@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))


@app.template_filter("strip_html")
def strip_html_filter(s):
    """Remove HTML tags for plain-text previews (e.g. note cards)."""
    if s is None:
        return ""
    return re.sub(r"<[^>]+>", "", s)


@app.template_filter("first_line_preview")
def first_line_preview_filter(s):
    """First block of text only for note card preview (e.g. just 'Poems 1'). Strips HTML, decodes entities."""
    if s is None:
        return ""

    block_end = re.sub(r"</(?:h[1-6]|p|div|li|tr)\s*>", "\n", s, flags=re.IGNORECASE)
    block_end = re.sub(r"<br\s*/?>", "\n", block_end, flags=re.IGNORECASE)
    plain = re.sub(r"<[^>]+>", "", block_end)
    plain = html.unescape(plain)
    first = plain.split("\n")[0].strip()
    return first[:80] if len(first) > 80 else first


def _relative_time(dt):
    """Format datetime as 'less than a min ago', '5 min ago', 'Feb 24', etc."""
    if dt is None:
        return "Today"
    now = datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    delta = now - dt
    secs = delta.total_seconds()
    if secs < 0:
        return dt.strftime("%b %d")
    if secs < 60:
        return "less than a min ago"
    if secs < 3600:
        mins = int(secs / 60)
        return "1 min ago" if mins == 1 else f"{mins} min ago"
    if secs < 86400:
        hours = int(secs / 3600)
        return "1 hour ago" if hours == 1 else f"{hours} hours ago"
    if secs < 172800:
        return "Yesterday"
    return dt.strftime("%b %d")


@app.template_filter("relative_time")
def relative_time_filter(dt):
    return _relative_time(dt)


@app.before_request
def _run_note_migration_once():
    global _migration_done
    if _migration_done:
        return
    try:
        _do_note_migration()
        _migration_done = True
    except Exception:
        pass


@app.route("/")
def home():
    return redirect(url_for("login"))


@app.route("/assets/<path:filename>")
def root_assets(filename):
    assets_dir = Path(app.root_path) / "assets"
    return send_from_directory(assets_dir, filename)


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""

        if not username or not password:
            flash("Please enter a username and password.", "error")
            return render_template("register.html")

        if User.query.filter_by(username=username).first():
            flash("That username is already taken. Choose another.", "error")
            return render_template("register.html")

        hashed_password = generate_password_hash(password)
        new_user = User(username=username, password=hashed_password)

        db.session.add(new_user)
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            flash("That username is already taken. Choose another.", "error")
            return render_template("register.html")

        flash("Account created successfully!", "success")
        return redirect(url_for("login"))

    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")

        user = User.query.filter_by(username=username).first()

        if user and check_password_hash(user.password, password):
            login_user(user)
            return redirect(url_for("dashboard"))
        else:
            flash("Invalid credentials")

    return render_template("login.html")


@app.route("/dashboard")
@login_required
def dashboard():
    notes = Note.query.filter_by(user_id=current_user.id, is_deleted=False).order_by(
        db.func.coalesce(Note.updated_at, Note.created_at).desc()
    ).all()
    for n in notes:
        show = _note_should_show_reminder(n)
        n._show_reminder = show
        n._reminder_nudge_text = _sidebar_reminder_nudge_text(n, show)
    show_tutorial = not bool(getattr(current_user, "tutorial_completed", True))
    return render_template(
        "dashboard.html",
        notes=notes,
        user_id=current_user.id,
        show_tutorial=show_tutorial,
    )


@app.route("/create_note")
@login_required
def create_note():
    return render_template("note.html", note=None, content_hidden=False)


@app.route("/note/<int:note_id>")
@login_required
def view_note(note_id):
    note = Note.query.get_or_404(note_id)

    if note.user_id != current_user.id:
        return "Unauthorized", 403

    content_hidden = bool(
        note.is_deleted is False
        and getattr(note, "is_locked", False)
        and not _session_note_is_unlocked(note.id)
    )
    return render_template("note.html", note=note, content_hidden=content_hidden)


_MAX_CHAT_HISTORY_MESSAGES = 120


def _chat_history_from_note(note):
    raw = (getattr(note, "chat_history_json", None) or "").strip()
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        if not isinstance(parsed, list):
            return []
        out = []
        for h in parsed[-_MAX_CHAT_HISTORY_MESSAGES:]:
            if not isinstance(h, dict):
                continue
            role = h.get("role")
            if role not in ("user", "assistant"):
                continue
            c = h.get("content")
            if not isinstance(c, str):
                c = str(c) if c is not None else ""
            out.append({"role": role, "content": c[:32000]})
        return out
    except Exception:
        return []


def _chat_history_has_flashcards_user_trigger(hist):
    """True if the saved transcript includes the Flashcards quick-action (matches client addMessage label)."""
    if not isinstance(hist, list):
        return False
    for h in hist:
        if not isinstance(h, dict) or h.get("role") != "user":
            continue
        if (h.get("content") or "").strip() == "Flashcards":
            return True
    return False


_MAX_CHAT_FEATURES_CHARS = 350000


def _sanitize_quiz_feature(quiz):
    if not isinstance(quiz, dict):
        return None
    scope = quiz.get("scope")
    if scope not in ("current_note", "general"):
        scope = "current_note"
    questions = quiz.get("questions")
    if not isinstance(questions, list) or not questions:
        return None
    clean_q = []
    for item in questions[:50]:
        if not isinstance(item, dict):
            continue
        qtext = str(item.get("question") or "")[:8000]
        opts = item.get("options")
        if not isinstance(opts, list):
            opts = []
        clean_opts = [str(o)[:4000] for o in opts[:12]]
        if not clean_opts:
            continue
        try:
            ci = int(item.get("correctIndex", 0))
        except (TypeError, ValueError):
            ci = 0
        ci = max(0, min(ci, len(clean_opts) - 1))
        clean_q.append({"question": qtext, "options": clean_opts, "correctIndex": ci})
    if not clean_q:
        return None
    answers_raw = quiz.get("answers")
    if isinstance(answers_raw, list):
        answers_clean = [bool(x) for x in answers_raw[: len(clean_q)]]
    else:
        answers_clean = []

    if quiz.get("completed") is True:
        try:
            idx_done = int(quiz.get("index", len(clean_q)))
        except (TypeError, ValueError):
            idx_done = len(clean_q)
        idx_done = max(0, min(idx_done, len(clean_q)))
        out = {
            "scope": scope,
            "completed": True,
            "questions": clean_q,
            "index": idx_done,
            "answers": answers_clean,
        }
        up = quiz.get("userPicks")
        if isinstance(up, list):
            picks = []
            for i, x in enumerate(up[: len(clean_q)]):
                try:
                    pi = int(x)
                except (TypeError, ValueError):
                    pi = 0
                nopts = len(clean_q[i].get("options") or [])
                if nopts > 0:
                    pi = max(0, min(pi, nopts - 1))
                picks.append(pi)
            out["userPicks"] = picks
        return out

    try:
        idx = int(quiz.get("index", 0))
    except (TypeError, ValueError):
        idx = 0
    idx = max(0, min(idx, len(clean_q) - 1))
    answers = answers_clean
    choice_raw = quiz.get("choiceIndex")
    try:
        choice_idx = int(choice_raw) if choice_raw is not None else None
    except (TypeError, ValueError):
        choice_idx = None
    n_opts = len(clean_q[idx].get("options") or [])
    if choice_idx is not None and n_opts > 0:
        choice_idx = max(0, min(choice_idx, n_opts - 1))
    elif choice_idx is not None:
        choice_idx = None
    return {
        "scope": scope,
        "questions": clean_q,
        "index": idx,
        "answers": answers,
        "answered": bool(quiz.get("answered")),
        "choiceIndex": choice_idx,
    }


def _sanitize_chat_features(raw):
    if not isinstance(raw, dict):
        return {}
    out = {}
    if raw.get("userActivatedPodcast") is True:
        out["userActivatedPodcast"] = True
    pod = raw.get("podcast")
    if isinstance(pod, dict):
        au = pod.get("audioUrl") or pod.get("audio_url")
        out["podcast"] = {
            "audioUrl": str(au)[:2048] if au is not None else "",
            "title": str(pod.get("title") or "")[:500],
        }
    if raw.get("userActivatedFlashcards") is True:
        out["userActivatedFlashcards"] = True
    fc = raw.get("flashcards")
    if isinstance(fc, dict):
        try:
            fi = int(fc.get("index", 0))
        except (TypeError, ValueError):
            fi = 0
        fco = {"index": max(0, fi), "showingBack": bool(fc.get("showingBack"))}
        ratings = fc.get("ratings")
        if isinstance(ratings, list):
            cleaned_ratings = []
            for x in ratings[:48]:
                if x is True:
                    cleaned_ratings.append(True)
                elif x is False:
                    cleaned_ratings.append(False)
                else:
                    cleaned_ratings.append(None)
            fco["ratings"] = cleaned_ratings
        if fc.get("complete") is True:
            fco["complete"] = True
            fco.pop("ratings", None)
        out["flashcards"] = fco
    qsan = _sanitize_quiz_feature(raw.get("quiz")) if isinstance(raw.get("quiz"), dict) else None
    if qsan:
        out["quiz"] = qsan
    return out


def _chat_features_from_note(note):
    """Return persisted chat_features_json only.

    Cached card text lives in note.flashcards_json for /flashcards_api and /note_features; it must not imply the user
    opened the Flashcards action. Inferring userActivatedFlashcards from flashcards_json + any chat history wrongly
    showed the flashcard widget after unrelated actions (e.g. Summarise only) when old cache existed.
    """
    out = {}
    raw = (getattr(note, "chat_features_json", None) or "").strip()
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                out = _sanitize_chat_features(parsed)
        except Exception:
            out = {}
    hist = _chat_history_from_note(note)
    if out.get("userActivatedFlashcards") and not _chat_history_has_flashcards_user_trigger(hist):
        out = dict(out)
        out.pop("userActivatedFlashcards", None)
        out.pop("flashcards", None)
    return out


@app.route("/get_note/<int:note_id>")
@login_required
def get_note(note_id):
    note = Note.query.get_or_404(note_id)

    if note.user_id != current_user.id:
        return jsonify({"error": "Unauthorized"}), 403

    locked_db = bool(getattr(note, "is_locked", False))

    if locked_db and not _session_note_is_unlocked(note.id):
        return jsonify({
            "success": True,
            "id": note.id,
            "title": "",
            "content": "",
            "is_locked": True,
            "has_password": True,
            "content_hidden": True,
            "chat_history": [],
            "chat_features": {},
        })

    legacy_note_hash = bool((getattr(note, "lock_password_hash", None) or "").strip())
    return jsonify({
        "success": True,
        "id": note.id,
        "title": note.title,
        "content": note.content,
        "is_locked": locked_db,
        "has_password": locked_db or legacy_note_hash,
        "content_hidden": False,
        "chat_history": _chat_history_from_note(note),
        "chat_features": _chat_features_from_note(note),
    })


_UNTITLED_NOTE_NUMBERED = re.compile(r"^Untitled Note \((\d+)\)\s*$", re.I)


def _allocate_untitled_note_title(user_id):
    """Next default title: Untitled Note (1), (2), … based on existing numbered titles for this user."""
    rows = (
        Note.query.filter_by(user_id=user_id, is_deleted=False)
        .with_entities(Note.title)
        .all()
    )
    max_n = 0
    for (t,) in rows:
        s = (t or "").strip()
        m = _UNTITLED_NOTE_NUMBERED.match(s)
        if m:
            max_n = max(max_n, int(m.group(1)))
    return f"Untitled Note ({max_n + 1})"


@app.route("/autosave_note", methods=["POST"])
@login_required
def autosave_note():
    data = request.get_json()
    note_id = data.get("note_id")
    title = (data.get("title") or "").strip()
    content = (data.get("content") or "").strip()

    if note_id:
        note = Note.query.get(note_id)

        if note.user_id != current_user.id:
            return jsonify({"error": "Unauthorized"}), 403

        if getattr(note, "is_locked", False):
            updated = note.updated_at or note.created_at
            return jsonify({
                "success": False,
                "locked": True,
                "note_id": note.id,
                "relative_time": _relative_time(updated),
            })

        show_before = _note_should_show_reminder(note)
        old_title = note.title
        old_content = note.content
        note.title = title or "Untitled Note"
        note.content = content
        if (old_title or "") != note.title or (old_content or "") != note.content:
            _invalidate_podcast_for_note(note)

    else:
        if not title:
            title = _allocate_untitled_note_title(current_user.id)
        elif title.lower() == "untitled note":
            title = _allocate_untitled_note_title(current_user.id)
        note = Note(
            title=title,
            content=content or "",
            user_id=current_user.id
        )
        db.session.add(note)
        show_before = False

    note.last_interaction_at = datetime.now(timezone.utc)
    db.session.commit()
    db.session.refresh(note)
    if note_id and _turn_off_reminder_if_firing_was_cleared(note, show_before):
        db.session.commit()
        db.session.refresh(note)
    updated = note.updated_at or note.created_at
    show = _note_should_show_reminder(note)
    return jsonify(
        {
            "success": True,
            "note_id": note.id,
            "title": note.title,
            "relative_time": _relative_time(updated),
            **_reminder_api_fields(note, show),
        }
    )


@app.route("/save_note_chat", methods=["POST"])
@login_required
def save_note_chat():
    """Persist AI assistant conversation for a note (survives browser refresh)."""
    data = request.get_json() or {}
    note_id = data.get("note_id")
    history = data.get("history")
    if note_id is None:
        return jsonify({"success": False, "error": "Missing note."}), 400
    note = Note.query.get(note_id)
    if not note or note.user_id != current_user.id or note.is_deleted:
        return jsonify({"success": False, "error": "Unauthorized"}), 403
    if getattr(note, "is_locked", False):
        return jsonify({"success": False, "locked": True}), 200
    show_before = _note_should_show_reminder(note)

    preserved_updated_at = note.updated_at
    if not isinstance(history, list):
        history = []
    cleaned = []
    for h in history[-_MAX_CHAT_HISTORY_MESSAGES:]:
        if not isinstance(h, dict):
            continue
        role = h.get("role")
        if role not in ("user", "assistant"):
            continue
        c = h.get("content")
        if not isinstance(c, str):
            c = str(c) if c is not None else ""
        cleaned.append({"role": role, "content": c[:32000]})
    note.chat_history_json = json.dumps(cleaned)
    if "features" in data:
        fin = data.get("features")
        if isinstance(fin, dict):
            sanitized = _sanitize_chat_features(fin)
            dumped = json.dumps(sanitized, separators=(",", ":"))
            if len(dumped) > _MAX_CHAT_FEATURES_CHARS:
                sanitized.pop("quiz", None)
                dumped = json.dumps(sanitized, separators=(",", ":"))
            if len(dumped) > _MAX_CHAT_FEATURES_CHARS:
                sanitized.pop("quiz", None)
                if "podcast" in sanitized:
                    sanitized["podcast"] = {
                        "audioUrl": (sanitized.get("podcast") or {}).get("audioUrl", "")[:1024],
                        "title": (sanitized.get("podcast") or {}).get("title", "")[:200],
                    }
                dumped = json.dumps(sanitized, separators=(",", ":"))
            note.chat_features_json = dumped[:_MAX_CHAT_FEATURES_CHARS]
        else:
            note.chat_features_json = ""
    note.updated_at = preserved_updated_at
    if any(isinstance(h, dict) and h.get("role") == "user" for h in cleaned):
        note.last_interaction_at = datetime.now(timezone.utc)
    db.session.commit()
    db.session.refresh(note)
    if _turn_off_reminder_if_firing_was_cleared(note, show_before):
        db.session.commit()
        db.session.refresh(note)
    show = _note_should_show_reminder(note)
    return jsonify({"success": True, "note_id": note_id, **_reminder_api_fields(note, show)})


@app.route("/note_touch_activity/<int:note_id>", methods=["POST"])
@login_required
def note_touch_activity(note_id):
    """Bump sidebar ordering when the user uses the AI panel for this note.

    Also bumps last_interaction_at so an active reminder/alarm clears (same as editing the note).
    """
    note = Note.query.get_or_404(note_id)
    if note.user_id != current_user.id or note.is_deleted:
        return jsonify({"success": False, "error": "Unauthorized"}), 403
    if getattr(note, "is_locked", False):
        return jsonify({"success": False, "locked": True}), 200
    show_before = _note_should_show_reminder(note)
    now = datetime.now(timezone.utc)
    note.updated_at = now
    note.last_interaction_at = now
    db.session.commit()
    db.session.refresh(note)
    if _turn_off_reminder_if_firing_was_cleared(note, show_before):
        db.session.commit()
        db.session.refresh(note)
    updated = note.updated_at or note.created_at
    show = _note_should_show_reminder(note)
    return jsonify(
        {"success": True, "relative_time": _relative_time(updated), **_reminder_api_fields(note, show)}
    )


def _login_password_matches(pw_plain):
    """True if pw_plain matches the logged-in user's account password."""
    if pw_plain is None or current_user is None:
        return False
    u = User.query.get(current_user.id)
    if not u or not u.password:
        return False
    return check_password_hash(u.password, pw_plain)


@app.route("/set_note_lock", methods=["POST"])
@login_required
def set_note_lock():
    data = request.get_json() or {}
    note_id = data.get("note_id")
    password = data.get("password") or ""
    if not note_id:
        return jsonify({"success": False, "error": "Missing note."}), 400
    note = Note.query.get(note_id)
    if not note or note.user_id != current_user.id or note.is_deleted:
        return jsonify({"success": False, "error": "Unauthorized"}), 403
    if getattr(note, "is_locked", False):
        return jsonify({"success": False, "error": "Note is already locked. Remove the lock first."}), 400
    if not _login_password_matches(password):
        return jsonify({"success": False, "error": "That does not match your password."}), 200
    note.is_locked = True
    note.lock_password_hash = ""
    db.session.commit()
    _session_unlock_note(note.id)
    return jsonify({"success": True, "locked": True})


@app.route("/verify_note_lock", methods=["POST"])
@login_required
def verify_note_lock():
    data = request.get_json() or {}
    note_id = data.get("note_id")
    password = data.get("password") or ""
    if not note_id:
        return jsonify({"success": False, "error": "Missing note."}), 400
    note = Note.query.get(note_id)
    if not note or note.user_id != current_user.id or note.is_deleted:
        return jsonify({"success": False, "error": "Unauthorized"}), 403
    if not getattr(note, "is_locked", False):
        return jsonify({"success": False, "error": "This note is not locked."}), 400
    legacy_hash = (getattr(note, "lock_password_hash", None) or "").strip()
    pw_ok = _login_password_matches(password)
    if not pw_ok and legacy_hash:
        pw_ok = check_password_hash(legacy_hash, password)
    if not pw_ok:
        return jsonify({"success": False, "error": "Incorrect password."}), 200
    _session_unlock_note(note.id)
    return jsonify({
        "success": True,
        "title": note.title or "",
        "content": note.content or "",
        "is_locked": bool(note.is_locked),
    })


@app.route("/clear_note_lock", methods=["POST"])
@login_required
def clear_note_lock():
    data = request.get_json() or {}
    note_id = data.get("note_id")
    password = data.get("password") or ""
    if not note_id:
        return jsonify({"success": False, "error": "Missing note."}), 400
    note = Note.query.get(note_id)
    if not note or note.user_id != current_user.id or note.is_deleted:
        return jsonify({"success": False, "error": "Unauthorized"}), 403
    if not getattr(note, "is_locked", False):
        return jsonify({"success": False, "error": "This note is not locked."}), 400
    legacy_hash = (getattr(note, "lock_password_hash", None) or "").strip()
    pw_ok = _login_password_matches(password)
    if not pw_ok and legacy_hash:
        pw_ok = check_password_hash(legacy_hash, password)
    if not pw_ok:
        return jsonify({"success": False, "error": "Incorrect password."}), 200
    note.is_locked = False
    note.lock_password_hash = ""
    db.session.commit()
    _session_remove_note_unlock(note.id)
    return jsonify({"success": True, "locked": False})


@app.route("/delete_note/<int:note_id>", methods=["POST"])
@login_required
def delete_note(note_id):
    note = Note.query.get_or_404(note_id)

    if note.user_id != current_user.id:
        return jsonify({"error": "Unauthorized"}), 403

    _invalidate_podcast_for_note(note)
    note.is_deleted = True
    db.session.commit()

    return jsonify({"success": True})


@app.route("/recycle_bin")
@app.route("/trash")
@login_required
def recycle_bin():
    deleted_notes = Note.query.filter_by(user_id=current_user.id, is_deleted=True).order_by(
        db.func.coalesce(Note.updated_at, Note.created_at).desc()
    ).all()
    return render_template("recycle_bin.html", notes=deleted_notes)


@app.route("/restore_note/<int:note_id>", methods=["POST"])
@login_required
def restore_note(note_id):
    note = Note.query.get_or_404(note_id)

    if note.user_id != current_user.id:
        return jsonify({"error": "Unauthorized"}), 403

    note.is_deleted = False
    db.session.commit()

    return jsonify({"success": True})


@app.route("/permanently_delete_note/<int:note_id>", methods=["POST"])
@login_required
def permanently_delete_note(note_id):
    note = Note.query.get_or_404(note_id)

    if note.user_id != current_user.id:
        return jsonify({"error": "Unauthorized"}), 403

    _invalidate_podcast_for_note(note)
    db.session.delete(note)
    db.session.commit()

    return jsonify({"success": True})


def _reminder_target_at_iso(note):
    t = getattr(note, "reminder_target_at", None)
    if t is None:
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    t = t.astimezone(timezone.utc)
    return t.isoformat().replace("+00:00", "Z")


@app.route("/note/<int:note_id>/reminder_state", methods=["GET"])
@login_required
def note_reminder_state(note_id):
    """Lightweight poll for sidebar reminder UI (scheduled or idle reminders)."""
    note = Note.query.get_or_404(note_id)
    if note.user_id != current_user.id or note.is_deleted:
        return jsonify({"success": False, "error": "Unauthorized"}), 403
    show = _note_should_show_reminder(note)
    return jsonify(
        {
            "success": True,
            "reminder_idle_hours": _note_reminder_idle_hours(note),
            "reminder_target_at": _reminder_target_at_iso(note),
            **_reminder_api_fields(note, show),
        }
    )


@app.route("/note/<int:note_id>/reminder", methods=["POST"])
@login_required
def note_reminder_toggle(note_id):
    """Enable/disable per-note reminder (idle hours or custom wall-clock target)."""
    note = Note.query.get_or_404(note_id)
    if note.user_id != current_user.id or note.is_deleted:
        return jsonify({"success": False, "error": "Unauthorized"}), 403
    if getattr(note, "is_locked", False):
        return jsonify({"success": False, "locked": True}), 200
    data = request.get_json() or {}
    want = data.get("enabled")
    raw_idle = data.get("idle_hours")
    raw_target = data.get("reminder_target_at")
    if want is None and raw_idle is None and raw_target is None:
        note.reminder_enabled = not bool(getattr(note, "reminder_enabled", False))
        if not note.reminder_enabled:
            note.reminder_target_at = None
    else:
        if want is not None:
            note.reminder_enabled = bool(want)
        if not note.reminder_enabled:
            note.reminder_target_at = None
        else:
            parsed_target = _parse_reminder_target_at_iso(raw_target)
            if parsed_target is not None:
                note.reminder_target_at = parsed_target
            elif raw_idle is not None:
                note.reminder_target_at = None
                try:
                    note.reminder_idle_hours = _clamp_reminder_idle_hours(raw_idle)
                except (TypeError, ValueError):
                    pass
    if note.reminder_enabled:
        note.last_interaction_at = datetime.now(timezone.utc)
    db.session.commit()
    db.session.refresh(note)
    show = _note_should_show_reminder(note)
    return jsonify(
        {
            "success": True,
            "reminder_idle_hours": _note_reminder_idle_hours(note),
            "reminder_target_at": _reminder_target_at_iso(note),
            **_reminder_api_fields(note, show),
        }
    )


@app.route("/delete_notes_bulk", methods=["POST"])
@login_required
def delete_notes_bulk():
    """Soft-delete multiple notes (move to Recently Deleted)."""
    data = request.get_json() or {}
    raw_ids = data.get("note_ids")
    if not isinstance(raw_ids, list) or not raw_ids:
        return jsonify({"success": False, "error": "No notes specified."}), 400
    deleted = 0
    for x in raw_ids:
        try:
            nid = int(x)
        except (TypeError, ValueError):
            continue
        note = Note.query.get(nid)
        if not note or note.user_id != current_user.id or note.is_deleted:
            continue
        _invalidate_podcast_for_note(note)
        note.is_deleted = True
        deleted += 1
    if deleted:
        db.session.commit()
    return jsonify({"success": True, "deleted_count": deleted})


@app.route("/chat")
@login_required
def chat():
    return render_template("chat.html")


def _assistant_username_instruction_suffix():
    """Text appended to system prompts so the model addresses the logged-in user by username."""
    if not current_user.is_authenticated:
        return ""
    raw = getattr(current_user, "username", None)
    if raw is None:
        return ""
    name = "".join(ch for ch in str(raw).strip() if ch.isprintable()).strip()
    if not name:
        return ""
    name = name[:120]
    return (
        "\n\nThe student's username is "
        + name
        + ". Address them by this username when it fits naturally (for example in greetings); "
        "do not use their name in every sentence."
    )


REVISION_SYSTEM_PROMPT = """You are a helpful University AI Revision Assistant. You help students with:
- Understanding and summarising their notes and topics
- Explaining concepts clearly and suggesting ways to remember them
- Quiz-style questions and practice (if they ask)
- Structuring revision and breaking down complex ideas
- Definitions, key points, and exam-style answers when relevant
Keep replies clear, concise, and focused on learning. Use a friendly, supportive tone."""

SUMMARISE_USER_PROMPT = (
    "Summarise the current note using only the note context already provided above. "
    "Write exactly one paragraph: a few connected sentences in plain prose. "
    "Do not use bullet points, numbered lists, line breaks between points, markdown, or "
    "lines starting with -, *, or numbers. No lists of any kind—only continuous paragraph text."
)


def _build_other_notes_memory_context(user_id, current_note_title="", current_note_content="", max_notes=8, max_chars=8000):
    """Build lightweight cross-note context so chat can remember user's other notes."""
    current_title_norm = (current_note_title or "").strip().lower()
    current_content_norm = ((current_note_content or "").strip())[:500].lower()
    remaining = max_chars
    sections = []

    notes = Note.query.filter_by(user_id=user_id, is_deleted=False).order_by(
        db.func.coalesce(Note.updated_at, Note.created_at).desc()
    ).all()

    for note in notes:
        if len(sections) >= max_notes or remaining <= 200:
            break

        title = (note.title or "Untitled Note").strip()
        content_raw = note.content or ""


        if current_title_norm and title.lower() == current_title_norm:
            if current_content_norm and current_content_norm in content_raw[:1200].lower():
                continue

        content_plain = re.sub(r"<[^>]+>", "", content_raw)
        content_plain = html.unescape(content_plain).strip()
        if not content_plain:
            continue

        snippet = content_plain[:900]
        entry = f"- {title}: {snippet}"
        if len(entry) + 1 > remaining:
            entry = entry[: max(0, remaining - 1)]
        if not entry:
            break

        sections.append(entry)
        remaining -= len(entry) + 1

    if not sections:
        return ""

    return (
        "Other notes memory for this user (may be useful when asked to compare or recall across notes):\n"
        + "\n".join(sections)
    )


def _resolve_note_for_user(note_id):
    if not note_id:
        return None
    try:
        note_id = int(note_id)
    except (TypeError, ValueError):
        return None
    note = Note.query.get(note_id)
    if not note or note.user_id != current_user.id or note.is_deleted:
        return None
    return note


PODCAST_SYSTEM_PROMPT = """You are a study podcast script writer.
Create a concise, engaging spoken script based ONLY on the provided note.
Keep it factual, clear, and revision-focused.
Do not add facts that are not in the note.
Output plain text only."""


FLASHCARDS_SYSTEM_PROMPT = """You generate revision flashcards from notes.
Return ONLY valid JSON array with 6 to 12 objects in this exact shape:
{"front":"Question/prompt","back":"Answer/explanation"}
No markdown. No extra text."""


def _generate_podcast_script(note_title, note_content):
    api_key = app.config.get("OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return None, "OpenAI API key is not set."
    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        note_text = (note_content or "")[:12000]
        prompt = (
            f"Title: {note_title or '(no title)'}\n\n"
            f"Content:\n{note_text}\n\n"
            "Write a short podcast-style revision narration (about 2-4 minutes when spoken)."
        )
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": PODCAST_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            max_tokens=900,
        )
        script = (response.choices[0].message.content or "").strip()
        return script, None
    except ImportError:
        return None, "OpenAI library not installed. Run: pip install openai"
    except Exception as e:
        return None, str(e)


def _podcast_mp3_path(user_id, note_id):
    """Filesystem path for this user's podcast MP3 for a note."""
    d = Path(app.root_path) / "static" / "uploads" / "podcasts"
    return d / f"u{int(user_id)}_n{int(note_id)}.mp3"


def _invalidate_podcast_for_note(note):
    """Clear cached script and delete MP3 so the next podcast matches current note text."""
    if note is None or note.id is None:
        return
    note.podcast_script = ""
    p = _podcast_mp3_path(note.user_id, note.id)
    try:
        if p.is_file():
            p.unlink()
    except OSError:
        pass


def _podcast_audio_url_if_exists(note):
    """Public podcast URL with cache-busting query when an MP3 exists."""
    mp3_path = _podcast_mp3_path(note.user_id, note.id)
    if not mp3_path.is_file() or mp3_path.stat().st_size == 0:
        return None
    v = int(mp3_path.stat().st_mtime)
    return url_for("podcast_audio", note_id=note.id) + f"?v={v}"


def _synthesize_podcast_mp3(script, dest_path):
    """Write MP3 bytes using OpenAI TTS (requires API key)."""
    api_key = app.config.get("OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OpenAI API key is not set.")
    from openai import OpenAI
    client = OpenAI(api_key=api_key)
    tts_input = (script or "")[:4096]
    dest_path = Path(dest_path)
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    response = client.audio.speech.create(
        model="tts-1",
        voice="alloy",
        input=tts_input,
    )
    if hasattr(response, "stream_to_file"):
        response.stream_to_file(str(dest_path))
    else:
        data = response.read() if hasattr(response, "read") else getattr(response, "content", b"")
        if not data:
            raise RuntimeError("Empty audio response from TTS.")
        dest_path.write_bytes(data)


def _generate_flashcards(note_title, note_content):
    api_key = app.config.get("OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return None, "OpenAI API key is not set."
    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        note_text = (note_content or "")[:12000]
        prompt = (
            f"Title: {note_title or '(no title)'}\n\n"
            f"Content:\n{note_text}\n\n"
            "Generate useful flashcards strictly from this note."
        )
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": FLASHCARDS_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            max_tokens=1400,
        )
        raw = (response.choices[0].message.content or "").strip()
        if "```" in raw:
            s = raw.find("[")
            e = raw.rfind("]") + 1
            if s != -1 and e > s:
                raw = raw[s:e]
        cards = json.loads(raw)
        if not isinstance(cards, list):
            return None, "Invalid flashcards format."
        out = []
        for c in cards[:20]:
            if not isinstance(c, dict):
                continue
            front = (c.get("front") or "").strip()
            back = (c.get("back") or "").strip()
            if front and back:
                out.append({"front": front, "back": back})
        if not out:
            return None, "No valid flashcards generated."
        return out, None
    except json.JSONDecodeError as e:
        return None, "Could not parse flashcards: " + str(e)
    except ImportError:
        return None, "OpenAI library not installed. Run: pip install openai"
    except Exception as e:
        return None, str(e)


@app.route("/chat_api", methods=["POST"])
@login_required
def chat_api():
    try:
        data = request.get_json() or {}
        is_summarise = bool(data.get("summarise"))
        user_message = (data.get("message") or "").strip()
        history = data.get("history") or []                                     
        note_title = (data.get("note_title") or "").strip()
        note_content = (data.get("note_content") or "").strip()

        if is_summarise:
            user_message = SUMMARISE_USER_PROMPT
        elif not user_message:
            return jsonify({"success": False, "error": "No message provided"}), 400

        if is_summarise and _plain_text_length(note_content) < 12:
            return jsonify({"success": False, "error": "Add more note content to summarise."}), 200

        api_key = app.config.get("OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
        if not api_key:
            return jsonify({
                "success": True,
                "response": "OpenAI API key is not set. Add OPENAI_API_KEY to your .env file or environment to use the AI assistant."
            })

        try:
            from openai import OpenAI
            client = OpenAI(api_key=api_key)
            messages = [{"role": "system", "content": REVISION_SYSTEM_PROMPT + _assistant_username_instruction_suffix()}]

            if note_title or note_content:
                note_text = (note_content or "")[:12000]                         
                context = f"Current note (use this to answer questions, summarise, or generate quiz questions):\nTitle: {note_title or '(no title)'}\n\nContent:\n{note_text}"
                messages.append({"role": "user", "content": context})
            other_notes_memory = _build_other_notes_memory_context(
                current_user.id,
                current_note_title=note_title,
                current_note_content=note_content,
            )
            if other_notes_memory:
                messages.append({"role": "user", "content": other_notes_memory})
            for h in history:
                if isinstance(h, dict) and h.get("role") in ("user", "assistant") and h.get("content"):
                    messages.append({"role": h["role"], "content": h["content"][:8000]})
            messages.append({"role": "user", "content": user_message})

            create_kwargs = {
                "model": "gpt-3.5-turbo",
                "messages": messages,
                "max_tokens": 1024,
            }
            if is_summarise:
                create_kwargs["temperature"] = 0.35
            response = client.chat.completions.create(**create_kwargs)
            ai_response = response.choices[0].message.content or ""
        except ImportError:
            ai_response = "OpenAI library not installed. Run: pip install openai"
        except Exception as e:
            ai_response = f"Error from AI: {str(e)}"

        return jsonify({
            "success": True,
            "response": ai_response
        })

    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@app.route("/podcast_api", methods=["POST"])
@login_required
def podcast_api():
    """Generate podcast audio. New script is only committed after MP3 is written so a failed/aborted run leaves no script."""
    try:
        data = request.get_json() or {}
        note_id = data.get("note_id")

        note = _resolve_note_for_user(note_id)
        if not note:
            return jsonify({"success": False, "error": "Save the note first, then generate a podcast."}), 200

        note_title = (note.title or "").strip()
        note_content = (note.content or "").strip()

        if _plain_text_length(note_content) < 15:
            return jsonify({"success": False, "error": "Add more note content to generate a podcast."}), 200

        had_script = bool((note.podcast_script or "").strip())
        script = (note.podcast_script or "").strip()
        script_is_new = False
        if not script:
            if getattr(note, "is_locked", False):
                return jsonify({"success": False, "error": "Unlock this note to generate a podcast."}), 200
            script, err = _generate_podcast_script(note_title, note_content)
            if err:
                return jsonify({"success": False, "error": err}), 500
            if not (script or "").strip():
                return jsonify({"success": False, "error": "Could not generate a script."}), 500
            script_is_new = True

        mp3_path = _podcast_mp3_path(note.user_id, note.id)
        temp_path = mp3_path.parent / (mp3_path.stem + ".part.mp3")
        need_audio = not mp3_path.is_file() or mp3_path.stat().st_size == 0
        if need_audio:
            try:
                if temp_path.is_file():
                    temp_path.unlink()
            except OSError:
                pass
            try:
                _synthesize_podcast_mp3(script, temp_path)
            except Exception as e:
                try:
                    if temp_path.is_file():
                        temp_path.unlink()
                except OSError:
                    pass
                return jsonify({"success": False, "error": f"Could not create audio file: {str(e)}"}), 500
            try:
                temp_path.replace(mp3_path)
            except OSError as e:
                try:
                    if temp_path.is_file():
                        temp_path.unlink()
                except OSError:
                    pass
                return jsonify({"success": False, "error": f"Could not save audio file: {str(e)}"}), 500

        if script_is_new:
            note.podcast_script = script
            db.session.commit()

        audio_url = _podcast_audio_url_if_exists(note)
        if not audio_url:
            return jsonify({"success": False, "error": "Audio file is not available."}), 500
        return jsonify({
            "success": True,
            "note_id": note.id,
            "script": script,
            "audio_url": audio_url,
            "note_title": note.title or "Untitled Note",
            "cached": had_script and not need_audio,
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/podcast_audio/<int:note_id>")
@login_required
def podcast_audio(note_id):
    note = Note.query.get_or_404(note_id)
    if note.user_id != current_user.id or note.is_deleted:
        abort(403)
    mp3_path = _podcast_mp3_path(note.user_id, note.id)
    if not mp3_path.is_file():
        abort(404)
    return send_file(mp3_path, mimetype="audio/mpeg")


@app.route("/note_features/<int:note_id>")
@login_required
def note_features(note_id):
    note = Note.query.get_or_404(note_id)
    if note.user_id != current_user.id or note.is_deleted:
        abort(403)
    flashcards = []
    if note.flashcards_json:
        try:
            flashcards = json.loads(note.flashcards_json)
            if not isinstance(flashcards, list):
                flashcards = []
        except Exception:
            flashcards = []
    podcast_audio_url = _podcast_audio_url_if_exists(note)
    return jsonify({
        "success": True,
        "note_title": note.title or "Untitled Note",
        "podcast_audio_url": podcast_audio_url,
        "flashcards": flashcards,
    })


@app.route("/flashcards_api", methods=["POST"])
@login_required
def flashcards_api():
    try:
        data = request.get_json() or {}
        note_id = data.get("note_id")
        note_title = (data.get("note_title") or "").strip()
        note_content = (data.get("note_content") or "").strip()

        if _plain_text_length(note_content) < 15:
            return jsonify({"success": False, "error": "Add more note content to generate flashcards."}), 200

        note = _resolve_note_for_user(note_id)
        if note and note.flashcards_json:
            try:
                cached_cards = json.loads(note.flashcards_json)
                if isinstance(cached_cards, list) and cached_cards:
                    return jsonify({"success": True, "cards": cached_cards, "cached": True})
            except Exception:
                pass

        cards, err = _generate_flashcards(note_title, note_content)
        if err:
            return jsonify({"success": False, "error": err}), 500

        if note and cards:
            if getattr(note, "is_locked", False):
                return jsonify({"success": False, "error": "Unlock this note to generate flashcards."}), 200
            note.flashcards_json = json.dumps(cards)
            db.session.commit()

        return jsonify({"success": True, "cards": cards, "cached": False})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


QUIZ_SYSTEM_PROMPT = """You generate quiz questions as JSON only. Output exactly 5 questions.
Return ONLY a valid JSON array, no other text or markdown. Each element must be:
{"question": "Question text?", "options": ["A) First option", "B) Second option", "C) Third option", "D) Fourth option"], "correctIndex": 0}
Use correctIndex 0 for A, 1 for B, 2 for C, 3 for D. Options must be exactly 4 strings. No code blocks or extra text."""


def _plain_text_length(html_or_text):
    """Approximate length of visible text (strip HTML tags)."""
    if not html_or_text:
        return 0
    text = re.sub(r"<[^>]+>", "", html_or_text)
    text = text.replace("&nbsp;", " ").strip()
    return len(text)


@app.route("/quiz_api", methods=["POST"])
@login_required
def quiz_api():
    try:
        data = request.get_json() or {}
        note_title = (data.get("note_title") or "").strip()
        note_content = (data.get("note_content") or "").strip()
        scope = (data.get("scope") or "current_note").strip().lower()
        if scope not in ("current_note", "general"):
            scope = "current_note"

        if _plain_text_length(note_content) < 15:
            if scope == "current_note":
                error_msg = "It looks like the content in this note is blank. Please add content so I can quiz you on your note."
            else:
                error_msg = "It looks like the content in this note is blank. Please add content so I can quiz you on this topic."
            return jsonify({
                "success": False,
                "error": error_msg,
            }), 200

        api_key = app.config.get("OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
        if not api_key:
            return jsonify({"success": False, "error": "OpenAI API key is not set."}), 500

        note_text = (note_content or "")[:12000]
        context = f"Note title: {note_title or '(no title)'}\n\nContent:\n{note_text}"

        if scope == "current_note":
            user_prompt = f"Based only on the exact content of this note, generate exactly 5 multiple-choice quiz questions that test the material in the note itself. Do not add questions from outside the note. Return ONLY a JSON array of 5 objects. Each object: \"question\" (string), \"options\" (array of 4 strings like \"A) ...\", \"B) ...\", \"C) ...\", \"D) ...\"), \"correctIndex\" (0, 1, 2, or 3). No other text.\n\n{context}"
        else:
            user_prompt = f"Use this note to infer the topic or subject. Generate exactly 5 multiple-choice quiz questions that test understanding of that topic in general—broader than the note, covering the subject. Return ONLY a JSON array of 5 objects. Each object: \"question\" (string), \"options\" (array of 4 strings like \"A) ...\", \"B) ...\", \"C) ...\", \"D) ...\"), \"correctIndex\" (0, 1, 2, or 3). No other text.\n\n{context}"

        try:
            from openai import OpenAI
            client = OpenAI(api_key=api_key)
            response = client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[
                    {"role": "system", "content": QUIZ_SYSTEM_PROMPT + _assistant_username_instruction_suffix()},
                    {"role": "user", "content": user_prompt},
                ],
                max_tokens=1500,
            )
            raw = (response.choices[0].message.content or "").strip()

            if "```" in raw:
                start = raw.find("[")
                end = raw.rfind("]") + 1
                if start != -1 and end > start:
                    raw = raw[start:end]
            questions = json.loads(raw)
            if not isinstance(questions, list) or len(questions) < 1:
                return jsonify({"success": False, "error": "Invalid quiz format."}), 500

            out = []
            for i, q in enumerate(questions[:10]):
                if not isinstance(q, dict):
                    continue
                question = (q.get("question") or "").strip()
                options = q.get("options")
                if not isinstance(options, list):
                    options = []
                options = [str(o).strip() for o in options[:4]]
                while len(options) < 4:
                    options.append("")
                correct = int(q.get("correctIndex", 0))
                if correct < 0 or correct > 3:
                    correct = 0
                if question:
                    out.append({"question": question, "options": options, "correctIndex": correct})
            if not out:
                return jsonify({"success": False, "error": "No valid questions generated."}), 500
            return jsonify({"success": True, "questions": out})
        except json.JSONDecodeError as e:
            return jsonify({"success": False, "error": "Could not parse quiz: " + str(e)}), 500
        except ImportError:
            return jsonify({"success": False, "error": "OpenAI library not installed."}), 500
        except Exception as e:
            return jsonify({"success": False, "error": str(e)}), 500
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/tutorial_complete", methods=["POST"])
@login_required
def tutorial_complete():
    current_user.tutorial_completed = True
    db.session.commit()
    return jsonify({"success": True})


@app.route("/logout")
@login_required
def logout():
    logout_user()
    return redirect(url_for("login"))


if __name__ == "__main__":
    with app.app_context():
        db.create_all()
        _ensure_updated_at_column()
        _ensure_note_feature_columns()
    app.run(debug=True)