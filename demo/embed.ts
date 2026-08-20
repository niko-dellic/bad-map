import demoDocument from "./index.html?raw";

const mount = document.querySelector<HTMLElement>("#demo-mount");

if (!mount) throw new Error("Unable to find the embedded demo mount");

const parsed = new DOMParser().parseFromString(demoDocument, "text/html");
const demo = parsed.querySelector<HTMLElement>("#app");

if (!demo) throw new Error("Unable to load the embedded demo markup");

demo.classList.add("is-embedded");
mount.replaceWith(demo);

await import("./main");
