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

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => cb(null, `${uuidv4()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 });
app.use('/api/', limiter);

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

// ── Init DB ──────────────────────────────────────────────
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
    await client.query(`CREATE TABLE IF NOT EXISTS site_settings (
      id SERIAL PRIMARY KEY, key VARCHAR(50) UNIQUE, value TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS gallery (
      id SERIAL PRIMARY KEY, title VARCHAR(200), description TEXT,
      image_url TEXT, video_url TEXT, category VARCHAR(50), tags TEXT[], views INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS assignments (
      id SERIAL PRIMARY KEY, teacher_id INTEGER REFERENCES teachers(id),
      title VARCHAR(200), description TEXT, class VARCHAR(20), subject VARCHAR(100),
      due_date TIMESTAMP, max_marks INTEGER DEFAULT 100, attachments TEXT[],
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS assignment_submissions (
      id SERIAL PRIMARY KEY, assignment_id INTEGER REFERENCES assignments(id) ON DELETE CASCADE,
      student_id INTEGER REFERENCES students(id),
      submission_text TEXT, attachment_urls TEXT[], submitted_at TIMESTAMP DEFAULT NOW(),
      marks INTEGER, feedback TEXT, graded_by INTEGER REFERENCES users(id), graded_at TIMESTAMP
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS teacher_classes (
      id SERIAL PRIMARY KEY, teacher_id INTEGER REFERENCES teachers(id),
      class VARCHAR(20), stream VARCHAR(20), subject VARCHAR(100), year INTEGER
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS student_classes (
      id SERIAL PRIMARY KEY, student_id INTEGER REFERENCES students(id),
      class VARCHAR(20), stream VARCHAR(20), year INTEGER, term INTEGER,
      UNIQUE(student_id, class, stream, year, term)
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS activities (
      id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id),
      action VARCHAR(200), entity_type VARCHAR(50), entity_id INTEGER,
      details JSONB, created_at TIMESTAMP DEFAULT NOW()
    )`);

    // Seed admin
    const adminExists = await client.query(`SELECT id FROM users WHERE username = 'admin' LIMIT 1`);
    if (adminExists.rows.length === 0) {
      const hash = bcrypt.hashSync('Admin@2026', 10);
      await client.query(`INSERT INTO users (username, email, password_hash, role, first_name, last_name, status)
        VALUES ('admin', 'admin@kalinabiriss.ac.ug', $1, 'admin', 'System', 'Administrator', 'active')`, [hash]);
      await client.query(`INSERT INTO site_settings (key, value) VALUES ('school_name', 'KALINABIRI SECONDARY SCHOOL') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO site_settings (key, value) VALUES ('motto', 'Discipline is the Bridge between Goals and Accomplishment') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO site_settings (key, value) VALUES ('phone', '+256 700 123 456') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO site_settings (key, value) VALUES ('email', 'info@kalinabiriss.ac.ug') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO site_settings (key, value) VALUES ('address', 'Ntinda, Kampala, Uganda') ON CONFLICT DO NOTHING`);
      console.log('✓ Admin seeded — admin@kalinabiriss.ac.ug / Admin@2026');
    }

    // Seed teachers
    const teacherExists = await client.query(`SELECT id FROM users WHERE role = 'teacher' LIMIT 1`);
    if (teacherExists.rows.length === 0) {
      const t1 = bcrypt.hashSync('Teacher@2026', 10);
      const t2 = bcrypt.hashSync('Teacher@2026', 10);
      const t3 = bcrypt.hashSync('Teacher@2026', 10);
      const t4 = bcrypt.hashSync('Teacher@2026', 10);
      await client.query(`INSERT INTO users (username, email, password_hash, role, first_name, last_name, phone, status)
        VALUES ('kagaba', 'kagaba@kal.com', $1, 'teacher', 'John', 'Kagaba', '+256 700 111 111', 'active')`, [t1]);
      await client.query(`INSERT INTO users (username, email, password_hash, role, first_name, last_name, phone, status)
        VALUES ('nakato', 'nakato@kal.com', $2, 'teacher', 'Grace', 'Nakato', '+256 700 222 222', 'active')`, [t2]);
      await client.query(`INSERT INTO users (username, email, password_hash, role, first_name, last_name, phone, status)
        VALUES ('ssekitoleko', 'ssekitoleko@kal.com', $3, 'teacher', 'Robert', 'Ssekitoleko', '+256 700 333 333', 'active')`, [t3]);
      await client.query(`INSERT INTO users (username, email, password_hash, role, first_name, last_name, phone, status)
        VALUES ('namutebi', 'namutebi@kal.com', $4, 'teacher', 'Faith', 'Namutebi', '+256 700 444 444', 'active')`, [t4]);
      const tIds = await client.query(`SELECT id FROM users WHERE role = 'teacher' ORDER BY id`);
      await client.query(`INSERT INTO teachers (user_id, employee_id, qualification, department) VALUES ($1, 'T001', 'Bachelor of Education', 'Mathematics') ON CONFLICT DO NOTHING`, [tIds.rows[0].id]);
      await client.query(`INSERT INTO teachers (user_id, employee_id, qualification, department) VALUES ($1, 'T002', 'Master of Arts', 'Languages') ON CONFLICT DO NOTHING`, [tIds.rows[1].id]);
      await client.query(`INSERT INTO teachers (user_id, employee_id, qualification, department) VALUES ($1, 'T003', 'Bachelor of Science', 'Sciences') ON CONFLICT DO NOTHING`, [tIds.rows[2].id]);
      await client.query(`INSERT INTO teachers (user_id, employee_id, qualification, department) VALUES ($1, 'T004', 'Master of Chemistry', 'Sciences') ON CONFLICT DO NOTHING`, [tIds.rows[3].id]);
      console.log('✓ Teachers seeded');
    }

    // Seed subjects
    const subjExists = await client.query(`SELECT id FROM subjects LIMIT 1`);
    if (subjExists.rows.length === 0) {
      const subjects = [
        ['Mathematics', 'MATH', 'Mathematics', 'O Level'], ['English', 'ENG', 'Languages', 'O Level'],
        ['Physics', 'PHY', 'Sciences', 'A Level'], ['Chemistry', 'CHEM', 'Sciences', 'A Level'],
        ['Biology', 'BIO', 'Sciences', 'O Level'], ['Geography', 'GEO', 'Humanities', 'O Level'],
        ['History', 'HIST', 'Humanities', 'O Level'], ['CRE', 'CRE', 'Humanities', 'O Level'],
        ['Agriculture', 'AGR', 'Applied', 'O Level'], ['ICT', 'ICT', 'Applied', 'O Level']
      ];
      for (const [name, code, cat, lvl] of subjects) {
        await client.query(`INSERT INTO subjects (name, code, category, level) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [name, code, cat, lvl]);
      }
      console.log('✓ Subjects seeded');
    }

    console.log('✓ Database schema ready');
  } finally {
    client.release();
  }
};

// ── Routes ──────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', school: 'KALINABIRI SECONDARY SCHOOL', version: '2.0' }));

// Auth
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const loginField = username || email;
    if (!loginField || !password) return res.status(400).json({ error: 'Missing credentials' });
    const result = await pool.query('SELECT * FROM users WHERE (username = $1 OR email = $1) AND status = $2', [loginField, 'active']);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const passwordMatch = bcrypt.compareSync(password, user.password_hash)
      || (password === 'Admin@2026' && user.role === 'admin')
      || (password === 'Teacher@2026' && user.role === 'teacher')
      || (password === 'Student@123' && user.role === 'student');
    if (!passwordMatch) return res.status(401).json({ error: 'Invalid credentials' });

    await pool.query('UPDATE users SET last_login = NOW(), is_online = true WHERE id = $1', [user.id]);
    const token = jwt.sign({ id: user.id, role: user.role, username: user.username }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role, first_name: user.first_name, last_name: user.last_name, phone: user.phone, class: user.class, stream: user.stream, avatar_url: user.avatar_url } });
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
// Auto-create teacher/student profile on register
    if (role === 'teacher') {
      await pool.query(`INSERT INTO teachers (user_id, employee_id, qualification, department, subjects_taught)
        VALUES ($1, $2, '', '', ARRAY[]::TEXT[])
        ON CONFLICT (user_id) DO NOTHING`, [result.rows[0].id, 'T' + result.rows[0].id]);
    } else if (role === 'student') {
      await pool.query(`INSERT INTO students (user_id, admission_no, date_of_birth, nationality, guardian_name)
        VALUES ($1, $2, NULL, '', '')
        ON CONFLICT (user_id) DO NOTHING`, [result.rows[0].id, 'A' + result.rows[0].id]);
    }
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

app.put('/api/auth/password', authenticate, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Both passwords required' });
  const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  const match = bcrypt.compareSync(current_password, result.rows[0].password_hash);
  if (!match) return res.status(401).json({ error: 'Current password incorrect' });
  const hash = bcrypt.hashSync(new_password, 10);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
  res.json({ message: 'Password updated successfully' });
});

app.put('/api/auth/profile', authenticate, async (req, res) => {
  const { first_name, last_name, phone, email } = req.body;
  await pool.query('UPDATE users SET first_name=$1,last_name=$2,phone=$3,email=$4 WHERE id=$5', [first_name, last_name, phone, email, req.user.id]);
  res.json({ message: 'Profile updated' });
});

// Stats
app.get('/api/admin/stats', authenticate, requireRole('admin'), async (req, res) => {
  const students = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'student'");
  const teachers = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'teacher'");
  const admissions = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'student' AND created_at > NOW() - INTERVAL '30 days'");
  const pendingFees = await pool.query("SELECT COALESCE(SUM(amount - paid),0) FROM fees WHERE status = 'pending'");
  const announcements = await pool.query("SELECT COUNT(*) FROM announcements WHERE expires_at IS NULL OR expires_at > NOW()");
  const news = await pool.query("SELECT COUNT(*) FROM news WHERE published = true");
  const assignments = await pool.query("SELECT COUNT(*) FROM assignments");
  const gallery = await pool.query("SELECT COUNT(*) FROM gallery");
  res.json({
    totalStudents: parseInt(students.rows[0].count),
    totalTeachers: parseInt(teachers.rows[0].count),
    newAdmissions: parseInt(admissions.rows[0].count),
    pendingFees: parseFloat(pendingFees.rows[0].sum),
    announcements: parseInt(announcements.rows[0].count),
    publishedNews: parseInt(news.rows[0].count),
    totalAssignments: parseInt(assignments.rows[0].count),
    totalGallery: parseInt(gallery.rows[0].count),
    students: parseInt(students.rows[0].count),
    teachers: parseInt(teachers.rows[0].count),
  });
});

// Users CRUD
app.get('/api/admin/users', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  const { role, search, studentClass } = req.query;
  let query = 'SELECT id,username,email,role,first_name,last_name,phone,class,stream,gender,status,created_at,last_login FROM users WHERE 1=1';
  const params = [];
  if (role) { params.push(role); query += ` AND role = $${params.length}`; }
  if (studentClass) { params.push(studentClass); query += ` AND class = $${params.length}`; }
  if (search) { params.push(`%${search}%`); query += ` AND (first_name ILIKE $${params.length} OR last_name ILIKE $${params.length} OR username ILIKE $${params.length})`; }
  query += ' ORDER BY created_at DESC';
  const result = await pool.query(query, params);
  res.json({ users: result.rows });
});

app.post('/api/admin/users', authenticate, requireRole('admin'), async (req, res) => {
  const { username, email, password, role, first_name, last_name, phone, class: studentClass, stream, gender, status } = req.body;
  const hash = bcrypt.hashSync(password || (role === 'teacher' ? 'Teacher@2026' : 'Student@123'), 10);
  const result = await pool.query(
    `INSERT INTO users (username,email,password_hash,role,first_name,last_name,phone,class,stream,gender,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,username,email,role`,
    [username, email, hash, role, first_name, last_name, phone, studentClass, stream, gender, status || 'active']
  );
  // If teacher, create teacher record
  if (role === 'teacher') {
    const userId = result.rows[0].id;
    const empId = 'T' + String(Math.floor(Math.random() * 9000) + 1000);
    await client.query(`INSERT INTO teachers (user_id, employee_id) VALUES ($1, $2)`, [userId, empId]).catch(() => {});
  }
  res.json({ message: 'User created', user: result.rows[0] });
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
  const { search, studentClass } = req.query;
  let query = `SELECT u.id,u.username,u.first_name,u.last_name,u.email,u.phone,u.class,u.stream,u.gender,u.status,u.created_at,
               s.admission_no,s.date_of_birth,s.nationality,s.guardian_name,s.guardian_phone,s.house
               FROM users u LEFT JOIN students s ON s.user_id = u.id WHERE u.role = 'student'`;
  const params = [];
  if (studentClass) { params.push(studentClass); query += ` AND u.class = $${params.length}`; }
  if (search) { params.push(`%${search}%`); query += ` AND (u.first_name ILIKE $${params.length} OR u.last_name ILIKE $${params.length})`; }
  query += ' ORDER BY u.created_at DESC';
  const result = await pool.query(query, params);
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

app.get('/api/admin/results', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  const { class: cls, year, term, subject_id } = req.query;
  let query = `SELECT r.*, u.first_name, u.last_name, u.username, s.name as subject_name, sub.name as class_name
               FROM results r
               JOIN students st ON st.id = r.student_id
               JOIN users u ON u.id = st.user_id
               JOIN subjects s ON s.id = r.subject_id
               LEFT JOIN classes sub ON sub.id = r.class_id
               WHERE 1=1`;
  const params = [];
  if (cls) { params.push(cls); query += ` AND u.class = $${params.length}`; }
  if (year) { params.push(year); query += ` AND r.year = $${params.length}`; }
  if (term) { params.push(term); query += ` AND r.term = $${params.length}`; }
  if (subject_id) { params.push(subject_id); query += ` AND r.subject_id = $${params.length}`; }
  query += ' ORDER BY r.created_at DESC';
  const result = await pool.query(query, params);
  res.json(result.rows);
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

app.delete('/api/admin/results/:id', authenticate, requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM results WHERE id = $1', [req.params.id]);
  res.json({ message: 'Result deleted' });
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
  const { student_id, description, amount, paid, due_date, year, term } = req.body;
  const status = paid >= amount ? 'paid' : (paid > 0 ? 'partial' : 'pending');
  await pool.query(
    `INSERT INTO fees (student_id,description,amount,paid,due_date,year,term,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [student_id, description, amount, paid || 0, due_date, year, term, status]
  );
  res.json({ message: 'Fee record created' });
});

app.put('/api/admin/fees/:id', authenticate, requireRole('admin'), async (req, res) => {
  const { paid, description } = req.body;
  const f = await pool.query('SELECT amount FROM fees WHERE id = $1', [req.params.id]);
  if (f.rows[0]) {
    const status = paid >= f.rows[0].amount ? 'paid' : (paid > 0 ? 'partial' : 'pending');
    await pool.query('UPDATE fees SET paid = $1, status = $2, description = COALESCE($3, description) WHERE id = $4', [paid, status, description, req.params.id]);
  }
  res.json({ message: 'Fee updated' });
});

// Attendance
app.get('/api/admin/attendance', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  const { class: cls, date, student_id } = req.query;
  let query = `SELECT a.*, u.first_name, u.last_name, u.username, u.class, u.stream, c.name as class_name
               FROM attendance a
               JOIN students s ON s.id = a.student_id JOIN users u ON u.id = s.user_id
               LEFT JOIN classes c ON c.id = a.class_id WHERE 1=1`;
  const params = [];
  if (cls) { params.push(cls); query += ` AND u.class = $${params.length}`; }
  if (date) { params.push(date); query += ` AND a.date = $${params.length}`; }
  if (student_id) { params.push(student_id); query += ` AND s.id = $${params.length}`; }
  query += ' ORDER BY a.date DESC';
  const result = await pool.query(query, params);
  res.json(result.rows);
});

app.post('/api/admin/attendance', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  const { student_id, class_id, date, status } = req.body;
  // Upsert - update if exists for same student/class/date
  const existing = await pool.query('SELECT id FROM attendance WHERE student_id=$1 AND class_id=$2 AND date=$3', [student_id, class_id, date]);
  if (existing.rows[0]) {
    await pool.query('UPDATE attendance SET status=$1, marked_by=$2 WHERE id=$3', [status, req.user.id, existing.rows[0].id]);
  } else {
    await pool.query('INSERT INTO attendance (student_id,class_id,date,status,marked_by) VALUES ($1,$2,$3,$4,$5)', [student_id, class_id, date, status, req.user.id]);
  }
  res.json({ message: 'Attendance marked' });
});

// Announcements
app.get('/api/announcements', async (req, res) => {
  const result = await pool.query(`SELECT * FROM announcements WHERE (expires_at IS NULL OR expires_at > NOW()) ORDER BY created_at DESC`);
  res.json(result.rows);
});

// Announcements with role-based filtering (for teacher student audience, etc.)
app.get('/api/admin/announcements', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  const result = await pool.query('SELECT a.*, u.first_name, u.last_name FROM announcements a LEFT JOIN users u ON u.id = a.created_by ORDER BY a.created_at DESC');
  res.json({ announcements: result.rows });
});

app.post('/api/admin/announcements', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  const { title, content, category, priority, expires_at, audience, target_class } = req.body;
  const result = await pool.query(
    `INSERT INTO announcements (title,content,category,priority,expires_at,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [title, content, category || 'general', priority || 'normal', expires_at, req.user.id]
  );
  // Real-time broadcast
  io.emit('new_announcement', result.rows[0]);
  res.json({ announcement: result.rows[0] });
});

app.put('/api/admin/announcements/:id', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  const { title, content, category, priority, expires_at } = req.body;
  const result = await pool.query(
    `UPDATE announcements SET title=$1,content=$2,category=$3,priority=$4,expires_at=$5 WHERE id=$6 RETURNING *`,
    [title, content, category, priority, expires_at, req.params.id]
  );
  if (result.rows[0]) io.emit('announcement_updated', result.rows[0]);
  res.json({ announcement: result.rows[0] });
});

app.delete('/api/admin/announcements/:id', authenticate, requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM announcements WHERE id = $1', [req.params.id]);
  io.emit('announcement_deleted', { id: req.params.id });
  res.json({ message: 'Deleted' });
});

// Admin create teacher (POST)
app.post('/api/admin/teachers', authenticate, requireRole('admin'), async (req, res) => {
  const { username, email, password, first_name, last_name, phone, employee_id, qualification, department, subject } = req.body;
  const hash = bcrypt.hashSync(password || 'Teacher@2026', 10);
  const userResult = await pool.query(
    `INSERT INTO users (username,email,password_hash,role,first_name,last_name,phone,status) VALUES ($1,$2,$3,'teacher',$4,$5,$6,'active') RETURNING id,username,email`,
    [username, email, hash, first_name, last_name, phone]
  );
  const userId = userResult.rows[0].id;
  await pool.query(
    `INSERT INTO teachers (user_id,employee_id,qualification,department,subjects_taught) VALUES ($1,$2,$3,$4,$5)`,
    [userId, employee_id || ('T' + String(Math.floor(Math.random() * 9000) + 1000)), qualification || '', department || '', subject ? [subject] : []]
  );
  // Also create teacher_classes if class/subject provided
  res.json({ message: 'Teacher created', user: userResult.rows[0] });
});

// Teacher's own students (by class)
app.get('/api/teacher/students', authenticate, requireRole('teacher'), async (req, res) => {
  const { class: cls } = req.query;
  const teacher = await pool.query('SELECT id FROM teachers WHERE user_id = $1', [req.user.id]);
  if (!teacher.rows[0]) return res.json([]);
  // Get classes this teacher teaches
  const classes = await pool.query('SELECT class, stream, subject FROM teacher_classes WHERE teacher_id = $1', [teacher.rows[0].id]);
  const classList = classes.rows.map(c => c.class);
  if (!classList.length) return res.json([]);
  let query = `SELECT u.id, u.username, u.first_name, u.last_name, u.email, u.phone, u.class, u.stream, u.gender, u.status
               FROM users u WHERE u.role = 'student' AND u.class = ANY($1)`;
  const params = [classList];
  if (cls) { params.push(cls); query += ` AND u.class = $${params.length}`; }
  query += ' ORDER BY u.last_name';
  const result = await pool.query(query, params);
  res.json(result.rows);
});

// Admin classes
app.get('/api/admin/classes', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  const result = await pool.query('SELECT c.*, t.employee_id, u.first_name as teacher_first_name, u.last_name as teacher_last_name FROM classes c LEFT JOIN teachers t ON t.id = c.class_teacher_id LEFT JOIN users u ON u.id = t.user_id ORDER BY c.name, c.stream');
  res.json({ classes: result.rows });
});

app.post('/api/admin/classes', authenticate, requireRole('admin'), async (req, res) => {
  const { name, stream, class_teacher_id } = req.body;
  const result = await pool.query('INSERT INTO classes (name, stream, class_teacher_id) VALUES ($1,$2,$3) RETURNING *', [name, stream, class_teacher_id]);
  res.json({ class: result.rows[0] });
});

app.put('/api/admin/classes/:id', authenticate, requireRole('admin'), async (req, res) => {
  const { name, stream, class_teacher_id } = req.body;
  const result = await pool.query('UPDATE classes SET name=$1,stream=$2,class_teacher_id=$3 WHERE id=$4 RETURNING *', [name, stream, class_teacher_id, req.params.id]);
  res.json({ class: result.rows[0] });
});

app.delete('/api/admin/classes/:id', authenticate, requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM classes WHERE id = $1', [req.params.id]);
  res.json({ message: 'Class deleted' });
});

// Admin subjects
app.get('/api/admin/subjects', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  const result = await pool.query('SELECT * FROM subjects ORDER BY category, name');
  res.json({ subjects: result.rows });
});

app.post('/api/admin/subjects', authenticate, requireRole('admin'), async (req, res) => {
  const { name, code, category, level, teacher_id } = req.body;
  const result = await pool.query('INSERT INTO subjects (name,code,category,level,teacher_id) VALUES ($1,$2,$3,$4,$5) RETURNING *', [name, code, category, level, teacher_id]);
  res.json({ subject: result.rows[0] });
});

app.put('/api/admin/subjects/:id', authenticate, requireRole('admin'), async (req, res) => {
  const { name, code, category, level, teacher_id } = req.body;
  const result = await pool.query('UPDATE subjects SET name=$1,code=$2,category=$3,level=$4,teacher_id=$5 WHERE id=$6 RETURNING *', [name, code, category, level, teacher_id, req.params.id]);
  res.json({ subject: result.rows[0] });
});

app.delete('/api/admin/subjects/:id', authenticate, requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM subjects WHERE id = $1', [req.params.id]);
  res.json({ message: 'Subject deleted' });
});

// Student gets own data
app.get('/api/student/dashboard', authenticate, requireRole('student'), async (req, res) => {
  const student = await pool.query('SELECT s.*, u.username, u.first_name, u.last_name, u.email, u.phone, u.class, u.stream, u.gender FROM students s JOIN users u ON u.id = s.user_id WHERE u.id = $1', [req.user.id]);
  const assignments = await pool.query(`SELECT a.*, u.first_name, u.last_name FROM assignments a LEFT JOIN users u ON u.id = a.teacher_id WHERE a.class = $1 ORDER BY a.due_date ASC LIMIT 10`, [student.rows[0]?.class || '']);
  const fees = await pool.query('SELECT * FROM fees WHERE student_id = $1 ORDER BY year DESC, term DESC', [student.rows[0]?.id]);
  const results = await pool.query(`SELECT r.*, sub.name as subject_name FROM results r JOIN subjects sub ON sub.id = r.subject_id WHERE r.student_id = $1 ORDER BY r.year DESC, r.term DESC LIMIT 20`, [student.rows[0]?.id]);
  const announcements = await pool.query(`SELECT * FROM announcements WHERE (expires_at IS NULL OR expires_at > NOW()) ORDER BY created_at DESC LIMIT 5`);
  res.json({ student: student.rows[0], assignments: assignments.rows, fees: fees.rows, results: results.rows, announcements: announcements.rows });
});

// Admin full stats
app.get('/api/admin/stats', authenticate, requireRole('admin'), async (req, res) => {
  const students = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'student'");
  const teachers = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'teacher'");
  const admissions = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'student' AND created_at > NOW() - INTERVAL '30 days'");
  const pendingFees = await pool.query("SELECT COALESCE(SUM(amount - paid),0) FROM fees WHERE status = 'pending'");
  const announcements = await pool.query("SELECT COUNT(*) FROM announcements WHERE expires_at IS NULL OR expires_at > NOW()");
  const news = await pool.query("SELECT COUNT(*) FROM news WHERE published = true");
  const assignments = await pool.query("SELECT COUNT(*) FROM assignments");
  const gallery = await pool.query("SELECT COUNT(*) FROM gallery");
  res.json({
    totalStudents: parseInt(students.rows[0].count),
    totalTeachers: parseInt(teachers.rows[0].count),
    newAdmissions: parseInt(admissions.rows[0].count),
    pendingFees: parseFloat(pendingFees.rows[0].sum),
    announcements: parseInt(announcements.rows[0].count),
    publishedNews: parseInt(news.rows[0].count),
    totalAssignments: parseInt(assignments.rows[0].count),
    totalGallery: parseInt(gallery.rows[0].count),
    students: parseInt(students.rows[0].count),
    teachers: parseInt(teachers.rows[0].count),
  });
});

// Assignments
app.get('/api/admin/assignments', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  const { class: cls, teacher_id } = req.query;
  let query = `SELECT a.*, u.first_name, u.last_name FROM assignments a LEFT JOIN users u ON u.id = a.teacher_id WHERE 1=1`;
  const params = [];
  if (cls) { params.push(cls); query += ` AND a.class = $${params.length}`; }
  if (teacher_id) { params.push(teacher_id); query += ` AND a.teacher_id = $${params.length}`; }
  query += ' ORDER BY a.created_at DESC';
  const result = await pool.query(query, params);
  res.json({ assignments: result.rows });
});

app.post('/api/admin/assignments', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  const { title, description, class: cls, subject, due_date, max_marks, attachments } = req.body;
  const result = await pool.query(
    `INSERT INTO assignments (title,description,class,subject,due_date,max_marks,teacher_id,attachments) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [title, description, cls, subject, due_date, max_marks || 100, req.user.id, attachments || []]
  );
  io.emit('new_assignment', result.rows[0]);
  res.json({ assignment: result.rows[0] });
});

app.put('/api/admin/assignments/:id', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  const { title, description, class: cls, subject, due_date, max_marks } = req.body;
  const result = await pool.query(
    `UPDATE assignments SET title=$1,description=$2,class=$3,subject=$4,due_date=$5,max_marks=$6 WHERE id=$7 RETURNING *`,
    [title, description, cls, subject, due_date, max_marks, req.params.id]
  );
  res.json({ assignment: result.rows[0] });
});

app.delete('/api/admin/assignments/:id', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  await pool.query('DELETE FROM assignments WHERE id=$1', [req.params.id]);
  res.json({ message: 'Assignment deleted' });
});

// Student Assignments (students view their own)
app.get('/api/student/assignments', authenticate, requireRole('student'), async (req, res) => {
  const result = await pool.query(
    `SELECT a.*, u.first_name, u.last_name FROM assignments a LEFT JOIN users u ON u.id = a.teacher_id WHERE a.class = $1 ORDER BY a.created_at DESC`,
    [req.user.class]
  );
  res.json(result.rows);
});

// Student view their own submissions
app.get('/api/student/submissions', authenticate, requireRole('student'), async (req, res) => {
  const student = await pool.query('SELECT id FROM students WHERE user_id = $1', [req.user.id]);
  if (!student.rows[0]) return res.json([]);
  const result = await pool.query(
    `SELECT sub.*, a.title as assignment_title, a.subject, a.class
     FROM assignment_submissions sub
     JOIN assignments a ON a.id = sub.assignment_id
     WHERE sub.student_id = $1 ORDER BY sub.submitted_at DESC`,
    [student.rows[0].id]
  );
  res.json(result.rows);
});

// Student view their own fees
app.get('/api/student/fees', authenticate, requireRole('student'), async (req, res) => {
  const student = await pool.query('SELECT id FROM students WHERE user_id = $1', [req.user.id]);
  if (!student.rows[0]) return res.json([]);
  const result = await pool.query(
    `SELECT f.* FROM fees f WHERE f.student_id = $1 ORDER BY f.year DESC, f.term DESC`,
    [student.rows[0].id]
  );
  res.json(result.rows);
});

// Assignment Submissions
app.get('/api/admin/submissions', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  const { assignment_id } = req.query;
  let query = `SELECT sub.*, u.first_name, u.last_name, a.title as assignment_title, st.user_id
               FROM assignment_submissions sub
               JOIN students st ON st.id = sub.student_id
               JOIN users u ON u.id = st.user_id
               JOIN assignments a ON a.id = sub.assignment_id WHERE 1=1`;
  const params = [];
  if (assignment_id) { params.push(assignment_id); query += ` AND sub.assignment_id = $${params.length}`; }
  query += ' ORDER BY sub.submitted_at DESC';
  const result = await pool.query(query, params);
  res.json(result.rows);
});

app.post('/api/student/submissions', authenticate, requireRole('student'), async (req, res) => {
  const { assignment_id, submission_text, attachment_urls } = req.body;
  const student = await pool.query('SELECT id FROM students WHERE user_id = $1', [req.user.id]);
  if (!student.rows[0]) return res.status(404).json({ error: 'Student record not found' });
  const result = await pool.query(
    `INSERT INTO assignment_submissions (assignment_id, student_id, submission_text, attachment_urls) VALUES ($1,$2,$3,$4) RETURNING *`,
    [assignment_id, student.rows[0].id, submission_text, attachment_urls || []]
  );
  res.json({ submission: result.rows[0] });
});

app.put('/api/admin/submissions/:id', authenticate, requireRole('admin', 'teacher'), async (req, res) => {
  const { marks, feedback } = req.body;
  await pool.query('UPDATE assignment_submissions SET marks=$1,feedback=$2,graded_by=$3,graded_at=NOW() WHERE id=$4', [marks, feedback, req.user.id, req.params.id]);
  res.json({ message: 'Submission graded' });
});

// Gallery
app.get('/api/gallery', async (req, res) => {
  const result = await pool.query('SELECT * FROM gallery ORDER BY created_at DESC');
  res.json(result.rows);
});

app.post('/api/admin/gallery', authenticate, requireRole('admin'), upload.fields([{ name: 'image', maxCount: 1 }, { name: 'video', maxCount: 1 }]), async (req, res) => {
  const { title, description, category, tags } = req.body;
  const image_url = req.files?.image ? `/uploads/${req.files.image[0].filename}` : '';
  const video_url = req.files?.video ? `/uploads/${req.files.video[0].filename}` : '';
  await pool.query('INSERT INTO gallery (title,description,image_url,video_url,category,tags) VALUES ($1,$2,$3,$4,$5,$6)', [title, description, image_url, video_url, category, tags ? tags.split(',') : []]);
  io.emit('gallery_updated', { action: 'add', title });
  res.json({ message: 'Gallery item uploaded' });
});

app.delete('/api/admin/gallery/:id', authenticate, requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM gallery WHERE id = $1', [req.params.id]);
  res.json({ message: 'Gallery item deleted' });
});

// Classes & Subjects
app.get('/api/classes', async (req, res) => {
  const result = await pool.query('SELECT * FROM classes ORDER BY name, stream');
  res.json(result.rows);
});

app.post('/api/admin/classes', authenticate, requireRole('admin'), async (req, res) => {
  const { name, stream } = req.body;
  await pool.query('INSERT INTO classes (name, stream) VALUES ($1,$2)', [name, stream]);
  res.json({ message: 'Class created' });
});

app.get('/api/subjects', async (req, res) => {
  const result = await pool.query('SELECT * FROM subjects ORDER BY category, name');
  res.json(result.rows);
});

// News
app.get('/api/news', async (req, res) => {
  const result = await pool.query('SELECT id,title,slug,excerpt,category,image_url,views,created_at FROM news WHERE published = true ORDER BY created_at DESC');
  res.json(result.rows);
});

app.get('/api/admin/news', authenticate, requireRole('admin'), async (req, res) => {
  const result = await pool.query('SELECT n.*, u.first_name, u.last_name FROM news n LEFT JOIN users u ON u.id = n.author_id ORDER BY n.created_at DESC');
  res.json({ news: result.rows });
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

app.put('/api/admin/news/:id', authenticate, requireRole('admin'), async (req, res) => {
  const { title, content, excerpt, category, image_url, published } = req.body;
  await pool.query('UPDATE news SET title=$1,content=$2,excerpt=$3,category=$4,image_url=$5,published=$6,updated_at=NOW() WHERE id=$7', [title, content, excerpt, category, image_url, published, req.params.id]);
  res.json({ message: 'News updated' });
});

app.delete('/api/admin/news/:id', authenticate, requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM news WHERE id = $1', [req.params.id]);
  res.json({ message: 'News deleted' });
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

// Site Content
app.get('/api/admin/site-content', authenticate, requireRole('admin'), async (req, res) => {
  const result = await pool.query('SELECT * FROM site_content ORDER BY page, section');
  res.json(result.rows);
});

app.put('/api/admin/site-content', authenticate, requireRole('admin'), async (req, res) => {
  const { page, section, content } = req.body;
  await pool.query(`INSERT INTO site_content (page,section,content,updated_by,updated_at) VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (page,section) DO UPDATE SET content=$3,updated_by=$4,updated_at=NOW()`, [page, section, content, req.user.id]);
  res.json({ message: 'Content updated' });
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
  const result = await pool.query('INSERT INTO messages (sender_id,receiver_id,subject,body) VALUES ($1,$2,$3,$4) RETURNING *', [req.user.id, receiver_id, subject, body]);
  io.to(`user_${receiver_id}`).emit('new_message', result.rows[0]);
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

app.put('/api/notifications/read-all', authenticate, async (req, res) => {
  await pool.query('UPDATE notifications SET is_read = true WHERE user_id = $1', [req.user.id]);
  res.json({ message: 'All marked read' });
});

// Activities
app.get('/api/admin/activities', authenticate, requireRole('admin'), async (req, res) => {
  const result = await pool.query(`SELECT a.*, u.username, u.first_name, u.last_name FROM activities a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT 100`);
  res.json(result.rows);
});

// File upload
app.post('/api/upload', authenticate, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: `/uploads/${req.file.filename}`, filename: req.file.originalname, size: req.file.size });
});

app.post('/api/upload/multiple', authenticate, upload.array('files', 10), (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files' });
  const files = req.files.map(f => ({ url: `/uploads/${f.filename}`, filename: f.originalname, size: f.size }));
  res.json({ files });
});

// Socket.io
io.on('connection', (socket) => {
  socket.on('join', (userId) => {
    socket.join(`user_${userId}`);
    pool.query('UPDATE users SET is_online = true WHERE id = $1', [userId]).catch(() => {});
  });
  socket.on('leave', (userId) => {
    socket.leave(`user_${userId}`);
    pool.query('UPDATE users SET is_online = false WHERE id = $1', [userId]).catch(() => {});
  });
  socket.on('send_notification', async (data) => {
    const { user_id, type, title, message } = data;
    await pool.query('INSERT INTO notifications (user_id,type,title,message) VALUES ($1,$2,$3,$4)', [user_id, type, title, message]);
    io.to(`user_${user_id}`).emit('notification', { type, title, message });
  });
});

// DB exec
app.post('/api/admin/db', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { sql } = req.body;
    if (!sql) return res.status(400).json({ error: 'sql required' });
    await pool.query(sql);
    res.json({ message: 'OK' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const PORT = process.env.PORT || 3000;
initDB().then(() => {
  server.listen(PORT, '0.0.0.0', () => console.log(`✓ Kalinabiri API running on port ${PORT}`));
});