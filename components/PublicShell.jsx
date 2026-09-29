import Link from "next/link";
import styles from "./PublicPages.module.css";

export default function PublicShell({ children, compact = false }) {
  return <div className={styles.page}>
    <header className={styles.header}>
      <Link href="/" className={styles.brand} aria-label="TRACK3D home">TRACK3D</Link>
      <nav className={styles.nav} aria-label="Main navigation">
        {!compact && <Link href="/#how-it-works" className={styles.linkButton}>HOW IT WORKS</Link>}
        <Link href="/login" className={styles.linkButton}>SIGN IN</Link>
        <Link href="/signup" className={styles.primaryButton}>CREATE ACCOUNT</Link>
      </nav>
    </header>
    {children}
    <footer className={styles.footer}>
      <span>© {new Date().getFullYear()} TRACK3D</span>
      <span className={styles.footerLinks}><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></span>
    </footer>
  </div>;
}
