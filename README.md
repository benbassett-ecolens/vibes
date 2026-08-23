# Ecolens L10 🎯

An internal EOS® (Entrepreneurial Operating System, from Gino Wickman's *Traction*) Level 10
Meeting hub for Ecolens — the same meeting toolkit ninety.io productizes, self-hosted and free.

## What's inside

| Tab | EOS concept |
| --- | --- |
| **Scorecard** | 5–15 measurables, each with an owner, a goal (≥ or ≤), this week/month and last week/month numbers, a **rolling 90-day average**, and a trend arrow (colored by whether the move is toward the goal). Weekly and monthly scorecards. Expand a row (▸) to backfill history — that history is what feeds the 90-day average. |
| **Rocks** | Quarterly Rocks: name, owner, due date, completion checkbox, blocker flag, and milestones (each with its own owner and checkbox) with a progress bar. |
| **Headlines** | One-line customer / employee / general news, with who shared it and when. |
| **Issues** | The Issues List, worked with IDS (Identify–Discuss–Solve): issue, short-term vs long-term, who raised it, the decision, who implements it, and a solved checkbox. |
| **Rate the Meeting** | The standard 90-minute L10 agenda, attendee selection, individual 1–10 ratings with a live average (EOS aims for 8+), and meeting notes. |
| **Team** | The people who appear as owners and attendees everywhere else. |

Data is stored in the browser (`localStorage`) with JSON **Export / Import** for backup and
hand-off. See "Shared team data" below for the multi-user upgrade path.

## Develop

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests (period math, 90-day rolling average)
npm run build      # type-check + production build → dist/
npm run build:single  # self-contained single-file build → dist-single/index.html
```

## Publishing & hosting for Ecolens internal use

The app builds to a static bundle (`dist/`), so hosting is cheap and simple. The real requirement
is **access control** — "viewable by select teams inside the ecolens domain" — and the cleanest way
to get that for a static app is to put an SSO gate *in front* of the host rather than build auth
into the app.

### Recommended: Cloudflare Pages + Cloudflare Access

Best fit for the requirement, free at Ecolens's likely scale (Access is free up to 50 users):

1. **Host**: connect this GitHub repo to [Cloudflare Pages](https://pages.cloudflare.com)
   (build command `npm run build`, output `dist`). Every push auto-deploys; PRs get preview URLs.
2. **Gate**: in Cloudflare Zero Trust, add the app's hostname to **Access** and create a policy:
   - *Broad*: allow emails ending in `@ecolens.io`, or
   - *Select teams*: connect Google Workspace as the identity provider and allow specific
     **Google Groups** (e.g. `leadership@ecolens.io`) — this is exactly "select teams".
3. Users hit the URL, sign in with their Ecolens Google account, and the edge blocks everyone else
   before a single byte of the app is served.

### Alternatives

- **Google Cloud (Firebase Hosting or Cloud Run) + Identity-Aware Proxy** — the most "native"
  option if Ecolens runs on Google Workspace; IAP restricts access by Google account or Google
  Group with no third party involved. Slightly more GCP setup than Cloudflare.
- **Vercel** — the fastest deploy experience (import repo, done), but its built-in protection
  gates on *Vercel team seats*, not your Google domain; domain-wide SSO needs a paid tier or a
  Cloudflare Access proxy in front. Fine for a quick internal pilot.
- **GitHub Pages** — free, but access control is limited to GitHub org membership (private Pages
  requires GitHub Enterprise), so it doesn't map well to "select teams in the ecolens domain".

### Shared team data (recommended next step)

Today each browser keeps its own data (Export/Import moves it around — workable for a single
meeting facilitator who "drives" the L10). For true shared state across the team, add
[Supabase](https://supabase.com) (free tier):

1. Enable **Google sign-in** in Supabase Auth and restrict it to the `ecolens.io` hosted domain.
2. Create tables mirroring `src/types.ts` (people, metrics + entries, rocks, milestones, issues,
   headlines, meetings) with row-level security keyed to a `team_id`.
3. Swap the persistence layer — it's isolated in `src/store.tsx` (`load()` + the save effect) —
   for Supabase reads/writes.

Firestore is an equivalent choice if you'd rather stay all-Google.

---

*EOS® and Level 10 Meeting™ are trademarks of EOS Worldwide. This is an internal tool inspired by
the concepts in* Traction*, not an official EOS product.*
