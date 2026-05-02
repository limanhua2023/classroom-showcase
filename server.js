import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase Setup - with validation
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

console.log('--- Environment Check ---');
console.log('SUPABASE_URL:', supabaseUrl ? 'SET (' + supabaseUrl.substring(0, 20) + '...)' : 'NOT SET');
console.log('SUPABASE_ANON_KEY:', supabaseKey ? 'SET (length: ' + supabaseKey.length + ')' : 'NOT SET');

let supabase = null;
if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('Supabase client initialized successfully.');
} else {
    console.error('WARNING: Supabase credentials missing! The app will start but database features will not work.');
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Endpoints
app.get('/api/assignments', async (req, res) => {
    if (!supabase) {
        return res.json([]);
    }
    try {
        const { data, error } = await supabase
            .from('assignments')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('GET /api/assignments error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/assignments', async (req, res) => {
    if (!supabase) {
        return res.status(503).json({ error: 'Database not configured' });
    }
    try {
        const { studentName, title, content } = req.body;
        if (!studentName || !title || !content) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const { data, error } = await supabase
            .from('assignments')
            .insert([{ 
                student_name: studentName, 
                title, 
                content,
                timestamp: new Date().toLocaleString()
            }])
            .select();

        if (error) throw error;
        res.status(201).json(data[0]);
    } catch (error) {
        console.error('POST /api/assignments error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});
