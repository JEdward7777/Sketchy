/**
 * Phase 1 shell: proves the PWA loads. The lobby replaces this in phase 4.
 */
export function App() {
  return (
    <main className="shell">
      <h1 className="wordmark">Sketchy</h1>
      <p className="tagline">Everyone draws the secret word. One agent is faking it.</p>
      <p className="status" data-testid="shell-status">
        Headquarters is still being built. Check back soon, agent.
      </p>
    </main>
  );
}
