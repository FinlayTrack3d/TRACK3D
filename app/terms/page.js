import PublicShell from "../../components/PublicShell";
import styles from "../../components/PublicPages.module.css";

export const metadata = { title: "Terms of Use | TRACK3D", description: "Terms for using the TRACK3D progress and coaching service." };

export default function TermsPage() {
  return <PublicShell compact><main className={styles.legal}>
    <div className={styles.sectionLabel}>USING TRACK3D</div>
    <h1>Terms of Use</h1>
    <p className={styles.updated}>Last updated: 30 September 2026</p>
    <p>These terms apply when you create an account or use TRACK3D. By using the service, you agree to use it responsibly and in accordance with these terms.</p>

    <h2>Your account</h2>
    <p>You are responsible for providing accurate information, keeping your sign-in details secure and for activity performed through your account. You must be at least 18 years old to use TRACK3D.</p>

    <h2>Coaching and health information</h2>
    <p>TRACK3D provides general fitness, routine and nutrition guidance for informational purposes. It is not medical advice, diagnosis or treatment. Stop an activity that causes pain and seek advice from an appropriately qualified professional when needed. In an emergency, contact emergency services.</p>

    <h2>Your content</h2>
    <p>You keep ownership of information and content you add. You give TRACK3D permission to store and process it only as needed to operate and improve the service and provide features you request.</p>

    <h2>Acceptable use</h2>
    <ul><li>Do not misuse, disrupt, probe or attempt to gain unauthorised access to the service.</li><li>Do not upload unlawful content or content that infringes another person’s rights.</li><li>Do not use automated access in a way that damages the service or other users.</li></ul>

    <h2>Availability and changes</h2>
    <p>Features may change, be interrupted or be withdrawn as TRACK3D develops. Reasonable care is taken to keep the service available and accurate, but uninterrupted availability or error-free recommendations cannot be guaranteed.</p>

    <h2>Ending use</h2>
    <p>You may stop using TRACK3D at any time. Access may be suspended where necessary to protect users, comply with law or respond to serious misuse.</p>

    <h2>Liability</h2>
    <p>Nothing in these terms excludes rights or liabilities that cannot legally be excluded. To the fullest extent permitted by law, TRACK3D is not responsible for indirect loss or for decisions made without appropriate professional advice.</p>
  </main></PublicShell>;
}
