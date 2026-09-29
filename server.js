// server.js
// SIT774 Task 10.2D - Website Project Part 3 (Database Integration)
//
// Extends the static StockWise site with one SQLite-backed feature: the
// contact page's query form. js/validation.js (written in Part 1) already
// says "In Part 3 of this project it will be saved to the database for the
// administrator to review" - this file is what makes that true, and
// queries.html is the administrator's review page it refers to.

const express = require('express');
const path = require('path');
const logger = require('morgan');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(logger('dev'));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// SQLite database (Node's built-in module, same as Task 9.1P/9.2C/10.1P)
const db = new DatabaseSync('stockwise.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS queries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    query TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )
`);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
const MAX_PHONE_DIGITS = 10;
const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const MAX_QUERY_LENGTH = 2000;

function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * POST /api/queries
 * Body: { name, email, phone, query }
 * Re-runs the same checks js/validation.js already applies in the browser,
 * because a request does not have to come from that form.
 */
app.post('/api/queries', (req, res) => {
  const name = str(req.body?.name);
  const email = str(req.body?.email);
  const phone = str(req.body?.phone);
  const query = str(req.body?.query);

  const errors = [];

  if (name === '') {
    errors.push('Please enter your name.');
  } else if (name.length > MAX_NAME_LENGTH) {
    errors.push(`Your name must be no longer than ${MAX_NAME_LENGTH} characters.`);
  }

  if (email === '') {
    errors.push('Please enter your email address.');
  } else if (email.length > MAX_EMAIL_LENGTH) {
    errors.push(`Your email address must be no longer than ${MAX_EMAIL_LENGTH} characters.`);
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.push('Please enter a valid email address, for example name@example.com.');
  }

  if (phone !== '') {
    if (!/^[0-9]+$/.test(phone)) {
      errors.push('Your phone number must contain digits only, with no spaces or symbols.');
    } else if (phone.length > MAX_PHONE_DIGITS) {
      errors.push(`Your phone number must be no longer than ${MAX_PHONE_DIGITS} digits.`);
    }
  }

  if (query === '') {
    errors.push('Please tell us what your query is about.');
  } else if (query.length > MAX_QUERY_LENGTH) {
    errors.push(`Your query must be no longer than ${MAX_QUERY_LENGTH} characters.`);
  }

  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO queries (name, email, phone, query)
      VALUES (?, ?, ?, ?)
    `);
    const info = stmt.run(name, email, phone === '' ? null : phone, query);

    res.status(201).json({
      message: 'Query received. Thank you, we will be in touch.',
      id: info.lastInsertRowid
    });
  } catch (err) {
    console.error('Failed to save query:', err.message);
    res.status(500).json({ errors: ['Could not save your query. Please try again.'] });
  }
});

/**
 * GET /api/queries?q=&sort=newest|oldest&page=1&pageSize=5
 * Lists submitted queries for the administrator review page: filterable by
 * a text search across name/email/query, sortable by date, and paginated.
 */
app.get('/api/queries', (req, res) => {
  const q = str(req.query.q);
  const sort = req.query.sort === 'oldest' ? 'ASC' : 'DESC';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(20, Math.max(1, parseInt(req.query.pageSize, 10) || 5));
  const offset = (page - 1) * pageSize;

  try {
    const where = q === '' ? '' : 'WHERE name LIKE ? OR email LIKE ? OR query LIKE ?';
    const params = q === '' ? [] : [`%${q}%`, `%${q}%`, `%${q}%`];

    const total = db
      .prepare(`SELECT COUNT(*) AS count FROM queries ${where}`)
      .get(...params).count;

    const rows = db
      .prepare(`
        SELECT id, name, email, phone, query, created_at
        FROM queries ${where}
        ORDER BY created_at ${sort}
        LIMIT ? OFFSET ?
      `)
      .all(...params, pageSize, offset);

    res.status(200).json({
      queries: rows,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    });
  } catch (err) {
    console.error('Failed to read queries:', err.message);
    res.status(500).json({ error: 'Could not read the queries list.' });
  }
});

/**
 * DELETE /api/queries/:id
 * Lets the administrator remove a query once it has been handled.
 */
app.delete('/api/queries/:id', (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'A valid query id is required.' });
  }

  // The existence check runs inside the same try as the delete itself, not
  // before it: a database failure here would otherwise skip this route's
  // JSON error handling entirely and fall through to Express's default
  // HTML error page, which the client can't parse as JSON.
  try {
    const existing = db.prepare('SELECT id FROM queries WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: `No query with id ${id} was found.` });
    }

    db.prepare('DELETE FROM queries WHERE id = ?').run(id);
    res.status(200).json({ message: `Query ${id} was deleted.` });
  } catch (err) {
    console.error('Failed to delete query:', err.message);
    res.status(500).json({ error: 'Could not delete the query.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log('Type Ctrl+C to shut down the web server');
});
