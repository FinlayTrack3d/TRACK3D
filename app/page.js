import Link from "next/link";
import PublicShell from "../components/PublicShell";
import styles from "../components/PublicPages.module.css";

export default function HomePage() {
  return <PublicShell>
    <main>
      <section className={styles.hero}>
        <div className={styles.eyebrow}>AWARENESS · STRATEGY · ACTION · RESULTS</div>
        <h1>Build a life you can measure and improve.</h1>
        <p>TRACK3D brings your morning routine, fitness programme, nutrition, habits and progress into one focused coaching system.</p>
        <div className={styles.actions}>
          <Link href="/signup" className={styles.primaryButton}>START BUILDING YOUR PLAN</Link>
          <Link href="/login" className={styles.secondaryButton}>SIGN IN</Link>
        </div>
      </section>

      <section id="how-it-works" className={styles.featureGrid} aria-label="How TRACK3D works">
        <article className={styles.feature}><div className={styles.sectionLabel}>01 · START THE DAY</div><h2>Morning routine</h2><p>Follow a clear daily sequence, keep streaks honest and begin with the actions that matter.</p></article>
        <article className={styles.feature}><div className={styles.sectionLabel}>02 · TRAIN WITH INTENT</div><h2>Fitness coaching</h2><p>Run your planned workouts, record every set and adjust exercises, volume or session days without losing history.</p></article>
        <article className={styles.feature}><div className={styles.sectionLabel}>03 · SEE THE PATTERN</div><h2>Progress in one place</h2><p>Review habits, nutrition, body data and progress photos so your next decision is based on evidence.</p></article>
      </section>
    </main>
  </PublicShell>;
}
