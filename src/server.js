require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

const app = express();

// ── Database ────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const query = (text, params) => pool.query(text, params);

// ── Middleware ───────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','PATCH'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '1mb' }));

const apiLimiter = rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false });
app.use('/api', apiLimiter);

// ── JWT Auth ──────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'kalibz_jwt_secret_2026_scottstechx';
const jwt = require('jsonwebtoken');

const authenticate = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
};

// ── Health ───────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── Seed / Init ──────────────────────────────────────────────────
app.post('/api/seed', async (req, res) => {
  const { secret } = req.query;
  if (secret !== 'KalibzSeed2026!') return res.status(403).json({ error: 'Forbidden' });
  const client = await pool.connect();
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await client.query(schema);
    const hash = await bcrypt.hash('Admin@2026', 12);
    await client.query(
      `INSERT INTO users (username, email, password, role, first_name, last_name, phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      ['admin', 'admin@kalinabiriss.ac.ug', hash, 'admin', 'ScottsTechX', 'Administrator', '+256-740396825']
    );
    await client.query(`INSERT INTO classes (name, stream) VALUES
      ('S.1','A'),('S.1','B'),('S.2','A'),('S.2','B'),
      ('S.3','A'),('S.3','B'),('S.4','A'),('S.4','B'),
      ('S.5','A'),('S.5','B'),('S.6','A'),('S.6','B')`);
    await client.query(`INSERT INTO subjects (name, code, category, level) VALUES
      ('Mathematics','MATH','Mathematics','O Level'),
      ('English','ENG','Languages','O Level'),
      ('Physics','PHY','Sciences','A Level'),
      ('Chemistry','CHEM','Sciences','A Level'),
      ('Biology','BIO','Sciences','O Level'),
      ('History','HIST','Humanities','O Level'),
      ('Geography','GEO','Humanities','O Level'),
      ('CRE','CRE','Humanities','O Level'),
      ('ICT','ICT','Applied','O Level'),
      ('Agriculture','AGR','Applied','O Level'),
      ('Economics','ECON','Humanities','A Level'),
      ('Literature','LIT','Languages','O Level')`);
    await client.query(`INSERT INTO announcements (title, content, category, priority, created_by) VALUES
      ('Term 2 Examinations Begin June 9','All S.4-S.6 students must be prepared. Exam timetable posted on notice board.','Academic','high',1),
      ('Fee Payment Final Deadline — June 15','Parents are urged to clear all Term 2 fees before June 15 to avoid penalties. Payment via mobile money accepted.','Finance','urgent',1),
      ('Science Fair 2026 — June 21','Interested students should submit project proposals by June 5. Categories: Biology, Chemistry, Physics, ICT.','Event','normal',1),
      ('Inter-Class Athletics Meet — July 10','All students encouraged to participate. Registration closes July 5.','Sports','normal',1),
      ('New ICT Lab Now Open','50 new computers installed. Lab open 7AM-6PM weekdays. First-come-first-served.','General','normal',1)`);
    res.json({ message: 'Database seeded successfully', admin: 'admin@kalinabiriss.ac.ug / Admin@2026' });
  } catch (e) {
    console.error('Seed error:', e);
    res.status(500).json({ error: 'Seed failed: ' + e.message });
  } finally {
    client.release();
  }
});

// ── Auth Routes ──────────────────────────────────────────────────
const bcrypt = require('bcryptjs');

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
    const user = rows[0];
    if (!user || !await bcrypt.compare(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email, role: user.role, first_name: user.first_name, last_name: user.last_name, phone: user.phone, class: user.class, stream: user.stream, avatar_url: user.avatar_url }
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Login failed' }); }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password, role = 'student', first_name, last_name, phone, class: cls, stream, admission_no } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
    const exists = await query('SELECT id FROM users WHERE email = $1 OR username = $2', [email, username]);
    if (exists.rows.length) return res.status(409).json({ error: 'Username or email already exists' });
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await query(
      `INSERT INTO users (username, email, password, role, first_name, last_name, phone, class, stream)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,username,email,role,first_name,last_name`,
      [username, email, hash, role, first_name, last_name, phone, cls, stream]
    );
    const user = rows[0];

    // Auto-create students/teachers row after user registration
    if (role === 'student') {
      const studentAdm = admission_no || `KSS/${new Date().getFullYear()}/${String(user.id).padStart(3, '0')}`;
      await query(
        `INSERT INTO students (user_id, admission_no, first_name, last_name, class, stream, phone, email, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')`,
        [user.id, studentAdm, first_name, last_name, cls || '', stream || 'A', phone, email]
      );
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role, first_name: user.first_name, last_name: user.last_name } });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Registration failed' }); }
});

// Migration endpoint — fix missing admission_no column on Railway DB
app.post('/api/migrate', authenticate, requireRole('admin'), async (req, res) => {
  try {
    // Ensure admission_no column exists
    await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS admission_no VARCHAR(50) UNIQUE`);
    // Backfill admission_no for any student rows that are missing it
    await query(`UPDATE students SET admission_no = COALESCE(admission_no, CONCAT('KSS/', EXTRACT(YEAR FROM created_at), '/', LPAD(id::text, 3, '0'))) WHERE admission_no IS NULL OR admission_no = ''`);
    res.json({ message: 'Migration complete', ts: new Date().toISOString() });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Migration failed: ' + e.message }); }
});

// ── Admin Stats ──────────────────────────────────────────────────
app.get('/api/admin/stats', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const studentCount = await query('SELECT COUNT(*)::int FROM students WHERE status=$1', ['active']);
    const teacherCount = await query('SELECT COUNT(*)::int FROM teachers WHERE status=$1', ['active']);
    const pendingAdm = await query("SELECT COUNT(*)::int FROM admissions WHERE status='pending'");
    const feesRow = await query("SELECT COALESCE(SUM(amount),0)::int total, COALESCE(SUM(paid),0)::int paid, COALESCE(SUM(balance),0)::int balance FROM fees");
    const annCount = await query('SELECT COUNT(*)::int FROM announcements');
    const newsCount = await query("SELECT COUNT(*)::int FROM news WHERE status='published'");
    res.json({
      students: studentCount.rows[0].count,
      teachers: teacherCount.rows[0].count,
      pendingAdmissions: pendingAdm.rows[0].count,
      feesCollected: feesRow.rows[0].paid,
      feesOutstanding: feesRow.rows[0].balance,
      announcements: annCount.rows[0].count,
      publishedNews: newsCount.rows[0].count,
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Stats failed' }); }
});

// ── Students CRUD ────────────────────────────────────────────────
app.get('/api/students', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM students ORDER BY id DESC');
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch students' }); }
});

app.post('/api/students', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { admission_no, first_name, last_name, class: cls, stream, gender, dob, phone, email, parent_name, parent_phone, parent_email, address, status = 'active' } = req.body;
    if (!first_name || !last_name || !cls) return res.status(400).json({ error: 'Name and class required' });
    const { rows } = await query(
      `INSERT INTO students (admission_no, first_name, last_name, class, stream, gender, dob, phone, email, parent_name, parent_phone, parent_email, address, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [admission_no, first_name, last_name, cls, stream || 'A', gender, dob, phone, email, parent_name, parent_phone, parent_email, address, status]
    );
    res.status(201).json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to create student' }); }
});

app.put('/api/students/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const fields = ['admission_no','first_name','last_name','class','stream','gender','dob','phone','email','parent_name','parent_phone','parent_email','address','status'];
    const updates = [];
    const vals = [];
    fields.forEach((f, i) => { if (req.body[f] !== undefined) { updates.push(`${f}=$${i+1}`); vals.push(req.body[f]); } });
    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
    vals.push(id);
    const { rows } = await query(`UPDATE students SET ${updates.join(',')} WHERE id=$${vals.length} RETURNING *`, vals);
    if (!rows.length) return res.status(404).json({ error: 'Student not found' });
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to update student' }); }
});

app.delete('/api/students/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await query('DELETE FROM students WHERE id=$1 RETURNING id', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Student not found' });
    res.json({ message: 'Deleted', id: rows[0].id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to delete student' }); }
});

// ── Teachers CRUD ────────────────────────────────────────────────
app.get('/api/teachers', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM teachers ORDER BY id DESC');
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch teachers' }); }
});

app.post('/api/teachers', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { first_name, last_name, email, phone, gender, subjects, classes, status = 'active' } = req.body;
    if (!first_name || !last_name || !email) return res.status(400).json({ error: 'Name and email required' });
    const { rows } = await query(
      `INSERT INTO teachers (first_name, last_name, email, phone, gender, subjects, classes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [first_name, last_name, email, phone, gender, subjects || [], classes || [], status]
    );
    res.status(201).json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to create teacher' }); }
});

app.put('/api/teachers/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const fields = ['first_name','last_name','email','phone','gender','subjects','classes','status'];
    const updates = [];
    const vals = [];
    fields.forEach((f, i) => { if (req.body[f] !== undefined) { updates.push(`${f}=$${i+1}`); vals.push(req.body[f]); } });
    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
    vals.push(id);
    const { rows } = await query(`UPDATE teachers SET ${updates.join(',')} WHERE id=$${vals.length} RETURNING *`, vals);
    if (!rows.length) return res.status(404).json({ error: 'Teacher not found' });
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to update teacher' }); }
});

app.delete('/api/teachers/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await query('DELETE FROM teachers WHERE id=$1 RETURNING id', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Teacher not found' });
    res.json({ message: 'Deleted', id: rows[0].id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to delete teacher' }); }
});

// ── Parents CRUD ──────────────────────────────────────────────────
app.get('/api/parents', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM parents ORDER BY id DESC');
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch parents' }); }
});

app.post('/api/parents', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { first_name, last_name, email, phone, relationship, student_id } = req.body;
    if (!first_name || !phone) return res.status(400).json({ error: 'Name and phone required' });
    const { rows } = await query(
      `INSERT INTO parents (first_name, last_name, email, phone, relationship, student_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [first_name, last_name, email, phone, relationship, student_id]
    );
    res.status(201).json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to create parent' }); }
});

app.delete('/api/parents/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await query('DELETE FROM parents WHERE id=$1 RETURNING id', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Parent not found' });
    res.json({ message: 'Deleted', id: rows[0].id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to delete parent' }); }
});

// ── Fees CRUD ─────────────────────────────────────────────────────
app.get('/api/fees', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { class: cls } = req.query;
    let q = 'SELECT f.*, s.first_name || \' \' || s.last_name as student_name FROM fees f LEFT JOIN students s ON f.student_id=s.id';
    const vals = [];
    if (cls) { q += ' WHERE f.class=$1'; vals.push(cls); }
    q += ' ORDER BY f.id DESC';
    const { rows } = await query(q, vals);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch fees' }); }
});

app.post('/api/fees', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { student_id, class: cls, term, amount, paid = 0, balance, due_date } = req.body;
    if (!cls || !amount) return res.status(400).json({ error: 'Class and amount required' });
    const bal = balance !== undefined ? balance : Math.max(0, amount - paid);
    const status = paid >= amount ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
    const { rows } = await query(
      `INSERT INTO fees (student_id, class, term, amount, paid, balance, status, due_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [student_id, cls, term, amount, paid, bal, status, due_date]
    );
    res.status(201).json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to create fee' }); }
});

app.put('/api/fees/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { paid } = req.body;
    if (paid === undefined) return res.status(400).json({ error: 'Paid amount required' });
    const { rows } = await query('SELECT * FROM fees WHERE id=$1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Fee not found' });
    const f = rows[0];
    const newPaid = paid;
    const newBalance = Math.max(0, f.amount - newPaid);
    const newStatus = newPaid >= f.amount ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid';
    const updated = await query(
      'UPDATE fees SET paid=$1, balance=$2, status=$3 WHERE id=$4 RETURNING *',
      [newPaid, newBalance, newStatus, id]
    );
    res.json(updated.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to update fee' }); }
});

app.delete('/api/fees/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await query('DELETE FROM fees WHERE id=$1 RETURNING id', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Fee not found' });
    res.json({ message: 'Deleted', id: rows[0].id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to delete fee' }); }
});

// ── Attendance CRUD ──────────────────────────────────────────────
app.get('/api/attendance', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { date, class: cls } = req.query;
    let q = 'SELECT a.*, s.first_name || \' \' || s.last_name as student_name FROM attendance a LEFT JOIN students s ON a.student_id=s.id WHERE 1=1';
    const vals = [];
    if (date) { vals.push(date); q += ` AND a.date=$${vals.length}`; }
    if (cls) { vals.push(cls); q += ` AND a.class=$${vals.length}`; }
    q += ' ORDER BY a.id DESC';
    const { rows } = await query(q, vals);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch attendance' }); }
});

app.post('/api/attendance', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { records, date, class: cls } = req.body;
    if (records && Array.isArray(records)) {
      const results = [];
      for (const r of records) {
        const { rows } = await query(
          `INSERT INTO attendance (student_id, class, date, status, marked_by)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [r.student_id, r.class || cls, r.date || date, r.status, req.user.id]
        );
        results.push(rows[0]);
      }
      return res.status(201).json({ records: results });
    }
    const { student_id, status } = req.body;
    if (!student_id || !date || !cls || !status) return res.status(400).json({ error: 'All fields required' });
    const { rows } = await query(
      `INSERT INTO attendance (student_id, class, date, status, marked_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [student_id, cls, date, status, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to record attendance' }); }
});

app.delete('/api/attendance/:id', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { rows } = await query('DELETE FROM attendance WHERE id=$1 RETURNING id', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Record not found' });
    res.json({ message: 'Deleted', id: rows[0].id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to delete attendance' }); }
});

// ── Results CRUD ─────────────────────────────────────────────────
app.get('/api/results', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { class: cls, term } = req.query;
    let q = 'SELECT r.*, s.first_name || \' \' || s.last_name as student_name FROM results r LEFT JOIN students s ON r.student_id=s.id WHERE 1=1';
    const vals = [];
    if (cls) { vals.push(cls); q += ` AND r.class=$${vals.length}`; }
    if (term) { vals.push(term); q += ` AND r.term=$${vals.length}`; }
    q += ' ORDER BY r.id DESC';
    const { rows } = await query(q, vals);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch results' }); }
});

app.post('/api/results', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { student_id, class: cls, subject, exam_type, score, grade, position, class_avg, term } = req.body;
    if (!student_id || !cls || !subject || score === undefined) return res.status(400).json({ error: 'student_id, class, subject, score required' });
    const { rows } = await query(
      `INSERT INTO results (student_id, class, subject, exam_type, score, grade, position, class_avg, term)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [student_id, cls, subject, exam_type, score, grade, position, class_avg, term]
    );
    res.status(201).json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to add result' }); }
});

app.delete('/api/results/:id', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { rows } = await query('DELETE FROM results WHERE id=$1 RETURNING id', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Result not found' });
    res.json({ message: 'Deleted', id: rows[0].id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to delete result' }); }
});

// ── Admissions CRUD ──────────────────────────────────────────────
app.get('/api/admissions', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { status } = req.query;
    let q = 'SELECT * FROM admissions';
    const vals = [];
    if (status) { vals.push(status); q += ` WHERE status=$${vals.length}`; }
    q += ' ORDER BY id DESC';
    const { rows } = await query(q, vals);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch admissions' }); }
});

app.post('/api/admissions', async (req, res) => {
  try {
    const { first_name, last_name, class: cls, gender, parent_name, parent_phone, parent_email } = req.body;
    if (!first_name || !cls) return res.status(400).json({ error: 'Name and class required' });
    const appNo = `APP-${new Date().getFullYear()}-${String(Math.floor(Math.random()*9999)).padStart(4,'0')}`;
    const { rows } = await query(
      `INSERT INTO admissions (app_no, first_name, last_name, class, gender, parent_name, parent_phone, parent_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [appNo, first_name, last_name, cls, gender, parent_name, parent_phone, parent_email]
    );
    res.status(201).json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to submit admission' }); }
});

app.put('/api/admissions/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'Status required' });
    const { rows } = await query('UPDATE admissions SET status=$1 WHERE id=$2 RETURNING *', [status, id]);
    if (!rows.length) return res.status(404).json({ error: 'Application not found' });
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to update admission' }); }
});

// ── Announcements (public read, auth write) ───────────────────────
app.get('/api/announcements', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 50');
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch announcements' }); }
});

app.post('/api/announcements', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { title, content, category = 'general', priority = 'normal', expires_at } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'Title and content required' });
    const { rows } = await query(
      `INSERT INTO announcements (title, content, category, priority, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [title, content, category, priority, expires_at, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to create announcement' }); }
});

app.put('/api/announcements/:id', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, category, priority, expires_at } = req.body;
    const { rows } = await query(
      `UPDATE announcements SET title=COALESCE($1,title), content=COALESCE($2,content), category=COALESCE($3,category), priority=COALESCE($4,priority), expires_at=COALESCE($5,expires_at) WHERE id=$6 RETURNING *`,
      [title, content, category, priority, expires_at, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Announcement not found' });
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to update announcement' }); }
});

app.delete('/api/announcements/:id', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { rows } = await query('DELETE FROM announcements WHERE id=$1 RETURNING id', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Announcement not found' });
    res.json({ message: 'Deleted', id: rows[0].id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to delete announcement' }); }
});

// ── News (public read, auth write) ────────────────────────────────
app.get('/api/news', async (req, res) => {
  try {
    const { rows } = await query("SELECT * FROM news WHERE status='published' ORDER BY created_at DESC LIMIT 50");
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch news' }); }
});

app.post('/api/news', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { title, content, category, image, status = 'published' } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'Title and content required' });
    const { rows } = await query(
      `INSERT INTO news (title, content, category, image, status, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [title, content, category, image, status, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to create news' }); }
});

app.put('/api/news/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, category, image, status } = req.body;
    const { rows } = await query(
      `UPDATE news SET title=COALESCE($1,title), content=COALESCE($2,content), category=COALESCE($3,category), image=COALESCE($4,image), status=COALESCE($5,status) WHERE id=$6 RETURNING *`,
      [title, content, category, image, status, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'News not found' });
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to update news' }); }
});

app.delete('/api/news/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await query('DELETE FROM news WHERE id=$1 RETURNING id', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'News not found' });
    res.json({ message: 'Deleted', id: rows[0].id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to delete news' }); }
});

// ── Classes & Subjects (public read) ────────────────────────────
app.get('/api/classes', async (req, res) => { try { const { rows } = await query('SELECT * FROM classes ORDER BY name, stream'); res.json(rows); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/subjects', async (req, res) => { try { const { rows } = await query('SELECT * FROM subjects ORDER BY name'); res.json(rows); } catch (e) { res.status(500).json({ error: e.message }); } });

app.post('/api/classes', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { name, stream = 'A', class_teacher_id } = req.body;
    if (!name) return res.status(400).json({ error: 'Class name required' });
    const { rows } = await query('INSERT INTO classes (name, stream, class_teacher_id) VALUES ($1,$2,$3) RETURNING *', [name, stream, class_teacher_id]);
    res.status(201).json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to create class' }); }
});

app.post('/api/subjects', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { name, code, category, level, teacher_id } = req.body;
    if (!name || !code) return res.status(400).json({ error: 'Name and code required' });
    const { rows } = await query('INSERT INTO subjects (name, code, category, level, teacher_id) VALUES ($1,$2,$3,$4,$5) RETURNING *', [name, code, category, level, teacher_id]);
    res.status(201).json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to create subject' }); }
});

// ── Gallery (public read) ────────────────────────────────────────
app.get('/api/gallery', async (req, res) => { try { const { rows } = await query('SELECT * FROM gallery ORDER BY created_at DESC'); res.json(rows); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/gallery', authenticate, requireRole('admin'), async (req, res) => { try { const { title, image_url, caption, category } = req.body; if (!image_url) return res.status(400).json({ error: 'image_url required' }); const { rows } = await query('INSERT INTO gallery (title, image_url, caption, category) VALUES ($1,$2,$3,$4) RETURNING *', [title, image_url, caption, category]); res.status(201).json(rows[0]); } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to add gallery item' }); } });
app.delete('/api/gallery/:id', authenticate, requireRole('admin'), async (req, res) => { try { const { rows } = await query('DELETE FROM gallery WHERE id=$1 RETURNING id', [req.params.id]); if (!rows.length) return res.status(404).json({ error: 'Item not found' }); res.json({ message: 'Deleted', id: rows[0].id }); } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to delete gallery item' }); } });

// ── Timetable ────────────────────────────────────────────────────
app.get('/api/timetable', authenticate, async (req, res) => {
  try {
    const { class: cls } = req.query;
    let q = 'SELECT * FROM timetable';
    const vals = [];
    if (cls) { vals.push(cls); q += ` WHERE class=$${vals.length}`; }
    q += ' ORDER BY day, time_slot';
    const { rows } = await query(q, vals);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch timetable' }); }
});

app.post('/api/timetable', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { class: cls, day, time_slot, subject, teacher } = req.body;
    if (!cls || !day || !subject) return res.status(400).json({ error: 'Class, day, subject required' });
    const { rows } = await query('INSERT INTO timetable (class, day, time_slot, subject, teacher) VALUES ($1,$2,$3,$4,$5) RETURNING *', [cls, day, time_slot, subject, teacher]);
    res.status(201).json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to create timetable entry' }); }
});

// ── Events ───────────────────────────────────────────────────────
app.get('/api/events', authenticate, async (req, res) => { try { const { rows } = await query('SELECT * FROM events ORDER BY event_date DESC'); res.json(rows); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/events', authenticate, requireRole('admin'), async (req, res) => { try { const { title, description, event_date } = req.body; if (!title) return res.status(400).json({ error: 'Title required' }); const { rows } = await query('INSERT INTO events (title, description, event_date, created_by) VALUES ($1,$2,$3,$4) RETURNING *', [title, description, event_date, req.user.id]); res.status(201).json(rows[0]); } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to create event' }); } });
app.delete('/api/events/:id', authenticate, requireRole('admin'), async (req, res) => { try { const { rows } = await query('DELETE FROM events WHERE id=$1 RETURNING id', [req.params.id]); if (!rows.length) return res.status(404).json({ error: 'Event not found' }); res.json({ message: 'Deleted', id: rows[0].id }); } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to delete event' }); } });

// ── Seed endpoint (one-time admin init) ─────────────────────────
app.post('/api/seed', async (req, res) => {
  try {
    const { secret } = req.query;
    if (secret !== 'KalibzSeed2026!') return res.status(403).json({ error: 'Forbidden' });
    const bcrypt = require('bcryptjs');
    const client = await pool.connect();
    try {
      // Run schema
      await client.query(fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8'));
      // Seed admin
      const adminCheck = await client.query("SELECT id FROM users WHERE email='admin@kalinabiriss.ac.ug'");
      if (!adminCheck.rows.length) {
        const hash = await bcrypt.hash('Admin@2026', 12);
        await client.query(
          `INSERT INTO users (username, email, password, role, first_name, last_name, phone)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          ['admin', 'admin@kalinabiriss.ac.ug', hash, 'admin', 'ScottsTechX', 'Administrator', '+256-740396825']
        );
      }
      // Seed classes
      const classCheck = await client.query('SELECT COUNT(*)::int FROM classes');
      if (classCheck.rows[0].count === 0) {
        await client.query(`INSERT INTO classes (name, stream) VALUES
          ('S.1','A'),('S.1','B'),('S.2','A'),('S.2','B'),
          ('S.3','A'),('S.3','B'),('S.4','A'),('S.4','B'),
          ('S.5','A'),('S.5','B'),('S.6','A'),('S.6','B')`);
      }
      // Seed subjects
      const subjCheck = await client.query('SELECT COUNT(*)::int FROM subjects');
      if (subjCheck.rows[0].count === 0) {
        await client.query(`INSERT INTO subjects (name, code, category, level) VALUES
          ('Mathematics','MATH','Mathematics','O Level'),
          ('English','ENG','Languages','O Level'),
          ('Physics','PHY','Sciences','A Level'),
          ('Chemistry','CHEM','Sciences','A Level'),
          ('Biology','BIO','Sciences','O Level'),
          ('History','HIST','Humanities','O Level'),
          ('Geography','GEO','Humanities','O Level'),
          ('CRE','CRE','Humanities','O Level'),
          ('ICT','ICT','Applied','O Level'),
          ('Agriculture','AGR','Applied','O Level'),
          ('Economics','ECON','Humanities','A Level'),
          ('Literature','LIT','Languages','O Level')`);
      }
      // Seed announcements
      const annCheck = await client.query('SELECT COUNT(*)::int FROM announcements');
      if (annCheck.rows[0].count === 0) {
        await client.query(`INSERT INTO announcements (title, content, category, priority, created_by) VALUES
          ('Term 2 Examinations Begin June 9','All S.4-S.6 students must be prepared. Exam timetable posted on notice board.','Academic','high',1),
          ('Fee Payment Final Deadline — June 15','Parents are urged to clear all Term 2 fees before June 15 to avoid penalties.','Finance','urgent',1),
          ('Science Fair 2026 — June 21','Project proposals due June 5. Categories: Biology, Chemistry, Physics, ICT.','Event','normal',1),
          ('Inter-Class Athletics Meet — July 10','Registration closes July 5. All students encouraged to participate.','Sports','normal',1),
          ('New ICT Lab Now Open','50 new computers installed. Open 7AM-6PM weekdays.','General','normal',1)`);
      }
      res.json({ message: 'Seed complete', admin: 'admin@kalinabiriss.ac.ug / Admin@2026' });
    } finally { client.release(); }
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ── Catch-all 404 ────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: `Cannot ${req.method} ${req.path}` }));

// ── Error handler ────────────────────────────────────────────────
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Internal server error' }); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Kalibz API running on port ${PORT}`));

module.exports = app;