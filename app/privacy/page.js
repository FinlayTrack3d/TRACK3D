import PublicShell from "../../components/PublicShell";
import styles from "../../components/PublicPages.module.css";
import { HEALTH_CONSENT_TEXT, HEALTH_CONSENT_VERSION } from "../../lib/account";

export const metadata = { title: "Privacy Notice | TRACK3D", description: "How TRACK3D handles your account, health, fitness and progress information, and your choices." };

// Who is responsible for TRACK3D users' information, and how to reach them.
// UK GDPR requires both: add the legal name and a contact email here.
const CONTROLLER = { name: "TRACK3D", email: "" };

export default function PrivacyPage() {
  return <PublicShell compact><main className={styles.legal}>
    <div className={styles.sectionLabel}>YOUR INFORMATION</div>
    <h1>Privacy Notice</h1>
    <p className={styles.updated}>Last updated: 6 October 2026 (version {HEALTH_CONSENT_VERSION})</p>
    <p>TRACK3D is a personal progress and coaching service for routines, training and nutrition. This notice explains what information we keep, why, who helps us run the service, how long we keep it and the choices you have. We do not sell your information or use it for advertising.</p>

    <h2 id="who-we-are">Who we are</h2>
    <p>{CONTROLLER.name} (www.track3d.co.uk) is responsible for your information (the &quot;controller&quot; under UK data protection law).{CONTROLLER.email ? <> Contact us about anything in this notice at <a href={`mailto:${CONTROLLER.email}`}>{CONTROLLER.email}</a>.</> : " You can download, correct and delete your information yourself in the app, in Profile → Account."}</p>

    <h2>What we keep</h2>
    <ul>
      <li>Account details: your email address and password (stored only as a secure hash).</li>
      <li>Health information: weight and body measurements, progress photos, food and nutrition logs and plans, training and workout logs, morning check-ins (such as sleep, mood and energy), pain reports, and what you tell the coach about these.</li>
      <li>Your profile: height, date of birth, sex and training experience, used to work out targets and pitch coaching at the right level.</li>
      <li>Routines, habits, goals, weekly reports, coach conversations and settings.</li>
      <li>Technical information our hosting providers log for security, such as IP addresses and request times.</li>
    </ul>

    <h2 id="health-data">Health information and your consent</h2>
    <p>Health information is &quot;special category&quot; data under UK data protection law. We only store it with your explicit consent, which you give with a separate tick box when you create your account: &quot;{HEALTH_CONSENT_TEXT}&quot; We record when you agreed and which version of this notice you agreed to. People who joined before we asked are asked once, the next time they sign in.</p>
    <p>You can withdraw your consent at any time in Profile → Account. We then stop using your health information, and you can&apos;t use the app until you agree again, because coaching depends on it. To have what&apos;s stored erased, delete your account (also in Profile → Account).</p>
    <p>Progress photos are stored privately. Only you can open them, through links that expire after an hour. TRACK3D gives general fitness and nutrition guidance; it is not a medical service and does not diagnose or treat anything.</p>

    <h2>Why we use it, and our lawful basis</h2>
    <ul>
      <li>To run your account and the features you use, such as plans, logs, reports and coaching: to perform our contract with you.</li>
      <li>To store and use your health information for coaching: your explicit consent.</li>
      <li>To keep the service secure and prevent misuse, for example limits on coaching requests: our legitimate interests in running a safe service.</li>
      <li>To meet legal obligations, where they apply.</li>
    </ul>
    <p>Calorie targets come from a standard formula and the coach&apos;s replies are suggestions. Nothing is decided about you automatically that has legal or similarly significant effects, and you can change any target or plan yourself. TRACK3D never sets calorie targets below a safe minimum.</p>

    <h2>Who helps us run TRACK3D</h2>
    <p>These providers process information for us, only on our instructions and under data processing terms:</p>
    <ul>
      <li>Supabase: database, sign-in and photo storage.</li>
      <li>Vercel: hosting for the website and app.</li>
      <li>Anthropic: AI coaching. The details needed to answer a coaching request (for example your targets and recent logs) are sent to Anthropic to write the reply.</li>
    </ul>
    <p>Some of these providers process information outside the UK, including in the United States. Where they do, the transfer is protected by the safeguards UK law requires, such as the UK International Data Transfer Addendum or the UK–US data bridge.</p>

    <h2>How long we keep it</h2>
    <p>We keep your information while your account is open. When you delete your account, everything is removed from our live systems straight away: every record, your progress photos and your sign-in account. Copies in our database provider&apos;s backups are deleted automatically within 30 days. Security logs kept by our hosting providers are deleted on their own short schedules.</p>

    <h2>Your rights</h2>
    <ul>
      <li>Access and portability: Profile → Account → Download my data gives you a ZIP file with everything stored for your account, as JSON files, plus your photos. You can download it once a day.</li>
      <li>Correction: you can edit your profile, plans and logs in the app.</li>
      <li>Erasure: Profile → Account → Delete my account removes your account and data.</li>
      <li>Withdrawing consent: Profile → Account, at any time.</li>
      <li>You can also ask us to restrict or stop using your information, or object to how we use it{CONTROLLER.email ? <>, by emailing <a href={`mailto:${CONTROLLER.email}`}>{CONTROLLER.email}</a></> : ""}.</li>
    </ul>
    <p>If you&apos;re unhappy with how we handle your information, you can complain to the Information Commissioner&apos;s Office (ICO) at <a href="https://ico.org.uk/make-a-complaint/">ico.org.uk/make-a-complaint</a> or on 0303 123 1113. We&apos;d appreciate the chance to sort it out first.</p>

    <h2 id="cookies">Cookies and storage on your device</h2>
    <p>TRACK3D doesn&apos;t use analytics, advertising or tracking cookies, and doesn&apos;t record your sessions. Our fonts are served from our own site, so pages don&apos;t contact other companies for them. Because we only use storage that is strictly necessary for the features you ask for, we don&apos;t need to ask for consent with a cookie banner.</p>
    <p>The app keeps these in your browser&apos;s local storage:</p>
    <ul>
      <li>Your sign-in session, so you stay signed in, and the time you signed in, so you&apos;re signed out after 3 hours.</li>
      <li>Unsaved progress, such as a workout, morning routine or nutrition plan you&apos;re part-way through, so a reload or lost signal doesn&apos;t lose it.</li>
      <li>Your recent coach conversation and copies of your habits, so they show straight away and while you&apos;re offline.</li>
      <li>Small settings, such as kg or stone and notices you&apos;ve dismissed.</li>
    </ul>
    <p>Signing out leaves unsaved progress on the device so it isn&apos;t lost; deleting your account removes all of it from the browser you use to delete it. If we ever add analytics, they won&apos;t load unless you agree, and you&apos;ll be able to refuse as easily as accept.</p>

    <h2>Security and age</h2>
    <p>Information is encrypted in transit, and the database only lets each account read and change its own records. No online service can promise perfect security, so please use a strong password that you don&apos;t use anywhere else. TRACK3D is intended for people aged 18 or over.</p>

    <h2>Changes</h2>
    <p>We&apos;ll update this notice when the service changes. The date and version above show the current one. If a change affects how we use your health information, we&apos;ll ask for your consent again.</p>
  </main></PublicShell>;
}
