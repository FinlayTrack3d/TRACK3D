import PublicShell from "../../components/PublicShell";
import styles from "../../components/PublicPages.module.css";

export const metadata = { title: "Privacy Notice | TRACK3D", description: "How TRACK3D handles account, fitness and progress information." };

export default function PrivacyPage() {
  return <PublicShell compact><main className={styles.legal}>
    <div className={styles.sectionLabel}>YOUR INFORMATION</div>
    <h1>Privacy Notice</h1>
    <p className={styles.updated}>Last updated: 30 September 2026</p>
    <p>TRACK3D is a personal progress and coaching service. This notice explains the information used to provide the service and the choices available to you.</p>

    <h2>Information you provide</h2>
    <ul><li>Account details, such as your email address.</li><li>Routine, habit, nutrition, fitness and workout records.</li><li>Body measurements, goals, check-ins and progress photos that you choose to add.</li><li>Messages and preferences you share with coaching features.</li></ul>

    <h2>How information is used</h2>
    <p>Information is used to operate your account, save your progress, personalise plans and coaching, improve reliability and protect the service from misuse. TRACK3D does not sell your personal information.</p>

    <h2>Storage and service providers</h2>
    <p>TRACK3D uses specialist hosting, database and AI service providers to operate the app. Information is shared with them only as needed to deliver those functions and is subject to their security and data-handling controls.</p>

    <h2>Photos and health-related information</h2>
    <p>Progress photos, measurements and fitness information can be sensitive. Adding them is optional. They are used to show your progress and support features you request; they are not medical records and TRACK3D does not provide medical diagnosis or treatment.</p>

    <h2>Retention and your choices</h2>
    <p>Information is kept while your account is active and as reasonably required for security, legal or operational purposes. You may request access, correction or deletion through the TRACK3D support channel associated with your account. You can also remove individual content where the app provides that control.</p>

    <h2>Security and age</h2>
    <p>Reasonable technical and organisational safeguards are used, but no online service can guarantee absolute security. TRACK3D is intended for people aged 18 or over.</p>

    <h2>Changes</h2>
    <p>This notice may be updated as the service changes. The date above identifies the current version.</p>
  </main></PublicShell>;
}
