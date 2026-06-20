// Developer mode is the dashboard's existing build/verify switch (Settings -> Developer mode),
// persisted as "avow-mode". When it's on (build), the developer surface shows: the build dashboard,
// the Developer Console card, and the /?dev route. One flag, one switch, read here by the router.

export function isDevMode(): boolean {
  try {
    return localStorage.getItem("avow-mode") === "build";
  } catch {
    return false;
  }
}
