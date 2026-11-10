import { ThemeToggle } from "@/components/ThemeToggle";
import { TrapReadout } from "@/components/TrapReadout";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <a className={styles.brand} href="./" aria-label="levtrap home">
          <Mark />
          <span className={styles.word}>levtrap</span>
          <span className={styles.tag}>v2 preview</span>
        </a>
        <nav className={styles.nav}>
          <a href="../">Current site</a>
          <ThemeToggle className={styles.iconButton} />
        </nav>
      </header>

      <main className={styles.main}>
        <TrapReadout />
        <p className={styles.note}>
          This is the foundation of levtrap 2: the new engine contract running in your browser. The
          one-screen simulator (scene, inspector, plots) is built on it next; follow the{" "}
          <a href="https://github.com/macroscopicquantumoptics/levtrap/issues/6">roadmap</a>.
        </p>
      </main>
    </div>
  );
}

/** A focused beam converging on a trapped particle. */
function Mark() {
  return (
    <svg className={styles.mark} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M4 5 L16 15.2 L28 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" opacity="0.55" />
      <path d="M4 27 L16 16.8 L28 27" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" opacity="0.55" />
      <circle cx="16" cy="16" r="3.6" fill="var(--accent)" />
    </svg>
  );
}
