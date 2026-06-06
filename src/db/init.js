require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function init() {
  console.log('Connecting to database...');
  const client = await pool.connect();

  try {
    // Run schema
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(schema);
    console.log('Schema created.');

    // Check if admin already exists
    const adminCheck = await client.query("SELECT id FROM users WHERE email='admin@kalinabiriss.ac.ug'");
    if (!adminCheck.rows.length) {
      // Create admin user
      const hash = await bcrypt.hash('Admin@2026', 12);
      await client.query(
        `INSERT INTO users (username, email, password, role, first_name, last_name, phone)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        ['admin', 'admin@kalinabiriss.ac.ug', hash, 'admin', 'ScottsTechX', 'Administrator', '+256-740396825']
      );
      console.log('Admin user created: admin@kalinabiriss.ac.ug / Admin@2026');
    }

    // Seed classes if empty
    const classCheck = await client.query('SELECT COUNT(*)::int FROM classes');
    if (classCheck.rows[0].count === 0) {
      await client.query(`INSERT INTO classes (name, stream) VALUES
        ('S.1','A'),('S.1','B'),('S.2','A'),('S.2','B'),
        ('S.3','A'),('S.3','B'),('S.4','A'),('S.4','B'),
        ('S.5','A'),('S.5','B'),('S.6','A'),('S.6','B')`);
      console.log('Classes seeded.');
    }

    // Seed subjects if empty
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
      console.log('Subjects seeded.');
    }

    // Seed announcements if empty
    const annCheck = await client.query('SELECT COUNT(*)::int FROM announcements');
    if (annCheck.rows[0].count === 0) {
      await client.query(`INSERT INTO announcements (title, content, category, priority, created_by)
        VALUES
        ('Term 2 Examinations Begin June 9','All S.4-S.6 students must be prepared. Exam timetable posted on notice board.','Academic','high',1),
        ('Fee Payment Final Deadline — June 15','Parents are urged to clear all Term 2 fees before June 15 to avoid penalties. Payment via mobile money accepted.','Finance','urgent',1),
        ('Science Fair 2026 — June 21','Interested students should submit project proposals by June 5. Categories: Biology, Chemistry, Physics, ICT.','Event','normal',1),
        ('Inter-Class Athletics Meet — July 10','All students encouraged to participate. Registration closes July 5.','Sports','normal',1),
        ('New ICT Lab Now Open','50 new computers installed. Lab open 7AM-6PM weekdays. First-come-first-served.','General','normal',1)`);
      console.log('Announcements seeded.');
    }

    console.log('\nDatabase initialization complete!');
  } catch (e) {
    console.error('Init failed:', e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

init();