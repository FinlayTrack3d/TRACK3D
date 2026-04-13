import { useState, useRef, useEffect } from "react";
import { supabase } from "../lib/supabase";

const NEON = "#00FFB2";
const NEON2 = "#00C8FF";
const NEON3 = "#FF2D78";
const BG = "#080C10";
const SURFACE = "#0D1318";
const SURFACE2 = "#111921";
const BORDER = "#1A2530";

const TODAY = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

const INITIAL_HABITS = [
  { id: 1, name: "Morning workout", done: true, streak: 14, category: "fitness" },
  { id: 2, name: "Drink 3L water", done: true, streak: 7, category: "health" },
  { id: 3, name: "10 min meditation", done: false, streak: 3, category: "mindset" },
  { id: 4, name: "Read 20 pages", done: false, streak: 21, category: "growth" },
  { id: 5, name: "Cold shower", done: true, streak: 5, category: "discipline" },
  { id: 6, name: "No social media before 10am", done: false, streak: 2, category: "mindset" },
  { id: 7, name: "Protein goal hit", done: true, streak: 9, category: "nutrition" },
];

const WORKOUTS = [
  { name: "Bench Press", sets: "4x8", weight: "185 lbs", type: "PUSH" },
  { name: "Incline DB Press", sets: "3x10", weight: "70 lbs", type: "PUSH" },
  { name: "Cable Flies", sets: "3x15", weight: "40 lbs", type: "PUSH" },
  { name: "Tricep Pushdown", sets: "3x12", weight: "55 lbs", type: "ARMS" },
  { name: "Overhead Ext.", sets: "3x10", weight: "65 lbs", type: "ARMS" },
];

const MEALS = [
  { name: "Chicken & Rice", time: "7:30 AM", cals: 480, p: 42, c: 55, f: 8 },
  { name: "Protein Shake", time: "10:00 AM", cals: 220, p: 40, c: 10, f: 3 },
  { name: "Salmon + Greens", time: "1:00 PM", cals: 560, p: 48, c: 22, f: 18 },
  { name: "Greek Yogurt", time: "4:00 PM", cals: 150, p: 17, c: 12, f: 3 },
];

const TOTAL_CALS = MEALS.reduce((a, m) => a + m.cals, 0);
const TOTAL_P = MEALS.reduce((a, m) => a + m.p, 0);
const TOTAL_C = MEALS.reduce((a, m) => a + m.c, 0);
const TOTAL_F = MEALS.reduce((a, m) => a + m.f, 0);

const heatData = Array.from({ length: 28 }, () => ({
  val: Math.random() > 0.2 ? Math.floor(Math.random() * 4) + 1 : 0,
}));

const heatColor = (v) => {
  if (v === 0) return BORDER;
  if (v === 1) return "rgba(0,255,178,0.15)";
  if (v === 2) return "rgba(0,255,178,0.35)";
  if (v === 3) return "rgba(0,255,178,0.6)";
  return NEON;
};

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Space+Mono:wght@400;700&display=swap');
  .t3d * { box-sizing: border-box; margin: 0; padding: 0; }
  .t3d { display: flex; min-height: 100vh; background: #080C10; color: #E0EAF0; font-family: 'Space Mono', monospace; }
  .t3d-sidebar { width: 210px; background: #0D1318; border-right: 1px solid #1A2530; display: flex; flex-direction: column; padding: 28px 0; flex-shrink: 0; }
  .t3d-logo { font-family: 'Orbitron', monospace; font-weight: 900; font-size: 20px; letter-spacing: 4px; padding: 0 22px 28px; background: linear-gradient(90deg,#00FFB2,#00C8FF); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .t3d-logo small { font-size: 10px; letter-spacing: 2px; display: block; -webkit-text-fill-color: #2A3A48; color: #2A3A48; margin-top: 2px; font-weight: 400; }
  .t3d-nav { display: flex; align-items: center; gap: 10px; padding: 12px 22px; cursor: pointer; font-size: 11px; letter-spacing: 1px; color: #3A5060; border-left: 2px solid transparent; transition: all .18s; }
  .t3d-nav:hover { color: #8AABB8; background: rgba(0,255,178,.04); }
  .t3d-nav.on { color: #00FFB2; border-left-color: #00FFB2; background: rgba(0,255,178,.06); }
  .t3d-nav-icon { width: 18px; text-align: center; font-size: 14px; }
  .t3d-sfooter { margin-top: auto; padding: 22px; font-size: 11px; color: #2A3A48; letter-spacing: 1px; line-height: 1.6; }
  .t3d-main { flex: 1; padding: 28px 28px 48px; min-width: 0; overflow-y: auto; }
  .t3d-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 28px; }
  .t3d-title { font-family: 'Orbitron', monospace; font-size: 18px; font-weight: 700; letter-spacing: 3px; }
  .t3d-date { font-size: 10px; color: #3A5060; letter-spacing: 2px; margin-top: 4px; }
  .t3d-dot { width: 8px; height: 8px; border-radius: 50%; background: #00FFB2; box-shadow: 0 0 8px #00FFB2; animation: t3dpulse 2s infinite; }
  @keyframes t3dpulse { 0%,100%{opacity:1} 50%{opacity:.4} }
  @keyframes t3dfade { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
  .t3d-fade { animation: t3dfade .35s ease forwards; }
  .t3d-grid3 { display: grid; grid-template-columns: repeat(3,1fr); gap: 14px; margin-bottom: 16px; }
  .t3d-grid2 { display: grid; grid-template-columns: repeat(2,1fr); gap: 14px; margin-bottom: 16px; }
  .t3d-grid12 { display: grid; grid-template-columns: 1fr 2fr; gap: 14px; margin-bottom: 16px; }
  .t3d-card { background: #0D1318; border: 1px solid #1A2530; border-radius: 8px; padding: 20px; position: relative; overflow: hidden; }
  .t3d-card::before { content:''; position:absolute; top:0;left:0;right:0; height:1px; background:linear-gradient(90deg,transparent,rgba(0,255,178,.25),transparent); }
  .t3d-ctitle { font-family: 'Orbitron', monospace; font-size: 9px; letter-spacing: 3px; color: #2A3A48; text-transform: uppercase; margin-bottom: 14px; }
  .t3d-sval { font-family: 'Orbitron', monospace; font-size: 30px; font-weight: 700; margin: 6px 0 3px; }
  .t3d-slabel { font-size: 10px; color: #3A5060; letter-spacing: 1px; }
  .t3d-sdelta { font-size: 10px; margin-top: 8px; }
  .t3d-up { color: #00FFB2; } .t3d-dn { color: #FF2D78; }
  .t3d-pbar { height: 4px; background: #1A2530; border-radius: 2px; overflow: hidden; margin-top: 10px; }
  .t3d-pfill { height: 100%; border-radius: 2px; transition: width .8s cubic-bezier(.16,1,.3,1); }
  .t3d-hrow { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #1A2530; cursor: pointer; }
  .t3d-hrow:last-child { border-bottom: none; }
  .t3d-hcheck { width: 20px; height: 20px; border-radius: 4px; border: 1px solid #1A2530; display: flex; align-items: center; justify-content: center; font-size: 11px; flex-shrink: 0; transition: all .18s; }
  .t3d-hcheck.done { background: rgba(0,255,178,.1); border-color: #00FFB2; color: #00FFB2; }
  .t3d-hname { flex: 1; font-size: 11px; }
  .t3d-hstreak { font-family: 'Orbitron', monospace; font-size: 10px; color: #3A5060; }
  .t3d-hstreak.fire { color: #FF8C00; }
  .t3d-hmap { display: grid; grid-template-columns: repeat(7,1fr); gap: 4px; margin-top: 8px; }
  .t3d-hcell { aspect-ratio:1; border-radius: 2px; transition: transform .15s; cursor: pointer; }
  .t3d-hcell:hover { transform: scale(1.25); }
  .t3d-witem { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #1A2530; font-size: 11px; }
  .t3d-witem:last-child { border-bottom: none; }
  .t3d-wtag { font-family: 'Orbitron', monospace; font-size: 8px; letter-spacing: 1px; padding: 3px 7px; border-radius: 3px; flex-shrink: 0; background: rgba(0,255,178,.07); color: #00FFB2; border: 1px solid rgba(0,255,178,.2); }
  .t3d-mrow { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .t3d-mlbl { font-size: 10px; width: 65px; letter-spacing: 1px; }
  .t3d-mbar { flex: 1; height: 5px; background: #1A2530; border-radius: 3px; overflow: hidden; }
  .t3d-mfill { height: 100%; border-radius: 3px; transition: width .8s cubic-bezier(.16,1,.3,1); }
  .t3d-mval { font-family: 'Orbitron', monospace; font-size: 10px; width: 65px; text-align: right; }
  .t3d-btn { background: rgba(0,255,178,.07); border: 1px solid rgba(0,255,178,.25); color: #00FFB2; font-family: 'Orbitron', monospace; font-size: 9px; letter-spacing: 2px; padding: 9px 16px; border-radius: 5px; cursor: pointer; transition: all .18s; white-space: nowrap; }
  .t3d-btn:hover { background: rgba(0,255,178,.14); }
  .t3d-btn:disabled { opacity: .35; cursor: not-allowed; }
  .t3d-btn-sm { padding: 6px 12px; font-size: 8px; }
  .t3d-btn-red { background: rgba(255,45,120,.07); border-color: rgba(255,45,120,.25); color: #FF2D78; }
  .t3d-ai-msg { margin-bottom: 8px; padding: 10px 13px; border-radius: 6px; font-size: 11px; line-height: 1.65; animation: t3dfade .3s ease; }
  .t3d-ai-tag { font-family: 'Orbitron', monospace; font-size: 8px; letter-spacing: 2px; margin-bottom: 5px; }
  .t3d-ai-input { flex: 1; background: #111921; border: 1px solid #1A2530; border-radius: 5px; padding: 9px 12px; color: #E0EAF0; font-family: 'Space Mono', monospace; font-size: 11px; outline: none; transition: border-color .18s; }
  .t3d-ai-input:focus { border-color: rgba(0,255,178,.35); }
  .t3d-ai-input::placeholder { color: #1E2E3A; }
  @keyframes t3dblink { 0%,100%{opacity:1} 50%{opacity:0} }
  .t3d-cursor::after { content:'|'; animation: t3dblink .7s infinite; color: #00FFB2; }
`;

function ScoreRing({ score, size = 108 }) {
  const r = size / 2 - 10;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);
  const color = score >= 70 ? NEON : score >= 40 ? "#FF8C00" : NEON3;
  return (
    <div style={{ textAlign: "center" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={BORDER} strokeWidth="6" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color}
          strokeWidth="6" strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1s cubic-bezier(.16,1,.3,1)", filter: `drop-shadow(0 0 5px ${color})` }} />
      </svg>
      <div style={{ marginTop: -(size / 2) - 8, paddingBottom: 6 }}>
        <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 28, fontWeight: 700, color }}>{score}</div>
        <div style={{ fontSize: 9, letterSpacing: 2, color: "#3A5060" }}>SCORE</div>
      </div>
    </div>
  );
}

function AICoach({ habits }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const endRef = useRef(null);

  const scroll = () => endRef.current?.scrollIntoView({ behavior: "smooth" });

  const ctx = () => {
    const done = habits.filter(h => h.done).map(h => h.name).join(", ");
    const pending = habits.filter(h => !h.done).map(h => h.name).join(", ");
    return `You are TRACK3D's AI coach - sharp, direct, data-driven accountability partner. Keep responses to 2-4 sentences. Be real, not fluffy.\n\nUser data today:\n- Completed habits: ${done || "none"}\n- Pending habits: ${pending || "all done!"}\n- Workout: Push day - Bench Press 185lbs, Incline DB 70lbs, Cable Flies, Triceps\n- Nutrition: ${TOTAL_CALS} kcal | ${TOTAL_P}g protein | ${TOTAL_C}g carbs | ${TOTAL_F}g fat\n- Overall score: 74/100`;
  };

  const send = async (msg) => {
    if (!msg.trim() || loading) return;
    setLoading(true);
    const updated = [...messages, { role: "user", content: msg }];
    setMessages(updated);
    setInput("");
    setTimeout(scroll, 50);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: ctx(),
          messages: updated,
        }),
      });
      const data = await res.json();
      const reply = data.content?.map(b => b.text || "").join("") || "Unable to connect.";
      setMessages([...updated, { role: "assistant", content: reply }]);
    } catch {
      setMessages([...updated, { role: "assistant", content: "Connection error." }]);
    }
    setLoading(false);
    setTimeout(scroll, 50);
  };

  const activate = () => { setStarted(true); send("Give me a quick assessment of my day so far and what I should focus on."); };

  return (
    <div className="t3d-card" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="t3d-ctitle">AI COACH</div>
      {!started ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "20px 0" }}>
          <div style={{ fontSize: 30, marginBottom: 10 }}>🤖</div>
          <div style={{ fontSize: 11, color: "#3A5060", marginBottom: 18, textAlign: "center", lineHeight: 1.6, letterSpacing: 1 }}>
            Your AI coach analyzes your habits,<br />workouts and nutrition in real-time.
          </div>
          <button className="t3d-btn" onClick={activate}>ACTIVATE COACH</button>
        </div>
      ) : (
        <>
          <div style={{ flex: 1, overflowY: "auto", maxHeight: 260, marginBottom: 10 }}>
            {messages.map((m, i) => (
              <div key={i} className="t3d-ai-msg" style={{
                background: m.role === "user" ? "rgba(0,200,255,.06)" : SURFACE2,
                border: `1px solid ${m.role === "user" ? "rgba(0,200,255,.15)" : "rgba(0,255,178,.1)"}`,
              }}>
                <div className="t3d-ai-tag" style={{ color: m.role === "user" ? NEON2 : NEON }}>
                  {m.role === "user" ? "YOU" : "AI COACH"}
                </div>
                <span style={{ color: m.role === "user" ? "#C0D8E8" : "#8AABB8" }}>{m.content}</span>
              </div>
            ))}
            {loading && (
              <div className="t3d-ai-msg" style={{ background: SURFACE2, border: "1px solid rgba(0,255,178,.1)" }}>
                <div className="t3d-ai-tag" style={{ color: NEON }}>AI COACH</div>
                <span className="t3d-cursor" style={{ color: "#3A5060", fontSize: 11 }}>Analyzing</span>
              </div>
            )}
            <div ref={endRef} />
          </div>
          <div style={{ display: "flex", gap: 7, marginBottom: 7 }}>
            <input className="t3d-ai-input" placeholder="Ask your coach..." value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && send(input)} />
            <button className="t3d-btn t3d-btn-sm" onClick={() => send(input)} disabled={loading || !input.trim()}>SEND</button>
          </div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {["What should I eat tonight?", "Am I overtraining?", "Motivate me"].map(q => (
              <button key={q} className="t3d-btn t3d-btn-sm" style={{ opacity: .65, fontSize: 8 }} onClick={() => send(q)} disabled={loading}>{q}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Dashboard({ habits, setHabits }) {
  const done = habits.filter(h => h.done).length;
  const score = Math.round((done / habits.length) * 58 + 16);
  return (
    <div className="t3d-fade">
      <div className="t3d-grid3">
        <div className="t3d-card">
          <div className="t3d-ctitle">DAILY SCORE</div>
          <div style={{ display: "flex", justifyContent: "center", paddingTop: 4 }}>
            <ScoreRing score={score} />
          </div>
        </div>
        <div className="t3d-card">
          <div className="t3d-ctitle">HABITS TODAY</div>
          <div className="t3d-sval" style={{ color: NEON }}>{done}<span style={{ fontSize: 15, color: "#3A5060" }}>/{habits.length}</span></div>
          <div className="t3d-slabel">COMPLETED</div>
          <div className="t3d-pbar"><div className="t3d-pfill" style={{ width: `${(done/habits.length)*100}%`, background: "linear-gradient(90deg,#00FFB2,#00C8FF)" }} /></div>
          <div className="t3d-sdelta t3d-up" style={{ marginTop: 10 }}>▲ 2 more than yesterday</div>
        </div>
        <div className="t3d-card">
          <div className="t3d-ctitle">CALORIES</div>
          <div className="t3d-sval" style={{ color: NEON2 }}>{TOTAL_CALS}</div>
          <div className="t3d-slabel">KCAL TODAY</div>
          <div className="t3d-pbar"><div className="t3d-pfill" style={{ width: `${(TOTAL_CALS/2400)*100}%`, background: "linear-gradient(90deg,#00C8FF,#0080FF)" }} /></div>
          <div style={{ fontSize: 10, color: "#3A5060", marginTop: 10 }}>Goal: 2,400 kcal</div>
        </div>
      </div>

      <div className="t3d-grid12">
        <div className="t3d-card">
          <div className="t3d-ctitle">HABITS</div>
          {habits.map(h => (
            <div key={h.id} className="t3d-hrow" onClick={() => setHabits(hh => hh.map(x => x.id===h.id ? {...x, done:!x.done} : x))}>
              <div className={`t3d-hcheck ${h.done?"done":""}`}>{h.done?"✓":""}</div>
              <div className="t3d-hname" style={{ color: h.done ? "#E0EAF0" : "#4A6070" }}>{h.name}</div>
              <div className={`t3d-hstreak ${h.streak>=7?"fire":""}`}>{h.streak>=7?"🔥":"◆"} {h.streak}d</div>
            </div>
          ))}
        </div>
        <AICoach habits={habits} />
      </div>

      <div className="t3d-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div className="t3d-ctitle" style={{ margin: 0 }}>28-DAY ACTIVITY</div>
          <div style={{ display: "flex", gap: 10, fontSize: 9, color: "#2A3A48", letterSpacing: 1 }}>
            {["SUN","MON","TUE","WED","THU","FRI","SAT"].map(d => <span key={d}>{d}</span>)}
          </div>
        </div>
        <div className="t3d-hmap">
          {heatData.map((d, i) => (
            <div key={i} className="t3d-hcell" style={{ background: heatColor(d.val) }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Fitness() {
  const stats = [
    { label: "WORKOUTS THIS WEEK", val: "4", delta: "+1 vs last week", up: true, color: NEON },
    { label: "TOTAL VOLUME", val: "18,240", delta: "lbs lifted", up: true, color: NEON2 },
    { label: "ACTIVE MINUTES", val: "68", delta: "4 min below avg", up: false, color: "#FF8C00" },
  ];
  const split = [
    { day: "MON", name: "PUSH", done: true },
    { day: "TUE", name: "PULL", done: true },
    { day: "WED", name: "LEGS", done: true },
    { day: "THU", name: "REST", done: true },
    { day: "FRI", name: "PUSH", done: false, today: true },
    { day: "SAT", name: "PULL", done: false },
    { day: "SUN", name: "LEGS", done: false },
  ];
  return (
    <div className="t3d-fade">
      <div className="t3d-grid3">
        {stats.map((s, i) => (
          <div className="t3d-card" key={i}>
            <div className="t3d-ctitle">{s.label}</div>
            <div className="t3d-sval" style={{ color: s.color }}>{s.val}</div>
            <div className={`t3d-sdelta ${s.up?"t3d-up":"t3d-dn"}`}>{s.up?"▲":"▼"} {s.delta}</div>
          </div>
        ))}
      </div>
      <div className="t3d-grid2">
        <div className="t3d-card">
          <div className="t3d-ctitle">TODAY'S WORKOUT - PUSH</div>
          {WORKOUTS.map((w, i) => (
            <div className="t3d-witem" key={i}>
              <div className="t3d-wtag">{w.type}</div>
              <div style={{ flex: 1 }}>{w.name}</div>
              <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 10, color: "#3A5060" }}>{w.sets}</div>
              <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 10, color: NEON2, width: 65, textAlign: "right" }}>{w.weight}</div>
            </div>
          ))}
          <div style={{ marginTop: 14, display: "flex", gap: 7 }}>
            <button className="t3d-btn t3d-btn-sm">+ ADD EXERCISE</button>
            <button className="t3d-btn t3d-btn-sm t3d-btn-red">CLEAR</button>
          </div>
        </div>
        <div className="t3d-card">
          <div className="t3d-ctitle">WEEKLY SPLIT</div>
          {split.map((d, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: "1px solid #1A2530", opacity: d.done ? .45 : 1 }}>
              <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 10, width: 28, color: d.today ? NEON : "#3A5060" }}>{d.day}</div>
              <div style={{ flex: 1, fontSize: 11, color: d.today ? "#E0EAF0" : "#4A6070" }}>{d.name}</div>
              {d.today && <span style={{ fontFamily: "'Orbitron',monospace", fontSize: 8, padding: "2px 7px", borderRadius: 10, background: "rgba(0,255,178,.1)", color: NEON, border: "1px solid rgba(0,255,178,.25)" }}>TODAY</span>}
              {d.done && <span style={{ color: NEON, fontSize: 12 }}>✓</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Nutrition() {
  const macros = [
    { label: "PROTEIN", val: TOTAL_P, goal: 180, color: NEON },
    { label: "CARBS", val: TOTAL_C, goal: 250, color: NEON2 },
    { label: "FATS", val: TOTAL_F, goal: 70, color: "#FF8C00" },
    { label: "CALORIES", val: TOTAL_CALS, goal: 2400, color: NEON3 },
  ];
  return (
    <div className="t3d-fade">
      <div className="t3d-grid2">
        <div className="t3d-card">
          <div className="t3d-ctitle">MACROS TODAY</div>
          {macros.map((m, i) => (
            <div className="t3d-mrow" key={i}>
              <div className="t3d-mlbl" style={{ color: m.color }}>{m.label}</div>
              <div className="t3d-mbar">
                <div className="t3d-mfill" style={{ width: `${Math.min((m.val/m.goal)*100,100)}%`, background: m.color, boxShadow: `0 0 5px ${m.color}50` }} />
              </div>
              <div className="t3d-mval" style={{ color: m.color }}>
                {m.val}<span style={{ fontSize: 8, color: "#3A5060" }}>/{m.goal}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="t3d-card">
          <div className="t3d-ctitle">CALORIE BREAKDOWN</div>
          <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}>
            <svg width="140" height="140">
              {(() => {
                const slices = [
                  { val: TOTAL_P * 4, color: NEON },
                  { val: TOTAL_C * 4, color: NEON2 },
                  { val: TOTAL_F * 9, color: "#FF8C00" },
                ];
                const total = slices.reduce((a, s) => a + s.val, 0);
                let cursor = -Math.PI / 2;
                const r = 55, cx = 70, cy = 70;
                return slices.map((s, i) => {
                  const angle = (s.val / total) * 2 * Math.PI;
                  const x1 = cx + r * Math.cos(cursor);
                  const y1 = cy + r * Math.sin(cursor);
                  cursor += angle;
                  const x2 = cx + r * Math.cos(cursor);
                  const y2 = cy + r * Math.sin(cursor);
                  return <path key={i} d={`M${cx} ${cy} L${x1} ${y1} A${r} ${r} 0 ${angle>Math.PI?1:0} 1 ${x2} ${y2}Z`} fill={s.color} opacity=".75" stroke={BG} strokeWidth="2" />;
                });
              })()}
              <circle cx="70" cy="70" r="33" fill={SURFACE} />
              <text x="70" y="67" textAnchor="middle" fontFamily="Orbitron,monospace" fontSize="15" fontWeight="700" fill={NEON}>{TOTAL_CALS}</text>
              <text x="70" y="80" textAnchor="middle" fontFamily="Space Mono,monospace" fontSize="8" fill="#3A5060">KCAL</text>
            </svg>
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 18, marginTop: 10 }}>
            {[["PROTEIN",NEON],["CARBS",NEON2],["FATS","#FF8C00"]].map(([l,c]) => (
              <div key={l} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 9, color: "#3A5060", letterSpacing: 1 }}>
                <div style={{ width: 7, height: 7, borderRadius: 2, background: c }} />{l}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="t3d-card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div className="t3d-ctitle" style={{ margin: 0 }}>FOOD LOG</div>
          <button className="t3d-btn t3d-btn-sm">+ LOG MEAL</button>
        </div>
        {MEALS.map((m, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 0", borderBottom: "1px solid #1A2530" }}>
            <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 9, color: "#3A5060", width: 55 }}>{m.time}</div>
            <div style={{ flex: 1, fontSize: 11 }}>{m.name}</div>
            <div style={{ display: "flex", gap: 14, fontSize: 10 }}>
              <span style={{ color: NEON }}>{m.p}g P</span>
              <span style={{ color: NEON2 }}>{m.c}g C</span>
              <span style={{ color: "#FF8C00" }}>{m.f}g F</span>
              <span style={{ fontFamily: "'Orbitron',monospace", color: "#4A6070" }}>{m.cals}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HabitsPage({ habits, setHabits }) {
  const cats = [...new Set(habits.map(h => h.category))];
  return (
    <div className="t3d-fade">
      <div className="t3d-grid3">
        <div className="t3d-card">
          <div className="t3d-ctitle">COMPLETION RATE</div>
          <div className="t3d-sval" style={{ color: NEON }}>{Math.round((habits.filter(h=>h.done).length/habits.length)*100)}%</div>
          <div className="t3d-slabel">TODAY</div>
          <div className="t3d-sdelta t3d-up" style={{ marginTop: 8 }}>▲ 12% vs last week</div>
        </div>
        <div className="t3d-card">
          <div className="t3d-ctitle">BEST STREAK</div>
          <div className="t3d-sval" style={{ color: "#FF8C00" }}>21 🔥</div>
          <div className="t3d-slabel">READ 20 PAGES</div>
        </div>
        <div className="t3d-card">
          <div className="t3d-ctitle">TOTAL HABITS</div>
          <div className="t3d-sval" style={{ color: NEON2 }}>{habits.length}</div>
          <div className="t3d-slabel">ACTIVE HABITS</div>
        </div>
      </div>
      {cats.map(cat => (
        <div className="t3d-card" key={cat} style={{ marginBottom: 14 }}>
          <div className="t3d-ctitle">{cat.toUpperCase()}</div>
          {habits.filter(h => h.category === cat).map(h => (
            <div key={h.id} className="t3d-hrow" onClick={() => setHabits(hh => hh.map(x => x.id===h.id ? {...x,done:!x.done} : x))}>
              <div className={`t3d-hcheck ${h.done?"done":""}`}>{h.done?"✓":""}</div>
              <div className="t3d-hname" style={{ color: h.done?"#E0EAF0":"#4A6070" }}>{h.name}</div>
              <div className="t3d-pbar" style={{ flex: 1, margin: "0 14px" }}>
                <div className="t3d-pfill" style={{ width: `${Math.min((h.streak/30)*100,100)}%`, background: h.streak>=7?"#FF8C00":NEON }} />
              </div>
              <div className={`t3d-hstreak ${h.streak>=7?"fire":""}`}>{h.streak>=7?"🔥":"◆"} {h.streak}d</div>
            </div>
          ))}
        </div>
      ))}
      <button className="t3d-btn">+ ADD NEW HABIT</button>
    </div>
  );
}

export default function App() { const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
      if (!session) window.location.href = "/login";
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (!session) window.location.href = "/login";
    });
    return () => subscription.unsubscribe();
  }, []);

  
  const [tab, setTab] = useState("dashboard");
  const [habits, setHabits] = useState(INITIAL_HABITS);
if (authLoading) return (
    <div style={{ minHeight: "100vh", background: "#080C10", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Orbitron',monospace", color: "#00FFB2", letterSpacing: 4, fontSize: 12 }}>
      LOADING...
    </div>
  );
  const nav = [
    { id: "dashboard", icon: "◈", label: "DASHBOARD" },
    { id: "fitness", icon: "⚡", label: "FITNESS" },
    { id: "nutrition", icon: "◎", label: "NUTRITION" },
    { id: "habits", icon: "◇", label: "HABITS" },
  ];

  const titles = { dashboard: "OVERVIEW", fitness: "FITNESS", nutrition: "NUTRITION", habits: "HABITS" };

  return (
    <>
      <style>{css}</style>
      <div className="t3d">
        <nav className="t3d-sidebar">
          <div className="t3d-logo">TRACK3D<small>SELF IMPROVEMENT OS</small></div>
          {nav.map(n => (
            <div key={n.id} className={`t3d-nav ${tab===n.id?"on":""}`} onClick={() => setTab(n.id)}>
              <span className="t3d-nav-icon">{n.icon}</span>{n.label}
            </div>
          ))}
          <div className="t3d-sfooter">
            STREAK: 14 DAYS 🔥<br />
            <span style={{ color: "#1A2530" }}>v1.0 · TRACK3D</span>
          </div>
        </nav>

        <main className="t3d-main">
          <div className="t3d-header">
            <div>
              <div className="t3d-title">{titles[tab]}</div>
              <div className="t3d-date">{TODAY.toUpperCase()}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div className="t3d-dot" />
              <span style={{ fontSize: 10, color: "#2A3A48", letterSpacing: 1 }}>LIVE</span>
            </div>
          </div>

          {tab === "dashboard" && <Dashboard habits={habits} setHabits={setHabits} />}
          {tab === "fitness" && <Fitness />}
          {tab === "nutrition" && <Nutrition />}
          {tab === "habits" && <HabitsPage habits={habits} setHabits={setHabits} />}
        </main>
      </div>
    </>
  );
}
