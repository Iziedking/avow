// Developer mode: off by default, so consumers never see the developer surface. A developer flips
// it on and it persists in localStorage, which reveals the Developer Console (its CTA on the home
// page and its /?dev route). Read by the router (main.tsx) and the landing footer (App.tsx).

const KEY = "avow:devmode";

export function isDevMode(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setDevMode(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* localStorage unavailable; dev mode just won't persist this session */
  }
}
