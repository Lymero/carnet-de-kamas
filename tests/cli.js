// Helpers for tests that run the server as a real process (main.test.js, release.test.js).
import { spawn } from "node:child_process";
import { createServer } from "node:net";

/** A TCP port that is free right now. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = /** @type {import("node:net").AddressInfo} */ (probe.address());
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Runs `node <script> ...args` and collects its output. `ready` resolves with the
 * output so far once it matches `until` (by default the last start-up line, so the
 * whole start-up output is there); `exited` resolves with the exit code.
 * The process is stopped when the test ends.
 * @param {import("node:test").TestContext} t
 * @param {string} script
 * @param {string[]} args
 * @param {{env?: Record<string, string>, until?: RegExp}} [options]
 */
export function runNode(t, script, args, { env = {}, until = /Laisse cette fenêtre ouverte/ } = {}) {
  const child = spawn(process.execPath, [script, ...args], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  const ready = new Promise((resolve, reject) => {
    const onData = (chunk) => {
      output += chunk;
      if (until.test(output)) resolve(output);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    exited.then((code) => reject(new Error(`exited with ${code} before ${until}:\n${output}`)));
  });
  ready.catch(() => {}); // a test may only await `exited`
  t.after(() => child.kill());
  return { ready, exited, output: () => output };
}
