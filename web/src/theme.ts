// The header's light/dark switch. The page starts light; an inline script in each page's head applies a saved
// dark choice before first paint, so this only wires up the button.
const SUN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;
const MOON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>`;

const root = document.documentElement;
const button = document.getElementById("theme-toggle");

function show() {
  if (!button) return;
  const dark = root.dataset.theme === "dark";
  // The icon shows the mode a click switches to.
  button.innerHTML = dark ? SUN : MOON;
  button.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
}

button?.addEventListener("click", () => {
  const dark = root.dataset.theme !== "dark";
  if (dark) root.dataset.theme = "dark";
  else delete root.dataset.theme;
  try {
    localStorage.setItem("theme", dark ? "dark" : "light");
  } catch {
    // Private windows can refuse storage; the switch still works for this visit.
  }
  show();
});

show();
