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

To move the routine to the claude.ai Routines page: New routine → paste the
full text of `ROUTINE_PROMPT.md` as the prompt → schedule Monday–Friday at
2:57am America/Chicago → attach the Slack connector → save. Then delete the
session-bound routine so it does not fire twice.

## How it runs

The routine runs on a schedule with the Slack connector attached. Each run
reads the memory canvas, researches with web search, makes exactly three
Slack writes (one canvas with the full write-ups, one short companion
message, one memory-canvas update), and ends. Nothing is written to the repo
during a run. Three writes means at most three approval prompts if the
routine runs in an attended session; a routine created from the claude.ai
Routines page runs unattended and prompts for nothing.

Routine ID `trig_01GSfVMJ8J9pBAsiqxbmA8YN` (bound to Claude Code session
`session_014ESx8JmD6MasqSHw7qRaTM`) until it is recreated from the Routines
page. To pause, resume, or change the schedule, use that page or ask Claude.

## Schedule

`CRON_TZ=America/Chicago 57 2 * * 1-5` — Monday to Friday at 2:57am Central
(a few minutes before 3 so it isn't queued behind the on-the-hour crowd).
Daylight saving is handled by the time zone in the cron expression.

## What you get each morning

One canvas titled "Weekend Ideas — date" in `#bens-cos` with three ideas,
best first. Each idea carries who pays, the price, the arithmetic to $100k,
the net margin, why it fits in a weekend, named competitors with prices, the
biggest risk, and a score, followed by three sections: the evidence with
links, the Saturday/Sunday plan with the first Claude Code prompt to paste
and a setup checklist for every tool, and the budget plus the
first-ten-customers plan with the actual post text.

A short companion message lists the three headlines, links the canvas, says
what steering was applied, and carries the steering legend.

## How to steer it

React on the companion message (only Ben's reactions count):

| Reaction | Meaning | What the routine does |
| --- | --- | --- |
| 1️⃣ 2️⃣ 3️⃣ | interested in that idea | Biases toward that niche and model |
| 🔥 | build it | Posts a full hour-by-hour Weekend Build Kit in the thread for idea 1, or for the idea named in a reply such as "build 2" |
| 👎 | none of these | Avoids all three; two days running on the same model or niche retires it |
| ❓ | tell me more | Deeper evidence and a clearer plan in the thread next run |

Reply in the companion message's thread with free text ("build 3", "more on
2", "no more EOS ideas") and the routine will honor and answer it. Post a
top-level message starting with `BG:` for a standing instruction (for example
`BG: ignore the variety rule` or `BG: only B2B for two weeks`). Everything it
infers is written to the memory canvas with a date.

## Rules the ideas must pass

Buildable by Claude Code in one weekend with Ben doing accounts and copy;
under $500 to launch; first ten customers from cold channels; not in a
regulated industry; at least 50% net margin; arithmetic that reaches $100k
gross in twelve months; not a repeat; and real demand evidence found by search
that morning.
