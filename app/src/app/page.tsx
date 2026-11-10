import { ThemeToggle } from "@/components/ThemeToggle";
import { TrapFrequencies } from "@/components/TrapFrequencies";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <h1 className={styles.wordmark}>
          lev<span>trap</span>
        </h1>
        <ThemeToggle />
      </header>
      <main className={styles.main}>
        <TrapFrequencies />
      </main>
    </div>
  );
}
