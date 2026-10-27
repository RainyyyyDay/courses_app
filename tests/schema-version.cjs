const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');

// Run the real migrations against memory only, never the installation database.
const source = fs.readFileSync(path.join(__dirname, '../back/db/schema.js'), 'utf8');
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
function migrate() {
  vm.runInNewContext(source, {
    require(name) {
      assert.equal(name, './connection');
      return { db };
    },
  }, { filename: 'schema.js' });
}
function snapshot() {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  return JSON.stringify({
    schema: db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(),
    rows: tables.map(({ name }) => [name, db.prepare('SELECT * FROM "' + name + '" ORDER BY rowid').all()]),
  });
}
try {
  migrate();
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 27);
  db.exec("ALTER TABLE assessments ADD COLUMN chart_reference TEXT; UPDATE courses SET name='preserved course' WHERE id=1");
  const before = snapshot();
  db.exec('PRAGMA user_version = 26');
  migrate();
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 27);
  assert.equal(snapshot(), before, 'v26 upgrade preserves all rows and optional columns');
  migrate();
  assert.equal(snapshot(), before, 'existing v27 database starts without changes');
  db.exec('PRAGMA user_version = 28');
  assert.throws(migrate, /28.*27/, 'future versions remain protected');
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 28);
  assert.equal(snapshot(), before);
  console.log('PASS schema version: fresh install, v26 upgrade, v27 restart, future-version protection');
} finally {
  db.close();
}
