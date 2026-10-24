from __future__ import annotations

import json
import os
import sqlite3
import threading
import webbrowser
from datetime import date, timedelta, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

APP_DIR = Path(__file__).resolve().parent
DB_PATH = APP_DIR / "data" / "scrum_board.db"
STATIC_DIR = APP_DIR / "static"
HOST = "127.0.0.1"
PORT = 8765


def connect_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def initialize_db():
    with connect_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS sprints (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                goal TEXT NOT NULL DEFAULT '',
                start_date TEXT NOT NULL DEFAULT '',
                end_date TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'todo',
                priority TEXT NOT NULL DEFAULT 'medium',
                assignee TEXT NOT NULL DEFAULT '',
                points INTEGER NOT NULL DEFAULT 0,
                due_date TEXT NOT NULL DEFAULT '',
                labels TEXT NOT NULL DEFAULT '[]',
                sprint_id INTEGER NULL REFERENCES sprints(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        """)
        sprint_count = conn.execute("SELECT COUNT(*) FROM sprints").fetchone()[0]
        if sprint_count == 0:
            today = date.today()
            start = today.isoformat()
            end = (today + timedelta(days=13)).isoformat()
            now = datetime.now().isoformat(timespec="seconds")
            cur = conn.execute(
                "INSERT INTO sprints(name, goal, start_date, end_date, created_at) VALUES(?,?,?,?,?)",
                ("Sprint 1", "İlk sprint hedefinizi buraya yazın.", start, end, now),
            )
            conn.execute("INSERT OR REPLACE INTO settings(key, value) VALUES('active_sprint_id', ?)", (str(cur.lastrowid),))
            conn.execute("INSERT OR REPLACE INTO settings(key, value) VALUES('board_name', 'Takım Scrum Boardu')")
        else:
            conn.execute("INSERT OR IGNORE INTO settings(key, value) VALUES('board_name', 'Takım Scrum Boardu')")
            active = conn.execute("SELECT value FROM settings WHERE key='active_sprint_id'").fetchone()
            if not active or not conn.execute("SELECT id FROM sprints WHERE id=?", (active[0],)).fetchone():
                first = conn.execute("SELECT id FROM sprints ORDER BY id LIMIT 1").fetchone()
                if first:
                    conn.execute("INSERT OR REPLACE INTO settings(key, value) VALUES('active_sprint_id', ?)", (str(first[0]),))


def rows_to_dict(rows):
    return [dict(row) for row in rows]


def bootstrap_payload():
    with connect_db() as conn:
        tasks = rows_to_dict(conn.execute("SELECT * FROM tasks ORDER BY id DESC").fetchall())
        sprints = rows_to_dict(conn.execute("SELECT * FROM sprints ORDER BY id DESC").fetchall())
        settings = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM settings").fetchall()}
    for task in tasks:
        try:
            task["labels"] = json.loads(task.get("labels") or "[]")
        except (ValueError, TypeError):
            task["labels"] = []
    settings["active_sprint_id"] = int(settings.get("active_sprint_id") or 0)
    return {"tasks": tasks, "sprints": sprints, "settings": settings}


class Handler(BaseHTTPRequestHandler):
    server_version = "LocalScrumBoard/1.0"

    def log_message(self, fmt, *args):
        # Keep the console focused on startup/shutdown rather than every local request.
        return

    def send_json(self, data, status=200):
        encoded = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length > 2_000_000:
            raise ValueError("İstek gövdesi çok büyük.")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            obj = json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ValueError("Geçersiz JSON verisi.") from exc
        if not isinstance(obj, dict):
            raise ValueError("JSON gövdesi bir nesne olmalı.")
        return obj

    def serve_static(self, path):
        if path in ("/", "/index.html"):
            target = STATIC_DIR / "index.html"
        elif path.startswith("/static/"):
            rel = path[len("/static/"):]
            target = (STATIC_DIR / rel).resolve()
            if STATIC_DIR.resolve() not in target.parents:
                self.send_error(403)
                return
        else:
            self.send_error(404)
            return
        if not target.is_file():
            self.send_error(404)
            return
        content = target.read_bytes()
        suffix = target.suffix.lower()
        mime = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".svg": "image/svg+xml"}.get(suffix, "application/octet-stream")
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/bootstrap":
            return self.send_json(bootstrap_payload())
        if parsed.path.startswith("/api/"):
            return self.send_json({"error": "API uç noktası bulunamadı."}, 404)
        self.serve_static(parsed.path)

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            data = self.read_json()
            if path == "/api/tasks":
                title = str(data.get("title", "")).strip()
                if not title:
                    return self.send_json({"error": "Görev başlığı boş olamaz."}, 400)
                status = data.get("status", "todo")
                priority = data.get("priority", "medium")
                if status not in {"todo", "in_progress", "review", "done"}:
                    return self.send_json({"error": "Geçersiz görev durumu."}, 400)
                if priority not in {"low", "medium", "high", "urgent"}:
                    return self.send_json({"error": "Geçersiz öncelik."}, 400)
                points = max(0, min(100, int(data.get("points", 0) or 0)))
                sprint_id = data.get("sprint_id") or None
                if sprint_id is not None:
                    sprint_id = int(sprint_id)
                labels = data.get("labels", [])
                if not isinstance(labels, list):
                    labels = []
                now = datetime.now().isoformat(timespec="seconds")
                with connect_db() as conn:
                    cur = conn.execute("""INSERT INTO tasks(title, description, status, priority, assignee, points, due_date, labels, sprint_id, created_at, updated_at)
                        VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                        (title, str(data.get("description", "")).strip(), status, priority,
                         str(data.get("assignee", "")).strip(), points, str(data.get("due_date", "")),
                         json.dumps([str(x).strip() for x in labels if str(x).strip()][:10], ensure_ascii=False), sprint_id, now, now))
                    task_id = cur.lastrowid
                return self.send_json({"id": task_id, "ok": True}, 201)
            if path == "/api/sprints":
                name = str(data.get("name", "")).strip()
                if not name:
                    return self.send_json({"error": "Sprint adı boş olamaz."}, 400)
                nowdate = date.today()
                start = str(data.get("start_date") or nowdate.isoformat())
                end = str(data.get("end_date") or (nowdate + timedelta(days=13)).isoformat())
                try:
                    if date.fromisoformat(end) < date.fromisoformat(start):
                        return self.send_json({"error": "Bitiş tarihi başlangıçtan önce olamaz."}, 400)
                except ValueError:
                    return self.send_json({"error": "Sprint tarihleri geçerli olmalı."}, 400)
                with connect_db() as conn:
                    cur = conn.execute("INSERT INTO sprints(name, goal, start_date, end_date, created_at) VALUES(?,?,?,?,?)",
                                       (name, str(data.get("goal", "")).strip(), start, end, datetime.now().isoformat(timespec="seconds")))
                    sprint_id = cur.lastrowid
                    conn.execute("INSERT OR REPLACE INTO settings(key, value) VALUES('active_sprint_id', ?)", (str(sprint_id),))
                return self.send_json({"id": sprint_id, "ok": True}, 201)
            if path == "/api/settings":
                active_id = data.get("active_sprint_id")
                with connect_db() as conn:
                    if active_id not in (None, "", 0, "0"):
                        if not conn.execute("SELECT id FROM sprints WHERE id=?", (int(active_id),)).fetchone():
                            return self.send_json({"error": "Sprint bulunamadı."}, 404)
                        conn.execute("INSERT OR REPLACE INTO settings(key, value) VALUES('active_sprint_id', ?)", (str(int(active_id)),))
                    if "board_name" in data:
                        name = str(data["board_name"]).strip()[:100] or "Takım Scrum Boardu"
                        conn.execute("INSERT OR REPLACE INTO settings(key, value) VALUES('board_name', ?)", (name,))
                return self.send_json({"ok": True})
            return self.send_json({"error": "API uç noktası bulunamadı."}, 404)
        except (ValueError, TypeError, OverflowError) as exc:
            return self.send_json({"error": str(exc) or "Gönderilen veri geçersiz."}, 400)
        except sqlite3.Error:
            return self.send_json({"error": "Veritabanı işleminde hata oluştu."}, 500)

    def do_PUT(self):
        path = urlparse(self.path).path
        try:
            data = self.read_json()
            if not path.startswith("/api/tasks/"):
                return self.send_json({"error": "API uç noktası bulunamadı."}, 404)
            try:
                task_id = int(path.rsplit("/", 1)[1])
            except ValueError:
                return self.send_json({"error": "Geçersiz görev numarası."}, 400)
            allowed_status = {"todo", "in_progress", "review", "done"}
            allowed_priority = {"low", "medium", "high", "urgent"}
            with connect_db() as conn:
                row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
                if not row:
                    return self.send_json({"error": "Görev bulunamadı."}, 404)
                old = dict(row)
                title = str(data.get("title", old["title"])).strip()
                if not title:
                    return self.send_json({"error": "Görev başlığı boş olamaz."}, 400)
                status = data.get("status", old["status"])
                priority = data.get("priority", old["priority"])
                if status not in allowed_status or priority not in allowed_priority:
                    return self.send_json({"error": "Durum veya öncelik değeri geçersiz."}, 400)
                points = max(0, min(100, int(data.get("points", old["points"]) or 0)))
                sprint_id = data.get("sprint_id", old["sprint_id"]) or None
                if sprint_id is not None:
                    sprint_id = int(sprint_id)
                    if not conn.execute("SELECT id FROM sprints WHERE id=?", (sprint_id,)).fetchone():
                        return self.send_json({"error": "Seçilen sprint bulunamadı."}, 400)
                labels = data.get("labels", json.loads(old["labels"] or "[]"))
                if not isinstance(labels, list):
                    labels = []
                conn.execute("""UPDATE tasks SET title=?, description=?, status=?, priority=?, assignee=?, points=?, due_date=?, labels=?, sprint_id=?, updated_at=? WHERE id=?""",
                    (title, str(data.get("description", old["description"])).strip(), status, priority,
                     str(data.get("assignee", old["assignee"])).strip(), points,
                     str(data.get("due_date", old["due_date"])),
                     json.dumps([str(x).strip() for x in labels if str(x).strip()][:10], ensure_ascii=False),
                     sprint_id, datetime.now().isoformat(timespec="seconds"), task_id))
            return self.send_json({"ok": True})
        except (ValueError, TypeError, OverflowError) as exc:
            return self.send_json({"error": str(exc) or "Gönderilen veri geçersiz."}, 400)
        except sqlite3.Error:
            return self.send_json({"error": "Veritabanı işleminde hata oluştu."}, 500)

    def do_DELETE(self):
        path = urlparse(self.path).path
        if not path.startswith("/api/tasks/"):
            return self.send_json({"error": "API uç noktası bulunamadı."}, 404)
        try:
            task_id = int(path.rsplit("/", 1)[1])
            with connect_db() as conn:
                cur = conn.execute("DELETE FROM tasks WHERE id=?", (task_id,))
                if cur.rowcount == 0:
                    return self.send_json({"error": "Görev bulunamadı."}, 404)
            return self.send_json({"ok": True})
        except ValueError:
            return self.send_json({"error": "Geçersiz görev numarası."}, 400)
        except sqlite3.Error:
            return self.send_json({"error": "Veritabanı işleminde hata oluştu."}, 500)


def main():
    initialize_db()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.daemon_threads = True
    url = f"http://{HOST}:{PORT}"
    print("\n========================================")
    print("  TAKIM SCRUM BOARDU - Yerel Uygulama")
    print("========================================")
    print(f"Tarayıcı adresi: {url}")
    print(f"Veriler burada saklanır: {DB_PATH}")
    print("Durdurmak için bu pencereyi kapatın veya Ctrl+C kullanın.\n")
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nUygulama kapatılıyor...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
