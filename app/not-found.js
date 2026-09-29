import Link from "next/link";
import PublicShell from "../components/PublicShell";
import styles from "../components/PublicPages.module.css";

export default function NotFound() {
  return <PublicShell compact><main className={styles.notFound}><div>
    <h1>404</h1><h2>That page is off track.</h2>
    <p>The address may have changed, or the page may no longer exist. Return to TRACK3D and choose where to go next.</p>
    <div className={styles.actions}><Link href="/" className={styles.primaryButton}>BACK TO TRACK3D</Link><Link href="/login" className={styles.secondaryButton}>SIGN IN</Link></div>
  </div></main></PublicShell>;
}
