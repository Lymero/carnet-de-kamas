/**
 * @file Shared type for views. No runtime code.
 *
 * A view renders into the main panel's container. The router mounts exactly one
 * view at a time; main.js calls `update` with fresh state after every change.
 *
 * @typedef {Object} View
 * @property {(el: HTMLElement) => void} mount       bind events on the container
 * @property {() => void} unmount                    remove those events
 * @property {(state: import("../../state.js").AppState) => void} update  re-render from state
 */

export {};
