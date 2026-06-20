// ─────────────────────────────────────────────────────────────────────────────
//  MH — Mo's Agentic Training Coach · Node.js / Express / Railway
// ─────────────────────────────────────────────────────────────────────────────
import express from 'express';
import cron from 'node-cron';

const app  = express();
app.use(express.json());

// ─── ENV ─────────────────────────────────────────────────────────────────────
const E = {
  ANTHROPIC_API_KEY:    process.env.ANTHROPIC_API_KEY,
  TELEGRAM_BOT_TOKEN:   process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID:     process.env.TELEGRAM_CHAT_ID,
  STRAVA_CLIENT_ID:     process.env.STRAVA_CLIENT_ID,
  STRAVA_CLIENT_SECRET: process.env.STRAVA_CLIENT_SECRET,
  STRAVA_REFRESH_TOKEN: process.env.STRAVA_REFRESH_TOKEN,
  STRAVA_VERIFY_TOKEN:  process.env.STRAVA_VERIFY_TOKEN,
  OURA_TOKEN:           process.env.OURA_TOKEN,
  HEVY_API_KEY:         process.env.HEVY_API_KEY,
  ATHLETE_ID:           process.env.ATHLETE_ID,
  INTERVALS_API_KEY:    process.env.INTERVALS_API_KEY,
  TEST_SECRET:          process.env.TEST_SECRET,
};

// ─── STATE (in-memory, resets on restart — fine for a single-user bot) ───────
const conversationHistory = []; // last 10 text turns
let   athleteProfile      = {}; // live profile overrides

// ─── ACTION VERB DETECTION ───────────────────────────────────────────────────
const ACTION_VERBS = /^(what|how|when|why|where|who|can|could|should|will|would|do|did|does|is|are|show|give|tell|check|pull|analyse|analyze|update|push|delete|add|remind|fetch|get|run|build|create|list|remove|cut|swap|replace|change|fix|drop|move|set|bump|hold|scale|clear|cancel|ignore|forget|send|plan|review|help|find|search|compare|log|start|stop|schedule|which|any|calculate|predict|estimate|was|were)/i;

// ─── SYSTEM PROMPT ───────────────────────────────────────────────────────────
const BASE_SYSTEM_PROMPT = `You are MH — Mo's autonomous training coach. You live in Telegram. Calm, precise, direct. Protective of long-term progress over short-term heroics.

━━━ BEHAVIORAL RULES ━━━

1. PLAIN STATEMENT (no question, no action): 1–2 sentences acknowledgment only. Call ZERO tools. Examples: "blister is healing", "skipped today", "feeling tired", "done". The statement is not an implicit question about anything.

2. ANSWER SCOPE = QUESTION SCOPE. One question = one data source = one answer. Call ONLY the tool that directly answers what was asked. Nothing else.
   - "what did I lift" / "last session" / "last gym" → get_hevy_workouts ONLY. No readiness. No CTL.
   - "what's my CTL" / "fitness" / "load" → get_intervals_wellness ONLY. No sleep. No gym.
   - "how's my recovery" / "readiness" → get_oura_readiness ONLY. No CTL. No Strava.
   - "last run" / "what did I run" → get_strava_activities ONLY. No readiness. No gym.
   - Never call more than one data source unless the question explicitly asks for multiple things (e.g. "compare my sleep and CTL").

3. SILENT REASONING. Never output "wait", "actually", "let me recalculate", or any retraction. Reason silently. Output the conclusion only.

4. HISTORY IS CONTEXT, NOT A QUEUE. Conversation history provides facts. Each new message is the only question. Do not reopen previous topics.

5. CLOSED TOPICS. If Mo says "stop asking about X" — drop it permanently for this conversation.

6. ONE FOLLOW-UP QUESTION MAX. Only when genuinely needed to act. Never ask what the data already answers.

7. ALWAYS "you" — never "Mo" or "he."

8. NO PREAMBLE. First word of response = first word of the answer.

9. NEVER mention weather unless temperature is in the actual Strava activity data.

━━━ ATHLETE PROFILE ━━━
Name: Mo · Beirut · 74kg · 8+ years running · zero injury history

Goal: Beirut Marathon · Nov 29 2026 · sub-3:30 (4:58/km) · stretch: sub-3:15
Target CTL: 65 by race week

Race history:
- Florence Nov 30 2025: 3:57:57 (5:33/km, 153bpm) — conservative, had 3:40 in him
- Madrid Apr 26 2026: 4:11:53 (5:56/km, 144bpm, 365m elevation) — wall at km 28 from elevation, not fitness
- Aquathlon relay Jun 14 2026: 5K in 23:21 (4:42/km, 163bpm) — C-race, heat-adjusted VDOT ~44–45

PRs: 5K <22:00 | 10K <46:00 | HM <1:50 | Marathon 3:57:57

━━━ PHYSIOLOGY ━━━
HR zones (LTHR-based, field test pending late June):
- Z2 easy: below 160bpm — fully conversational
- Tempo/sub-threshold: 160–170bpm
- Threshold Z4: 170–178bpm
- VO2max Z5: above 178bpm
VT1: 160–162bpm | LTHR estimate: 172–178bpm | Max HR: ~194–196bpm | RHR: ~57–58bpm

Training targets — HR is always primary, pace is reference only (pace shifts with heat, fatigue, elevation):
- Easy/recovery: HR < 158bpm · ~5:24–5:53/km at 15°C
- Long run: HR < 155bpm · ~5:24–5:40/km at 15°C
- Z3 Tempo (sustained 20–45min): HR 160–170bpm · ~5:05–5:24/km at 15°C. Comfortably hard — can force a sentence, not hold a conversation. Lower cost, higher volume potential. Aerobic ceiling builder.
- Z4 Threshold intervals (8–12min reps, 3min jog recovery): HR 170–178bpm · ~4:42–4:50/km at 15°C. Right at lactate balance point. 4:42/km is anchored to Jun 14 aquathlon (5K in 23:21 at near-maximal effort on zero sleep) — confirmed LT ceiling, not a guess.
- VO2max intervals (3–5min reps, full recovery): HR > 178bpm · ~4:19–4:30/km at 15°C
- Marathon pace: HR ~162–168bpm · 4:58/km at 15°C

RULE: Every run prescription must state the HR target first. Pace is always listed as "~X/km at 15°C — will be slower in heat." Never prescribe pace without HR.

THRESHOLD BAILOUT RULE: Always include this in any threshold prescription — "If HR hits 178+ by the midpoint of rep 1, drop to 4:50–5:00/km and treat it as tempo. The session is still useful."

FATIGUE CHECK FOR QUALITY SESSIONS: Always check recovery before prescribing threshold or VO2max. Threshold on a sleep score below 60 or TSB clearly negative → downgrade to Z3 tempo or skip entirely. State the reason explicitly.

HEAT ADJUSTMENT (Beirut summer, apparent temp > 25°C):
- Easy run: HR < 158bpm. Pace will be 5:40–6:15/km or slower — correct.
- Midday (10:00–17:00) + apparent temp > 25°C: HR < 155bpm. Flag: "best window is after 6pm."
- Long run: HR < 155bpm. Cap at 90 min regardless of planned distance above 28°C — after 90min thermal load exceeds aerobic benefit. If that means 14km instead of 18km, that's the run.
- Threshold/quality: delay to before 7am or cancel if apparent temp > 30°C.
- Pace shift: add 10–15 sec/km per 5°C above 25°C. At 30°C, threshold pace becomes ~4:52–5:00/km for the same HR. HR leads — pace follows. Never prescribe pace without noting "~X/km at 15°C — expect ~Y/km at [temp]°C."
- Always call get_weather before prescribing any outdoor run target in summer.
- Note: training in Beirut heat builds plasma volume and heat tolerance — don't avoid it. Execute correctly (HR-led, water access for runs >45min).

GPS NOTE: Intervals Pro sets trainer=true for ALL structured workouts, including outdoor runs. Do NOT label a run "treadmill" based on trainer=true alone.
- Mo stated outdoors → "GPS data unavailable — Intervals Pro issue. HR analysis only." One sentence, move on.
- Mo stated treadmill → label it. One word.
- Unknown → ask once: "Treadmill or outdoors?"

━━━ QUALITY SESSION DECISION TREE (Wednesday) ━━━
Evaluate in this exact order — stop when you hit a disqualifier:

1. READINESS GATE: If Oura readiness verdict is "easy" or "rest" that morning → downgrade to Z2 regardless of anything else.
2. SPACING GATE: Hard minimum 48h between threshold-or-harder efforts. If last hard session was <48h ago → push one day or drop to Z2.
3. STIMULUS ROTATION: Never repeat the same session type 3 Wednesdays in a row. Rotation: threshold (8–12min reps) → cruise intervals (shorter, denser) → race-pace 1km reps at 10K effort → VO2max (3–4min reps) → back to threshold. Current build (Beirut Marathon) leans threshold + race-pace because that's what Nov 29 demands.
4. PHASE OF BUILD:
   - Phase 1 (now – early Aug): threshold or race-pace only. VO2max too costly.
   - Phase 2 (Aug–Sep): any quality type. Spinneys 5K Sep 6 = calibration.
   - Phase 3 (Oct – early Nov): race-specific. 1km reps at projected 10K pace (~4:25–4:35/km) or threshold reps at 4:42–4:50/km.
   - ≤14 days to race: sharpener or strides only — no full quality session.
5. VOLUME CONTEXT: If long run preceded this session <48h and legs are likely heavy → shorten rep count but hold pace. Never widen the pace band.

CTL tiers (used as baseline — decision tree above takes priority):
- CTL < 20: Threshold 2×10min @ 4:42–4:50/km, 3min jog, 10min warm/cool
- CTL 20–35: Threshold 3×10min @ 4:42–4:50/km, 3min jog
- CTL 35–50: Rotate threshold / cruise intervals / tempo
- CTL ≥ 50: VO2max 5×3min @ 4:19–4:30/km, full recovery
- Readiness <70: downgrade one tier. Readiness <60: Z2 only.

━━━ HARD LIMITS ━━━
These override everything including Mo's request:
- Readiness <40 → no threshold, full stop. Easy only.
- TSB ≤ -20 → flag it. TSB ≤ -30 → Z2 max until recovery.
- 3 consecutive nights sleep <5.5h → Z2 only until sleep recovers.
- Active injury signal (HR not responding normally to pace, pain on target limb) → threshold off until resolved.
Note: high ATL alone is NOT a hard cap. ATL 28 + HRV balance 88 + RHR score 98 = body handling it. The combination of ATL + recovery signals matters, not ATL in isolation.

━━━ WEEKLY STRUCTURE ━━━
Mon: REST
Tue: Upper gym (Upper A or B — whichever NOT done most recently)
Wed: Quality run (tempo / interval / progression — rotate stimulus)
Thu: Deadlift + Arms + easy run
Fri: Lower gym (Lower A or B — whichever NOT done most recently)
Sat: Boxing + easy run
Sun: Long run

Runs: 4/week (Wed quality + Thu easy + Sat easy + Sun long)
80/20 polarised: ~80% easy (< 160bpm), ~20% quality

Thursday note: Deadlift day is always the "good enough" session — between Wed quality run and Fri gym. Working weight only. Never expect PRs.
After Lower A/B with heavy compound lifts (BSS, sumo deadlift, hip thrusts): next day is Z2 only regardless of plan — no quality. Lower gym fatigue takes 24–48h to clear.

━━━ LONG RUN PROGRESSION ━━━
Anchor: time-on-feet and build phase — not CTL.
- Add ~2km every 2 weeks. Cutback (~20%) every 3rd or 4th week.
- Long run cap: never >35% of weekly volume. At 35–40km/week → 15km max. At 50km/week → 18km. At 65km/week → 22–23km.
- Peak long run: 30–32km, reached ~4 weeks before race day (approximately Nov 1).
- Rate cap: +10% max per week on total running volume (Nielsen et al.). Never increase volume AND add a new session type in the same week.

Phase 1 (now – early Aug): Long run is pure Z2. No MP segments. Building time-on-feet, aerobic base, leg durability.
Phase 2 (Aug–Sep): Long run starts incorporating MP segments. Structure: 10km easy → 8–10km at 4:58/km → 2km cooldown. Spinneys 5K Sep 6 recalibrates VDOT and sharpens MP target.
Phase 3 (Oct – early Nov): 20–25km at marathon pace within the long run. Taper begins ~Nov 8 (3 weeks out). Last truly long specific run ~Nov 1–8.

━━━ BEIRUT MARATHON BUILD — 23 WEEKS ━━━
Race: Nov 29 2026. Target: sub-3:30 (4:58/km). Stretch: sub-3:15.
Weeks 1–6 (now – early Aug): 4 runs/week, long run 15–22km, one quality/week, no MP work. Goal: consistent 45km/week injury-free.
Weeks 7–12 (Aug–Sep): 4–5 runs/week, long run 22–28km, two quality sessions once volume stable, MP segments begin.
Weeks 13–18 (Oct – mid-Nov): specific phase. Long run peaks 30–32km with MP. Two quality sessions: one threshold/cruise, one MP-specific long effort. Peak weekly volume ~55–65km.
Weeks 19–21 (mid–late Nov): taper. Week 19: −40% volume. Week 20: −20%. Race week: easy + one short sharpener. Intensity retained throughout.
Peak week (approx week 16, early Nov): Sun 30–32km with 18–20km at MP. Wed 12–14km threshold. Mon easy 8–10km. Total ~60–65km.

━━━ GYM TEMPLATES ━━━
Upper A (9): Bench Press (Barbell) | Lat Pulldowns | Shoulder Press (DB) | Cable Flyes | V-Grip Seated Rows | Lateral Raises | Rear Delt Flyes | Triceps Pushdowns | DB Bicep Curls

Upper B (8): DB Incline Press | Pull-ups (band) | Overhead Press (Barbell) | Bent Over Row | Face Pulls | DB Lateral Raises | Triceps Pushdowns | DB Bicep Curls

Lower A (8 — quad/unilateral): Goblet Squats | Single-Leg RDL | DB Step Ups | Standing Cable Glute Kickbacks | Leg Extensions | Nordic Hamstring Curls | Single-Leg Calf Raises | Copenhagen Planks (3×30s/side)

Lower B (8 — posterior chain): Bulgarian Split Squats | Barbell Hip Thrusts | Single-Leg RDL | Nordic Hamstring Curls | Standing Cable Glute Kickbacks | Single-Leg Calf Raises | Banded Clamshells | Copenhagen Planks (3×30s/side)

Deadlift + Arms: Deadlift | Triceps Rope Pushdown | DB Bicep Curl | Hammer Curl | Overhead Triceps Extension

Template flexibility: Mo may swap, omit, or substitute any exercise session to session. Accept what was logged — only flag genuine redundancy or safety concern.

TEMPLATE EDITS: If Mo says "cut X", "add X to routine", "remove X", "swap X for Y" → call get_hevy_routines then update_hevy_routine. Confirm in 1 sentence ("Done — X removed from Lower A."). No other output.

━━━ STRENGTH PROGRESSION ━━━
BUMP: all working sets hit target rep range with good form → bump next session
HOLD: any working set missed rep floor, or large weight jump with significant fade, or modified session
SCALE BACK: form breakdown or pain, or 2+ consecutive sessions with multi-set rep drops → −2.5kg

Increments:
- Deadlift: +5kg (at 80kg+) | Goblet squat: +2.5kg | Hip thrust: +2.5kg
- Unilateral (BSS, single-leg RDL, step-up): +2.5kg only
- Upper compounds (bench, row, shoulder press): +2.5kg
- Upper isolation (lateral raise, fly, face pull, arms): +1.25–2.5kg
- Bodyweight (pull-ups, Nordics, Copenhagen): reduce assistance or add reps — never add load
Warmup sets (~50% working weight) are NOT working sets — ignore for progression.

━━━ SHOE ROTATION ━━━
- ASICS Superblast 2 (~312km): daily trainer — easy runs, long runs, recovery
- NB SC Trainer v3 (~277km): carbon super trainer — quality, threshold, VO2max
- Adidas Adios Pro 4 (~140km): marathon race shoe — MP blocks, tune-up races
- Nike Alphafly 3 (~63km): alternative race shoe — needs 50–60km break-in
- Nike Vomero Plus (~107km): max cushion — heavy legs, recovery
- Adidas Evo SL (~40km): speed/tempo — hold until blister fully resolved
- Nike Pegasus Trail 5 GTX (0km): trail/wet only
- Nike Vaporfly 3: RETIRED — caused blister Jun 3. Never recommend.

━━━ WARMUP / COOLDOWN ━━━
Easy run: first 5–10 min IS the warmup. No structured warmup.
Threshold: 10–15 min easy jog + 4–6 dynamic drills before reps. 5–10 min easy jog cooldown.
Long run: first 2–3km IS the warmup. Start slow end of Z2, let body open up.
Lower gym: 5 min joint mobility + one warmup set at ~50%.
Upper gym: 5 min mobility + one warmup set at ~50%.

━━━ DATA TOOLS — WHEN TO USE WHAT ━━━
- Run question / activity → get_strava_activities or get_strava_activity_detail
- Fitness / CTL / load → get_intervals_wellness
- Planned sessions → get_intervals_planned_workouts
- Recovery / sleep / HRV → get_oura_readiness + get_oura_sleep
- Gym sessions → get_hevy_workouts | Routine structure → get_hevy_routines
- Weather → get_weather (always before outdoor run prescription in summer)
- Profile → get_profile
- Plain statement (no question, no action) → ZERO TOOLS

━━━ POST-ACTIVITY FORMAT ━━━
Fires automatically when Strava syncs. Under 120 words. No bold headers. Address as "you".
Structure: [type + distance + brief context] → [2–3 sentences: key metrics, what they mean, one forward note]
No race projections unless asked. No shoe rules. No follow-up questions.

━━━ MORNING BRIEF FORMAT ━━━
Runs automatically every morning. Scannable in 15 seconds.
1. READINESS: 🟢 GREEN / 🟡 AMBER / 🔴 RED — two numbers that decided it
2. TODAY: session in one line (type · distance · target HR or pace)
3. WHY: one sentence
4. CHANGED: what differs from scheduled plan, or "no change"
5. WEEK: updated day-by-day skeleton ONLY if something shifted
6. FLAG: one line only if genuinely needed — else omit entirely

Decision rules — evaluate ALL signals, combine them:
🟢 GREEN (train as prescribed): readiness ≥75 AND HRV balance ≥85 AND RHR score ≥90 AND sleep ≥6.5h AND TSB between -10 and +5 AND no injury signal.
🟡 AMBER (proceed with modification): readiness 55–74 OR HRV balance 70–84 OR sleep 5–6.5h OR TSB -20 to -10. Action: drop one rep from quality sessions, cap long run at 75% of planned distance, keep easy HR ≤160bpm. State the modification and why.
🔴 RED (Z2 or rest only): readiness <55 OR HRV balance <70 OR sleep <5h for 2+ consecutive nights OR TSB <-20 OR RHR 5+bpm above 7-day baseline. → Replace today with easy run or rest. Protect next quality session.
One RED metric alone → AMBER, not RED. Two or more RED metrics same morning → quality session does not happen.
- Never two hard sessions back-to-back.
- Protect the long run — move before cutting. Never cut two long runs in a row.

━━━ WEEKLY PLAN FORMAT ━━━
Output starts with 📅, nothing before it.
📅 *Week of [Mon date]*
Readiness: [score] | CTL: [value] | ATL: [value]
*Mon MM-DD* – Rest
*Tue MM-DD* – [Upper A or B] (gym)
*Wed MM-DD* – ⚡ [quality session + structure] ✅ Intervals
*Thu MM-DD* – Deadlift + Arms + easy run
*Fri MM-DD* – [Lower A or B] (gym)
*Sat MM-DD* – Boxing + easy run
*Sun MM-DD* – Long run
[One readiness note only if score < 70. Omit otherwise.]

━━━ STRENGTH CHECK FORMAT ━━━
Start with "Here's your". Nothing before it.
One block per routine. Previous vs current weights. BUMP/HOLD verdict per exercise.
End with: ✅ Hevy updated: [changes] OR ✅ No changes needed.`;

function buildSystemPrompt() {
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const now      = new Date();
  const dateStr  = now.toISOString().slice(0, 10);
  const dayName  = dayNames[now.getDay()];
  let prompt     = `TODAY: ${dateStr} (${dayName})\n\n${BASE_SYSTEM_PROMPT}`;
  const keys     = Object.keys(athleteProfile);
  if (keys.length) {
    const overrides = keys.map(k =>
      `  ${k}: ${athleteProfile[k].value} (updated ${athleteProfile[k].updated} via ${athleteProfile[k].source})`
    ).join('\n');
    prompt += `\n\n━━━ LIVE PROFILE UPDATES (override defaults above) ━━━\n${overrides}`;
  }
  return prompt;
}

// ─── TOOLS ───────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'get_strava_activities',
    description: 'List recent Strava activities. Use for training overview, weekly load, recent runs.',
    input_schema: {
      type: 'object',
      properties: {
        per_page: { type: 'integer', description: 'Number of activities (max 30)', default: 15 },
        after:    { type: 'integer', description: 'Unix timestamp lower bound' },
        before:   { type: 'integer', description: 'Unix timestamp upper bound' },
      },
    },
  },
  {
    name: 'get_strava_activities_for_date',
    description: 'Get Strava activities for a specific date.',
    input_schema: {
      type: 'object',
      required: ['date'],
      properties: {
        date:        { type: 'string',  description: 'YYYY-MM-DD' },
        days_window: { type: 'integer', description: 'Days either side (default 1)', default: 1 },
      },
    },
  },
  {
    name: 'get_strava_activity_detail',
    description: 'Full detail for one activity including laps, HR streams, pace per km. Use for post-run analysis.',
    input_schema: {
      type: 'object',
      required: ['activity_id'],
      properties: {
        activity_id: { type: 'string' },
      },
    },
  },
  {
    name: 'get_strava_athlete_stats',
    description: 'Overall Strava stats: total distance, runs, recent totals.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_strava_gear',
    description: 'Shoe list from Strava with distance logged.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_oura_readiness',
    description: 'Oura readiness scores: HRV, resting HR, sleep score, recovery index.',
    input_schema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'YYYY-MM-DD (default 7 days ago)' },
        end_date:   { type: 'string', description: 'YYYY-MM-DD (default today)' },
      },
    },
  },
  {
    name: 'get_oura_sleep',
    description: 'Oura sleep data: duration, stages, HRV, resting HR per night.',
    input_schema: {
      type: 'object',
      properties: {
        start_date: { type: 'string' },
        end_date:   { type: 'string' },
      },
    },
  },
  {
    name: 'get_hevy_workouts',
    description: 'Recent gym sessions from Hevy. Exercises, sets, reps, weight.',
    input_schema: {
      type: 'object',
      properties: {
        page:     { type: 'integer', default: 1 },
        pageSize: { type: 'integer', default: 10 },
      },
    },
  },
  {
    name: 'get_hevy_routines',
    description: 'Current Hevy routine templates with exercise names and weights. Always call before update_hevy_routine.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'update_hevy_routine',
    description: 'Update a Hevy routine — to bump/scale weights OR to add/remove/swap exercises when Mo requests it. Always call get_hevy_routines first to get the routine ID and current structure.',
    input_schema: {
      type: 'object',
      required: ['routineId', 'routine'],
      properties: {
        routineId: { type: 'string' },
        routine:   { type: 'object' },
      },
    },
  },
  {
    name: 'get_intervals_activities',
    description: 'Intervals.icu activity list with HR zone breakdown.',
    input_schema: {
      type: 'object',
      properties: {
        start: { type: 'string', description: 'YYYY-MM-DD' },
        end:   { type: 'string', description: 'YYYY-MM-DD' },
      },
    },
  },
  {
    name: 'get_intervals_wellness',
    description: 'CTL (fitness), ATL (fatigue), TSB (form) from Intervals.icu. Use for any fitness/load/Beirut target question.',
    input_schema: {
      type: 'object',
      properties: {
        start: { type: 'string' },
        end:   { type: 'string' },
      },
    },
  },
  {
    name: 'get_intervals_planned_workouts',
    description: 'Upcoming planned workouts from Intervals.icu calendar.',
    input_schema: {
      type: 'object',
      properties: {
        oldest: { type: 'string', description: 'YYYY-MM-DD' },
        newest: { type: 'string', description: 'YYYY-MM-DD' },
      },
    },
  },
  {
    name: 'create_planned_workout',
    description: 'Add a planned workout to Intervals.icu. Use for Wednesday quality run only during weekly plan.',
    input_schema: {
      type: 'object',
      required: ['date', 'name', 'type'],
      properties: {
        date:        { type: 'string' },
        name:        { type: 'string' },
        type:        { type: 'string' },
        description: { type: 'string' },
        moving_time: { type: 'integer' },
        distance:    { type: 'number' },
      },
    },
  },
  {
    name: 'delete_planned_workout',
    description: 'Delete a planned workout from Intervals.icu by event ID.',
    input_schema: {
      type: 'object',
      required: ['event_id'],
      properties: {
        event_id: { type: 'string' },
      },
    },
  },
  {
    name: 'get_weather',
    description: 'Current Beirut weather: apparent temperature, conditions. Always call before prescribing outdoor runs in summer.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_profile',
    description: 'Live athlete profile overrides: PRs, zone updates, coaching notes.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'update_profile',
    description: 'Update a field in the live athlete profile (after a PR, field test, or zone update).',
    input_schema: {
      type: 'object',
      required: ['key', 'value'],
      properties: {
        key:    { type: 'string' },
        value:  { type: 'string' },
        source: { type: 'string' },
      },
    },
  },
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function todayStr()    { return new Date().toISOString().slice(0, 10); }
function daysAgo(n)    { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }
function daysAhead(n)  { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
function intervalsAuth() { return 'Basic ' + Buffer.from(`API_KEY:${E.INTERVALS_API_KEY}`).toString('base64'); }

function calcPace(elapsed_time, distance) {
  if (!distance || distance < 10) return null;
  const sPerKm = elapsed_time / (distance / 1000);
  const mins = Math.floor(sPerKm / 60);
  const secs = Math.round(sPerKm % 60).toString().padStart(2, '0');
  return `${mins}:${secs}/km`;
}

function mapActivity(a) {
  return {
    id:              a.id,
    name:            a.name,
    type:            a.type,
    sport_type:      a.sport_type,
    date:            a.start_date_local?.slice(0, 10),
    start_time:      a.start_date_local,
    distance_km:     a.distance ? +(a.distance / 1000).toFixed(2) : null,
    moving_time_s:   a.moving_time,
    pace_min_per_km: calcPace(a.moving_time, a.distance),
    avg_hr:          a.average_heartrate,
    max_hr:          a.max_heartrate,
    elevation_m:     a.total_elevation_gain,
    trainer:         a.trainer,
  };
}

// ─── STRAVA AUTH ─────────────────────────────────────────────────────────────
async function getStravaToken() {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     E.STRAVA_CLIENT_ID,
      client_secret: E.STRAVA_CLIENT_SECRET,
      refresh_token: E.STRAVA_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Strava token refresh failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function stravaGet(path) {
  const token = await getStravaToken();
  const res   = await fetch(`https://www.strava.com/api/v3${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Strava API ${res.status}: ${path}`);
  return res.json();
}

// ─── TOOL EXECUTOR ───────────────────────────────────────────────────────────
async function executeTool(name, args) {
  switch (name) {

    case 'get_strava_activities': {
      const params = new URLSearchParams({ per_page: String(args.per_page || 15) });
      if (args.after)  params.set('after',  String(args.after));
      if (args.before) params.set('before', String(args.before));
      const acts = await stravaGet(`/athlete/activities?${params}`);
      return Array.isArray(acts) ? acts.map(mapActivity) : acts;
    }

    case 'get_strava_activities_for_date': {
      const t = Math.floor(new Date(args.date + 'T00:00:00Z').getTime() / 1000);
      const w = (args.days_window || 1) * 86400;
      const params = new URLSearchParams({ per_page: '30', after: String(t - w), before: String(t + w + 86400) });
      const acts = await stravaGet(`/athlete/activities?${params}`);
      return Array.isArray(acts) ? acts.map(mapActivity) : acts;
    }

    case 'get_strava_activity_detail': {
      const token = await getStravaToken();
      const [data, streamsData] = await Promise.all([
        fetch(`https://www.strava.com/api/v3/activities/${args.activity_id}`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then(r => r.json()),
        fetch(`https://www.strava.com/api/v3/activities/${args.activity_id}/streams?keys=heartrate,time`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then(r => r.json()),
      ]);
      const hrData = (Array.isArray(streamsData) ? streamsData.find(s => s.type === 'heartrate')?.data : null) || [];
      if (data.laps) {
        data.laps = data.laps.map(lap => {
          const startIdx = lap.start_index ?? 0;
          const endIdx   = lap.end_index   ?? startIdx;
          const lapHR    = hrData.slice(startIdx, endIdx + 1).filter(h => h > 0);
          return {
            ...lap,
            pace_min_per_km: calcPace(lap.elapsed_time, lap.distance),
            hr_avg: lapHR.length ? Math.round(lapHR.reduce((a, b) => a + b, 0) / lapHR.length) : null,
            hr_max: lapHR.length ? Math.max(...lapHR) : null,
            hr_drift: lapHR.length > 1 ? lapHR[lapHR.length - 1] - lapHR[0] : null,
          };
        });
      }
      if (data.splits_metric) {
        data.splits_metric = data.splits_metric.map(s => ({
          ...s,
          pace_min_per_km: calcPace(s.elapsed_time, s.distance),
        }));
      }
      for (const f of ['segment_efforts','best_efforts','map','photos','similar_activities',
                       'splits_imperial','athlete','embed_token','device_name','start_latlng',
                       'end_latlng','achievement_count','kudos_count','comment_count',
                       'pr_count','total_photo_count','has_kudoed','hide_from_home']) {
        delete data[f];
      }
      return data;
    }

    case 'get_strava_athlete_stats': {
      const athlete = await stravaGet('/athlete');
      return stravaGet(`/athletes/${athlete.id}/stats`);
    }

    case 'get_strava_gear': {
      const athlete = await stravaGet('/athlete');
      return { shoes: athlete.shoes || [] };
    }

    case 'get_oura_readiness': {
      const params = new URLSearchParams({
        start_date: args.start_date || daysAgo(7),
        end_date:   args.end_date   || todayStr(),
      });
      const res = await fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?${params}`, {
        headers: { Authorization: `Bearer ${E.OURA_TOKEN}` },
      });
      return res.json();
    }

    case 'get_oura_sleep': {
      const params = new URLSearchParams({
        start_date: args.start_date || daysAgo(7),
        end_date:   args.end_date   || todayStr(),
      });
      const headers = { Authorization: `Bearer ${E.OURA_TOKEN}` };
      const [scoreRes, timingRes] = await Promise.all([
        fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?${params}`,  { headers }),
        fetch(`https://api.ouraring.com/v2/usercollection/sleep?${params}`,        { headers }),
      ]);
      const [scores, timing] = await Promise.all([scoreRes.json(), timingRes.json()]);
      const longSessions = (timing.data || [])
        .filter(s => s.type !== 'short' && (s.total_sleep_duration || 0) > 10800)
        .map(s => ({
          day:                  s.day,
          total_sleep_s:        s.total_sleep_duration,
          deep_sleep_s:         s.deep_sleep_duration,
          rem_sleep_s:          s.rem_sleep_duration,
          average_hrv:          s.average_hrv,
          lowest_heart_rate:    s.lowest_heart_rate,
        }));
      return { daily_scores: scores.data || [], sleep_sessions: longSessions };
    }

    case 'get_hevy_workouts': {
      const res = await fetch(
        `https://api.hevyapp.com/v1/workouts?page=${args.page || 1}&pageSize=${Math.min(args.pageSize || 10, 10)}`,
        { headers: { 'api-key': E.HEVY_API_KEY } }
      );
      return res.json();
    }

    case 'get_hevy_routines': {
      const pages = await Promise.all([1, 2, 3].map(p =>
        fetch(`https://api.hevyapp.com/v1/routines?page=${p}&pageSize=10`, {
          headers: { 'api-key': E.HEVY_API_KEY },
        }).then(r => r.json())
      ));
      const all = pages.flatMap(p => p.routines || p || []);
      return { routines: all, total: all.length };
    }

    case 'update_hevy_routine': {
      const res = await fetch(`https://api.hevyapp.com/v1/routines/${args.routineId}`, {
        method:  'PUT',
        headers: { 'api-key': E.HEVY_API_KEY, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ routine: args.routine }),
      });
      if (!res.ok) {
        const err = await res.text().catch(() => 'unknown');
        throw new Error(`Hevy PUT ${res.status}: ${err}`);
      }
      return { success: true };
    }

    case 'get_intervals_activities': {
      const res = await fetch(
        `https://intervals.icu/api/v1/athlete/${E.ATHLETE_ID}/activities?start=${args.start || daysAgo(28)}&end=${args.end || todayStr()}&cols=id,start_date_local,type,moving_time,distance,icu_hr_zone_counts,average_heartrate,total_elevation_gain`,
        { headers: { Authorization: intervalsAuth() } }
      );
      return res.json();
    }

    case 'get_intervals_wellness': {
      const res = await fetch(
        `https://intervals.icu/api/v1/athlete/${E.ATHLETE_ID}/wellness?start=${args.start || daysAgo(28)}&end=${args.end || todayStr()}`,
        { headers: { Authorization: intervalsAuth() } }
      );
      return res.json();
    }

    case 'get_intervals_planned_workouts': {
      const params = new URLSearchParams({
        oldest: args.oldest || todayStr(),
        newest: args.newest || daysAhead(7),
      });
      const res = await fetch(
        `https://intervals.icu/api/v1/athlete/${E.ATHLETE_ID}/events?${params}`,
        { headers: { Authorization: intervalsAuth() } }
      );
      return res.json();
    }

    case 'create_planned_workout': {
      const body = {
        start_date_local: args.date + 'T06:00:00',
        type:             args.type || 'Run',
        name:             args.name,
        description:      args.description || '',
      };
      if (args.moving_time) body.moving_time = args.moving_time;
      if (args.distance)    body.distance    = args.distance;
      const res = await fetch(
        `https://intervals.icu/api/v1/athlete/${E.ATHLETE_ID}/events`,
        {
          method:  'POST',
          headers: { Authorization: intervalsAuth(), 'Content-Type': 'application/json' },
          body:    JSON.stringify(body),
        }
      );
      if (!res.ok) throw new Error(`Intervals POST ${res.status}`);
      return res.json();
    }

    case 'delete_planned_workout': {
      const res = await fetch(
        `https://intervals.icu/api/v1/athlete/${E.ATHLETE_ID}/events/${args.event_id}`,
        { method: 'DELETE', headers: { Authorization: intervalsAuth() } }
      );
      return { success: res.ok, status: res.status };
    }

    case 'get_weather': {
      const res = await fetch(
        'https://api.open-meteo.com/v1/forecast?latitude=33.8938&longitude=35.5018&current=temperature_2m,apparent_temperature,weathercode,windspeed_10m&timezone=Asia/Beirut'
      );
      const data = await res.json();
      const c    = data.current;
      return {
        temperature_c:          c.temperature_2m,
        apparent_temperature_c: c.apparent_temperature,
        windspeed_kmh:          c.windspeed_10m,
        weathercode:            c.weathercode,
        time_local:             c.time,
      };
    }

    case 'get_profile': {
      return Object.keys(athleteProfile).length ? athleteProfile : { note: 'no profile overrides set' };
    }

    case 'update_profile': {
      athleteProfile[args.key] = { value: args.value, source: args.source || 'user_update', updated: todayStr() };
      return { success: true, key: args.key, value: args.value };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── CLAUDE API ───────────────────────────────────────────────────────────────
async function callClaude(messages) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         E.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type':      'application/json',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      system: [{
        type:          'text',
        text:          buildSystemPrompt(),
        cache_control: { type: 'ephemeral' },
      }],
      tools:    TOOLS,
      messages,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Anthropic ${res.status}: ${JSON.stringify(err)}`);
  }
  return res.json();
}

// ─── AGENT LOOP ───────────────────────────────────────────────────────────────
async function runAgentLoop(userMessage, history = [], maxIters = 8) {
  const messages = [...history, { role: 'user', content: userMessage }];
  let response   = await callClaude(messages);
  let iters      = 0;

  while (response.stop_reason === 'tool_use') {
    if (++iters > maxIters) {
      return { text: '⚠️ Too many tool calls. Try rephrasing.', messages };
    }
    messages.push({ role: 'assistant', content: response.content });

    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      console.log(`[tool] ${block.name}`, JSON.stringify(block.input).slice(0, 120));
      try {
        const result = await executeTool(block.name, block.input);
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
      } catch (e) {
        console.error(`[tool error] ${block.name}:`, e.message);
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${e.message}`, is_error: true });
      }
    }

    messages.push({ role: 'user', content: toolResults });
    response = await callClaude(messages);
  }

  const text = response.content?.find(b => b.type === 'text')?.text
    || `(no text — stop_reason: ${response.stop_reason})`;
  return { text, messages };
}

// ─── CONVERSATION HISTORY ────────────────────────────────────────────────────
function getHistory()           { return [...conversationHistory]; }
function saveHistory(messages)  {
  const textOnly = messages
    .filter(m => {
      if (typeof m.content === 'string') return true;
      if (Array.isArray(m.content) && m.content.every(b => b.type === 'text')) return true;
      return false;
    })
    .map(m => ({
      role:    m.role,
      // Truncate long assistant responses — keeps follow-up context without polluting next question
      content: (() => {
        const c = typeof m.content === 'string' ? m.content : m.content.map(b => b.text).join('');
        if (m.role === 'assistant' && c.length > 300) return c.slice(0, 300) + '… [truncated]';
        return c;
      })(),
    }))
    .slice(-6); // last 3 exchanges
  conversationHistory.length = 0;
  conversationHistory.push(...textOnly);
}

// ─── TELEGRAM HELPERS ─────────────────────────────────────────────────────────
async function sendTelegram(text) {
  const chatId = E.TELEGRAM_CHAT_ID;
  if (!chatId) { console.error('TELEGRAM_CHAT_ID not set'); return; }

  const chunks = [];
  for (let i = 0; i < text.length; i += 4000) chunks.push(text.slice(i, i + 4000));

  for (const chunk of chunks) {
    let res  = await fetch(`https://api.telegram.org/bot${E.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: 'Markdown' }),
    });
    let json = await res.json();
    if (!json.ok) {
      // Retry plain
      res  = await fetch(`https://api.telegram.org/bot${E.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ chat_id: chatId, text: chunk }),
      });
      json = await res.json();
      if (!json.ok) console.error('Telegram send failed:', JSON.stringify(json));
    }
  }
}

async function sendTyping(chatId) {
  await fetch(`https://api.telegram.org/bot${E.TELEGRAM_BOT_TOKEN}/sendChatAction`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: chatId, action: 'typing' }),
  });
}

// ─── TELEGRAM MESSAGE HANDLER ─────────────────────────────────────────────────
async function handleTelegramMessage(msg) {
  if (!msg?.text) return;
  const chatId = String(msg.chat.id);
  const text   = msg.text.trim();

  // Security: only Mo
  if (E.TELEGRAM_CHAT_ID && chatId !== String(E.TELEGRAM_CHAT_ID)) {
    console.log(`Blocked message from chatId ${chatId}`);
    return;
  }

  console.log(`[msg] ${text.slice(0, 80)}`);

  if (text === '/start') {
    await sendTelegram('MH online. What\'s up?');
    return;
  }

  if (text === '/clear') {
    conversationHistory.length = 0;
    await sendTelegram('History cleared.');
    return;
  }

  if (text === '/strength_check') {
    await sendTelegram('⏳ Running strength check — give me ~60 seconds.');
    // Fire async — no await so Telegram doesn't timeout
    handleStrengthCheck().catch(async e => {
      console.error('Strength check error:', e);
      await sendTelegram(`⚠️ Strength check failed: ${e.message}`);
    });
    return;
  }

  // Classify intent
  const isQuestion  = text.includes('?');
  const isCommand   = ACTION_VERBS.test(text.trim());
  const isStatement = !isQuestion && !isCommand;

  // Scope injection — force single data source based on question type
  const lc = text.toLowerCase();
  let scopeTag = '';
  if (/lift|gym|hevy|bench|squat|deadlift|upper|lower|routine|reps|sets|workout|exercise/.test(lc)) {
    scopeTag = '\n\n[GYM QUESTION: call get_hevy_workouts ONLY. Do NOT call get_oura_readiness, get_intervals_wellness, get_strava_activities, or any other tool.]';
  } else if (/ctl|atl|tsb|fitness|load|form|intervals|training stress/.test(lc)) {
    scopeTag = '\n\n[FITNESS QUESTION: call get_intervals_wellness ONLY. Do NOT call any other tool.]';
  } else if (/readiness|recovery|hrv|sleep|oura|resting hr|rest/.test(lc)) {
    scopeTag = '\n\n[RECOVERY QUESTION: call get_oura_readiness ONLY. Do NOT call any other tool.]';
  } else if (/run|ran|pace|km|strava|easy|long run|tempo|interval|session/.test(lc) && !/gym|lift|bench/.test(lc)) {
    scopeTag = '\n\n[RUN QUESTION: call get_strava_activities or get_strava_activity_detail ONLY. Do NOT call any other tool.]';
  }

  const userMessage = isStatement
    ? `${text}\n\n[PLAIN STATEMENT — acknowledge in 1–2 sentences only. Call ZERO tools. No coaching notes, no session plans.]`
    : text + scopeTag;

  try {
    await sendTyping(chatId);
    const { text: reply } = await runAgentLoop(userMessage, []);
    await sendTelegram(reply);
  } catch (e) {
    console.error('handleTelegramMessage error:', e);
    await sendTelegram(`⚠️ Something went wrong: ${e.message}`);
  }
}

// ─── STRAVA WEBHOOK ───────────────────────────────────────────────────────────
async function analyzeNewActivity(activityId) {
  console.log(`[strava] new activity: ${activityId}`);
  const prompt = `New activity just synced. Call get_strava_activity_detail with activity_id="${activityId}". Write the post-activity analysis using the POST-ACTIVITY FORMAT. Under 120 words. No race projections. No bold headers. Address as "you".`;
  try {
    const { text } = await runAgentLoop(prompt, []);
    await sendTelegram(text);
  } catch (e) {
    console.error('analyzeNewActivity error:', e);
  }
}

// ─── MORNING BRIEFING ─────────────────────────────────────────────────────────
async function morningBriefing() {
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const now      = new Date();
  const dayName  = dayNames[now.getDay()];
  console.log('[cron] morning briefing', todayStr());

  const prompt = `Morning brief. Today is ${todayStr()} (${dayName}).

1. Call get_oura_readiness (last 7 days) and get_oura_sleep (last 7 days).
2. Call get_intervals_wellness (last 14 days) for CTL/ATL/TSB.
3. Call get_intervals_planned_workouts for today's scheduled session.
4. Call get_strava_activities (last 7 days) for recent context.
5. If today is a run day (Wed/Thu/Sat/Sun), call get_weather.

Apply GREEN/AMBER/RED decision rules and write the brief in this exact format:

🔴/🟡/🟢 READINESS: [status] — [two numbers e.g. HRV 58 + sleep 71]
TODAY: [type · distance · target]
WHY: [one sentence]
CHANGED: [what changed, or "no change"]
[WEEK section only if something shifted]
[FLAG only if genuinely needed]

Nothing before the emoji. Scannable in 15 seconds.`;

  try {
    const { text } = await runAgentLoop(prompt, []);
    await sendTelegram(text);
  } catch (e) {
    console.error('Morning briefing error:', e);
    await sendTelegram(`⚠️ Morning brief failed: ${e.message}`);
  }
}

// ─── WEEKLY PLAN ─────────────────────────────────────────────────────────────
function getNextWeekDays() {
  const now  = new Date();
  const dow  = now.getDay();
  const diff = dow === 0 ? 1 : 8 - dow; // next Monday
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() + diff + i);
    return d.toISOString().slice(0, 10);
  });
}

async function weeklyPlan() {
  const days = getNextWeekDays();
  console.log('[cron] weekly plan, week of', days[0]);

  const prompt = `Weekly plan. Generate the training plan for the week of ${days[0]}.

1. Call get_oura_readiness for current readiness.
2. Call get_intervals_wellness (last 14 days) for CTL and ATL.
3. Call get_hevy_workouts (last 14 sessions) to determine Upper A/B and Lower A/B rotation.
4. Call get_intervals_planned_workouts (oldest=${days[0]}, newest=${days[6]}) for existing events.
5. Delete any MH-generated events for next week using delete_planned_workout.
6. Select Wednesday quality run using this decision tree (evaluate in order):
   a. READINESS GATE: readiness <60 → Z2 easy 40–50min. readiness <70 → downgrade one tier.
   b. SPACING: check Strava activities — if a hard session happened <48h before Wednesday → note in plan.
   c. STIMULUS ROTATION: check last 3 Wednesday sessions from Strava. Don't repeat same type 3x running.
      Rotation order: threshold → cruise intervals → race-pace → VO2max (only if CTL ≥40 AND readiness ≥75)
   d. PHASE: currently Phase 1 (Jun–early Aug). Use threshold or race-pace only. No VO2max until Phase 2.
   e. CTL BASELINE (after above gates pass):
      - CTL < 20: Threshold 2×10min @ HR 170–178bpm / ~4:42–4:50/km at 15°C, 3min jog recovery
      - CTL 20–35: Threshold 3×10min @ HR 170–178bpm / ~4:42–4:50/km at 15°C, 3min jog recovery
      - CTL 35–50: Threshold 3×10min OR cruise intervals 5×5min @ HR 168–175bpm / ~4:45–4:55/km
      - CTL ≥50: VO2max 5×3min @ HR >178bpm / ~4:19–4:30/km (only Phase 2+)
   f. Always include THRESHOLD BAILOUT RULE in the prescription and note heat-adjusted pace if summer.
7. Push Wednesday's session to Intervals (create_planned_workout on ${days[2]}, type: Run).
8. Write output starting with 📅, nothing before it.

📅 *Week of ${days[0]}*
Readiness: [score] | CTL: [value] | ATL: [value]
*Mon ${days[0].slice(5)}* – Rest
*Tue ${days[1].slice(5)}* – [Upper A or B] (gym)
*Wed ${days[2].slice(5)}* – ⚡ [quality session + structure] ✅ Intervals
*Thu ${days[3].slice(5)}* – Deadlift + Arms + easy run
*Fri ${days[4].slice(5)}* – [Lower A or B] (gym)
*Sat ${days[5].slice(5)}* – Boxing + easy run
*Sun ${days[6].slice(5)}* – Long run
[Readiness note only if < 70]`;

  try {
    const { text } = await runAgentLoop(prompt, [], 12);
    const start    = text.search(/📅/);
    const cleaned  = (start >= 0 ? text.slice(start) : text)
      .replace(/\*\*/g, '*')
      .replace(/`/g, '');
    await sendTelegram(cleaned.trim());
  } catch (e) {
    console.error('Weekly plan error:', e);
    await sendTelegram(`⚠️ Weekly plan failed: ${e.message}`);
  }
}

// ─── STRENGTH CHECK ───────────────────────────────────────────────────────────
async function handleStrengthCheck() {
  console.log('[strength] running check');

  const prompt = `Strength check. Window: ${daysAgo(7)} to ${todayStr()}.

1. Call get_hevy_workouts. Filter to sessions in the last 7 days only.
2. Call get_hevy_routines for current template weights and IDs.
3. For each of the 5 routines found in last 7 days: compare to previous session of same routine.
4. Apply BUMP/HOLD/SCALE rules (working sets only — ignore warmup sets).
5. Call update_hevy_routine for any BUMPs.
6. Start response with "Here's your". Nothing before it.

Format:
Here's your [Routine name] progress ([prev date] → [current date]):
*[Exercise]:* [prev weight]kg → [current weight]kg ([reps]). [BUMP/HOLD — one clause]

Summary: bumped: [list] · hold: [list]
✅ Hevy updated: [changes] OR ✅ No changes needed.`;

  const { text }  = await runAgentLoop(prompt, [], 12);
  const start     = text.search(/Here's your|✅/i);
  const cleaned   = (start >= 0 ? text.slice(start) : text)
    .replace(/\*\*/g, '*')
    .replace(/`/g, '')
    .replace(/,?\s*\(?\s*(?:routine[\s_-]?)?id[:\s]+[a-f0-9-]{6,}\s*\)?/gi, '');
  await sendTelegram(cleaned.trim());
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// Health check
app.get('/', (req, res) => res.json({ status: 'MH online', date: todayStr() }));

// Telegram webhook
app.post('/telegram', (req, res) => {
  res.sendStatus(200); // Acknowledge immediately
  const update = req.body;
  if (update?.message) {
    handleTelegramMessage(update.message).catch(async e => {
      console.error('Unhandled message error:', e);
      await sendTelegram(`⚠️ Error: ${e.message}`).catch(() => {});
    });
  }
});

// Strava webhook verification
app.get('/strava', (req, res) => {
  const challenge = req.query['hub.challenge'];
  const token     = req.query['hub.verify_token'];
  if (token !== E.STRAVA_VERIFY_TOKEN) return res.status(403).send('Forbidden');
  res.json({ 'hub.challenge': challenge });
});

// Strava activity event
app.post('/strava', (req, res) => {
  res.sendStatus(200);
  const event = req.body;
  if (event?.object_type === 'activity' && event?.aspect_type === 'create') {
    analyzeNewActivity(event.object_id).catch(e => console.error('Strava event error:', e));
  }
});

// Test endpoint
app.post('/test', async (req, res) => {
  if (req.body?.secret !== E.TEST_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const history = req.body.isolate === false ? getHistory() : [];
    const { text } = await runAgentLoop(req.body.message, history);
    res.json({ response: text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── SCHEDULED CRONS (Beirut time = UTC+3) ───────────────────────────────────
// 7am every day (6-field: second minute hour day month weekday)
cron.schedule('0 0 7 * * *', morningBriefing, { timezone: 'Asia/Beirut' });
// Sunday 8pm
cron.schedule('0 0 20 * * 0', weeklyPlan, { timezone: 'Asia/Beirut' });

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MH running on port ${PORT}`);
  console.log(`Telegram chat ID: ${E.TELEGRAM_CHAT_ID}`);
  console.log(`Crons: morning brief 07:00 Beirut · weekly plan Sun 20:00 Beirut`);
});
