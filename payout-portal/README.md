# Team payout portal

Apps Script web app that shows each teammate only their own payout lines from the
restricted master sheet. It runs as the sheet owner, identifies the viewer by
Workspace email, and returns only that person's rows. Embed it in a Google Site.

## Setup (about 10 minutes)

1. **Team tab.** In the master sheet add a tab named `Team` with headers `Name | Email`
   and one row per person. Names must match the names used in column A of the payout
   tabs and in the F1:M1 summary header (Max, Ben, David, Danica, Chris, Naomi, Brittany).
2. **Script project.** Go to script.google.com > New project. Paste `Code.gs`; add an HTML
   file named `Index` and paste `Index.html`. Project Settings > tick "Show appsscript.json"
   and paste `appsscript.json`.
3. **Config.** In `Code.gs` set `SHEET_ID` (the long ID in the sheet URL) and `ADMIN_EMAILS`.
4. **Deploy.** Deploy > New deployment > Web app. Execute as: **Me**. Who has access:
   **Anyone within your domain**. Authorize when prompted.
5. **Site.** In Google Sites: Insert > Embed > By URL, paste the web app URL (`.../exec`).
   Publish the site restricted to your domain (or the 7 people).
6. **Test.** Open as yourself, use "View as" to check each teammate, then have one teammate
   confirm they see only their own numbers and no "View as" control.

## Monthly use

Add a new tab named `YYYYMMDD Retainer/variable payout` (copy last month's). It appears in
the period picker automatically. Tabs like "Ben version ..." and "AI Lab payout ..." are ignored.

## How numbers are computed

- Per-client lines: each person's row inside a `<Client> - Retainer` block; basis is the
  retainer plus any `Variable` amount, % and payout are read straight from columns C and D.
- Total: the sheet's own per-person total (row 2, columns F:M).
- "Other / adjustments" = sheet total minus the per-client lines. It appears only when they differ.
- Clawbacks: a negative payout in a block shows as a negative line.

## Tests

`node test.cjs` runs the parser against a synthetic grid. It contains no real figures.

## Not yet covered

- The `AI Lab payout` tab (different layout with owed/paid columns).
- Blocks with no `Client - Retainer` label show as "Unnamed client N" once they have a payout.
