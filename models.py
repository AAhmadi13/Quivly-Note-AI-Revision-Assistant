# Author: Adam H. Ahmadi ID: 23160330
from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from datetime import datetime

db = SQLAlchemy()

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(150), unique=True, nullable=False)
    password = db.Column(db.String(255), nullable=False)
    tutorial_completed = db.Column(db.Boolean, default=False, nullable=False)

    notes = db.relationship('Note', backref='author', lazy=True)


class Note(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), default="Untitled Note")
    content = db.Column(db.Text, default="")
    is_deleted = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    podcast_script = db.Column(db.Text, default="")
    flashcards_json = db.Column(db.Text, default="")
    is_locked = db.Column(db.Boolean, default=False)
    lock_password_hash = db.Column(db.String(255), default="")
    chat_history_json = db.Column(db.Text, default="")
    chat_features_json = db.Column(db.Text, default="")
    reminder_enabled = db.Column(db.Boolean, default=False)
    reminder_idle_hours = db.Column(db.Integer, default=24)
    reminder_target_at = db.Column(db.DateTime, nullable=True)
    last_interaction_at = db.Column(db.DateTime, nullable=True)

    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)