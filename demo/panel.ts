import { elements, requiredElement } from "./dom";

const SETTINGS_MIN_WIDTH = 248;
const SETTINGS_MAX_WIDTH = 480;

export function setupSettingsPanel(): void {
  const settings = requiredElement<HTMLElement>("#settings");
  const toggle = requiredElement<HTMLButtonElement>("#settings-toggle");
  const resize = requiredElement<HTMLElement>("#settings-resize");
  const scroll = requiredElement<HTMLElement>(".panel-scroll");
  const tabs = elements<HTMLButtonElement>(".panel-tab");
  const panels = elements<HTMLElement>(".tab-panel");

  const activateTab = (tab: string, focus = false) => {
    for (const button of tabs) {
      const active = button.dataset.tab === tab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
      if (active && focus) button.focus();
    }
    for (const panel of panels) panel.hidden = panel.id !== `panel-${tab}`;
    scroll.scrollTop = 0;
  };

  tabs.forEach((button, index) => {
    button.onclick = () => activateTab(button.dataset.tab!);
    button.onkeydown = (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      event.preventDefault();
      const nextIndex =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
              tabs.length;
      activateTab(tabs[nextIndex]!.dataset.tab!, true);
    };
  });

  const setWidth = (width: number) => {
    const viewportMaximum = Math.max(
      SETTINGS_MIN_WIDTH,
      window.innerWidth - 28,
    );
    const next = Math.round(
      Math.min(
        SETTINGS_MAX_WIDTH,
        viewportMaximum,
        Math.max(SETTINGS_MIN_WIDTH, width),
      ),
    );
    document.documentElement.style.setProperty("--settings-width", `${next}px`);
    resize.setAttribute("aria-valuenow", String(next));
  };

  let drag: { pointerX: number; width: number } | undefined;
  resize.onpointerdown = (event) => {
    if (settings.classList.contains("is-collapsed")) return;
    drag = {
      pointerX: event.clientX,
      width: settings.getBoundingClientRect().width,
    };
    resize.setPointerCapture(event.pointerId);
    document.body.classList.add("is-resizing");
  };
  resize.onpointermove = (event) => {
    if (drag) setWidth(drag.width + drag.pointerX - event.clientX);
  };
  const finishResize = (event: PointerEvent) => {
    if (!drag) return;
    drag = undefined;
    if (resize.hasPointerCapture(event.pointerId))
      resize.releasePointerCapture(event.pointerId);
    document.body.classList.remove("is-resizing");
  };
  resize.onpointerup = finishResize;
  resize.onpointercancel = finishResize;
  resize.onkeydown = (event) => {
    const step = event.shiftKey ? 40 : 10;
    if (event.key === "ArrowLeft")
      setWidth(settings.getBoundingClientRect().width + step);
    else if (event.key === "ArrowRight")
      setWidth(settings.getBoundingClientRect().width - step);
    else if (event.key === "Home") setWidth(SETTINGS_MIN_WIDTH);
    else if (event.key === "End") setWidth(SETTINGS_MAX_WIDTH);
    else return;
    event.preventDefault();
  };

  toggle.onclick = () => {
    const collapsed = settings.classList.toggle("is-collapsed");
    toggle.setAttribute("aria-expanded", String(!collapsed));
    const label = collapsed
      ? "Expand settings panel"
      : "Collapse settings panel";
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
  };
}
