import type { WithPalette } from "./builtIn";

/**
 * Lines, the theme lines starts with and falls back to: plum on lilac, as its icon is. Paper with a
 * breath of lilac, lilac greys and a plum accent in light; the icon's near-black and its lilac in
 * dark. Questions are in the accent, the callout nearest it in hue. On its own, as the website
 * (site/) is drawn in it too.
 */
export const lines: WithPalette = {
  id: "lines",
  name: "Lines",
  palette: {
    light: {
      colors: [
        { id: "white", color: "#fdfbff" },
        { id: "dark-gray", color: "#201824" },
        { id: "light-gray", color: "#f3eef8" },
        { id: "purple", color: "#6b3e85" },
        { id: "dark-gray-2", color: "#443a4a" },
        { id: "gray", color: "#6a6072" },
        { id: "purple-2", color: "#5e3675" },
        { id: "dark-purple", color: "#2a1c32" },
      ],
    },
    dark: {
      colors: [
        { id: "white", color: "#ffffff" },
        { id: "black", color: "#17121d" },
        { id: "light-gray", color: "#ebe6ef" },
        { id: "dark-gray", color: "#2a2330" },
        { id: "purple", color: "#bda2e6" },
        { id: "gray", color: "#a49cac" },
        { id: "pale-purple", color: "#cdb6ec" },
      ],
    },
  },
  light: {
    bg: "white",
    "bg-sidebar": "light-gray",
    "bg-elevated": "white",
    text: "dark-gray",
    "text-sidebar": "dark-gray-2",
    "text-muted": "gray",
    accent: "purple",
    "tag-text": "purple-2",
    ink: "dark-purple",
    "callout-question": "purple",
  },
  dark: {
    bg: "black",
    "bg-elevated": "dark-gray",
    text: "light-gray",
    "text-muted": "gray",
    accent: "purple",
    "tag-text": "pale-purple",
    ink: "white",
    "callout-question": "purple",
  },
};
