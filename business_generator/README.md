# Weekend business generator

A scheduled Claude routine that posts three weekend-buildable business ideas to
Slack `#bens-cos` every weekday at about 3am Central, researches each one live,
and steers itself from Ben's emoji reactions.

There is no code to run here. The routine is a prompt (below) plus a Slack
canvas that acts as its memory. This folder is the source of truth for both, so
changes can be reviewed and versioned like anything else in the repo.

| File | What it is |
| --- | --- |
| `ROUTINE_PROMPT.md` | The exact prompt the routine runs. Edit here, then ask Claude to update the routine (or paste it into the routine's settings). |
| `page/weekend-ideas.html` | Source of the Weekend Ideas page (a Claude artifact with a database). Republish it from Claude to change the page. |
| `MEMORY_SEED.md` | The initial content of the "Business Generator Memory" canvas in `#bens-cos` (canvas `F0C4ZNH0D46`). The routine maintains the live canvas itself after this. |

## How it runs

The routine wakes a Claude Code session each weekday morning, reads its memory
and Ben's votes from the Weekend Ideas page's database, researches with web
search, and writes the day's three ideas and a run record back to that
database in a single batch. Nothing is posted to Slack or email, and nothing
is written to the repo during a run.

The page: https://claude.ai/artifact/AoqzugAYh7DPGLzPxSr2sY (private; its
source is `page/weekend-ideas.html` in this folder). Routine ID
`trig_01GSfVMJ8J9pBAsiqxbmA8YN`, bound to session
`session_014ESx8JmD6MasqSHw7qRaTM`.

## Schedule

`CRON_TZ=America/Chicago 57 2 * * 1-5` — Monday to Friday at 2:57am Central.
Daylight saving is handled by the time zone in the cron expression.

## What you get each morning

The page shows the latest run on top: three ideas, best first, each with who
pays, the price, the arithmetic to $100k, the net margin, why it fits in a
weekend, named competitors with prices, the biggest risk, and a score, plus
three expandable sections: the evidence with links, the Saturday/Sunday plan
with the first Claude Code prompt to paste and a setup checklist for every
tool, and the budget plus the first-ten-customers plan with the actual post
text. Earlier days are one click away, and a table at the bottom lists every
idea ever proposed with your call on it.

## How to steer it

On any idea, click one button. Only the owner's clicks count.

| Button | What the routine does next run |
| --- | --- |
| Interested | Biases toward that niche and model |
| Build it | Writes a full hour-by-hour Weekend Build Kit into that idea, with every account to create and every Claude Code prompt to paste |
| Not this | Avoids it; two rejections on the same niche or model retire it |
| Tell me more | Writes a follow-up into that idea with deeper evidence and a clearer plan |

Type anything into an idea's note box and the routine reads it. The
"Standing instructions" box at the bottom of the page holds rules applied
every run, such as "ignore the variety rule" or "only B2B for two weeks".

## Rules the ideas must pass

Buildable by Claude Code in one weekend with Ben doing accounts and copy;
under $500 to launch; first ten customers from cold channels; not in a
regulated industry; at least 50% net margin; arithmetic that reaches $100k
gross in twelve months; not a repeat; and real demand evidence found by search
that morning.
