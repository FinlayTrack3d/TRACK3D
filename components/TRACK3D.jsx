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

const SUGGESTED_TASKS = [
  { name: "Take supplements", duration: 5, type: "tick" },
  { name: "Have a shower", duration: 15, type: "tick" },
  { name: "Go for a walk", duration: 30, type: "tick" },
  { name: "Meditate", duration: 10, type: "tick" },
  { name: "Journaling", duration: 10, type: "tick" },
  { name: "Read", duration: 20, type: "tick" },
  { name: "Cold shower", duration: 10, type: "tick" },
  { name: "Stretch / Mobility", duration: 15, type: "tick" },
  { name: "Drink water", duration: 2, type: "tick" },
  { name: "Review goals", duration: 5, type: "tick" },
];

const MORNING_QUOTES = [
  "Well done. The hardest part is showing up — go smash it.",
  "Another morning won. Now go make the rest of the day count.",
  "You started right. Carry that energy forward.",
  "Discipline in the morning, freedom in the afternoon.",
  "Small wins stack. You just added one. Keep going.",
];

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Space+Mono:wght@400;700&display=swap');
  .t3d * { box-sizing: border-box; margin: 0; padding: 0; }
  .t3d { display: flex; min-height: 100vh; background: #080C10; color: #E0EAF0; font-family: 'Space Mono', monospace; }
  .t3d-sidebar { width: 210px; background: #0D1318; border-right: 1px solid #1A2530; display: flex; flex-direction: column; padding: 28px 0; flex-shrink: 0; }
  .t3d-logo { font-family: 'Orbitron', monospace; font-weight: 900; font-size: 20px; letter-spacing: 4px; padding: 0 22px 28px; background: linear-gradient(90deg,#00FFB2,#00C8FF); -webkit-background-clip: text; -webkit-text-fill-color: transparent; text-align: center; }
  .t3d-logo small { font-size: 9px; letter-spacing: 1px; display: block; -webkit-text-fill-color: #FFFFFF; color: #FFFFFF; margin-top: 4px; font-weight: 400; text-align: center; }
  .t3d-nav { display: flex; align-items: center; gap: 10px; padding: 12px 22px; cursor: pointer; font-size: 11px; letter-spacing: 1px; color: #3A5060; border-left: 2px solid transparent; transition: all .18s; }
  .t3d-nav:hover { color: #8AABB8; background: rgba(0,255,178,.04); }
  .t3d-nav.on { color: #00FFB2; border-left-color: #00FFB2; background: rgba(0,255,178,.06); }
  .t3d-nav-icon { width: 18px; text-align: center; font-size: 14px; }
  .t3d-sfooter { margin-top: auto; padding: 22px; font-size: 11px; color: #2A3A48; letter-spacing: 1px; line-height: 1.6; }
  ..t3d-main { flex: 1; padding: 28px 28px 48px; min-width: 0; overflow-y: auto; }
  @media (max-width: 768px) { .t3d-sidebar { display: none; } .t3d-main { padding: 16px; } }
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
  .t3d-input { background: #111921; border: 1px solid #1A2530; border-radius: 5px; padding: 9px 12px; color: #E0EAF0; font-family: 'Space Mono', monospace; font-size: 12px; outline: none; transition: border-color .18s; width: 100%; }
  .t3d-input:focus { border-color: rgba(0,255,178,.35); }
  .t3d-input::placeholder { color: #1E2E3A; }
  .t3d-checkin-step { min-height: 300px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 20px; }
  .t3d-big-btn { width: 100%; padding: 18px; font-family: 'Orbitron', monospace; font-size: 13px; letter-spacing: 3px; border-radius: 8px; cursor: pointer; transition: all .2s; border: none; }
  .t3d-tick-btn { background: rgba(0,255,178,.1); border: 2px solid #00FFB2; color: #00FFB2; padding: 16px 32px; font-family: 'Orbitron', monospace; font-size: 20px; border-radius: 8px; cursor: pointer; transition: all .2s; margin: 8px; }
  .t3d-tick-btn:hover { background: rgba(0,255,178,.2); transform: scale(1.05); }
  .t3d-cross-btn { background: rgba(255,45,120,.1); border: 2px solid #FF2D78; color: #FF2D78; padding: 16px 32px; font-family: 'Orbitron', monospace; font-size: 20px; border-radius: 8px; cursor: pointer; transition: all .2s; margin: 8px; }
  .t3d-cross-btn:hover { background: rgba(255,45,120,.2); transform: scale(1.05); }
  .t3d-task-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 20px; font-size: 10px; letter-spacing: 1px; cursor: pointer; border: 1px solid #1A2530; background: #111921; color: #4A6070; margin: 4px; transition: all .18s; }
  .t3d-task-chip.selected { border-color: #00FFB2; background: rgba(0,255,178,.08); color: #00FFB2; }
  .t3d-task-chip:hover { border-color: #3A5060; color: #8AABB8; }
  .t3d-progress-dots { display: flex; gap: 6px; justify-content: center; margin-bottom: 24px; }
  .t3d-dot-step { width: 8px; height: 8px; border-radius: 50%; background: #1A2530; transition: all .3s; }
  .t3d-dot-step.active { background: #00FFB2; box-shadow: 0 0 6px #00FFB2; }
  .t3d-dot-step.done { background: rgba(0,255,178,.4); }
`;

// ─── Score Ring ───────────────────────────────────────────────────────────────
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

// ─── AI Coach ─────────────────────────────────────────────────────────────────
function AICoach({ habits, system }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const endRef = useRef(null);

  const scroll = () => endRef.current?.scrollIntoView({ behavior: "smooth" });

  const defaultSystem = `You are TRACK3D's AI coach - sharp, direct, data-driven accountability partner. Keep responses to 2-4 sentences. Be real, not fluffy.
User data today:
- Completed habits: ${habits.filter(h => h.done).map(h => h.name).join(", ") || "none"}
- Pending habits: ${habits.filter(h => !h.done).map(h => h.name).join(", ") || "all done!"}
- Nutrition: ${TOTAL_CALS} kcal | ${TOTAL_P}g protein
- Overall score: 74/100`;

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
          system: system || defaultSystem,
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

  const activate = () => { setStarted(true); send(system ? "Suggest an optimal morning routine for me based on my goals. Give me 5-7 tasks in order with durations." : "Give me a quick assessment of my day so far and what I should focus on."); };

  return (
    <div className="t3d-card" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="t3d-ctitle">{system ? "AI MORNING PLANNER" : "AI COACH"}</div>
      {!started ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "20px 0" }}>
          <div style={{ fontSize: 30, marginBottom: 10 }}>🤖</div>
          <div style={{ fontSize: 11, color: "#3A5060", marginBottom: 18, textAlign: "center", lineHeight: 1.6, letterSpacing: 1 }}>
            {system ? "Let AI build your optimal\nmorning routine." : "Your AI coach analyzes your habits,\nworkouts and nutrition in real-time."}
          </div>
          <button className="t3d-btn" onClick={activate}>{system ? "BUILD MY ROUTINE" : "ACTIVATE COACH"}</button>
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
                  {m.role === "user" ? "YOU" : "AI"}
                </div>
                <span style={{ color: m.role === "user" ? "#C0D8E8" : "#8AABB8" }}>{m.content}</span>
              </div>
            ))}
            {loading && (
              <div className="t3d-ai-msg" style={{ background: SURFACE2, border: "1px solid rgba(0,255,178,.1)" }}>
                <div className="t3d-ai-tag" style={{ color: NEON }}>AI</div>
                <span className="t3d-cursor" style={{ color: "#3A5060", fontSize: 11 }}>Thinking</span>
              </div>
            )}
            <div ref={endRef} />
          </div>
          <div style={{ display: "flex", gap: 7, marginBottom: 7 }}>
            <input className="t3d-ai-input" placeholder="Ask anything..." value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && send(input)} />
            <button className="t3d-btn t3d-btn-sm" onClick={() => send(input)} disabled={loading || !input.trim()}>SEND</button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Schedule Review with Drag ────────────────────────────────────────────────
function ScheduleReview({ scheduledTasks, setScheduledTasks, wakeTime, recalcTimes, calcFinishTime, LOCKED_LAST, onBack, onSave }) {
  const [dragIdx, setDragIdx] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiExplanation, setAiExplanation] = useState("");

  const draggable = scheduledTasks.filter(t => t.id !== "checkin");
  const locked = scheduledTasks.find(t => t.id === "checkin") || LOCKED_LAST;

  const handleDragStart = (i) => setDragIdx(i);
  const handleDragOver = (e, i) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === i) return;
    const newList = [...draggable];
    const [moved] = newList.splice(dragIdx, 1);
    newList.splice(i, 0, moved);
    setScheduledTasks(recalcTimes([...newList, locked]));
    setDragIdx(i);
  };
  const handleDragEnd = () => setDragIdx(null);

  const optimiseWithAI = async () => {
    setAiLoading(true);
    setAiExplanation("");
    const taskList = draggable.map(t => t.name + " (" + t.duration + "min)").join(", ");
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: "You are a morning routine expert. Reorder the tasks for maximum effectiveness. Respond ONLY with JSON: {order: [task names], explanation: string}",
          messages: [{ role: "user", content: "Optimise this morning routine: " + taskList }],
        }),
      });
      const data = await res.json();
      const text = data.content?.map(b => b.text || "").join("") || "";
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
      if (parsed.order) {
        const reordered = parsed.order.map(name => draggable.find(t => t.name === name)).filter(Boolean);
        const remaining = draggable.filter(t => !reordered.find(r => r.name === t.name));
        setScheduledTasks(recalcTimes([...reordered, ...remaining, locked]));
        setAiExplanation(parsed.explanation || "");
      }
    } catch (e) {
      setAiExplanation("Could not optimise. Try again.");
    }
    setAiLoading(false);
  };

  return (
    <div>
      <div className="t3d-ctitle">DRAG TO REORDER YOUR ROUTINE</div>
      <div style={{ marginBottom: 12, fontSize: 10, color: "#3A5060", letterSpacing: 1 }}>
        Hold and drag using the lines to reorder. Check-in is locked last.
      </div>
      <div style={{ marginBottom: 8 }}>
        {draggable.map((t, i) => (
          <div key={t.id || i} draggable
            onDragStart={() => handleDragStart(i)}
            onDragOver={(e) => handleDragOver(e, i)}
            onDragEnd={handleDragEnd}
            style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 10px", borderBottom: "1px solid #1A2530", cursor: "grab", borderRadius: 4, background: dragIdx === i ? "rgba(0,255,178,.04)" : "transparent" }}>
            <div style={{ color: "#2A3A48", fontSize: 18, userSelect: "none" }}>≡</div>
            <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 10, color: "#00C8FF", width: 45 }}>{t.scheduledTime}</div>
            <div style={{ flex: 1, fontSize: 12 }}>{t.icon || "▸"} {t.name}</div>
            <div style={{ fontSize: 10, color: "#3A5060" }}>{t.duration}min</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 10px", border: "1px solid rgba(0,200,255,.2)", borderRadius: 6, marginBottom: 16, background: "rgba(0,200,255,.04)" }}>
        <div style={{ fontSize: 14 }}>🔒</div>
        <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 10, color: "#00C8FF", width: 45 }}>{locked.scheduledTime}</div>
        <div style={{ flex: 1, fontSize: 12, color: "#4A6070" }}>{locked.icon} {locked.name}</div>
        <div style={{ fontSize: 9, color: "#3A5060", letterSpacing: 1 }}>LOCKED</div>
      </div>
      <div style={{ background: "rgba(0,200,255,.05)", border: "1px solid rgba(0,200,255,.2)", borderRadius: 6, padding: 12, marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, color: "#3A5060" }}>ROUTINE FINISHES AT</span>
        <span style={{ fontFamily: "'Orbitron',monospace", fontSize: 12, color: "#00C8FF" }}>{calcFinishTime(wakeTime, scheduledTasks)}</span>
      </div>
      {aiExplanation && (
        <div style={{ background: "rgba(0,255,178,.04)", border: "1px solid rgba(0,255,178,.15)", borderRadius: 6, padding: 12, marginBottom: 16, fontSize: 11, color: "#8AABB8", lineHeight: 1.6 }}>
          <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 9, color: "#00FFB2", letterSpacing: 2, marginBottom: 6 }}>AI SUGGESTION</div>
          {aiExplanation}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="t3d-btn t3d-btn-sm t3d-btn-red" style={{ flex: 1 }} onClick={onBack}>← TASKS</button>
        <button className="t3d-btn t3d-btn-sm" style={{ flex: 1.5, borderColor: "rgba(255,140,0,.4)", color: "#FF8C00", background: "rgba(255,140,0,.07)" }} onClick={optimiseWithAI} disabled={aiLoading}>
          {aiLoading ? "THINKING..." : "✨ OPTIMISE WITH AI"}
        </button>
        <button className="t3d-btn t3d-btn-sm" style={{ flex: 1, background: "rgba(0,255,178,.12)", borderColor: "rgba(0,255,178,.5)" }} onClick={onSave}>
          LOCK IT IN →
        </button>
      </div>
    </div>
  );
}

// ─── Morning Section ──────────────────────────────────────────────────────────
function MorningSection({ user }) {
  const [view, setView] = useState("home");
  const [setupStep, setSetupStep] = useState(0);
  const [wakeTime, setWakeTime] = useState("06:00");
  const [selectedTasks, setSelectedTasks] = useState([]);
  const [customTask, setCustomTask] = useState("");
  const [scheduledTasks, setScheduledTasks] = useState([]);
  const [checkinStep, setCheckinStep] = useState(0);
  const [checkinData, setCheckinData] = useState({});
  const [tempInput, setTempInput] = useState("");
  const [photoPreview, setPhotoPreview] = useState(null);
  const [isSetup, setIsSetup] = useState(false);
  const [completedToday, setCompletedToday] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const fileRef = useRef(null);

  const getLocalDate = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  };
  const today = getLocalDate();

  const NON_NEGS = [
    { id: "weight", name: "Log body weight", type: "number", unit: "kg", icon: "⚖️", duration: 2 },
    { id: "sleep", name: "Log sleep duration", type: "sleep", icon: "😴", duration: 1 },
    { id: "photo", name: "Progress photo", type: "photo", icon: "📸", duration: 2 },
  ];
  const LOCKED_LAST = { id: "checkin", name: "TRACK3D Morning Check-in", type: "tick", icon: "📱", duration: 2 };

  // Load routine and history from Supabase on mount
  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load routine
      const { data: routineData } = await supabase
        .from("morning_routines")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (routineData) {
        setWakeTime(routineData.wake_time || "06:00");
        setScheduledTasks(routineData.tasks || []);
        setIsSetup(true);
      }

      // Load checkins
      const { data: checkinHistory } = await supabase
        .from("morning_checkins")
        .select("*")
        .eq("user_id", user.id)
        .order("date", { ascending: false })
        .limit(30);

      if (checkinHistory) {
        setHistory(checkinHistory);
        const todayEntry = checkinHistory.find(c => c.date === today);
        if (todayEntry) setCompletedToday(true);
      }
    } catch (e) {
      console.log("Load error:", e);
    }
    setLoading(false);
  };

  const saveRoutine = async (tasks) => {
    if (!user) return;
    await supabase.from("morning_routines").upsert({
      user_id: user.id,
      wake_time: wakeTime,
      tasks: tasks,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
  };

  const saveCheckin = async (data, score) => {
    if (!user) return;
    await supabase.from("morning_checkins").upsert({
      user_id: user.id,
      date: today,
      score: score,
      data: data,
      created_at: new Date().toISOString(),
    }, { onConflict: "user_id,date" });
  };

  const calcFinishTime = (wake, tasks) => {
    const [h, m] = wake.split(":").map(Number);
    const totalMins = tasks.reduce((a, t) => a + (t.duration || 10), 0);
    const finishMins = h * 60 + m + totalMins;
    const fh = Math.floor(finishMins / 60) % 24;
    const fm = finishMins % 60;
    return `${String(fh).padStart(2,"0")}:${String(fm).padStart(2,"0")}`;
  };

  const toggleTask = (task) => {
    setSelectedTasks(prev =>
      prev.find(t => t.name === task.name)
        ? prev.filter(t => t.name !== task.name)
        : [...prev, { ...task, id: task.name }]
    );
  };

  const addCustomTask = () => {
    if (!customTask.trim()) return;
    setSelectedTasks(prev => [...prev, { id: customTask, name: customTask, duration: 10, type: "tick" }]);
    setCustomTask("");
  };

  const buildSchedule = (orderedTasks) => {
    const [h, m] = wakeTime.split(":").map(Number);
    let cursor = h * 60 + m;
    const all = [...(orderedTasks || [...NON_NEGS, ...selectedTasks]), LOCKED_LAST];
    return all.map(task => {
      const th = Math.floor(cursor / 60) % 24;
      const tm = cursor % 60;
      const time = `${String(th).padStart(2,"0")}:${String(tm).padStart(2,"0")}`;
      cursor += task.duration || 5;
      return { ...task, scheduledTime: time };
    });
  };

  const recalcTimes = (tasks) => {
    const [h, m] = wakeTime.split(":").map(Number);
    let cursor = h * 60 + m;
    return tasks.map(task => {
      const th = Math.floor(cursor / 60) % 24;
      const tm = cursor % 60;
      const time = `${String(th).padStart(2,"0")}:${String(tm).padStart(2,"0")}`;
      cursor += task.duration || 5;
      return { ...task, scheduledTime: time };
    });
  };

  const allSteps = scheduledTasks.length > 0 ? scheduledTasks : [...NON_NEGS, ...selectedTasks, LOCKED_LAST];
  const currentStep = allSteps[checkinStep];

  const morningScore = (data) => {
    const total = allSteps.length;
    if (total === 0) return 0;
    let points = 0;
    allSteps.forEach(step => {
      const key = step.id || step.name;
      const val = data[key];
      if (step.type === "number" && val && val !== "") points++;
      else if (step.type === "sleep" && val && val !== "") points++;
      else if (step.type === "photo" && val && val !== "skipped") points++;
      else if (step.type === "tick" && val === true) points++;
    });
    return Math.round((points / total) * 10);
  };

  const finishTime = isSetup ? calcFinishTime(wakeTime, scheduledTasks) : "--:--";

  // 7-day chart data
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    const entry = history.find(h => h.date === dateStr);
    return { date: dateStr, score: entry ? entry.score : null, label: d.toLocaleDateString("en-GB", { weekday: "short" }) };
  });

  if (loading) return (
    <div className="t3d-fade">
      <div className="t3d-card" style={{ textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 11, color: "#3A5060", letterSpacing: 2 }}>LOADING MORNING DATA...</div>
      </div>
    </div>
  );

  // HOME view
  if (view === "home") {
    return (
      <div className="t3d-fade">
        {!isSetup ? (
          <div className="t3d-card" style={{ textAlign: "center", padding: 40 }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>🌅</div>
            <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 14, letterSpacing: 3, color: NEON, marginBottom: 8 }}>MORNING ROUTINE</div>
            <div style={{ fontSize: 12, color: "#3A5060", marginBottom: 28, lineHeight: 1.7 }}>
              Build your optimal morning routine.<br />Track it every day. Win every morning.
            </div>
            <button className="t3d-btn" style={{ fontSize: 11, padding: "14px 28px" }} onClick={() => setView("setup")}>
              SET UP MY MORNING
            </button>
          </div>
        ) : (
          <>
            <div className="t3d-grid3">
              <div className="t3d-card" style={{ textAlign: "center" }}>
                <div className="t3d-ctitle">WAKE UP</div>
                <div className="t3d-sval" style={{ color: NEON, fontSize: 24 }}>{wakeTime}</div>
              </div>
              <div className="t3d-card" style={{ textAlign: "center" }}>
                <div className="t3d-ctitle">FINISH BY</div>
                <div className="t3d-sval" style={{ color: NEON2, fontSize: 24 }}>{finishTime}</div>
              </div>
              <div className="t3d-card" style={{ textAlign: "center" }}>
                <div className="t3d-ctitle">TASKS</div>
                <div className="t3d-sval" style={{ color: "#FF8C00", fontSize: 24 }}>{allSteps.length}</div>
              </div>
            </div>

            {/* Check-in button or completed state */}
            <div className="t3d-card" style={{ marginBottom: 16, textAlign: "center", padding: 32 }}>
              {completedToday ? (
                <>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
                  <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 13, color: NEON, letterSpacing: 2, marginBottom: 8 }}>
                    MORNING COMPLETE
                  </div>
                  <div style={{ fontSize: 11, color: "#3A5060", letterSpacing: 1 }}>
                    Score: {history.find(h => h.date === today)?.score || 0}/10 · Come back tomorrow!
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 12, color: "#3A5060", marginBottom: 20, letterSpacing: 1 }}>
                    READY TO START YOUR MORNING?
                  </div>
                  <button
                    className="t3d-big-btn"
                    style={{ background: "linear-gradient(90deg, rgba(0,255,178,.15), rgba(0,200,255,.15))", border: `1px solid ${NEON}`, color: NEON, fontSize: 14, letterSpacing: 3 }}
                    onClick={() => { setCheckinStep(0); setCheckinData({}); setTempInput(""); setView("checkin"); }}>
                    ☀️ MORNING CHECK-IN
                  </button>
                </>
              )}
            </div>

            {/* Today's schedule */}
            <div className="t3d-card" style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div className="t3d-ctitle" style={{ margin: 0 }}>TODAY'S SCHEDULE</div>
                <button className="t3d-btn t3d-btn-sm" onClick={() => { setView("setup"); setSetupStep(0); }}>EDIT</button>
              </div>
              {scheduledTasks.map((t, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${BORDER}` }}>
                  <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 10, color: NEON2, width: 45 }}>{t.scheduledTime}</div>
                  <div style={{ flex: 1, fontSize: 12 }}>{t.icon || "▸"} {t.name}</div>
                  <div style={{ fontSize: 10, color: "#3A5060" }}>{t.duration}min</div>
                </div>
              ))}
            </div>

            {/* 7-day chart */}
            <div className="t3d-card" style={{ marginBottom: 16 }}>
              <div className="t3d-ctitle">7-DAY MORNING SCORES</div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 80, padding: "0 4px" }}>
                {last7.map((d, i) => (
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <div style={{ width: "100%", position: "relative", height: 60, display: "flex", alignItems: "flex-end" }}>
                      <div style={{
                        width: "100%",
                        height: d.score !== null ? `${(d.score / 10) * 100}%` : "4px",
                        background: d.score !== null
                          ? d.score >= 7 ? NEON : d.score >= 4 ? "#FF8C00" : NEON3
                          : BORDER,
                        borderRadius: "3px 3px 0 0",
                        transition: "height .6s cubic-bezier(.16,1,.3,1)",
                        boxShadow: d.score !== null && d.score >= 7 ? `0 0 6px ${NEON}60` : "none",
                        minHeight: 4,
                      }} />
                    </div>
                    <div style={{ fontSize: 9, color: d.date === today ? NEON : "#2A3A48", letterSpacing: 0.5 }}>{d.label}</div>
                    {d.score !== null && <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 8, color: "#3A5060" }}>{d.score}</div>}
                  </div>
                ))}
              </div>
            </div>

            {/* History accordion */}
            <div className="t3d-card">
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                onClick={() => setHistoryOpen(h => !h)}>
                <div className="t3d-ctitle" style={{ margin: 0 }}>MORNING HISTORY</div>
                <div style={{ color: "#3A5060", fontSize: 14, transition: "transform .2s", transform: historyOpen ? "rotate(180deg)" : "rotate(0deg)" }}>▾</div>
              </div>
              {historyOpen && (
                <div style={{ marginTop: 16 }}>
                  {history.length === 0 ? (
                    <div style={{ fontSize: 11, color: "#3A5060", textAlign: "center", padding: "16px 0" }}>No history yet — complete your first morning check-in!</div>
                  ) : (
                    history.map((entry, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${BORDER}` }}>
                        <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 9, color: "#3A5060", width: 80 }}>
                          {new Date(entry.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            {entry.data && Object.entries(entry.data).map(([k, v]) => (
                              <span key={k} style={{
                                fontSize: 9, padding: "2px 6px", borderRadius: 10,
                                background: v === true ? "rgba(0,255,178,.1)" : v === false ? "rgba(255,45,120,.1)" : "rgba(0,200,255,.1)",
                                color: v === true ? NEON : v === false ? NEON3 : NEON2,
                                border: `1px solid ${v === true ? "rgba(0,255,178,.2)" : v === false ? "rgba(255,45,120,.2)" : "rgba(0,200,255,.2)"}`,
                              }}>
                                {k}: {v === true ? "✓" : v === false ? "✗" : String(v).slice(0,8)}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div style={{
                          fontFamily: "'Orbitron',monospace", fontSize: 13, fontWeight: 700,
                          color: entry.score >= 7 ? NEON : entry.score >= 4 ? "#FF8C00" : NEON3
                        }}>{entry.score}/10</div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  // SETUP view
  if (view === "setup") {
    return (
      <div className="t3d-fade">
        <div className="t3d-card">
          <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
            {["WAKE TIME", "TASKS", "REVIEW"].map((s, i) => (
              <div key={i} style={{
                flex: 1, textAlign: "center", padding: "8px 4px", borderRadius: 5, fontSize: 9,
                letterSpacing: 1, fontFamily: "'Orbitron',monospace",
                background: setupStep === i ? "rgba(0,255,178,.08)" : "transparent",
                border: `1px solid ${setupStep === i ? NEON : BORDER}`,
                color: setupStep === i ? NEON : "#3A5060"
              }}>{s}</div>
            ))}
          </div>

          {setupStep === 0 && (
            <div>
              <div className="t3d-ctitle">WHAT TIME DO YOU WANT TO WAKE UP?</div>
              <div style={{ display: "flex", justifyContent: "center", margin: "32px 0" }}>
                <input type="time" value={wakeTime} onChange={e => setWakeTime(e.target.value)}
                  style={{ background: SURFACE2, border: `1px solid ${NEON}`, borderRadius: 8, padding: "16px 24px", color: NEON, fontSize: 28, outline: "none", textAlign: "center", colorScheme: "dark", minWidth: 180 }} />
              </div>
              <div style={{ fontSize: 11, color: "#3A5060", textAlign: "center", marginBottom: 24 }}>
                Your morning routine will be scheduled from this time
              </div>
              <button className="t3d-btn" style={{ width: "100%", padding: 14 }} onClick={() => setSetupStep(1)}>NEXT →</button>
            </div>
          )}

          {setupStep === 1 && (
            <div>
              <div className="t3d-ctitle">CHOOSE YOUR MORNING TASKS</div>
              <div style={{ background: "rgba(0,255,178,.04)", border: "1px solid rgba(0,255,178,.15)", borderRadius: 6, padding: 12, marginBottom: 16, fontSize: 11, color: "#3A5060" }}>
                ✓ Body weight, sleep & progress photo included. TRACK3D Check-in always last.
              </div>
              <div style={{ marginBottom: 16 }}>
                {SUGGESTED_TASKS.map((t, i) => (
                  <span key={i} className={`t3d-task-chip ${selectedTasks.find(s => s.name === t.name) ? "selected" : ""}`}
                    onClick={() => toggleTask(t)}>
                    {selectedTasks.find(s => s.name === t.name) ? "✓ " : ""}{t.name} ({t.duration}m)
                  </span>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
                <input className="t3d-input" placeholder="Add custom task..." value={customTask}
                  onChange={e => setCustomTask(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addCustomTask()} />
                <button className="t3d-btn t3d-btn-sm" onClick={addCustomTask}>ADD</button>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="t3d-btn t3d-btn-sm" onClick={() => setSetupStep(0)}>← BACK</button>
                <button className="t3d-btn" style={{ flex: 1, padding: 12 }}
                  onClick={() => { setScheduledTasks(buildSchedule([...NON_NEGS, ...selectedTasks])); setSetupStep(2); }}>
                  NEXT →
                </button>
              </div>
            </div>
          )}

          {setupStep === 2 && (
            <ScheduleReview
              scheduledTasks={scheduledTasks}
              setScheduledTasks={setScheduledTasks}
              wakeTime={wakeTime}
              recalcTimes={recalcTimes}
              calcFinishTime={calcFinishTime}
              LOCKED_LAST={LOCKED_LAST}
              onBack={() => setSetupStep(1)}
              onSave={async () => {
                await saveRoutine(scheduledTasks);
                setIsSetup(true);
                setView("home");
              }}
            />
          )}
        </div>
      </div>
    );
  }

  // CHECK-IN view
  if (view === "checkin" && currentStep) {
    return (
      <div className="t3d-fade">
        <div className="t3d-card">
          <div className="t3d-progress-dots">
            {allSteps.map((_, i) => (
              <div key={i} className={`t3d-dot-step ${i === checkinStep ? "active" : i < checkinStep ? "done" : ""}`} />
            ))}
          </div>
          <div style={{ textAlign: "center", marginBottom: 8, fontSize: 10, color: "#3A5060", letterSpacing: 2 }}>
            STEP {checkinStep + 1} OF {allSteps.length}
          </div>
          <div className="t3d-checkin-step">
            <div style={{ fontSize: 40, marginBottom: 16 }}>{currentStep.icon || "▸"}</div>
            <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 14, letterSpacing: 2, color: "#E0EAF0", marginBottom: 8 }}>
              {currentStep.name}
            </div>

            {currentStep.type === "number" && (
              <div style={{ width: "100%", maxWidth: 280 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
                  <input className="t3d-input" type="number" placeholder={`Enter ${currentStep.unit}...`}
                    value={tempInput} onChange={e => setTempInput(e.target.value)}
                    style={{ textAlign: "center", fontSize: 24, padding: 16 }} />
                  <span style={{ color: "#3A5060", fontSize: 14 }}>{currentStep.unit}</span>
                </div>
                <button className="t3d-btn" style={{ width: "100%", padding: 14 }} disabled={!tempInput}
                  onClick={() => { setCheckinData(d => ({ ...d, [currentStep.id]: tempInput })); setTempInput(""); setCheckinStep(s => s + 1); }}>
                  CONFIRM →
                </button>
              </div>
            )}

            {currentStep.type === "sleep" && (
              <div style={{ width: "100%", maxWidth: 280 }}>
                <input className="t3d-input" placeholder="e.g. 7h 30m" value={tempInput}
                  onChange={e => setTempInput(e.target.value)}
                  style={{ textAlign: "center", fontSize: 20, padding: 16, marginBottom: 16 }} />
                <button className="t3d-btn" style={{ width: "100%", padding: 14 }} disabled={!tempInput}
                  onClick={() => { setCheckinData(d => ({ ...d, [currentStep.id]: tempInput })); setTempInput(""); setCheckinStep(s => s + 1); }}>
                  CONFIRM →
                </button>
              </div>
            )}

            {currentStep.type === "photo" && (
              <div style={{ width: "100%", maxWidth: 280, textAlign: "center" }}>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
                  onChange={e => { const f = e.target.files[0]; if (f) { setPhotoPreview(URL.createObjectURL(f)); setCheckinData(d => ({ ...d, photo: f.name })); } }} />
                {photoPreview ? (
                  <div>
                    <img src={photoPreview} style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 8, border: `2px solid ${NEON}`, marginBottom: 16 }} alt="progress" />
                    <button className="t3d-btn" style={{ width: "100%", padding: 14 }}
                      onClick={() => setCheckinStep(s => s + 1)}>
                      CONFIRM →
                    </button>
                  </div>
                ) : (
                  <button className="t3d-btn" style={{ width: "100%", padding: 14, marginBottom: 12 }} onClick={() => fileRef.current?.click()}>
                    📸 UPLOAD PHOTO
                  </button>
                )}
                <button className="t3d-btn t3d-btn-sm t3d-btn-red" style={{ width: "100%" }}
                  onClick={() => { setCheckinData(d => ({ ...d, photo: "skipped" })); setCheckinStep(s => s + 1); }}>
                  SKIP TODAY
                </button>
              </div>
            )}

            {currentStep.type === "tick" && (
              <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
                <button className="t3d-tick-btn"
                  onClick={() => { setCheckinData(d => ({ ...d, [currentStep.id || currentStep.name]: true })); setCheckinStep(s => s + 1); }}>
                  ✓
                </button>
                <button className="t3d-cross-btn"
                  onClick={() => { setCheckinData(d => ({ ...d, [currentStep.id || currentStep.name]: false })); setCheckinStep(s => s + 1); }}>
                  ✗
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // COMPLETE view
  if (view === "checkin" && checkinStep >= allSteps.length) {
    const score = morningScore(checkinData);
    const quote = MORNING_QUOTES[Math.floor(Math.random() * MORNING_QUOTES.length)];

    // Save handled via button click

    return (
      <div className="t3d-fade">
        <div className="t3d-card" style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🌟</div>
          <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 12, letterSpacing: 3, color: NEON, marginBottom: 8 }}>MORNING COMPLETE</div>
          <div style={{ margin: "24px auto" }}>
            <ScoreRing score={score * 10} size={120} />
          </div>
          <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 11, color: "#3A5060", letterSpacing: 2, marginBottom: 8 }}>
            MORNING SCORE: {score}/10
          </div>
          <div style={{ fontSize: 13, color: "#8AABB8", fontStyle: "italic", marginBottom: 32, lineHeight: 1.7, padding: "0 20px" }}>
            "{quote}"
          </div>
          <div style={{ marginBottom: 24 }}>
            {Object.entries(checkinData).map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${BORDER}`, fontSize: 11 }}>
                <span style={{ color: "#4A6070" }}>{k}</span>
                <span style={{ color: v === true ? NEON : v === false ? NEON3 : NEON2 }}>
                  {v === true ? "✓" : v === false ? "✗" : v}
                </span>
              </div>
            ))}
          </div>
          <button className="t3d-btn" style={{ width: "100%", padding: 14 }} onClick={async () => {
            await saveCheckin(checkinData, score);
            setCompletedToday(true);
            await loadData();
            setView("home");
          }}>
            BACK TO MORNING
          </button>
        </div>
      </div>
    );
  }

  return null;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
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

// ─── Fitness Section ──────────────────────────────────────────────────────────
function Fitness({ user }) {
  const [view, setView] = useState("home");
  const [split, setSplit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [setupStep, setSetupStep] = useState(0);
  const [numSessions, setNumSessions] = useState(3);
  const [sessions, setSessions] = useState([]);
  const [currentSessionIdx, setCurrentSessionIdx] = useState(0);
  const [history, setHistory] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restTimerEnabled, setRestTimerEnabled] = useState(false);
  const [restSeconds, setRestSeconds] = useState(90);
  const [restActive, setRestActive] = useState(false);
  const [restRemaining, setRestRemaining] = useState(0);
  const [aiAnswers, setAiAnswers] = useState({});
  const [aiStep, setAiStep] = useState(0);
  const [aiBuilding, setAiBuilding] = useState(false);
  const [aiPlan, setAiPlan] = useState(null);
  const [replaceWarning, setReplaceWarning] = useState(null);
  const [noDaysWarning, setNoDaysWarning] = useState(false);
  const [addExerciseModal, setAddExerciseModal] = useState(null); // sessionIdx when open
  const [newEx, setNewEx] = useState({ name: "", sets: 3, reps: [], tempo: "" });

  // Workout logger state - track sets per exercise independently
  const [activeSession, setActiveSession] = useState(null);
  const [exerciseIdx, setExerciseIdx] = useState(0);
  const [setProgress, setSetProgress] = useState({}); // { exerciseIdx: currentSetIdx }
  const [completedSets, setCompletedSets] = useState({}); // { exerciseIdx: [{weight, reps, setNum}] }
  const [currentInputs, setCurrentInputs] = useState({}); // { exerciseIdx: {weight, reps} }
  const [workoutStart, setWorkoutStart] = useState(null);

  const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

  const AI_QUESTIONS = [
    { id: "split_pref", q: "Do you have a preferred training split, or are you open to suggestions?", type: "choice", options: ["I have a preferred split", "Open to suggestions"] },
    { id: "days_per_week", q: "How many days per week can you train?", type: "choice", options: ["2-3 days", "4 days", "5 days", "6+ days"] },
    { id: "preferred_days", q: "Do you have preferred training days?", type: "text", placeholder: "e.g. Mon, Wed, Fri or no preference" },
    { id: "goal", q: "What is your main goal?", type: "choice", options: ["Build muscle", "Lose fat", "Build strength", "Athletic performance", "General fitness"] },
    { id: "experience", q: "What is your experience level?", type: "choice", options: ["Beginner (0-1 year)", "Intermediate (1-3 years)", "Advanced (3+ years)"] },
    { id: "session_length", q: "How long can you train per session?", type: "choice", options: ["30 minutes", "45 minutes", "60 minutes", "90+ minutes"] },
    { id: "equipment", q: "What equipment do you have access to?", type: "choice", options: ["Full commercial gym", "Home gym (weights)", "Dumbbells only", "Bodyweight only"] },
    { id: "weak_points", q: "Any weak points or areas you want to prioritise?", type: "text", placeholder: "e.g. legs, shoulders, core or none" },
    { id: "injuries", q: "Any injuries or exercises to avoid?", type: "text", placeholder: "e.g. bad knees, avoid overhead pressing or none" },
    { id: "favourite_exercises", q: "Any favourite exercises you definitely want included?", type: "text", placeholder: "e.g. bench press, squats or no preference" },
  ];

  useEffect(() => { if (!user) return; loadData(); }, [user]);

  useEffect(() => {
    if (!restActive) return;
    if (restRemaining <= 0) { setRestActive(false); return; }
    const timer = setTimeout(() => setRestRemaining(r => r - 1), 1000);
    return () => clearTimeout(timer);
  }, [restActive, restRemaining]);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data: splitData } = await supabase.from("workout_splits").select("*").eq("user_id", user.id).single();
      if (splitData) { setSplit(splitData); setSessions(splitData.sessions || []); }
      const { data: logs } = await supabase.from("workout_logs").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20);
      if (logs) setHistory(logs);
    } catch (e) { console.log("Load error:", e); }
    setLoading(false);
  };

  const saveSplit = async (sessionsData) => {
    if (!user) return;
    await supabase.from("workout_splits").upsert({ user_id: user.id, sessions: sessionsData, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  };

  const saveWorkoutLog = async () => {
    if (!user) return;
    const d = new Date();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    const exerciseData = activeSession.exercises.map((ex, eIdx) => ({
      name: ex.name,
      sets: (completedSets[eIdx] || []).map(s => ({ weight: s.weight, reps: s.reps })),
    }));
    const totalVol = exerciseData.reduce((a, ex) => a + ex.sets.reduce((b, s) => b + (parseFloat(s.weight)||0) * (parseInt(s.reps)||0), 0), 0);
    await supabase.from("workout_logs").insert({
      user_id: user.id, date: dateStr, session_name: activeSession?.name || "Workout",
      exercises: exerciseData, total_volume: totalVol,
      duration_mins: Math.round((Date.now() - workoutStart) / 60000),
      created_at: new Date().toISOString(),
    });
  };

  const getTodaySession = () => {
    if (!sessions.length) return null;
    const todayNum = new Date().getDay();
    const dayNames = ["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"];
    const todayShort = ["SUN","MON","TUE","WED","THU","FRI","SAT"][todayNum];
    return sessions.find(s => s.days?.some(d => d.toUpperCase() === todayShort || dayNames[todayNum].startsWith(d.toUpperCase()))) || null;
  };

  // Get last session's data for a specific exercise
  const getLastSessionData = (exName) => {
    for (const log of history) {
      const ex = log.exercises?.find(e => e.name?.toLowerCase() === exName?.toLowerCase());
      if (ex?.sets?.length) return ex.sets;
    }
    return null;
  };

  // Calculate suggested weight based on last session performance
  const getSuggestedWeight = (exName, setIdx, repRange) => {
    const lastSets = getLastSessionData(exName);
    if (!lastSets || !lastSets[setIdx]) return null;
    const lastSet = lastSets[setIdx];
    const lastWeight = parseFloat(lastSet.weight) || 0;
    const lastReps = parseInt(lastSet.reps) || 0;
    if (!lastWeight) return null;

    // Parse rep range top end
    const rangeTop = repRange ? parseInt(String(repRange).split("-").pop()) : null;
    if (rangeTop && lastReps >= rangeTop) {
      return (lastWeight + 2.5).toFixed(1); // Hit top of range — increase
    }
    return lastWeight.toFixed(1); // Keep same
  };

  const startWorkout = (session) => {
    setActiveSession(session);
    setExerciseIdx(0);
    setSetProgress({});
    setCompletedSets({});
    setCurrentInputs({});
    setWorkoutStart(Date.now());
    setView("workout");
  };

  const getCurrentSetIdx = (eIdx) => setProgress[eIdx] || 0;
  const getCompletedForExercise = (eIdx) => completedSets[eIdx] || [];

  const confirmSet = () => {
    const eIdx = exerciseIdx;
    const sIdx = getCurrentSetIdx(eIdx);
    const weight = currentInputs[eIdx]?.weight || "";
    const reps = currentInputs[eIdx]?.reps || "";
    if (!weight || !reps) return;

    const newSet = { weight, reps, setNum: sIdx + 1 };
    const newCompleted = { ...completedSets, [eIdx]: [...(completedSets[eIdx] || []), newSet] };
    setCompletedSets(newCompleted);
    setCurrentInputs(prev => ({ ...prev, [eIdx]: { weight: "", reps: "" } }));

    const totalSets = activeSession.exercises[eIdx]?.sets || 0;

    if (restTimerEnabled) { setRestRemaining(restSeconds); setRestActive(true); }

    if (sIdx + 1 < totalSets) {
      setSetProgress(prev => ({ ...prev, [eIdx]: sIdx + 1 }));
    } else {
      // All sets done for this exercise — auto move to next
      const nextIdx = eIdx + 1;
      if (nextIdx < activeSession.exercises.length) {
        setExerciseIdx(nextIdx);
      } else {
        // Workout complete
        saveWorkoutLog().then(() => { loadData(); setView("complete"); });
      }
    }
  };

  const buildAIPlan = async () => {
    setAiBuilding(true);
    const context = Object.entries(aiAnswers).map(([k, v]) => {
      const q = AI_QUESTIONS.find(q => q.id === k);
      return `${q?.q}: ${v}`;
    }).join("\n");
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: `You are an expert personal trainer. Build a complete training programme. 
SAFETY: Never recommend training through injuries. For beginners start conservatively. Recommend consulting a doctor for health conditions. This is general fitness guidance not medical advice.
Respond ONLY with valid JSON:
{"split_name": "string", "sessions": [{"name": "string", "days": ["Monday"], "exercises": [{"name": "string", "sets": 4, "reps": ["10","8","8","6"], "tempo": "3-1-0-1", "notes": "string"}]}], "notes": "string"}`,
          messages: [{ role: "user", content: `Build me a training programme:\n${context}` }],
        }),
      });
      const data = await res.json();
      const text = data.content?.map(b => b.text || "").join("") || "";
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
      setAiPlan(parsed);
    } catch (e) { console.error("AI plan error:", e); }
    setAiBuilding(false);
  };

  if (loading) return (
    <div className="t3d-fade"><div className="t3d-card" style={{ textAlign: "center", padding: 40 }}>
      <div style={{ fontSize: 11, color: "#3A5060", letterSpacing: 2 }}>LOADING FITNESS DATA...</div>
    </div></div>
  );

  // ── WORKOUT VIEW ──────────────────────────────────────────────────────────
  if (view === "workout" && activeSession) {
    const currentExercise = activeSession.exercises[exerciseIdx];
    if (!currentExercise) return null;
    const sIdx = getCurrentSetIdx(exerciseIdx);
    const totalSets = currentExercise.sets || 0;
    const totalExercises = activeSession.exercises.length;
    const exerciseCompletedSets = getCompletedForExercise(exerciseIdx);
    const currentSetRepRange = Array.isArray(currentExercise.reps) ? currentExercise.reps[sIdx] : currentExercise.reps;
    const suggestedWeight = getSuggestedWeight(currentExercise.name, sIdx, currentSetRepRange);
    const lastSets = getLastSessionData(currentExercise.name);
    const weight = currentInputs[exerciseIdx]?.weight || "";
    const reps = currentInputs[exerciseIdx]?.reps || "";

    return (
      <div className="t3d-fade">
        <div className="t3d-card">
          {/* Exercise navigation */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <button className="t3d-btn t3d-btn-sm" style={{ opacity: exerciseIdx === 0 ? 0.3 : 1 }}
              onClick={() => { if (exerciseIdx > 0) setExerciseIdx(e => e-1); }}>◀</button>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 13, letterSpacing: 2, color: "#E0EAF0" }}>{currentExercise.name}</div>
              <div style={{ fontSize: 10, color: "#3A5060", marginTop: 3 }}>Exercise {exerciseIdx+1} of {totalExercises}</div>
              {currentExercise.tempo && <div style={{ fontSize: 10, color: NEON2, marginTop: 2 }}>TEMPO: {currentExercise.tempo}</div>}
              {currentSetRepRange && <div style={{ fontSize: 10, color: "#3A5060", marginTop: 2 }}>REP RANGE: {currentSetRepRange}</div>}
            </div>
            <button className="t3d-btn t3d-btn-sm" style={{ opacity: exerciseIdx === totalExercises-1 ? 0.3 : 1 }}
              onClick={() => { if (exerciseIdx < totalExercises-1) setExerciseIdx(e => e+1); }}>▶</button>
          </div>

          {/* Rest timer */}
          {restActive && (
            <div style={{ textAlign: "center", marginBottom: 16, padding: 12, background: "rgba(0,200,255,.06)", border: "1px solid rgba(0,200,255,.2)", borderRadius: 6 }}>
              <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 24, color: NEON2 }}>{restRemaining}s</div>
              <div style={{ fontSize: 10, color: "#3A5060", letterSpacing: 1 }}>REST</div>
              <button className="t3d-btn t3d-btn-sm" style={{ marginTop: 8 }} onClick={() => setRestActive(false)}>SKIP</button>
            </div>
          )}

          {/* Current set */}
          {!restActive && (
            <div style={{ background: SURFACE2, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 20, marginBottom: 12, textAlign: "center" }}>
              <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 11, color: "#3A5060", letterSpacing: 2, marginBottom: 16 }}>
                SET {sIdx+1} OF {totalSets}
              </div>
              <div style={{ display: "flex", gap: 16, justifyContent: "center", alignItems: "center" }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#3A5060", letterSpacing: 1, marginBottom: 8 }}>REPS</div>
                  <input type="number" value={reps}
                    onChange={e => setCurrentInputs(prev => ({ ...prev, [exerciseIdx]: { ...prev[exerciseIdx], reps: e.target.value } }))}
                    placeholder="0"
                    style={{ width: 80, height: 80, background: "#E0EAF0", border: "none", borderRadius: 8, fontSize: 28, fontWeight: 700, textAlign: "center", color: "#080C10", outline: "none" }} />
                </div>
                <button onClick={confirmSet} disabled={!weight || !reps}
                  style={{ width: 60, height: 60, background: weight && reps ? NEON : BORDER, border: "none", borderRadius: 8, fontSize: 24, cursor: "pointer", color: "#080C10", fontWeight: 700 }}>▶</button>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#3A5060", letterSpacing: 1, marginBottom: 8 }}>WEIGHT (kg)</div>
                  <input type="number" value={weight}
                    onChange={e => setCurrentInputs(prev => ({ ...prev, [exerciseIdx]: { ...prev[exerciseIdx], weight: e.target.value } }))}
                    placeholder={suggestedWeight || "0"}
                    style={{ width: 80, height: 80, background: "#E0EAF0", border: "none", borderRadius: 8, fontSize: suggestedWeight && !weight ? 16 : 28, fontWeight: 700, textAlign: "center", color: "#080C10", outline: "none" }} />
                </div>
              </div>

              {/* Suggested weight hint */}
              {suggestedWeight && (
                <div style={{ marginTop: 10, fontSize: 10, color: NEON, letterSpacing: 1 }}>
                  {getLastSessionData(currentExercise.name)?.[sIdx]?.reps >= (currentSetRepRange ? parseInt(String(currentSetRepRange).split("-").pop()) : 999)
                    ? `↑ Try ${suggestedWeight}kg — you hit the top of your range last time!`
                    : `Last session: ${suggestedWeight}kg`
                  }
                </div>
              )}
            </div>
          )}

          {/* Last session scores */}
          {lastSets && lastSets.length > 0 && (
            <div style={{ background: "rgba(0,200,255,.04)", border: "1px solid rgba(0,200,255,.1)", borderRadius: 6, padding: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 9, color: "#3A5060", letterSpacing: 2, marginBottom: 6, fontFamily: "'Orbitron',monospace" }}>LAST SESSION</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {lastSets.map((s, i) => (
                  <div key={i} style={{ fontSize: 10, color: NEON2 }}>Set {i+1}: {s.reps} reps @ {s.weight}kg</div>
                ))}
              </div>
            </div>
          )}

          {/* Completed sets this session */}
          {exerciseCompletedSets.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {exerciseCompletedSets.map((s, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${BORDER}`, fontSize: 10, opacity: 0.7 }}>
                  <span style={{ color: "#3A5060", fontFamily: "'Orbitron',monospace", fontSize: 9 }}>SET {s.setNum} ✓</span>
                  <span style={{ color: NEON }}>{s.reps} reps</span>
                  <span style={{ color: NEON2 }}>{s.weight}kg</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button className="t3d-btn t3d-btn-sm t3d-btn-red" style={{ fontSize: 8 }} onClick={() => setReplaceWarning(exerciseIdx)}>REPLACE</button>
            <button className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={async () => { await saveWorkoutLog(); await loadData(); setView("home"); }}>END WORKOUT</button>
          </div>

          {replaceWarning !== null && (
            <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
              <div style={{ background: SURFACE, border: `1px solid ${NEON3}`, borderRadius: 8, padding: 28, maxWidth: 320, textAlign: "center" }}>
                <div style={{ fontSize: 24, marginBottom: 12 }}>⚠️</div>
                <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 11, color: NEON3, letterSpacing: 2, marginBottom: 12 }}>OFF PLAN WARNING</div>
                <div style={{ fontSize: 12, color: "#8AABB8", marginBottom: 20, lineHeight: 1.6 }}>Going off plan is not recommended. Consistency delivers the best results. Are you sure?</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="t3d-btn t3d-btn-sm" style={{ flex: 1 }} onClick={() => setReplaceWarning(null)}>STAY ON PLAN</button>
                  <button className="t3d-btn t3d-btn-sm t3d-btn-red" style={{ flex: 1 }} onClick={() => {
                    const newName = prompt("Enter replacement exercise name:");
                    if (newName) {
                      const updated = JSON.parse(JSON.stringify(activeSession));
                      updated.exercises[replaceWarning].name = newName;
                      setActiveSession(updated);
                    }
                    setReplaceWarning(null);
                  }}>REPLACE</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── WORKOUT COMPLETE ──────────────────────────────────────────────────────
  if (view === "complete") {
    const allSets = Object.values(completedSets).flat();
    const totalVol = allSets.reduce((a, s) => a + (parseFloat(s.weight)||0) * (parseInt(s.reps)||0), 0);
    const duration = Math.round((Date.now() - workoutStart) / 60000);
    return (
      <div className="t3d-fade">
        <div className="t3d-card" style={{ textAlign: "center", padding: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>💪</div>
          <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 14, color: NEON, letterSpacing: 3, marginBottom: 24 }}>WORKOUT COMPLETE</div>
          <div className="t3d-grid3" style={{ marginBottom: 20 }}>
            <div><div style={{ fontFamily: "'Orbitron',monospace", fontSize: 20, color: NEON }}>{duration}</div><div style={{ fontSize: 9, color: "#3A5060", letterSpacing: 1 }}>MINUTES</div></div>
            <div><div style={{ fontFamily: "'Orbitron',monospace", fontSize: 20, color: NEON2 }}>{allSets.length}</div><div style={{ fontSize: 9, color: "#3A5060", letterSpacing: 1 }}>SETS</div></div>
            <div><div style={{ fontFamily: "'Orbitron',monospace", fontSize: 20, color: "#FF8C00" }}>{Math.round(totalVol).toLocaleString()}</div><div style={{ fontSize: 9, color: "#3A5060", letterSpacing: 1 }}>KG VOLUME</div></div>
          </div>
          {activeSession?.exercises?.map((ex, eIdx) => {
            const sets = completedSets[eIdx] || [];
            if (!sets.length) return null;
            return (
              <div key={eIdx} style={{ marginBottom: 12, textAlign: "left" }}>
                <div style={{ fontSize: 11, color: "#E0EAF0", marginBottom: 6 }}>{ex.name}</div>
                {sets.map((s, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#3A5060", padding: "3px 0" }}>
                    <span>Set {s.setNum}</span><span style={{ color: NEON }}>{s.reps} reps @ {s.weight}kg</span>
                  </div>
                ))}
              </div>
            );
          })}
          <button className="t3d-btn" style={{ width: "100%", padding: 14, marginTop: 16 }} onClick={() => setView("home")}>BACK TO FITNESS</button>
        </div>
      </div>
    );
  }

  // ── AI BUILDER ────────────────────────────────────────────────────────────
  if (view === "ai_builder") {
    if (aiBuilding) return (
      <div className="t3d-fade"><div className="t3d-card" style={{ textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 30, marginBottom: 16 }}>🤖</div>
        <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 11, color: NEON, letterSpacing: 2, marginBottom: 8 }}>BUILDING YOUR PROGRAMME</div>
        <div style={{ fontSize: 11, color: "#3A5060" }}>Analysing your answers...</div>
      </div></div>
    );

    if (aiPlan) return (
      <div className="t3d-fade">
        <div className="t3d-card">
          <div className="t3d-ctitle">YOUR AI PROGRAMME — {aiPlan.split_name}</div>
          {aiPlan.notes && <div style={{ background: "rgba(0,255,178,.04)", border: "1px solid rgba(0,255,178,.15)", borderRadius: 6, padding: 12, marginBottom: 16, fontSize: 11, color: "#8AABB8", lineHeight: 1.6 }}>{aiPlan.notes}</div>}
          {aiPlan.sessions?.map((s, sIdx) => (
            <div key={sIdx} style={{ marginBottom: 16, background: SURFACE2, borderRadius: 6, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 11, color: NEON }}>{s.name}</div>
                <div style={{ fontSize: 10, color: "#3A5060" }}>{s.days?.join(", ")}</div>
              </div>
              {s.exercises?.map((ex, eIdx) => (
                <div key={eIdx} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: `1px solid ${BORDER}`, fontSize: 11 }}>
                  <div style={{ flex: 1 }}>{ex.name}</div>
                  <div style={{ fontSize: 10, color: "#3A5060" }}>{ex.sets}×{Array.isArray(ex.reps) ? ex.reps.join("/") : ex.reps}</div>
                  {ex.tempo && <div style={{ fontSize: 9, color: NEON2 }}>{ex.tempo}</div>}
                </div>
              ))}
            </div>
          ))}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={() => setAiPlan(null)}>REBUILD</button>
            <button className="t3d-btn" style={{ flex: 1, padding: 12 }} onClick={async () => {
              await saveSplit(aiPlan.sessions);
              setSessions(aiPlan.sessions);
              setSplit({ sessions: aiPlan.sessions });
              setView("home");
            }}>SAVE PROGRAMME ✓</button>
          </div>
        </div>
      </div>
    );

    const currentQ = AI_QUESTIONS[aiStep];
    return (
      <div className="t3d-fade">
        <div className="t3d-card">
          <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
            {AI_QUESTIONS.map((_, i) => (
              <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= aiStep ? NEON : BORDER, transition: "background .3s" }} />
            ))}
          </div>
          <div style={{ fontSize: 10, color: "#3A5060", letterSpacing: 1, marginBottom: 8 }}>QUESTION {aiStep+1} OF {AI_QUESTIONS.length}</div>
          <div style={{ fontSize: 14, color: "#E0EAF0", marginBottom: 24, lineHeight: 1.6 }}>{currentQ.q}</div>
          {currentQ.type === "choice" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
              {currentQ.options.map((opt, i) => (
                <button key={i} className="t3d-btn" style={{ textAlign: "left", padding: "12px 16px", fontSize: 11, letterSpacing: 1,
                  background: aiAnswers[currentQ.id] === opt ? "rgba(0,255,178,.15)" : "transparent",
                  borderColor: aiAnswers[currentQ.id] === opt ? NEON : BORDER,
                  color: aiAnswers[currentQ.id] === opt ? NEON : "#4A6070" }}
                  onClick={() => {
                    setAiAnswers(a => ({ ...a, [currentQ.id]: opt }));
                    setTimeout(() => { if (aiStep < AI_QUESTIONS.length-1) setAiStep(s => s+1); else buildAIPlan(); }, 300);
                  }}>{opt}</button>
              ))}
            </div>
          )}
          {currentQ.type === "text" && (
            <div style={{ marginBottom: 20 }}>
              <input className="t3d-input" placeholder={currentQ.placeholder}
                value={aiAnswers[currentQ.id] || ""}
                onChange={e => setAiAnswers(a => ({ ...a, [currentQ.id]: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && aiAnswers[currentQ.id] && (aiStep < AI_QUESTIONS.length-1 ? setAiStep(s => s+1) : buildAIPlan())} />
              <button className="t3d-btn" style={{ width: "100%", padding: 12, marginTop: 12 }}
                disabled={!aiAnswers[currentQ.id]}
                onClick={() => aiStep < AI_QUESTIONS.length-1 ? setAiStep(s => s+1) : buildAIPlan()}>
                {aiStep < AI_QUESTIONS.length-1 ? "NEXT →" : "BUILD MY PROGRAMME"}
              </button>
            </div>
          )}
          {aiStep > 0 && <button className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={() => setAiStep(s => s-1)}>← BACK</button>}
        </div>
      </div>
    );
  }

  // ── MANUAL SETUP ──────────────────────────────────────────────────────────
  if (view === "setup") {
    return (
      <div className="t3d-fade">
        <div className="t3d-card">
          {setupStep === 0 && (
            <div>
              <div className="t3d-ctitle">HOW MANY SESSIONS PER WEEK?</div>
              <div style={{ display: "flex", justifyContent: "center", gap: 12, margin: "32px 0" }}>
                {[2,3,4,5,6].map(n => (
                  <button key={n} className="t3d-btn" style={{ width: 50, height: 50, fontSize: 18, padding: 0,
                    background: numSessions === n ? "rgba(0,255,178,.15)" : "transparent",
                    borderColor: numSessions === n ? NEON : BORDER }}
                    onClick={() => setNumSessions(n)}>{n}</button>
                ))}
              </div>
              <button className="t3d-btn" style={{ width: "100%", padding: 14 }} onClick={() => {
                setSessions(Array.from({ length: numSessions }, (_, i) => ({ name: `Session ${i+1}`, days: [], exercises: [] })));
                setSetupStep(1); setCurrentSessionIdx(0);
              }}>NEXT →</button>
            </div>
          )}

          {setupStep === 1 && sessions[currentSessionIdx] && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div className="t3d-ctitle" style={{ margin: 0 }}>SESSION {currentSessionIdx+1} OF {sessions.length}</div>
                <div style={{ fontSize: 10, color: "#3A5060" }}>{currentSessionIdx+1}/{sessions.length}</div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "#3A5060", letterSpacing: 1, marginBottom: 6 }}>SESSION NAME</div>
                <input className="t3d-input" placeholder="e.g. Push, Pull, Legs, Upper..."
                  value={sessions[currentSessionIdx].name}
                  onChange={e => setSessions(prev => prev.map((s, i) => i === currentSessionIdx ? { ...s, name: e.target.value } : s))} />
              </div>

              {/* Days — optional */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "#3A5060", letterSpacing: 1, marginBottom: 6 }}>
                  TRAINING DAYS <span style={{ color: "#2A3A48" }}>(OPTIONAL)</span>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {DAYS.map(d => {
                    const selected = sessions[currentSessionIdx].days?.includes(d);
                    return (
                      <button key={d} className="t3d-btn t3d-btn-sm"
                        style={{ background: selected ? "rgba(0,255,178,.15)" : "transparent", borderColor: selected ? NEON : BORDER, color: selected ? NEON : "#3A5060" }}
                        onClick={() => setSessions(prev => prev.map((s, i) => i === currentSessionIdx ? {
                          ...s, days: selected ? s.days.filter(x => x !== d) : [...(s.days||[]), d]
                        } : s))}>
                        {d}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Exercises */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "#3A5060", letterSpacing: 1, marginBottom: 8 }}>EXERCISES</div>
                {sessions[currentSessionIdx].exercises?.map((ex, eIdx) => (
                  <div key={eIdx} style={{ background: SURFACE2, borderRadius: 6, padding: 12, marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <div style={{ fontSize: 12 }}>{ex.name}</div>
                      <button className="t3d-btn t3d-btn-sm t3d-btn-red" style={{ fontSize: 8 }}
                        onClick={() => setSessions(prev => prev.map((s, i) => i === currentSessionIdx ? { ...s, exercises: s.exercises.filter((_, j) => j !== eIdx) } : s))}>✕</button>
                    </div>
                    <div style={{ fontSize: 10, color: "#3A5060" }}>
                      {ex.sets} sets · {Array.isArray(ex.reps) ? ex.reps.join(" / ") : ex.reps} reps
                      {ex.tempo && ` · ${ex.tempo}`}
                    </div>
                  </div>
                ))}
                <button className="t3d-btn t3d-btn-sm" style={{ width: "100%", marginTop: 4 }}
                  onClick={() => setAddExerciseModal(currentSessionIdx)}>+ ADD EXERCISE</button>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                {currentSessionIdx > 0 && <button className="t3d-btn t3d-btn-sm t3d-btn-red" onClick={() => setCurrentSessionIdx(i => i-1)}>← BACK</button>}
                {currentSessionIdx < sessions.length-1 ? (
                  <button className="t3d-btn" style={{ flex: 1, padding: 12 }} onClick={() => setCurrentSessionIdx(i => i+1)}>NEXT SESSION →</button>
                ) : (
                  <button className="t3d-btn" style={{ flex: 1, padding: 12 }} onClick={async () => {
                    const hasNoDays = sessions.some(s => !s.days || s.days.length === 0);
                    if (hasNoDays) { setNoDaysWarning(true); return; }
                    await saveSplit(sessions);
                    setSplit({ sessions });
                    setView("home");
                  }}>SAVE SPLIT ✓</button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* No days warning modal */}
        {noDaysWarning && (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
            <div style={{ background: SURFACE, border: `1px solid ${NEON2}`, borderRadius: 8, padding: 28, maxWidth: 340, textAlign: "center" }}>
              <div style={{ fontSize: 24, marginBottom: 12 }}>📅</div>
              <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 11, color: NEON2, letterSpacing: 2, marginBottom: 12 }}>ALLOCATE YOUR DAYS</div>
              <div style={{ fontSize: 12, color: "#8AABB8", marginBottom: 20, lineHeight: 1.7 }}>
                Scheduling sessions to specific days helps build consistency, lets TRACK3D show you today's workout automatically, and makes it easier to stay on track. We strongly recommend allocating days!
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="t3d-btn t3d-btn-sm" style={{ flex: 1 }} onClick={() => setNoDaysWarning(false)}>GO BACK & ADD DAYS</button>
                <button className="t3d-btn t3d-btn-sm" style={{ flex: 1, borderColor: BORDER, color: "#3A5060" }} onClick={async () => {
                  setNoDaysWarning(false);
                  await saveSplit(sessions);
                  setSplit({ sessions });
                  setView("home");
                }}>SAVE ANYWAY</button>
              </div>
            </div>
          </div>
        )}

        {/* Add exercise modal */}
        {addExerciseModal !== null && (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.9)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
            <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 24, width: "100%", maxWidth: 380 }}>
              <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 11, color: NEON, letterSpacing: 2, marginBottom: 16 }}>ADD EXERCISE</div>

              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: "#3A5060", letterSpacing: 1, marginBottom: 6 }}>EXERCISE NAME</div>
                <input className="t3d-input" placeholder="e.g. Bench Press" value={newEx.name} onChange={e => setNewEx(n => ({ ...n, name: e.target.value }))} />
              </div>

              <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "#3A5060", letterSpacing: 1, marginBottom: 6 }}>SETS</div>
                  <input className="t3d-input" type="number" placeholder="3" value={newEx.sets}
                    onChange={e => {
                      const n = parseInt(e.target.value) || 1;
                      setNewEx(prev => ({ ...prev, sets: n, reps: Array.from({ length: n }, (_, i) => prev.reps[i] || "") }));
                    }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "#3A5060", letterSpacing: 1, marginBottom: 6 }}>TEMPO (OPT)</div>
                  <input className="t3d-input" placeholder="3-1-0-1" value={newEx.tempo} onChange={e => setNewEx(n => ({ ...n, tempo: e.target.value }))} />
                </div>
              </div>

              {/* Per-set rep ranges */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: "#3A5060", letterSpacing: 1, marginBottom: 8 }}>REPS PER SET</div>
                {Array.from({ length: newEx.sets || 3 }, (_, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <div style={{ fontSize: 10, color: "#3A5060", width: 40, fontFamily: "'Orbitron',monospace" }}>SET {i+1}</div>
                    <input className="t3d-input" placeholder="e.g. 8-10 or 8"
                      value={newEx.reps[i] || ""}
                      onChange={e => setNewEx(prev => {
                        const reps = [...(prev.reps || [])];
                        reps[i] = e.target.value;
                        return { ...prev, reps };
                      })} />
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button className="t3d-btn t3d-btn-sm t3d-btn-red" style={{ flex: 1 }} onClick={() => { setAddExerciseModal(null); setNewEx({ name: "", sets: 3, reps: [], tempo: "" }); }}>CANCEL</button>
                <button className="t3d-btn" style={{ flex: 1 }} disabled={!newEx.name}
                  onClick={() => {
                    setSessions(prev => prev.map((s, i) => i === addExerciseModal ? {
                      ...s, exercises: [...(s.exercises||[]), { name: newEx.name, sets: newEx.sets || 3, reps: newEx.reps, tempo: newEx.tempo }]
                    } : s));
                    setAddExerciseModal(null);
                    setNewEx({ name: "", sets: 3, reps: [], tempo: "" });
                  }}>ADD ✓</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── HOME VIEW ─────────────────────────────────────────────────────────────
  const todaySession = getTodaySession();
  const thisWeekLogs = history.filter(h => {
    const d = new Date(h.date); const now = new Date();
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay());
    return d >= weekStart;
  });

  return (
    <div className="t3d-fade">
      {!split ? (
        <div className="t3d-card" style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚡</div>
          <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 14, letterSpacing: 3, color: NEON, marginBottom: 8 }}>FITNESS</div>
          <div style={{ fontSize: 12, color: "#3A5060", marginBottom: 28, lineHeight: 1.7 }}>Set up your training programme.<br />Track every session. Beat every record.</div>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button className="t3d-btn" style={{ padding: "14px 20px", fontSize: 10 }} onClick={() => setView("setup")}>📋 BUILD MY SPLIT</button>
            <button className="t3d-btn" style={{ padding: "14px 20px", fontSize: 10, borderColor: "rgba(0,200,255,.3)", color: NEON2 }}
              onClick={() => { setAiStep(0); setAiAnswers({}); setAiPlan(null); setView("ai_builder"); }}>🤖 AI BUILD MY PROGRAMME</button>
          </div>
          <div style={{ marginTop: 20, fontSize: 10, color: "#2A3A48", lineHeight: 1.6 }}>TRACK3D provides general fitness guidance. Consult a qualified professional before starting any new exercise programme. Not medical advice.</div>
        </div>
      ) : (
        <>
          <div className="t3d-grid3">
            <div className="t3d-card" style={{ textAlign: "center" }}>
              <div className="t3d-ctitle">THIS WEEK</div>
              <div className="t3d-sval" style={{ color: NEON }}>{thisWeekLogs.length}</div>
              <div className="t3d-slabel">SESSIONS</div>
            </div>
            <div className="t3d-card" style={{ textAlign: "center" }}>
              <div className="t3d-ctitle">TOTAL VOLUME</div>
              <div className="t3d-sval" style={{ color: NEON2, fontSize: 20 }}>{thisWeekLogs.reduce((a, l) => a + (l.total_volume||0), 0).toLocaleString()}</div>
              <div className="t3d-slabel">KG THIS WEEK</div>
            </div>
            <div className="t3d-card" style={{ textAlign: "center" }}>
              <div className="t3d-ctitle">LAST SESSION</div>
              <div className="t3d-sval" style={{ color: "#FF8C00", fontSize: 16 }}>{history[0]?.session_name || "—"}</div>
              <div className="t3d-slabel">{history[0]?.date || "NO SESSIONS YET"}</div>
            </div>
          </div>

          <div className="t3d-card" style={{ marginBottom: 16, textAlign: "center", padding: 28 }}>
            {todaySession ? (
              <>
                <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 12, color: "#3A5060", letterSpacing: 2, marginBottom: 8 }}>TODAY</div>
                <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 20, color: NEON, marginBottom: 8 }}>{todaySession.name}</div>
                <div style={{ fontSize: 11, color: "#3A5060", marginBottom: 20 }}>{todaySession.exercises?.length} exercises</div>
                <button className="t3d-big-btn"
                  style={{ background: "linear-gradient(90deg, rgba(0,255,178,.15), rgba(0,200,255,.15))", border: `1px solid ${NEON}`, color: NEON, fontSize: 14, letterSpacing: 3 }}
                  onClick={() => startWorkout(todaySession)}>⚡ START WORKOUT</button>
              </>
            ) : (
              <>
                <div style={{ fontSize: 11, color: "#3A5060", marginBottom: 16 }}>NO SESSION SCHEDULED TODAY</div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                  {sessions.map((s, i) => <button key={i} className="t3d-btn t3d-btn-sm" onClick={() => startWorkout(s)}>{s.name}</button>)}
                </div>
              </>
            )}
          </div>

          <div className="t3d-card" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div className="t3d-ctitle" style={{ margin: 0 }}>WEEKLY SPLIT</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="t3d-btn t3d-btn-sm" onClick={() => { setSetupStep(0); setView("setup"); }}>EDIT</button>
                <button className="t3d-btn t3d-btn-sm" style={{ borderColor: "rgba(0,200,255,.3)", color: NEON2 }} onClick={() => { setAiStep(0); setAiAnswers({}); setAiPlan(null); setView("ai_builder"); }}>AI REBUILD</button>
              </div>
            </div>
            {DAYS.map(day => {
              const dayIdx = ["MON","TUE","WED","THU","FRI","SAT","SUN"].indexOf(day);
              const todayIdx = [1,2,3,4,5,6,0][new Date().getDay()-1] ?? new Date().getDay()-1;
              const isToday = dayIdx === [1,2,3,4,5,6,0].indexOf(new Date().getDay());
              const session = sessions.find(s => s.days?.includes(day));
              return (
                <div key={day} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: `1px solid ${BORDER}` }}>
                  <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 10, width: 32, color: isToday ? NEON : "#3A5060" }}>{day}</div>
                  <div style={{ flex: 1, fontSize: 11, color: session ? (isToday ? "#E0EAF0" : "#4A6070") : "#2A3A48" }}>{session ? session.name : "REST"}</div>
                  {isToday && <span style={{ fontFamily: "'Orbitron',monospace", fontSize: 8, padding: "2px 7px", borderRadius: 10, background: "rgba(0,255,178,.1)", color: NEON, border: "1px solid rgba(0,255,178,.25)" }}>TODAY</span>}
                </div>
              );
            })}
          </div>

          <div className="t3d-card" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="t3d-ctitle" style={{ margin: 0 }}>REST TIMER</div>
              <button className="t3d-btn t3d-btn-sm"
                style={{ background: restTimerEnabled ? "rgba(0,255,178,.15)" : "transparent", borderColor: restTimerEnabled ? NEON : BORDER }}
                onClick={() => setRestTimerEnabled(v => !v)}>{restTimerEnabled ? "ON" : "OFF"}</button>
            </div>
            {restTimerEnabled && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <div style={{ fontSize: 11, color: "#3A5060" }}>Duration:</div>
                {[30,60,90,120,180].map(s => (
                  <button key={s} className="t3d-btn t3d-btn-sm"
                    style={{ background: restSeconds === s ? "rgba(0,255,178,.15)" : "transparent", borderColor: restSeconds === s ? NEON : BORDER, color: restSeconds === s ? NEON : "#3A5060" }}
                    onClick={() => setRestSeconds(s)}>{s}s</button>
                ))}
              </div>
            )}
          </div>

          <div className="t3d-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setHistoryOpen(h => !h)}>
              <div className="t3d-ctitle" style={{ margin: 0 }}>WORKOUT HISTORY</div>
              <div style={{ color: "#3A5060", fontSize: 14, transform: historyOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform .2s" }}>▾</div>
            </div>
            {historyOpen && (
              <div style={{ marginTop: 16 }}>
                {history.length === 0 ? (
                  <div style={{ fontSize: 11, color: "#3A5060", textAlign: "center", padding: "16px 0" }}>No workouts logged yet!</div>
                ) : history.map((log, i) => (
                  <div key={i} style={{ padding: "12px 0", borderBottom: `1px solid ${BORDER}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 10, color: NEON }}>{log.session_name}</div>
                      <div style={{ fontSize: 10, color: "#3A5060" }}>{log.date}</div>
                    </div>
                    <div style={{ display: "flex", gap: 16, fontSize: 10, color: "#3A5060" }}>
                      <span>{log.duration_mins} mins</span>
                      <span>{Math.round(log.total_volume).toLocaleString()} kg volume</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}



// ─── Nutrition ────────────────────────────────────────────────────────────────
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

// ─── Habits ───────────────────────────────────────────────────────────────────
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

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tab, setTab] = useState("dashboard");
  const [habits, setHabits] = useState(INITIAL_HABITS);

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

  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: "#080C10", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Orbitron',monospace", color: "#00FFB2", letterSpacing: 4, fontSize: 12 }}>
      LOADING...
    </div>
  );

  const nav = [
    { id: "dashboard", icon: "◈", label: "DASHBOARD" },
    { id: "morning", icon: "🌅", label: "MORNING" },
    { id: "fitness", icon: "⚡", label: "FITNESS" },
    { id: "nutrition", icon: "◎", label: "NUTRITION" },
    { id: "habits", icon: "◇", label: "HABITS" },
  ];

  const titles = { dashboard: "OVERVIEW", morning: "MORNING", fitness: "FITNESS", nutrition: "NUTRITION", habits: "HABITS" };

  return (
    <>
      <style>{css}</style>
      <div className="t3d">
        <nav className="t3d-sidebar">
          <div className="t3d-logo">TRACK3D<small>Awareness. Strategy. Action. Results.</small></div>
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
              <button className="t3d-btn t3d-btn-sm" style={{ fontSize: 16, padding: "6px 12px" }}
  onClick={() => document.querySelector('.t3d-sidebar').style.display = 
    document.querySelector('.t3d-sidebar').style.display === 'none' ? 'flex' : 'none'}>
  ☰
</button>
              <div className="t3d-dot" />
              <span style={{ fontSize: 10, color: "#2A3A48", letterSpacing: 1 }}>LIVE</span>
              <button className="t3d-btn t3d-btn-sm" style={{ fontSize: 9, marginLeft: 12 }}
                onClick={async () => { await supabase.auth.signOut(); window.location.href = "/login"; }}>
                SIGN OUT
              </button>
              <button className="t3d-btn t3d-btn-sm" style={{ fontSize: 9, marginLeft: 12 }}
                onClick={async () => { await supabase.auth.signOut(); window.location.href = "/login"; }}>
                SIGN OUT
              </button>
            </div>
          </div>

          {tab === "dashboard" && <Dashboard habits={habits} setHabits={setHabits} />}
          {tab === "morning" && <MorningSection user={user} />}
          {tab === "fitness" && <Fitness user={user} />}
          {tab === "nutrition" && <Nutrition />}
          {tab === "habits" && <HabitsPage habits={habits} setHabits={setHabits} />}
        </main>
      </div>
    </>
  );
}