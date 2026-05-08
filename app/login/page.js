"use client";
import { useState } from "react";
import { supabase } from "../../lib/supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [isForgot, setIsForgot] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  const handleAuth = async () => {
    setLoading(true);
    setMessage("");
    setIsError(false);

    if (isForgot) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) { setMessage(error.message); setIsError(true); }
      else setMessage("Check your email for a password reset link!");
      setLoading(false);
      return;
    }

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) { setMessage(error.message); setIsError(true); }
      else setMessage("Check your email to confirm your account!");
    } else {
      // persistSession: true is default in Supabase — keeps users logged in
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { setMessage(error.message); setIsError(true); }
      else window.location.href = "/";
    }
    setLoading(false);
  };

  const inputStyle = {
    width: "100%", background: "#111921", border: "1px solid #1A2530",
    borderRadius: 6, padding: "12px 14px", color: "#E0EAF0",
    fontFamily: "'Space Mono', monospace", fontSize: 12, outline: "none",
    marginBottom: 12, boxSizing: "border-box", colorScheme: "dark",
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#080C10", display: "flex",
      alignItems: "center", justifyContent: "center",
      fontFamily: "'Space Mono', monospace", padding: 20,
    }}>
      <div style={{
        background: "#0D1318", border: "1px solid #1A2530", borderRadius: 12,
        padding: 40, width: "100%", maxWidth: 400, position: "relative",
      }}>
        {/* Logo */}
        <div style={{
          fontFamily: "'Orbitron', monospace", fontSize: 24, fontWeight: 900,
          letterSpacing: 4, background: "linear-gradient(90deg,#00FFB2,#00C8FF)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          marginBottom: 4, textAlign: "center",
        }}>TRACK3D</div>
        <div style={{ fontSize: 10, color: "#FFFFFF", letterSpacing: 2, marginBottom: 32, textAlign: "center" }}>
          Awareness. Strategy. Action. Results.
        </div>

        <div style={{ fontSize: 11, color: "#3A5060", letterSpacing: 2, marginBottom: 24 }}>
          {isForgot ? "RESET PASSWORD" : isSignUp ? "CREATE ACCOUNT" : "SIGN IN"}
        </div>

        <input type="email" placeholder="Email address" value={email}
          onChange={e => setEmail(e.target.value)} style={inputStyle} />

        {!isForgot && (
          <input type="password" placeholder="Password" value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAuth()}
            style={inputStyle} />
        )}

        {message && (
          <div style={{
            fontSize: 11, marginBottom: 16, letterSpacing: 0.5, lineHeight: 1.5,
            color: isError ? "#FF2D78" : "#00FFB2",
          }}>{message}</div>
        )}

        <button onClick={handleAuth} disabled={loading} style={{
          width: "100%", background: "rgba(0,255,178,.08)",
          border: "1px solid rgba(0,255,178,.3)", color: "#00FFB2",
          fontFamily: "'Orbitron', monospace", fontSize: 11, letterSpacing: 2,
          padding: "13px 0", borderRadius: 6, cursor: "pointer", marginBottom: 16,
          opacity: loading ? 0.5 : 1,
        }}>
          {loading ? "LOADING..." : isForgot ? "SEND RESET EMAIL" : isSignUp ? "CREATE ACCOUNT" : "SIGN IN"}
        </button>

        {/* Forgot password */}
        {!isSignUp && !isForgot && (
          <div onClick={() => { setIsForgot(true); setMessage(""); }}
            style={{ fontSize: 11, color: "#3A5060", textAlign: "center", cursor: "pointer", letterSpacing: 1, marginBottom: 12 }}>
            Forgot your password?
          </div>
        )}

        {/* Back / toggle */}
        <div onClick={() => { setIsForgot(false); setIsSignUp(!isSignUp && !isForgot ? true : false); setMessage(""); }}
          style={{ fontSize: 11, color: "#FFFFFF", textAlign: "center", cursor: "pointer", letterSpacing: 1 }}>
          {isForgot ? "← Back to sign in" : isSignUp ? "Already have an account? Sign in" : "No account? Create one"}
        </div>
      </div>
    </div>
  );
}