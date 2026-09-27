# SAT Practice

Practice with **every question in the College Board SAT Suite Question Bank** (about 3,800 questions across all seven
difficulty bands), take **adaptive mock tests**, and sit the **official College Board practice tests** with real timing
and official scoring.

**Open it in any browser, phone included:** **https://bengreff.github.io/sat-practice/**

Or install the local app (saves progress to a file and fetches the official test PDFs automatically):

| System | Run this |
|---|---|
| macOS / Linux (Terminal) | `curl -fsSL https://raw.githubusercontent.com/bengreff/sat-practice/main/install.sh \| bash` |
| Windows (PowerShell) | `irm https://raw.githubusercontent.com/bengreff/sat-practice/main/install.ps1 \| iex` |

The installer puts the app in `~/SATPractice`, adds a desktop launcher, and starts it. Running it again updates
the app without touching your progress. Python 3.8+ is required (the Windows installer installs it if missing).

## Features

**Practice**
- Random questions from a pool you define: sections, difficulty bands 1–7, domains and skills (each with a focus
  weight), and status: never answered, missed before, always right, flagged.
- Cap how many times each question can repeat; least-asked questions come first.
- Instant checking with the correct answer and the College Board's explanation; notes on every attempt; flags.
- Presets: hardest only (band 7), hard (6–7), all bands, mistakes and flags, unseen only.
- Grid-in answers are checked the way the SAT checks them (equivalent fractions and decimals, truncated or rounded
  decimals that fill every answer slot).

**Tests**
- *Adaptive practice tests* assembled from the bank in the digital SAT format: Reading and Writing (2 × 27 questions,
  32 min each) and Math (2 × 22, 35 min each), with a harder or easier second module depending on the first.
- *Official practice tests 4–11*: the College Board's released tests, shown page by page next to an answer sheet,
  timed like the paper format (39 / 43 minutes per module), and scored with each test's own answer key and
  raw-to-scaled conversion table.
- Test-day tools: Desmos graphing calculator, math reference sheet, mark for review, answer elimination, question
  navigator, timers that survive reloads, a 10-minute break, save-and-resume.

**Stats**
- Accuracy, streaks, time per question, estimated section and total scores.
- Charts of accuracy by difficulty band, accuracy over time, and time per question over time.
- Accuracy and coverage by section, domain and skill; weakest skills; history of every test.

**Plan**
- Enter a score report (section scores plus the Knowledge and Skills domain bars) and get a suggested practice
  configuration you can apply with one click.

**Data**
- Export and import progress files to move between devices (imports merge; nothing is lost).
- Export and import the downloaded questions so another device doesn't need to download them again.

## Where the content comes from

This repository contains **code only**. No question text is stored here.

- **Questions** are downloaded on each device from the College Board's public
  [SAT Suite Question Bank](https://satsuitequestionbank.collegeboard.org/). The College Board limits request rates,
  so the first full download takes about 20 minutes. You can practice while it runs, and the hardest questions
  arrive first.
- **Official practice tests** are the PDFs the College Board publishes at
  [satsuite.collegeboard.org](https://satsuite.collegeboard.org/practice/practice-tests/paper). The local app downloads
  them for you. In the web version the College Board's site doesn't allow the download, so you download the PDF
  once and choose it in the app.
- `data/official-tests.json` holds, per official test, the page ranges of each module, the answer key and the score
  conversion table. `tools/extract_official.py` rebuilds it from the PDFs and cross-checks every multiple-choice key
  against the answer-explanation PDFs.

## Scores

Official practice tests are scored with their own conversion tables. Everything else is an **estimate**:
adaptive-test and practice-based scores use the average of the official conversion tables, and the difficulty mix of
each module and the routing threshold are informed guesses (the College Board doesn't publish them).

## Running from a clone

```
git clone https://github.com/bengreff/sat-practice && cd sat-practice && python3 server.py
```

Progress is kept in `progress.json` (merged on every save, backed up to `backups/` on each start and reset).
The app itself is plain HTML, CSS and JavaScript modules with no build step; `server.py` uses only the Python
standard library.

## Disclaimer

Not affiliated with or endorsed by College Board. SAT is a registered trademark of College Board. Questions, tests,
answer keys and conversion tables belong to College Board. Code is MIT licensed.
