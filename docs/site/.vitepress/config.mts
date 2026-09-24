import { resolve } from "node:path";
import { defineConfig } from "vitepress";
export default defineConfig({
  title: "bad-map",
  description: "Semantic low-resolution cartography for MapLibre GL JS.",
  base: "/docs/",
  cleanUrls: true,
  vite: { publicDir: resolve(import.meta.dirname, "../../../public") },
  outDir: resolve(import.meta.dirname, "../../../.docs/site"),
  head: [["link", { rel: "icon", href: "/favicon.ico" }]],
  markdown: {
    theme: {
      light: "github-light-high-contrast",
      dark: "github-dark-high-contrast",
    },
  },
  themeConfig: {
    logo: "/favicon-32x32.png",
    siteTitle: "bad-map",
    logoLink: "/",
    nav: [
      {
        text: "Home",
        link: "https://bad-map-sigma.vercel.app/",
        target: "_self",
      },
      { text: "Docs", link: "/" },
      { text: "API", link: "/api/" },
      { text: "Demo", link: "https://bad-map-sigma.vercel.app/demo/" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Introduction", link: "/" },
          { text: "Installation and first map", link: "/getting-started" },
          { text: "Sources and semantic packs", link: "/sources" },
          { text: "Appearance and camera", link: "/appearance" },
          { text: "Data layers and interaction", link: "/data-layers" },
          { text: "Deployment", link: "/deployment" },
          { text: "Troubleshooting", link: "/troubleshooting" },
          { text: "Gallery", link: "/gallery" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "All exports", link: "/api/" },
          { text: "LowResBasemap", link: "/api/classes/LowResBasemap" },
        ],
      },
    ],
    search: { provider: "local" },
    socialLinks: [
      { icon: "github", link: "https://github.com/niko-dellic/bad-map" },
    ],
    outline: { level: [2, 3] },
    footer: {
      message: "bad-map · Make your map worse.",
      copyright: "MIT licensed",
    },
  },
});
