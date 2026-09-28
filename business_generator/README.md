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
| `MEMORY_SEED.md` | The initial content of the "Business Generator Memory" canvas in `#bens-cos` (canvas `F0C4ZNH0D46`). The routine maintains the live canvas itself after this. |

## How it runs

The routine wakes the Claude Code session that built it (the session holds the
Slack connector; routines that spawn a fresh session get no connectors in this
workspace and cannot post). Each run reads the memory canvas, researches with
web search, posts to Slack, and updates the canvas. Nothing is written to the
repo during a run.

Routine ID `trig_01GSfVMJ8J9pBAsiqxbmA8YN`, bound to Claude Code session
`session_014ESx8JmD6MasqSHw7qRaTM`. To pause, resume, or change the schedule,
ask Claude in that session or use the Routines page on claude.ai.

## Schedule

`CRON_TZ=America/Chicago 57 2 * * 1-5` — Monday to Friday at 2:57am Central
(a few minutes before 3 so it isn't queued behind the on-the-hour crowd).
Daylight saving is handled by the time zone in the cron expression.

## What you get each morning

Three cards in `#bens-cos`, best first. Each card carries the idea, who pays,
the price, the arithmetic to $100k, the net margin, why it fits in a weekend,
two demand links, named competitors with prices, the biggest risk, and a score.
Each card's thread has three replies: the evidence, the Saturday/Sunday plan
with the first Claude Code prompt to paste, and the budget plus the
first-ten-customers plan with the actual post text.

A short summary message follows the three cards.

## How to steer it

React on a card (only Ben's reactions count):

| Reaction | Meaning | What the routine does |
| --- | --- | --- |
| :+1: | interested | Biases toward that niche and model, posts adjacent angles in the thread |
| :fire: | build it | Posts a full hour-by-hour Weekend Build Kit in the thread, with every account to create and every Claude Code prompt to paste |
| :-1: | not this | Avoids it; two thumbs-down on the same model or niche retires it |
| :question: | tell me more | Deeper evidence and a clearer plan in the thread |
| :eyes: | go deeper on demand | A demand deep-dive in the thread |

Reply in a card's thread with free text and the routine will honor and answer
it. Post a top-level message starting with `BG:` for a standing instruction
(for example `BG: no more Chrome extensions` or `BG: only B2B for the next two
weeks`). Everything it infers is written to the memory canvas with a date.

## Rules the ideas must pass

Buildable by Claude Code in one weekend with Ben doing accounts and copy;
under $500 to launch; first ten customers from cold channels; not in a
regulated industry; at least 50% net margin; arithmetic that reaches $100k
gross in twelve months; not a repeat; and real demand evidence found by search
that morning.
