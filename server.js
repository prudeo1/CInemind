require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '30kb' }));
app.use('/api/', rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(express.static(path.join(__dirname, 'public')));

const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const GENRES = { Action:28, Adventure:12, Animation:16, Comedy:35, Crime:80, Documentary:99, Drama:18, Family:10751, Fantasy:14, History:36, Horror:27, Music:10402, Mystery:9648, Romance:10749, 'Sci-Fi':878, Thriller:53, War:10752, Western:37 };
const hasTmdb = () => Boolean(process.env.TMDB_ACCESS_TOKEN);
const hasGemini = () => Boolean(process.env.GEMINI_API_KEY);

async function tmdb(endpoint, params = {}) {
  if (!hasTmdb()) throw new Error('TMDB is not configured. Add TMDB_ACCESS_TOKEN to your .env file.');
  const url = new URL(`${TMDB_BASE}${endpoint}`);
  Object.entries(params).forEach(([k,v]) => { if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v)); });
  const r = await fetch(url, { headers: { Authorization: `Bearer ${process.env.TMDB_ACCESS_TOKEN}`, accept: 'application/json' } });
  if (!r.ok) throw new Error(`Movie database request failed (${r.status}).`);
  return r.json();
}
function movieShape(m) {
  return { id:m.id, title:m.title, year:m.release_date?.slice(0,4) || '—', releaseDate:m.release_date || '', rating:m.vote_average ? Number(m.vote_average).toFixed(1) : '—', poster:m.poster_path ? `${IMAGE_BASE}${m.poster_path}` : null, backdrop:m.backdrop_path ? `https://image.tmdb.org/t/p/w1280${m.backdrop_path}` : null, overview:m.overview || 'No synopsis is available yet.', genreIds:m.genre_ids || m.genres?.map(g=>g.id) || [], genres:m.genres?.map(g=>g.name) || [], language:m.original_language || '' };
}
async function gemini(prompt, json = false) {
  if (!hasGemini()) return null;
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ contents:[{role:'user',parts:[{text:prompt}]}], generationConfig:{temperature:0.55,maxOutputTokens:1400,...(json?{responseMimeType:'application/json'}:{})} })
  });
  if (!r.ok) { const detail = await r.text(); console.error('Gemini error:', r.status, detail.slice(0,500)); throw new Error(`AI request failed (${r.status}). Check your Gemini key and quota.`); }
  const data = await r.json();
  return data.candidates?.[0]?.content?.parts?.map(p=>p.text || '').join('\n') || '';
}
function safeText(v, max=240) { return typeof v === 'string' ? v.trim().slice(0,max) : ''; }

app.get('/api/config', (_req,res) => res.json({ supabaseUrl:process.env.SUPABASE_URL || '', supabaseAnonKey:process.env.SUPABASE_ANON_KEY || '' }));
app.get('/api/status', (_req,res) => res.json({ aiEnabled:hasGemini(), tmdbEnabled:hasTmdb(), databaseEnabled:Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY), mode:hasGemini() && hasTmdb() ? 'LIVE AI' : 'SETUP REQUIRED' }));
app.get('/api/movies', async (req,res) => {
  try { const data = await tmdb('/movie/popular',{page:1}); res.json({results:(data.results||[]).map(movieShape)}); }
  catch(e) { res.status(503).json({error:e.message}); }
});
app.get('/api/search', async (req,res) => {
  const q = safeText(req.query.q,100); if(q.length < 2) return res.status(400).json({error:'Enter at least two characters.'});
  try { const data=await tmdb('/search/movie',{query:q,include_adult:false,page:1}); res.json({results:(data.results||[]).slice(0,8).map(movieShape)}); }
  catch(e){res.status(503).json({error:e.message});}
});
app.post('/api/summarize', async (req,res) => {
  const title=safeText(req.body?.title,100), mode=req.body?.mode==='full'?'full':'spoiler-free';
  if(!title) return res.status(400).json({error:'Enter a movie title first.'});
  try {
    let found;
    if(hasTmdb()) {
      const search=await tmdb('/search/movie',{query:title,include_adult:false,page:1});
      found=search.results?.[0];
      if(!found) return res.status(404).json({error:`I couldn't find “${title}” in the movie database. Check the title or release year.`});
      const details=await tmdb(`/movie/${found.id}`,{append_to_response:'credits'});
      const m=movieShape(details);
      const cast=(details.credits?.cast||[]).slice(0,6).map(c=>`${c.name} as ${c.character}`).join(', ');
      const crew=(details.credits?.crew||[]).find(c=>c.job==='Director')?.name || 'Not listed';
      const context=`Title: ${m.title} (${m.year})\nGenres: ${m.genres.join(', ')}\nOverview: ${m.overview}\nDirector: ${crew}\nMain cast: ${cast}\nRuntime: ${details.runtime||'Unknown'} minutes`;
      const prompt=`You are CINEMIND, an accurate and engaging film analyst. Use ONLY the verified movie facts below as factual grounding. Do not invent scenes, character names, quotes, or plot details. If the synopsis is too limited to support a detailed claim, say so.\n${context}\n\nCreate a ${mode==='full'?'detailed plot summary including the ending. Clearly mark the entire section as SPOILERS.':'spoiler-free summary. Do not reveal twists, deaths, the ending, or hidden identities.'}\nThen include these headings: The premise; Story and themes; Mood and pacing; What makes it worth watching; Who will enjoy it. Keep it informative, well-written and specific.`;
      const answer=await gemini(prompt);
      if(!answer) return res.json({movie:m,answer:`## ${m.title} (${m.year})\n\n${m.overview}\n\nLive movie data is connected. Add a Gemini API key to generate the full AI analysis.`,source:'tmdb'});
      return res.json({movie:m,answer,source:'ai'});
    }
    return res.status(503).json({error:'Movie search is not configured yet. Add your TMDB access token to enable movie lookup.'});
  } catch(e){ console.error(e); res.status(502).json({error:e.message || 'Could not analyse this movie.'}); }
});
app.post('/api/recommend', async (req,res) => {
  const mood=safeText(req.body?.mood,500), avoid=safeText(req.body?.avoid,180), era=safeText(req.body?.era,40)||'Any era';
  const genres=Array.isArray(req.body?.genres)?req.body.genres.filter(g=>GENRES[g]).slice(0,6):[];
  if(!mood && !genres.length) return res.status(400).json({error:'Tell me what kind of movie you feel like watching.'});
  try {
    let discoverParams={include_adult:false,sort_by:'popularity.desc',page:1,'vote_count.gte':80};
    if(genres.length) discoverParams.with_genres=genres.map(g=>GENRES[g]).join('|');
    if(era==='Classics (before 1990)') discoverParams['primary_release_date.lte']='1989-12-31';
    if(era==='90s & 2000s'){discoverParams['primary_release_date.gte']='1990-01-01';discoverParams['primary_release_date.lte']='2009-12-31';}
    if(era==='2010s'){discoverParams['primary_release_date.gte']='2010-01-01';discoverParams['primary_release_date.lte']='2019-12-31';}
    if(era==='2020s') discoverParams['primary_release_date.gte']='2020-01-01';
    const pages=await Promise.all([tmdb('/discover/movie',discoverParams),tmdb('/movie/top_rated',{page:1})]);
    let pool=[...(pages[0].results||[]),...(pages[1].results||[])];
    const unique=[...new Map(pool.map(m=>[m.id,m])).values()].filter(m=>m.poster_path && !m.adult).slice(0,35).map(movieShape);
    if(!unique.length) return res.status(404).json({error:'No matching films came back. Try a broader genre or era.'});
    const prompt=`You are CINEMIND, a film recommendation engine. Choose the 6 best-fitting DISTINCT movies from the supplied candidate list ONLY. Never invent a title or ID. Match the user's mood semantically, respect selected genres, release era and exclusions. Exclude films whose genre or synopsis clearly conflicts with the avoid field. Return strict JSON: {"intro":"one concise personalised sentence","picks":[{"id":number,"reason":"one specific sentence explaining the match"}]}. Do not add markdown.\nUSER MOOD: ${mood||'Not specified'}\nGENRES: ${genres.join(', ')||'Any'}\nERA: ${era}\nAVOID: ${avoid||'Nothing'}\nCANDIDATES: ${JSON.stringify(unique.map(m=>({id:m.id,title:m.title,year:m.year,genres:m.genres,overview:m.overview,rating:m.rating})))}`;
    let picks=[], intro='A selection based on your preferences.';
    const raw=await gemini(prompt,true);
    if(raw){try{const parsed=JSON.parse(raw.replace(/^```json\s*/i,'').replace(/```$/,'').trim());intro=safeText(parsed.intro,220)||intro;const byId=new Map(unique.map(m=>[m.id,m]));picks=(parsed.picks||[]).filter(p=>byId.has(Number(p.id))).slice(0,6).map(p=>({...byId.get(Number(p.id)),reason:safeText(p.reason,240)}));}catch(err){console.error('Could not parse recommendation JSON',err.message);}}
    if(!picks.length) picks=unique.slice(0,6).map(m=>({...m,reason:`A popular ${m.genres.slice(0,2).join(' / ')||'film'} pick to explore based on your preferences.`}));
    res.json({intro,picks,source:raw&&picks.length?'ai':'tmdb'});
  } catch(e){console.error(e);res.status(502).json({error:e.message||'Could not create recommendations.'});}
});
app.listen(PORT,()=>console.log(`CINEMIND running at http://localhost:${PORT}`));
