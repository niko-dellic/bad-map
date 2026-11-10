type Theme = "light" | "dark";

/** Follow system appearance standalone; the embedding parent can override it. */
export function followEmbedTheme(apply: (theme: Theme) => void): void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  let override: Theme | undefined;
  const update = () => {
    const theme = override ?? (media.matches ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
    apply(theme);
  };
  const parentOrigin = document.referrer
    ? new URL(document.referrer).origin
    : null;
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (
      window.parent === window ||
      event.source !== window.parent ||
      !parentOrigin ||
      event.origin !== parentOrigin
    )
      return;
    const data = event.data;
    if (
      !data ||
      typeof data !== "object" ||
      !("type" in data) ||
      data.type !== "portfolio:theme" ||
      !("theme" in data)
    )
      return;
    if (data.theme !== "light" && data.theme !== "dark") return;
    override = data.theme;
    update();
  });
  media.addEventListener("change", update);
  update();
}
