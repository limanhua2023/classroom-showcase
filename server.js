import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import multer from 'multer';
import archiver from 'archiver';
import QRCode from 'qrcode';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

// Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
let supabase = null;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log('Supabase connected.');
} else {
  console.error('WARNING: Supabase credentials missing!');
}

// Multer for image upload (memory storage)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Teacher Auth Middleware ───
function teacherAuth(req, res, next) {
  const auth = req.headers['x-teacher-auth'];
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const [activityId, password] = Buffer.from(auth, 'base64').toString().split(':');
    req.teacherActivityId = activityId;
    req.teacherPassword = password;
    next();
  } catch { return res.status(401).json({ error: 'Invalid auth' }); }
}

// ─── ACTIVITIES ───
app.post('/api/activities', async (req, res) => {
  try {
    const { course_name, class_name, activity_name, description, invite_code, teacher_password } = req.body;
    const { data, error } = await supabase.from('activities').insert([{
      course_name, class_name, activity_name, description, invite_code, teacher_password
    }]).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/activities/code/:code', async (req, res) => {
  try {
    const { data, error } = await supabase.from('activities')
      .select('id,course_name,class_name,activity_name,description,invite_code,upload_open,voting_open,comments_open,show_live_ranking,created_at')
      .eq('invite_code', req.params.code).single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(404).json({ error: 'Activity not found' }); }
});

app.put('/api/activities/:id', teacherAuth, async (req, res) => {
  try {
    const { data: act } = await supabase.from('activities').select('teacher_password').eq('id', req.params.id).single();
    if (!act || act.teacher_password !== req.teacherPassword) return res.status(403).json({ error: 'Wrong password' });
    const { data, error } = await supabase.from('activities').update(req.body).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── USERS ───
app.post('/api/users', async (req, res) => {
  try {
    const { activity_id, name, student_id, class_name, group_name } = req.body;
    // Check if user already exists (allow re-entry)
    const { data: existing } = await supabase.from('users')
      .select('*').eq('activity_id', activity_id).eq('student_id', student_id).single();
    if (existing) return res.json(existing);
    const { data, error } = await supabase.from('users').insert([{
      activity_id, name, student_id, class_name, group_name
    }]).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── IMAGE UPLOAD ───
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image' });
    const ext = req.file.originalname.split('.').pop() || 'jpg';
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const filePath = `uploads/${filename}`;
    const { error } = await supabase.storage.from('submissions').upload(filePath, req.file.buffer, {
      contentType: req.file.mimetype, upsert: false
    });
    if (error) throw error;
    const { data: urlData } = supabase.storage.from('submissions').getPublicUrl(filePath);
    res.json({ url: urlData.publicUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── SUBMISSIONS ───
app.post('/api/submissions', async (req, res) => {
  try {
    const { activity_id, user_id, title, description, image_url } = req.body;
    // Check if user already submitted (allow re-upload)
    const { data: existing } = await supabase.from('submissions')
      .select('*').eq('activity_id', activity_id).eq('user_id', user_id).single();
    if (existing) {
      const { data, error } = await supabase.from('submissions').update({
        title, description, image_url, last_modified_time: new Date().toISOString(),
        edit_count: existing.edit_count + 1
      }).eq('id', existing.id).select().single();
      if (error) throw error;
      return res.json(data);
    }
    // Generate anonymous code
    const { count } = await supabase.from('submissions').select('*', { count: 'exact', head: true }).eq('activity_id', activity_id);
    const code = `A${String((count || 0) + 1).padStart(3, '0')}`;
    const { data, error } = await supabase.from('submissions').insert([{
      activity_id, user_id, anonymous_code: code, title, description, image_url
    }]).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Student: get anonymous submissions
app.get('/api/submissions', async (req, res) => {
  try {
    const { activity_id } = req.query;
    const { data, error } = await supabase.from('submissions')
      .select('id,anonymous_code,title,description,image_url,upload_time,view_count,rating_count,average_rating,composite_score,is_pinned,is_teacher_selected,status')
      .eq('activity_id', activity_id).eq('status', 'visible')
      .order('upload_time', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/submissions/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('submissions')
      .select('id,anonymous_code,title,description,image_url,upload_time,view_count,rating_count,average_rating,user_id')
      .eq('id', req.params.id).single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(404).json({ error: 'Not found' }); }
});

// Teacher: get all submissions with real names
app.get('/api/teacher/submissions', teacherAuth, async (req, res) => {
  try {
    const { activity_id } = req.query;
    const { data: act } = await supabase.from('activities').select('teacher_password').eq('id', activity_id).single();
    if (!act || act.teacher_password !== req.teacherPassword) return res.status(403).json({ error: 'Forbidden' });
    const { data, error } = await supabase.from('submissions')
      .select('*, users(name, student_id, class_name, group_name)')
      .eq('activity_id', activity_id).order('upload_time', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/teacher/submissions/:id', teacherAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('submissions').update(req.body).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/teacher/submissions/:id', teacherAuth, async (req, res) => {
  try {
    await supabase.from('submissions').delete().eq('id', req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── RATINGS ───
app.post('/api/ratings', async (req, res) => {
  try {
    const { activity_id, submission_id, rater_user_id, score } = req.body;
    // Check: can't rate own submission
    const { data: sub } = await supabase.from('submissions').select('user_id').eq('id', submission_id).single();
    if (sub && sub.user_id === rater_user_id) return res.status(403).json({ error: 'Cannot rate your own work' });
    // Upsert rating
    const { data: existing } = await supabase.from('ratings')
      .select('id').eq('submission_id', submission_id).eq('rater_user_id', rater_user_id).single();
    if (existing) {
      await supabase.from('ratings').update({ score, updated_at: new Date().toISOString() }).eq('id', existing.id);
    } else {
      await supabase.from('ratings').insert([{ activity_id, submission_id, rater_user_id, score }]);
    }
    // Recalculate average
    const { data: allRatings } = await supabase.from('ratings').select('score').eq('submission_id', submission_id);
    const avg = allRatings.reduce((s, r) => s + r.score, 0) / allRatings.length;
    await supabase.from('submissions').update({
      average_rating: Math.round(avg * 100) / 100, rating_count: allRatings.length
    }).eq('id', submission_id);
    res.json({ ok: true, average: avg, count: allRatings.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/ratings/my', async (req, res) => {
  try {
    const { activity_id, user_id } = req.query;
    const { data, error } = await supabase.from('ratings').select('submission_id,score')
      .eq('activity_id', activity_id).eq('rater_user_id', user_id);
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── COMMENTS ───
app.post('/api/comments', async (req, res) => {
  try {
    const { activity_id, submission_id, user_id, content } = req.body;
    if (!activity_id || !submission_id || !user_id || !content?.trim()) {
      return res.status(400).json({ error: '缺少必要字段' });
    }
    // Check if comments are open; if the column doesn't exist yet, allow it through
    try {
      const { data: act } = await supabase.from('activities').select('comments_open').eq('id', activity_id).single();
      if (act && act.comments_open === false) {
        return res.status(403).json({ error: '评论功能已关闭，请等待教师开启' });
      }
    } catch (checkErr) {
      // Column may not exist yet (SQL not run) — allow through
      console.warn('comments_open check failed, allowing comment:', checkErr.message);
    }
    const { data, error } = await supabase.from('comments').insert([{
      activity_id, submission_id, user_id, content: content.trim()
    }]).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/comments', async (req, res) => {
  try {
    const { submission_id } = req.query;
    if (!submission_id) return res.json([]);
    const { data, error } = await supabase.from('comments')
      .select('id, content, created_at')
      .eq('submission_id', submission_id).order('created_at', { ascending: true });
    if (error) {
      // Table may not exist yet — return empty gracefully
      console.warn('Comments table error (may not exist yet):', error.message);
      return res.json([]);
    }
    res.json(data || []);
  } catch (e) { res.json([]); }
});

app.delete('/api/teacher/comments/:id', teacherAuth, async (req, res) => {
  try {
    await supabase.from('comments').delete().eq('id', req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── RANKINGS ───
app.get('/api/rankings', async (req, res) => {
  try {
    const { activity_id } = req.query;
    const { data, error } = await supabase.from('submissions')
      .select('id,anonymous_code,title,average_rating,rating_count,view_count,composite_score,image_url')
      .eq('activity_id', activity_id).eq('status', 'visible').order('composite_score', { ascending: false });
    if (error) throw error;
    // Calculate composite scores
    if (data.length > 0) {
      const maxRC = Math.max(...data.map(d => d.rating_count), 1);
      const maxVC = Math.max(...data.map(d => d.view_count), 1);
      data.forEach((d, i) => {
        const normRC = d.rating_count / maxRC * 5;
        const normVC = d.view_count / maxVC * 5;
        d.composite_score = Math.round((d.average_rating * 0.7 + normRC * 0.2 + normVC * 0.1) * 100) / 100;
        d.rank = i + 1;
      });
      data.sort((a, b) => b.composite_score - a.composite_score || b.rating_count - a.rating_count || b.average_rating - a.average_rating);
      data.forEach((d, i) => d.rank = i + 1);
    }
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── VIEWS ───
app.post('/api/views', async (req, res) => {
  try {
    const { submission_id, viewer_user_id } = req.body;
    // Check 10-min duplicate
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: recent } = await supabase.from('views').select('id')
      .eq('submission_id', submission_id).eq('viewer_user_id', viewer_user_id)
      .gte('viewed_at', tenMinAgo).limit(1);
    if (recent && recent.length > 0) return res.json({ ok: true, duplicate: true });
    await supabase.from('views').insert([{ submission_id, viewer_user_id, is_valid: true }]);
    // Increment view count
    const { data: sub } = await supabase.from('submissions').select('view_count').eq('id', submission_id).single();
    await supabase.from('submissions').update({ view_count: (sub?.view_count || 0) + 1 }).eq('id', submission_id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── TEACHER AUTH CHECK ───
app.post('/api/teacher/login', async (req, res) => {
  try {
    const { invite_code, password } = req.body;
    const { data, error } = await supabase.from('activities')
      .select('*').eq('invite_code', invite_code).single();
    if (error || !data) return res.status(404).json({ error: 'Activity not found' });
    if (data.teacher_password !== password) return res.status(403).json({ error: 'Wrong password' });
    const token = Buffer.from(`${data.id}:${password}`).toString('base64');
    res.json({ activity: data, token });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── CSV EXPORT ───
app.get('/api/teacher/export', teacherAuth, async (req, res) => {
  try {
    const { activity_id } = req.query;
    const { data: act } = await supabase.from('activities').select('*').eq('id', activity_id).single();
    if (!act || act.teacher_password !== req.teacherPassword) return res.status(403).json({ error: 'Forbidden' });
    const { data } = await supabase.from('submissions')
      .select('*, users(name, student_id, class_name, group_name)')
      .eq('activity_id', activity_id).order('rank', { ascending: true });
    const BOM = '\uFEFF';
    let csv = BOM + '排名,匿名编号,学生姓名,学号,班级,小组,作品标题,上传时间,浏览量,评分人数,平均分,综合分,教师评分,最终成绩\n';
    (data || []).forEach((s, i) => {
      const u = s.users || {};
      csv += `${i+1},${s.anonymous_code},${u.name||''},${u.student_id||''},${u.class_name||''},${u.group_name||''},${s.title},${s.upload_time},${s.view_count},${s.rating_count},${s.average_rating},${s.composite_score},${s.teacher_score||''},${s.final_score||''}\n`;
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=classshow_export.csv');
    res.send(csv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── ZIP EXPORT ───
app.get('/api/teacher/export-zip', teacherAuth, async (req, res) => {
  try {
    const { activity_id } = req.query;
    const { data: act } = await supabase.from('activities').select('*').eq('id', activity_id).single();
    if (!act || act.teacher_password !== req.teacherPassword) return res.status(403).json({ error: 'Forbidden' });
    
    const { data: subs } = await supabase.from('submissions')
      .select('*, users(name, student_id, class_name)')
      .eq('activity_id', activity_id);
      
    if (!subs || subs.length === 0) return res.status(404).json({ error: 'No submissions found' });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(act.activity_name)}_works.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    // Download images from Supabase and append to ZIP
    for (const s of subs) {
      if (s.image_url) {
        try {
          const response = await fetch(s.image_url);
          if (response.ok) {
            const buffer = await response.arrayBuffer();
            const u = s.users || {};
            const ext = s.image_url.split('.').pop()?.split('?')[0] || 'jpg';
            // 格式: 班级_学号_姓名_标题.jpg
            const safeTitle = s.title.replace(/[\/\?<>\\:\*\|":]/g, '');
            const filename = `${u.class_name||'未知班级'}_${u.student_id||'未知学号'}_${u.name||'未知姓名'}_${safeTitle}.${ext}`;
            archive.append(Buffer.from(buffer), { name: filename });
          }
        } catch (err) { console.error('Error downloading image for zip:', s.image_url, err); }
      }
    }
    await archive.finalize();
  } catch (e) { 
    if (!res.headersSent) res.status(500).json({ error: e.message }); 
  }
});

// ─── ACTIVITY STATS ───
app.get('/api/activities/:id/stats', async (req, res) => {
  try {
    const id = req.params.id;
    const { count: userCount } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('activity_id', id);
    const { count: subCount } = await supabase.from('submissions').select('*', { count: 'exact', head: true }).eq('activity_id', id);
    const { count: ratingCount } = await supabase.from('ratings').select('*', { count: 'exact', head: true }).eq('activity_id', id);
    res.json({ users: userCount || 0, submissions: subCount || 0, ratings: ratingCount || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/qrcode', async (req, res) => {
  try {
    const { text } = req.query;
    if (!text) return res.status(400).json({ error: 'Text required' });
    const url = await QRCode.toDataURL(text, { width: 300, margin: 2, color: { dark: '#1e293b', light: '#ffffff' } });
    res.json({ url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, '0.0.0.0', () => console.log(`ClassShow running on port ${PORT}`));
