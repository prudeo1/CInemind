require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '30kb' }));
app.use('/api/', rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(express.static(path.join(__dirname, 'public')));

const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const GENRES = { Action:28, Adventure:12, Animation:16, Comedy:35, Crime:80, Documentary:99, Drama:18, Family:10751, Fantasy:14, History:36, Horror:27, Music:10402, Mystery:9648, Romance:10749, 'Sci-Fi':878, Thriller:53, War:10752, Western:37 };

// Regions / languages the user can pick. `lang` = TMDB original language, `country` = origin country.
const REGIONS = {
  'Any region': {},
  'American (Hollywood)': { country: 'US' },
  'Korean': { lang: 'ko' },
  'Japanese': { lang: 'ja' },
  'Anime': { lang: 'ja', genre: 16 },
  'Bollywood / Indian': { lang: 'hi' },
  'Nollywood (Nigerian)': { country: 'NG' },
  'Chinese / Hong Kong': { lang: 'zh|cn' },
  'French': { lang: 'fr' },
  'Spanish / Latin American': { lang: 'es' },
  'Italian': { lang: 'it' },
  'German': { lang: 'de' },
  'Turkish': { lang: 'tr' },
  'Thai': { lang: 'th' },
  'British': { country: 'GB' },
  'Scandinavian': { lang: 'sv|da|no|fi' }
};
// If no region is chosen, try to read one from the mood text ("a korean romance", "anime", ...).
const REGION_HINTS = [
  [/anime|ghibli|manga|shonen/i, 'Anime'],
  [/korean|k-?drama|korea/i, 'Korean'],
  [/japan/i, 'Japanese'],
  [/bollywood|hindi|indian/i, 'Bollywood / Indian'],
  [/nollywood|nigeria/i, 'Nollywood (Nigerian)'],
  [/chinese|cantonese|hong kong|mandarin/i, 'Chinese / Hong Kong'],
  [/french|france/i, 'French'],
  [/spanish|latin|mexican|argentin/i, 'Spanish / Latin American'],
  [/italian/i, 'Italian'],
  [/german/i, 'German'],
  [/turkish/i, 'Turkish'],
  [/thai/i, 'Thai'],
  [/british|\buk\b|english film/i, 'British'],
  [/american|hollywood/i, 'American (Hollywood)']
];
function detectRegion(mood) {
  for (const [re, name] of REGION_HINTS) if (re.test(mood || '')) return name;
  return 'Any region';
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
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
  const primary = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const models = [primary, 'gemini-3.6-flash', 'gemini-3.5-flash-lite'].filter((m, i, arr) => arr.indexOf(m) === i);
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.55, maxOutputTokens: 4096, ...(json ? { responseMimeType: 'application/json' } : {}) }
  });
  let lastStatus = 0;
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let r;
      try {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body
        });
      } catch (netErr) {
        lastStatus = 0;
        console.error(`Gemini ${model} network error:`, netErr.message);
        await new Promise(res => setTimeout(res, 1000 * (attempt + 1)));
        continue;
      }
      if (r.ok) {
        const data = await r.json();
        return data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('\n') || '';
      }
      lastStatus = r.status;
      const detail = await r.text();
      console.error(`Gemini ${model} error (attempt ${attempt + 1}):`, r.status, detail.slice(0, 500));
      if (![429, 500, 503].includes(r.status)) break; // permanent error: skip to next model
      await new Promise(res => setTimeout(res, 1000 * (attempt + 1)));
    }
  }
  if (lastStatus === 503 || lastStatus === 500) throw new Error("Google's AI is overloaded right now. Please try again in a moment.");
  if (lastStatus === 429) throw new Error('Gemini quota or rate limit reached. Please wait a bit and try again.');
  if (lastStatus === 0) throw new Error('Could not reach the Gemini service. Check your internet connection.');
  throw new Error(`AI request failed (${lastStatus}). Check your Gemini key and model name.`);
}
function safeText(v, max=240) { return typeof v === 'string' ? v.trim().slice(0,max) : ''; }

app.get('/api/config', (_req,res) => res.json({ supabaseUrl:process.env.SUPABASE_URL || '', supabaseAnonKey:process.env.SUPABASE_ANON_KEY || '' }));
app.get('/api/status', (_req,res) => res.json({ aiEnabled:hasGemini(), tmdbEnabled:hasTmdb(), databaseEnabled:Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY), mode:hasGemini() && hasTmdb() ? 'LIVE AI' : 'SETUP REQUIRED' }));
app.get('/api/movies', async (req,res) => {
  try {
    const regionName = REGIONS[req.query.region] ? req.query.region : 'Any region';
    const r = REGIONS[regionName];
    let results;
    if (regionName === 'Any region') {
      results = (await tmdb('/movie/popular',{page:1})).results || [];
    } else {
      const p = { include_adult:false, sort_by:'popularity.desc', 'vote_count.gte':30, page:1 };
      if (r.country) p.with_origin_country = r.country;
      if (r.genre) p.with_genres = r.genre;
      const langs = r.lang ? r.lang.split('|') : [null];
      const lists = await Promise.all(langs.map(l => tmdb('/discover/movie', { ...p, ...(l ? { with_original_language: l } : {}) })));
      results = lists.flatMap(x => x.results || []).sort((a,b) => (b.popularity||0) - (a.popularity||0));
    }
    res.json({results:results.map(movieShape)});
  }
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
  let regionName = REGIONS[req.body?.region] ? req.body.region : 'Any region';
  if (regionName === 'Any region') regionName = detectRegion(mood);
  const region = REGIONS[regionName];
  if(!mood && !genres.length && regionName==='Any region') return res.status(400).json({error:'Tell me what kind of movie you feel like watching.'});
  try {
    const base={include_adult:false,'vote_count.gte':region.lang||region.country?40:80};
    if(region.genre){ base.with_genres=[region.genre,...genres.slice(0,1).map(g=>GENRES[g]).filter(g=>g!==region.genre)].join(','); }
    else if(genres.length) base.with_genres=genres.map(g=>GENRES[g]).join('|');
    if(region.country) base.with_origin_country=region.country;
    if(era==='Classics (before 1990)') base['primary_release_date.lte']='1989-12-31';
    if(era==='90s & 2000s'){base['primary_release_date.gte']='1990-01-01';base['primary_release_date.lte']='2009-12-31';}
    if(era==='2010s'){base['primary_release_date.gte']='2010-01-01';base['primary_release_date.lte']='2019-12-31';}
    if(era==='2020s') base['primary_release_date.gte']='2020-01-01';
    // Several pages, two sort orders: popular AND critically acclaimed, so results are broad, not just blockbusters.
    const langs=region.lang?region.lang.split('|'):[null];
    const multi=langs.length>1, strict=Boolean(region.lang||region.country);
    const jobs=[];
    for(const lang of langs){
      const b2={...base,...(lang?{with_original_language:lang}:{})};
      for(const page of (multi?[1]:[1,2,3])) jobs.push(tmdb('/discover/movie',{...b2,sort_by:'popularity.desc',page}));
      for(const page of (multi?[1]:[1,2])) jobs.push(tmdb('/discover/movie',{...b2,sort_by:'vote_average.desc','vote_count.gte':strict?150:500,page}));
    }
    const settled=await Promise.allSettled(jobs);
    const pool=settled.filter(x=>x.status==='fulfilled').flatMap(x=>x.value.results||[]);
    if(!pool.length && settled[0]?.status==='rejected') throw settled[0].reason;
    const unique=shuffle([...new Map(pool.map(m=>[m.id,m])).values()].filter(m=>m.poster_path && !m.adult)).slice(0,60).map(movieShape);
    if(!unique.length) return res.status(404).json({error:'No matching films came back. Try a broader genre, region or era.'});
    const prompt=`You are CINEMIND, a film recommendation engine. Choose the 6 best-fitting DISTINCT movies from the supplied candidate list ONLY. Never invent a title or ID. Aim for variety (different decades, countries and tones where the filters allow). Match the user's mood semantically, respect selected genres, release era and exclusions. Exclude films whose genre or synopsis clearly conflicts with the avoid field. Return strict JSON: {"intro":"one concise personalised sentence","picks":[{"id":number,"reason":"one specific sentence explaining the match"}]}. Do not add markdown.\nUSER MOOD: ${mood||'Not specified'}\nGENRES: ${genres.join(', ')||'Any'}\nERA: ${era}\nREGION/LANGUAGE: ${regionName}\nAVOID: ${avoid||'Nothing'}\nCANDIDATES: ${JSON.stringify(unique.map(m=>({id:m.id,title:m.title,year:m.year,genres:m.genres,overview:m.overview,rating:m.rating})))}`;
    let picks=[], intro='A selection based on your preferences.';
    const raw=await gemini(prompt,true);
    if(raw){try{const parsed=JSON.parse(raw.replace(/^```json\s*/i,'').replace(/```$/,'').trim());intro=safeText(parsed.intro,220)||intro;const byId=new Map(unique.map(m=>[m.id,m]));picks=(parsed.picks||[]).filter(p=>byId.has(Number(p.id))).slice(0,6).map(p=>({...byId.get(Number(p.id)),reason:safeText(p.reason,240)}));}catch(err){console.error('Could not parse recommendation JSON',err.message);}}
    if(!picks.length) picks=unique.slice(0,6).map(m=>({...m,reason:`A popular ${m.genres.slice(0,2).join(' / ')||'film'} pick to explore based on your preferences.`}));
    res.json({intro,picks,source:raw&&picks.length?'ai':'tmdb'});
  } catch(e){console.error(e);res.status(502).json({error:e.message||'Could not create recommendations.'});}
});
const server = app.listen(PORT, () => console.log(`CINEMIND running at http://localhost:${PORT}`));
server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the other process (kill -9 $(lsof -ti :${PORT})) or run: PORT=3001 npm start`);
    process.exit(1);
  }
  throw err;
});