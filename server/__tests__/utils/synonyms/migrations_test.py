"""Disposable SQLite migration regression; never opens application storage."""
import pathlib
import sqlite3
import unittest


class SynonymMigrationTest(unittest.TestCase):
    def test_new_tables_preserve_existing_schema_and_records(self):
        root = pathlib.Path(__file__).resolve().parents[3] / "prisma" / "migrations"
        additions = {
            "20261010000000_schat_synonym_suggestions",
            "20261010010000_schat_synonym_suggestion_runs",
        }
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        files = sorted(root.glob("*/migration.sql"))
        self.assertEqual(sum(f.parent.name in additions for f in files), 2)
        for file in files:
            if file.parent.name not in additions:
                db.executescript(file.read_text(encoding="utf-8"))
        db.execute("INSERT INTO schat_synonym_groups (terms,status) VALUES (?,?)",
                   ('["synthetic-existing","synthetic-alias"]', 'active'))
        tables = [r[0] for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        def snapshot():
            return {table: (list(db.execute(f'PRAGMA table_info("{table}")')),
                            list(db.execute(f'SELECT * FROM "{table}"'))) for table in tables}
        before = snapshot()
        for file in files:
            if file.parent.name in additions:
                db.executescript(file.read_text(encoding="utf-8"))
        self.assertEqual(snapshot(), before)
        db.execute("INSERT INTO schat_synonym_suggestion_runs (trigger) VALUES ('upload')")
        db.execute("INSERT INTO schat_synonym_suggestions (type,terms,method,run_id) VALUES ('addition','[]','fake',1)")
        self.assertEqual(db.execute("SELECT status, run_id FROM schat_synonym_suggestions").fetchone(),
                         ('pending', 1))
        self.assertEqual(db.execute('PRAGMA integrity_check').fetchone(), ('ok',))


if __name__ == '__main__':
    unittest.main()
