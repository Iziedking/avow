// A flat, square, monospace dark theme for the dapp-kit wallet button and modal, so they
// match the Avow house style. No blur, no shadow, no rounded corners, no glass.

import type { ThemeVars } from "@mysten/dapp-kit";

export const avowDark: ThemeVars = {
  blurs: {
    modalOverlay: "none",
  },
  backgroundColors: {
    primaryButton: "#1b2023",
    primaryButtonHover: "#232a2e",
    outlineButtonHover: "#161a1c",
    walletItemHover: "#161a1c",
    walletItemSelected: "#1b2023",
    modalOverlay: "rgba(8, 10, 11, 0.82)",
    modalPrimary: "#121517",
    modalSecondary: "#0e1012",
    iconButton: "transparent",
    iconButtonHover: "#161a1c",
    dropdownMenu: "#121517",
    dropdownMenuSeparator: "#23282b",
  },
  borderColors: {
    outlineButton: "#2f363a",
  },
  colors: {
    primaryButton: "#e9ecee",
    outlineButton: "#e9ecee",
    body: "#e9ecee",
    bodyMuted: "#9aa3a8",
    bodyDanger: "#d8a24a",
    iconButton: "#e9ecee",
  },
  radii: {
    small: "0px",
    medium: "0px",
    large: "0px",
    xlarge: "0px",
  },
  shadows: {
    primaryButton: "none",
    walletItemSelected: "none",
  },
  fontWeights: {
    normal: "400",
    medium: "500",
    bold: "600",
  },
  fontSizes: {
    small: "12px",
    medium: "13px",
    large: "15px",
    xlarge: "18px",
  },
  typography: {
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
    fontStyle: "normal",
    lineHeight: "1.4",
    letterSpacing: "0.02em",
  },
};
