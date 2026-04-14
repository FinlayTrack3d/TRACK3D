"use client";
import { useState } from "react";
import { supabase } from "../../lib/supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleAuth = async () => {
    setLoading(true);
    setError("");
    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
      else setError("Check your email to confirm your account!");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
      else window.location.href = "/";
    }
    setLoading(false);
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#080C10", display: "flex",
      alignItems: "center", justifyContent: "center", fontFamily: "'Space Mono', monospace"
    }}>
      <div style={{
        background: "#0D1318", border: "1px solid #1A2530", borderRadius: 12,
        padding: 40, width: "100%", maxWidth: 400, position: "relative"
      }}>
        <div style={{
          fontFamily: "'Orbitron', monospace", fontSize: 24, fontWeight: 900,
          letterSpacing: 4, background: "linear-gradient(90deg,#00FFB2,#00C8FF)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          marginBottom: 4 , textAlign: "center"
        }}>TRACK3D</div>
        <div style={{ fontSize: 10, color: "#FFFFFF", letterSpacing: 2, marginBottom: 32, textAlign: "center" }}>
          Awareness. Strategy. Action. Results.
        </div>

        <div style={{ fontSize: 11, color: "#3A5060", letterSpacing: 2, marginBottom: 24 }}>
          {isSignUp ? "CREATE ACCOUNT" : "SIGN IN"}
        </div>

        <input
          type="email"
          placeholder="Email address"
          value={email}
          onChange={e => setEmail(e.target.value)}
          style={{
            width: "100%", background: "#111921", border: "1px solid #1A2530",
            borderRadius: 6, padding: "12px 14px", color: "#E0EAF0",
            fontFamily: "'Space Mono', monospace", fontSize: 12, outline: "none",
            marginBottom: 12, boxSizing: "border-box"
          }}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleAuth()}
          style={{
            width: "100%", background: "#111921", border: "1px solid #1A2530",
            borderRadius: 6, padding: "12px 14px", color: "#E0EAF0",
            fontFamily: "'Space Mono', monospace", fontSize: 12, outline: "none",
            marginBottom: 20, boxSizing: "border-box"
          }}
        />

        {error && (
          <div style={{
            fontSize: 11, color: error.includes("Check") ? "#00FFB2" : "#FF2D78",
            marginBottom: 16, letterSpacing: 0.5
          }}>{error}</div>
        )}

        <button
          onClick={handleAuth}
          disabled={loading}
          style={{
            width: "100%", background: "rgba(0,255,178,.08)",
            border: "1px solid rgba(0,255,178,.3)", color: "#00FFB2",
            fontFamily: "'Orbitron', monospace", fontSize: 11, letterSpacing: 2,
            padding: "13px 0", borderRadius: 6, cursor: "pointer", marginBottom: 16
          }}>
          {loading ? "LOADING..." : isSignUp ? "CREATE ACCOUNT" : "SIGN IN"}
        </button>

        <div
          onClick={() => setIsSignUp(!isSignUp)}
          style={{ fontSize: 11, color: "#FFFFFF", textAlign: "center", cursor: "pointer", letterSpacing: 1 }}>
          {isSignUp ? "Already have an account? Sign in" : "No account? Create one"}
        </div>
      </div>
    </div>
  );
}