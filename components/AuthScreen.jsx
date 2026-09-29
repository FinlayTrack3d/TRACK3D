"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { beginLoginWindow, loginWindowExpiry } from "../lib/login-window";
import PublicShell from "./PublicShell";
import styles from "./PublicPages.module.css";

const COPY = {
  login: { title: "Sign in", intro: "Continue your routines, coaching and progress tracking.", submit: "SIGN IN" },
  signup: { title: "Create your account", intro: "Build a plan around your routines, training and goals.", submit: "CREATE ACCOUNT" },
  forgot: { title: "Reset your password", intro: "Enter your email and we’ll send you a secure reset link.", submit: "SEND RESET EMAIL" },
  reset: { title: "Choose a new password", intro: "Use at least eight characters and keep it unique to TRACK3D.", submit: "UPDATE PASSWORD" },
};

export default function AuthScreen({ mode }) {
  const copy = COPY[mode];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    if (mode === "reset") return;
    let cancelled = false;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!cancelled && !error && data.session && loginWindowExpiry(data.session.user.id) > Date.now()) window.location.replace("/app");
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [mode]);

  const fail = (text) => { setMessage(text); setIsError(true); setLoading(false); };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setMessage("");
    setIsError(false);

    if ((mode === "signup" || mode === "reset") && password.length < 8) return fail("Use at least eight characters for your password.");
    if ((mode === "signup" || mode === "reset") && password !== confirmPassword) return fail("The passwords do not match.");

    if (mode === "forgot") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
      if (error) return fail(error.message);
      setMessage("Check your email for a password reset link.");
      setLoading(false);
      return;
    }

    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/app` } });
      if (error) return fail(error.message);
      setMessage("Check your email to confirm your account.");
      setLoading(false);
      return;
    }

    if (mode === "reset") {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) return fail(error.message);
      await supabase.auth.signOut({ scope: "local" });
      setMessage("Password updated. You can now sign in.");
      setPassword("");
      setConfirmPassword("");
      setLoading(false);
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return fail(error.message);
    beginLoginWindow(data.user.id);
    window.location.replace("/app");
  };

  const needsEmail = mode !== "reset";
  const needsPassword = mode !== "forgot";
  const needsConfirmation = mode === "signup" || mode === "reset";

  return <PublicShell compact>
    <main className={styles.authMain}>
      <form className={styles.authCard} onSubmit={handleSubmit}>
        <div className={styles.sectionLabel}>TRACK3D ACCOUNT</div>
        <h1>{copy.title}</h1>
        <p className={styles.intro}>{copy.intro}</p>

        {needsEmail && <label className={styles.field}>Email address
          <input className={styles.input} type="email" name="email" inputMode="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} />
        </label>}

        {needsPassword && <label className={styles.field}>{mode === "login" ? "Password" : "Password (8+ characters)"}
          <span className={styles.inputWrap}>
            <input className={`${styles.input} ${styles.passwordInput}`} type={showPassword ? "text" : "password"} name="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "login" ? undefined : 8} value={password} onChange={event => setPassword(event.target.value)} />
            <button type="button" className={styles.showButton} onClick={() => setShowPassword(value => !value)} aria-label={`${showPassword ? "Hide" : "Show"} password`}>{showPassword ? "HIDE" : "SHOW"}</button>
          </span>
        </label>}

        {needsConfirmation && <label className={styles.field}>Confirm password
          <input className={styles.input} type={showPassword ? "text" : "password"} name="confirmPassword" autoComplete="new-password" required minLength={8} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} />
        </label>}

        {needsConfirmation && <p className={styles.hint}>Use eight or more characters. A longer, unique passphrase is easiest to remember and safest.</p>}
        {message && <div role={isError ? "alert" : "status"} className={`${styles.message} ${isError ? styles.error : ""}`}>{message}</div>}

        <button className={`${styles.primaryButton} ${styles.submit}`} type="submit" disabled={loading}>{loading ? "PLEASE WAIT..." : copy.submit}</button>

        <div className={styles.authLinks}>
          {mode === "login" && <><Link href="/forgot-password">Forgot your password?</Link><span>No account? <Link href="/signup">Create one</Link></span></>}
          {mode === "signup" && <span>Already have an account? <Link href="/login">Sign in</Link></span>}
          {(mode === "forgot" || mode === "reset") && <Link href="/login">← Back to sign in</Link>}
        </div>

        {mode === "signup" && <p className={styles.legalNote}>By creating an account, you agree to the <Link href="/terms">Terms</Link> and acknowledge the <Link href="/privacy">Privacy Notice</Link>.</p>}
      </form>
    </main>
  </PublicShell>;
}
