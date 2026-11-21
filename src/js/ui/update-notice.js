/**
 * @file The desktop app's update offer: asks the shell (src-tauri/src/lib.rs) whether a
 * newer version is published and, if so, shows it in the header with a button that
 * installs it. The shell downloads the update, checks its signature, installs it and
 * restarts the app; the page never sees a URL or a file.
 */

/**
 * Checks for an update once and, when there is one, fills and shows `el`. A failed
 * check (offline, GitHub unreachable) is silent: the app works the same without it.
 * @param {{invoke: (command: string, args?: Record<string, unknown>) => Promise<any>}} core
 *   `window.__TAURI__.core`
 * @param {HTMLElement} el  the header's empty, hidden notice
 */
export async function offerUpdate(core, el) {
  /** @type {string|null} */
  let version;
  try {
    version = await core.invoke("check_update");
  } catch (error) {
    console.warn("Could not check for updates", error);
    return;
  }
  if (!version) return;

  const text = document.createElement("span");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn small primary";
  const ready = () => {
    text.textContent = `Version ${version} disponible`;
    button.textContent = "Mettre à jour";
    button.disabled = false;
  };
  ready();
  button.addEventListener("click", async () => {
    button.disabled = true;
    text.textContent = `Installation de la version ${version}…`;
    button.textContent = "Patiente";
    try {
      // On success the app restarts (or, on Windows, the installer closes it): this never returns.
      await core.invoke("install_update");
    } catch (error) {
      console.warn("Could not install the update", error);
      ready();
      text.textContent = "La mise à jour a échoué. Réessaie plus tard.";
    }
  });
  el.replaceChildren(text, button);
  el.hidden = false;
}
