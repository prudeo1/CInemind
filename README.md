<<<<<<< HEAD
# CINEMIND — AI Movie Companion

CINEMIND is a responsive, liquid-glass movie discovery app with an animated globe, live movie metadata, AI-assisted summaries, mood-based recommendations, and an optional account-backed watchlist.

## What's integrated

- **TMDB:** real movie title search, posters, release years, genres, ratings, synopsis, director and cast metadata.
- **Google Gemini:** spoiler-free/full-story analysis grounded in retrieved movie metadata; recommendation ranking against a real TMDB candidate pool.
- **Supabase (optional):** email magic-link sign-in and per-user watchlists, protected with Postgres Row Level Security.
- **Safety and reliability:** API keys remain server-side, request-size limits, API rate limiting, Helmet security headers, input validation, adult results excluded from TMDB queries, and graceful setup errors.
- **UI:** responsive layout, liquid-glass styling, animated analysis globe, movie cards, account panel and watchlist.

## Requirements

- Node.js 18+
- A TMDB API Read Access Token
- A Google Gemini API key
- A Supabase project (optional, only needed for accounts and cloud-synced watchlists)

## 1. Configure API credentials

Copy `.env.example` to `.env` and fill in the values. Never commit `.env` or put provider secrets in browser JavaScript.

### TMDB

1. Create/sign in to a TMDB account.
2. Open account Settings → API and request a developer API key.
3. Copy the **API Read Access Token** into `TMDB_ACCESS_TOKEN`.
4. Review TMDB's current API terms and attribution rules before public or commercial use.

Docs: https://developer.themoviedb.org/docs/getting-started

### Gemini

1. Create a key in Google AI Studio.
2. Put it in `GEMINI_API_KEY`.
3. The default model is `gemini-2.5-flash`; change `GEMINI_MODEL` if your account/project uses another supported model.

Docs: https://ai.google.dev/gemini-api/docs/get-started

### Supabase (optional)

1. Create a Supabase project.
2. Copy the Project URL to `SUPABASE_URL` and the publishable key (or legacy anon key) to `SUPABASE_ANON_KEY`.
3. Open the Supabase SQL Editor and run `supabase/schema.sql`.
4. In Supabase Authentication → URL Configuration, add your local and deployed app URLs to the allowed redirect URLs (for example `http://localhost:3000/**`).
5. Configure the email provider and templates in Supabase Auth.

The app uses Supabase's browser client with the publishable/anon key. The database table has RLS policies that limit each signed-in user to their own rows. Never put a Supabase service-role/secret key in the frontend or `.env` used by this app.

Docs: https://supabase.com/docs/guides/database/row-level-security

## 2. Install and run

```bash
cp .env.example .env
# Edit .env and add your keys
npm install
npm start
```

Open http://localhost:3000.

## API routes

- `GET /api/status` — reports which integrations are configured.
- `GET /api/config` — exposes only the Supabase project URL and public anon/publishable key.
- `GET /api/search?q=...` — searches TMDB movie titles.
- `GET /api/movies` — popular TMDB movies.
- `POST /api/summarize` — `{ "title": "Arrival", "mode": "spoiler-free" }` or `mode: "full"`.
- `POST /api/recommend` — `{ "mood": "clever, tense mystery with a satisfying twist", "genres": ["Mystery", "Thriller"], "era": "Any era", "avoid": "gore" }`.

## Deployment

Deploy the Node app to a Node-compatible host (Render, Railway, Fly.io, or a VPS). Set the same environment variables in the host's secret/environment settings. Add the deployed origin to Supabase's allowed redirect URLs. Use HTTPS and configure an appropriate domain before sharing publicly.

## Important launch checklist

- TMDB's developer API is intended for non-commercial use subject to its terms and attribution requirements. Contact TMDB for commercial licensing before monetizing the product.
- Keep all provider keys private and rotate any key that is accidentally exposed.
- Set provider usage limits and billing alerts where available.
- Add monitoring, backups, automated tests, and a privacy policy before accepting public users.
- Gemini summaries are AI-generated interpretations, not authoritative plot records. The app grounds responses in TMDB metadata and prompts the model not to invent unsupported details, but outputs can still be inaccurate. Users should choose spoiler-free mode to avoid intentional ending disclosures.
- Supabase email authentication requires email delivery configuration and allowed redirect URLs.
=======
# Cinemind
AI-powered movie recommendation and watchlist app
>>>>>>> origin/main


