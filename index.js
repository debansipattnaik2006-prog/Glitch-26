import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { eventConfig } from './config.js';

const { Pool } = pg;
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined });
const port = process.env.PORT || 4000;
app.use(helmet());
app.use(cors({ origin: (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(','), credentials: false }));
app.use(express.json({ limit: '30kb' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60_000, limit: 8, message: { error: 'Too many login attempts. Please try again later.' } }));

const registrationSchema = z.object({
  studentName: z.string().trim().min(2).max(80),
  rollNumber: z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9/-]+$/, 'Use letters, numbers, hyphens or slashes only.'),
  academicYear: z.enum(['1st Year', '2nd Year', '3rd Year']),
  contactNumber: z.string().trim().max(20).optional().or(z.literal(''))
});
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try { if (!token) throw new Error(); req.admin = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Administrator authentication required.' }); }
}
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/config', (_req, res) => res.json(eventConfig));

app.post('/api/register', async (req, res) => {
  const parsed = registrationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const d = parsed.data;
  try {
    const result = await pool.query(
      `INSERT INTO registrations (student_name, roll_number, academic_year, department, contact_number, pass_id)
       VALUES ($1, UPPER($2), $3, 'ITM', NULLIF($4,''), $5)
       RETURNING id, student_name, roll_number, academic_year, department, pass_id, registration_date, entry_status`,
      [d.studentName, d.rollNumber, d.academicYear, d.contactNumber || '', randomUUID()]
    );
    res.status(201).json({ registration: result.rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'This roll number is already registered. Each student can generate one pass.' });
    console.error(e); res.status(500).json({ error: 'Registration could not be completed. Please try again.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'Enter your email and password.' });
  try {
    const r = await pool.query('SELECT id, email, password_hash, role FROM admins WHERE LOWER(email)=LOWER($1)', [email.trim()]);
    if (!r.rowCount || !(await bcrypt.compare(password, r.rows[0].password_hash))) return res.status(401).json({ error: 'Invalid email or password.' });
    const a = r.rows[0];
    const token = jwt.sign({ adminId: a.id, email: a.email, role: a.role }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, admin: { email: a.email, role: a.role } });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Login service unavailable.' }); }
});

app.get('/api/admin/overview', auth, async (_req, res) => {
  try {
    const q = await pool.query(`SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE academic_year='1st Year')::int year1,
      COUNT(*) FILTER (WHERE academic_year='2nd Year')::int year2, COUNT(*) FILTER (WHERE academic_year='3rd Year')::int year3,
      COUNT(*) FILTER (WHERE entry_status='USED')::int verified, COUNT(*) FILTER (WHERE entry_status='PENDING')::int pending FROM registrations`);
    res.json({ ...q.rows[0], passes: q.rows[0].total });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not load dashboard.' }); }
});
app.get('/api/admin/registrations', auth, async (req, res) => {
  const search = String(req.query.search || '').slice(0, 80);
  const year = ['1st Year','2nd Year','3rd Year'].includes(req.query.year) ? req.query.year : null;
  try {
    const q = await pool.query(`SELECT id, student_name, roll_number, academic_year, department, pass_id, registration_date, entry_status, verified_at
      FROM registrations WHERE ($1='' OR student_name ILIKE '%'||$1||'%' OR roll_number ILIKE '%'||$1||'%') AND ($2::text IS NULL OR academic_year=$2)
      ORDER BY registration_date DESC LIMIT 1000`, [search, year]);
    res.json({ registrations: q.rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not load registrations.' }); }
});
app.post('/api/admin/verify', auth, async (req, res) => {
  const passId = String(req.body?.passId || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(passId)) return res.status(400).json({ status: 'INVALID', error: 'Invalid pass identifier.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const q = await client.query('SELECT id, student_name, roll_number, academic_year, pass_id, entry_status FROM registrations WHERE pass_id=$1 FOR UPDATE', [passId]);
    if (!q.rowCount) { await client.query('COMMIT'); return res.status(404).json({ status: 'INVALID', error: 'No registration matches this pass.' }); }
    const s = q.rows[0];
    if (s.entry_status === 'USED') { await client.query('COMMIT'); return res.json({ status: 'USED', student: s, message: 'PASS ALREADY USED' }); }
    await client.query("UPDATE registrations SET entry_status='USED', verified_at=NOW(), verified_by=$1 WHERE id=$2", [req.admin.adminId, s.id]);
    await client.query('COMMIT');
    res.json({ status: 'APPROVED', student: { ...s, entry_status: 'USED' }, message: 'ENTRY APPROVED' });
  } catch (e) { await client.query('ROLLBACK'); console.error(e); res.status(500).json({ error: 'Verification failed. Try again.' }); }
  finally { client.release(); }
});
app.get('/api/admin/export', auth, async (_req, res) => {
  try {
    const q = await pool.query('SELECT student_name, roll_number, academic_year, department, pass_id, registration_date, entry_status, verified_at FROM registrations ORDER BY registration_date');
    const cols = ['student_name','roll_number','academic_year','department','pass_id','registration_date','entry_status','verified_at'];
    const csv = [cols.join(','), ...q.rows.map(row => cols.map(c => `"${String(row[c] ?? '').replaceAll('"','""')}"`).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', 'attachment; filename="glitch26-registrations.csv"'); res.send(csv);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Export failed.' }); }
});

async function bootstrap() {
  if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) throw new Error('DATABASE_URL and JWT_SECRET are required. Copy server/.env.example to server/.env.');
  await pool.query('SELECT 1');
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
    await pool.query('INSERT INTO admins(email,password_hash) VALUES($1,$2) ON CONFLICT(email) DO NOTHING', [process.env.ADMIN_EMAIL.toLowerCase(), hash]);
  }
  app.listen(port, () => console.log(`GLITCH’26 API running at http://localhost:${port}`));
}
bootstrap().catch(e => { console.error('Startup failed:', e.message); process.exit(1); });
