export default function manifest() {
  return {
    name: "TRACK3D",
    short_name: "TRACK3D",
    description: "Personal routines, fitness coaching, nutrition and progress tracking.",
    start_url: "/app",
    display: "standalone",
    background_color: "#080c10",
    theme_color: "#080c10",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
  };
}
