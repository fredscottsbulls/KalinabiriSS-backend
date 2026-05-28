require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ── Database ──────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

// ── Middleware ────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => cb(null, `${uuidv4()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500 });
app.use('/api/', limiter);

// ── Auth Middleware ───────────────────────────────────────
const authenticate = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer '))
    return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
};

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Forbidden' });

// ── Init DB ───────────────────────────────────────────────
const initDB = async () => {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY, username VARCHAR(50) UNIQUE, email VARCHAR(100) UNIQUE,
      password_hash TEXT NOT NULL, role VARCHAR(20) DEFAULT 'student',
      first_name VARCHAR(50), last_name VARCHAR(50), phone VARCHAR(20),
      class VARCHAR(20), stream VARCHAR(20), gender VARCHAR(10),
      address TEXT, emergency_contact VARCHAR(100), avatar_url TEXT,
      status VARCHAR(20) DEFAULT 'active', created_at TIMESTAMP DEFAULT NOW(),
      last_login TIMESTAMP, is_online BOOLEAN DEFAULT false
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY, user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      admission_no VARCHAR(50) UNIQUE, date_of_birth DATE, nationality VARCHAR(50),
      former_school TEXT, religion VARCHAR(50), guardian_name VARCHAR(100),
      guardian_phone VARCHAR(20), guardian_relation VARCHAR(50),
      medical_conditions TEXT, house VARCHAR(50), clubs TEXT[],
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS teachers (
      id SERIAL PRIMARY KEY, user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      employee_id VARCHAR(50) UNIQUE, qualification VARCHAR(100),
      subjects_taught TEXT[], department VARCHAR(50),
      experience_years INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS subjects (
      id SERIAL PRIMARY KEY, name VARCHAR(100), code VARCHAR(20),
      category VARCHAR(20), level VARCHAR(20), teacher_id INTEGER REFERENCES teachers(id),
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS classes (
      id SERIAL PRIMARY KEY, name VARCHAR(20), stream VARCHAR(20),
      class_teacher_id INTEGER REFERENCES teachers(id), created_at TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS enrollments (
      id SERIAL PRIMARY KEY, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
      class_id INTEGER REFERENCES classes(id), subject_id INTEGER REFERENCES subjects(id),
      year INTEGER, term INTEGER, created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(student_id, class_id, subject_id, year, term)
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS attendance (
      id SERIAL PRIMARY KEY, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
      class_id INTEGER REFERENCES classes(id), subject_id INTEGER REFERENCES subjects(id),
      date DATE, status VARCHAR(10), marked_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS results (
      id SERIAL PRIMARY KEY, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
      subject_id INTEGER REFERENCES subjects(id), class_id INTEGER REFERENCES classes(id),
      exam_type VARCHAR(30), year INTEGER, term INTEGER,
      score DECIMAL(5,2), grade VARCHAR(5), remarks TEXT,
      entered_by INTEGER REFERENCES users(id), created_at TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS fees (
      id SERIAL PRIMARY KEY, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
      description VARCHAR(200), amount DECIMAL(10,2), paid DECIMAL(10,2) DEFAULT 0,
      due_date DATE, year INTEGER, term INTEGER, status VARCHAR(20) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS announcements (
      id SERIAL PRIMARY KEY, title VARCHAR(200), content TEXT, category VARCHAR(30),
      priority VARCHAR(10) DEFAULT 'normal', expires_at TIMESTAMP,
      created_by INTEGER REFERENCES users(id), created_at TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS news (
      id SERIAL PRIMARY KEY, title VARCHAR(200), slug VARCHAR(200) UNIQUE,
      content TEXT, excerpt TEXT, category VARCHAR(50), image_url TEXT,
      author_id INTEGER REFERENCES users(id), published BOOLEAN DEFAULT false,
      views INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY, title VARCHAR(200), description TEXT,
      event_date TIMESTAMP, end_date TIMESTAMP, location VARCHAR(100),
      category VARCHAR(50), created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY, sender_id INTEGER REFERENCES users(id),
      receiver_id INTEGER REFERENCES users(id), subject VARCHAR(200),
      body TEXT, is_read BOOLEAN DEFAULT false, parent_id INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(30), title VARCHAR(200), message TEXT,
      is_read BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS site_content (
      id SERIAL PRIMARY KEY, page VARCHAR(50), section VARCHAR(50),
      content TEXT, updated_by INTEGER REFERENCES users(id),
      updated_at TIMESTAMP DEFAULT NOW(), UNIQUE(page, section)
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS gallery (
      id SERIAL PRIMARY KEY, title VARCHAR(200), description TEXT,
      image_url TEXT, category VARCHAR(50), tags TEXT[], views INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS activities (
      id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id),
      action VARCHAR(200), entity_type VARCHAR(50), entity_id INTEGER,
      details JSONB, created_at TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS site_settings (
      id SERIAL PRIMARY KEY, key VARCHAR(50) UNIQUE, value TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    // Seed admin
    const adminExists = await client.query(`SELECT id FROM users WHERE username = 'admin' LIMIT 1`);
    if (adminExists.rows.length === 0) {
      const hash = bcrypt.hashSync('Admin@2026', 10);
      await client.query(`INSERT INTO users (username, email, password_hash, role, first_name, last_name, status)
        VALUES ('admin', 'admin@kalinabiriss.ac.ug', $1, 'admin', 'System', 'Administrator', 'active')`, [hash]);
      await client.query(`INSERT INTO site_settings (key, value) VALUES ('school_name', 'KALINABIRI SECONDARY SCHOOL')
        ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO site_settings (key, value) VALUES ('motto', 'Discipline is the Bridge between Goals and Accomplishment')
        ON CONFLICT DO NOTHING`);
      console.log('✓ Admin seeded — admin@kalinabiriss.ac.ug / Admin@2026');
    }
    console.log('✓ Database schema ready');
  } finally {
    client.release();
  }
};

// ── Routes ────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', school: 'KALINABIRI SECONDARY SCHOOL', version: '1.0' }));

// Auth
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE (username = $1 OR email = $1) AND status = $2', [username, 'active']);
    const user = result.rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash))
      return res.status(401).json({ error: 'Invalid credentials' });
    await pool.query('UPDATE users SET last_login = NOW(), is_online = true WHERE id = $1', [user.id]);
    const token = jwt.sign({ id: user.id, role: user.role, username: user.username }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role, first_name: user.first_name, last_name: user.last_name, avatar_url: user.avatar_url } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password, role, first_name, last_name, phone, class: studentClass, gender } = req.body;
    if (!username || !email || !password || !role) return res.status(400).json({ error: 'Missing required fields' });
    const hash = bcrypt.hashSync(password, 10);
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, role, first_name, last_name, phone, class, gender, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active') RETURNING id,username,email,role`,
      [username, email, hash, role, first_name || '', last_name || '', phone || '', studentClass || '', gender || '']
    );
    res.json({ message: 'Registered successfully', user: result.rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Username or email already exists' });
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/auth/me', authenticate, async (req, res) => {
  const result = await pool.query('SELECT id,username,email,role,first_name,last_name,phone,class,stream,gender,avatar_url,status FROM users WHERE id = $1', [req.user.id]);
  res.json(result.rows[0]);
});

// Stats
app.get('/api/admin/stats', authenticate, requireRole('admin'), async (req, res) => {
  const students = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'student'");
  const teachers = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'teacher'");
  const admissions = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'student' AND created_at > NOW() - INTERVAL '30 days'");
  const pendingFees = await pool.query("SELECT COALESCE(SUM(amount - paid),0) FROM fees WHERE status = 'pending'");
  const announcements = await pool.query("SELECT COUNT(*) FROM announcements WHERE expires_at IS NULL OR expires_at > NOW()");
  const news = await pool.query("SELECT COUNT(*) FROM news WHERE published = true");
  res.json({
    students: parseInt(students.rows[0].count),
    teachers: parseInt(teachers.rows[0].count),
    newAdmissions: parseInt(admissions.rows[0].count),
    pendingFees: parseFloat(pendingFees.rows[0].sum),
    announcements: parseInt(announcements.rows[0].count),
    news: parseInt(news.rows[0].count)
  });
});

// Users CRUD
app.get('/api/admin/users', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  const { role, search } = req.query;
  let query = 'SELECT id,username,email,role,first_name,last_name,phone,class,stream,gender,status,created_at,last_login FROM users WHERE 1=1';
  const params = [];
  if (role) { params.push(role); query += ` AND role = $${params.length}`; }
  if (search) { params.push(`%${search}%`); query += ` AND (first_name ILIKE $${params.length} OR last_name ILIKE $${params.length} OR username ILIKE $${params.length})`; }
  query += ' ORDER BY created_at DESC';
  const result = await pool.query(query, params);
  res.json(result.rows);
});

app.put('/api/admin/users/:id', authenticate, requireRole('admin'), async (req, res) => {
  const { first_name, last_name, email, phone, role, class: studentClass, stream, status } = req.body;
  await pool.query(
    'UPDATE users SET first_name=$1,last_name=$2,email=$3,phone=$4,role=$5,class=$6,stream=$7,status=$8 WHERE id=$9',
    [first_name, last_name, email, phone, role, studentClass, stream, status, req.params.id]
  );
  res.json({ message: 'User updated' });
});

app.delete('/api/admin/users/:id', authenticate, requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM users WHERE id = $1 AND role != $2', [req.params.id, 'admin']);
  res.json({ message: 'User deleted' });
});

// Students
app.get('/api/admin/students', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  const result = await pool.query(`
    SELECT u.id,u.username,u.first_name,u.last_name,u.email,u.phone,u.class,u.stream,u.gender,u.status,u.created_at,
           s.admission_no,s.date_of_birth,s.nationality,s.guardian_name,s.guardian_phone,s.house
    FROM users u LEFT JOIN students s ON s.user_id = u.id
    WHERE u.role = 'student' ORDER BY u.created_at DESC
  `);
  res.json(result.rows);
});

app.post('/api/admin/students', authenticate, requireRole('admin'), async (req, res) => {
  const { username, email, password, first_name, last_name, phone, class: studentClass, stream, gender, admission_no, date_of_birth, nationality, guardian_name, guardian_phone, house } = req.body;
  const hash = bcrypt.hashSync(password || 'Student@123', 10);
  const userResult = await pool.query(
    `INSERT INTO users (username,email,password_hash,role,first_name,last_name,phone,class,stream,gender,status)
     VALUES ($1,$2,$3,'student',$4,$5,$6,$7,$8,$9,'active') RETURNING id`,
    [username, email, hash, first_name, last_name, phone, studentClass, stream, gender]
  );
  const userId = userResult.rows[0].id;
  await pool.query(
    `INSERT INTO students (user_id,admission_no,date_of_birth,nationality,guardian_name,guardian_phone,house)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [userId, admission_no, date_of_birth, nationality, guardian_name, guardian_phone, house]
  );
  res.json({ message: 'Student created', userId });
});

// Results
app.get('/api/results', authenticate, async (req, res) => {
  const studentId = req.user.role === 'student' ? req.user.id : req.query.student_id;
  if (!studentId) return res.status(400).json({ error: 'student_id required' });
  const student = await pool.query('SELECT id FROM students WHERE user_id = $1', [studentId]);
  if (!student.rows[0]) return res.json([]);
  const results = await pool.query(`
    SELECT r.*, s.name as subject_name, s.code as subject_code, c.name as class_name
    FROM results r
    JOIN subjects s ON s.id = r.subject_id
    JOIN classes c ON c.id = r.class_id
    WHERE r.student_id = $1 ORDER BY r.year DESC, r.term DESC, r.exam_type
  `, [student.rows[0].id]);
  res.json(results.rows);
});

app.post('/api/results', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  const { student_id, subject_id, class_id, exam_type, year, term, score, grade, remarks } = req.body;
  await pool.query(
    `INSERT INTO results (student_id,subject_id,class_id,exam_type,year,term,score,grade,remarks,entered_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [student_id, subject_id, class_id, exam_type, year, term, score, grade, remarks, req.user.id]
  );
  res.json({ message: 'Result entered' });
});

// Fees
app.get('/api/admin/fees', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  const result = await pool.query(`
    SELECT f.*, u.first_name, u.last_name, u.class, u.username
    FROM fees f JOIN students s ON s.id = f.student_id JOIN users u ON u.id = s.user_id
    ORDER BY f.created_at DESC
  `);
  res.json(result.rows);
});

app.post('/api/admin/fees', authenticate, requireRole('admin'), async (req, res) => {
  const { student_id, description, amount, due_date, year, term } = req.body;
  await pool.query(
    `INSERT INTO fees (student_id,description,amount,due_date,year,term) VALUES ($1,$2,$3,$4,$5,$6)`,
    [student_id, description, amount, due_date, year, term]
  );
  res.json({ message: 'Fee record created' });
});

app.put('/api/admin/fees/:id', authenticate, requireRole('admin'), async (req, res) => {
  const { paid, status } = req.body;
  await pool.query('UPDATE fees SET paid = $1, status = $2 WHERE id = $3', [paid, status, req.params.id]);
  res.json({ message: 'Fee updated' });
});

// Attendance
app.get('/api/admin/attendance', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  const { class_id, date } = req.query;
  let query = `SELECT a.*, u.first_name, u.last_name, u.username, u.class, c.name as class_name
               FROM attendance a
               JOIN students s ON s.id = a.student_id JOIN users u ON u.id = s.user_id
               LEFT JOIN classes c ON c.id = a.class_id WHERE 1=1`;
  const params = [];
  if (class_id) { params.push(class_id); query += ` AND a.class_id = $${params.length}`; }
  if (date) { params.push(date); query += ` AND a.date = $${params.length}`; }
  query += ' ORDER BY a.date DESC';
  const result = await pool.query(query, params);
  res.json(result.rows);
});

app.post('/api/admin/attendance', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  const { student_id, class_id, subject_id, date, status } = req.body;
  await pool.query(
    `INSERT INTO attendance (student_id,class_id,subject_id,date,status,marked_by) VALUES ($1,$2,$3,$4,$5,$6)`,
    [student_id, class_id, subject_id, date, status, req.user.id]
  );
  res.json({ message: 'Attendance marked' });
});

// Announcements
app.get('/api/announcements', async (req, res) => {
  const result = await pool.query(`SELECT * FROM announcements WHERE (expires_at IS NULL OR expires_at > NOW()) ORDER BY created_at DESC`);
  res.json(result.rows);
});

app.get('/api/admin/announcements', authenticate, requireRole('admin'), async (req, res) => {
  const result = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC');
  res.json(result.rows);
});

app.post('/api/admin/announcements', authenticate, requireRole('admin'), async (req, res) => {
  const { title, content, category, priority, expires_at } = req.body;
  await pool.query(
    `INSERT INTO announcements (title,content,category,priority,expires_at,created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
    [title, content, category, priority, expires_at, req.user.id]
  );
  res.json({ message: 'Announcement created' });
});

app.delete('/api/admin/announcements/:id', authenticate, requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM announcements WHERE id = $1', [req.params.id]);
  res.json({ message: 'Deleted' });
});

// News
app.get('/api/news', async (req, res) => {
  const result = await pool.query('SELECT id,title,slug,excerpt,category,image_url,views,created_at FROM news WHERE published = true ORDER BY created_at DESC');
  res.json(result.rows);
});

app.get('/api/admin/news', authenticate, requireRole('admin'), async (req, res) => {
  const result = await pool.query('SELECT * FROM news ORDER BY created_at DESC');
  res.json(result.rows);
});

app.post('/api/admin/news', authenticate, requireRole('admin'), async (req, res) => {
  const { title, content, excerpt, category, image_url, published } = req.body;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  await pool.query(
    `INSERT INTO news (title,slug,content,excerpt,category,image_url,published,author_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [title, slug, content, excerpt, category, image_url, published || false, req.user.id]
  );
  res.json({ message: 'News created' });
});

// Site Content (CMS)
app.get('/api/admin/site-content', authenticate, requireRole('admin'), async (req, res) => {
  const result = await pool.query('SELECT * FROM site_content ORDER BY page, section');
  res.json(result.rows);
});

app.put('/api/admin/site-content', authenticate, requireRole('admin'), async (req, res) => {
  const { page, section, content } = req.body;
  await pool.query(
    `INSERT INTO site_content (page,section,content,updated_by,updated_at)
     VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (page,section) DO UPDATE SET content=$3,updated_by=$4,updated_at=NOW()`,
    [page, section, content, req.user.id]
  );
  res.json({ message: 'Content updated' });
});

// Site Settings
app.get('/api/settings', async (req, res) => {
  const result = await pool.query('SELECT * FROM site_settings');
  const settings = {};
  result.rows.forEach(r => { settings[r.key] = r.value; });
  res.json(settings);
});

app.put('/api/admin/settings', authenticate, requireRole('admin'), async (req, res) => {
  const { key, value } = req.body;
  await pool.query(`INSERT INTO site_settings (key,value,updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (key) DO UPDATE SET value=$2,updated_at=NOW()`, [key, value]);
  res.json({ message: 'Setting updated' });
});

// Gallery
app.get('/api/gallery', async (req, res) => {
  const result = await pool.query('SELECT * FROM gallery ORDER BY created_at DESC');
  res.json(result.rows);
});

app.post('/api/admin/gallery', authenticate, requireRole('admin'), upload.single('image'), async (req, res) => {
  const { title, description, category, tags } = req.body;
  const image_url = req.file ? `/uploads/${req.file.filename}` : '';
  await pool.query('INSERT INTO gallery (title,description,image_url,category,tags) VALUES ($1,$2,$3,$4,$5)', [title, description, image_url, category, tags ? tags.split(',') : []]);
  res.json({ message: 'Image uploaded' });
});

// Messages
app.get('/api/messages', authenticate, async (req, res) => {
  const result = await pool.query(
    `SELECT m.*, u1.first_name as sender_first, u1.last_name as sender_last, u2.first_name as receiver_first, u2.last_name as receiver_last
     FROM messages m JOIN users u1 ON u1.id = m.sender_id JOIN users u2 ON u2.id = m.receiver_id
     WHERE m.sender_id = $1 OR m.receiver_id = $1 ORDER BY m.created_at DESC`,
    [req.user.id]
  );
  res.json(result.rows);
});

app.post('/api/messages', authenticate, async (req, res) => {
  const { receiver_id, subject, body } = req.body;
  await pool.query('INSERT INTO messages (sender_id,receiver_id,subject,body) VALUES ($1,$2,$3,$4)', [req.user.id, receiver_id, subject, body]);
  res.json({ message: 'Message sent' });
});

// Notifications
app.get('/api/notifications', authenticate, async (req, res) => {
  const result = await pool.query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.user.id]);
  res.json(result.rows);
});

app.put('/api/notifications/:id/read', authenticate, async (req, res) => {
  await pool.query('UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.json({ message: 'Marked read' });
});

// Classes & Subjects
app.get('/api/classes', async (req, res) => {
  const result = await pool.query('SELECT * FROM classes ORDER BY name, stream');
  res.json(result.rows);
});

app.get('/api/subjects', async (req, res) => {
  const result = await pool.query('SELECT * FROM subjects ORDER BY category, name');
  res.json(result.rows);
});

// Activities / Audit Log
app.get('/api/admin/activities', authenticate, requireRole('admin'), async (req, res) => {
  const result = await pool.query(`
    SELECT a.*, u.username, u.first_name, u.last_name
    FROM activities a LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.created_at DESC LIMIT 100
  `);
  res.json(result.rows);
});

// File upload
app.post('/api/upload', authenticate, requireRole('admin', 'teacher'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: `/uploads/${req.file.filename}`, filename: req.file.originalname });
});

// Socket.io — real-time notifications
io.on('connection', (socket) => {
  socket.on('join', (userId) => socket.join(`user_${userId}`));
  socket.on('send_notification', async (data) => {
    const { user_id, type, title, message } = data;
    await pool.query('INSERT INTO notifications (user_id,type,title,message) VALUES ($1,$2,$3,$4)', [user_id, type, title, message]);
    io.to(`user_${user_id}`).emit('notification', { type, title, message });
  });
});

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const PORT = process.env.PORT || 3000;
initDB().then(() => {
  server.listen(PORT, '0.0.0.0', () => console.log(`✓ Kalinabiri API running on port ${PORT}`));
}).catch(e => { console.error('DB init failed:', e); process.exit(1); });
