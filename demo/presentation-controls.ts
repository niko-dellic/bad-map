import type { Map } from "maplibre-gl";
import { requiredElement } from "./dom";

const AUTO_ROTATE_DEGREES_PER_MILLISECOND = 0.006;

const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement);

export function setupPresentationControls(map: Map): () => void {
  const app = requiredElement<HTMLElement>("#app");
  const autoRotateButton = requiredElement<HTMLButtonElement>("#auto-rotate");
  const uiVisibilityButton = requiredElement<HTMLButtonElement>(
    "#ui-visibility-toggle",
  );

  let autoRotate = false;
  let autoRotateFrame: number | undefined;
  let previousFrameTime: number | undefined;

  const updateAutoRotateButton = () => {
    const action = autoRotate ? "Stop" : "Start";
    autoRotateButton.setAttribute("aria-pressed", String(autoRotate));
    autoRotateButton.textContent = `${action.toLowerCase()} auto-rotate`;
    autoRotateButton.title = `${action} auto-rotate (Shift+R)`;
  };

  const rotate = (timestamp: number) => {
    if (!autoRotate) return;
    if (previousFrameTime !== undefined) {
      const elapsed = Math.min(100, timestamp - previousFrameTime);
      map.setBearing(
        map.getBearing() + elapsed * AUTO_ROTATE_DEGREES_PER_MILLISECOND,
      );
    }
    previousFrameTime = timestamp;
    autoRotateFrame = requestAnimationFrame(rotate);
  };

  const setAutoRotate = (enabled: boolean) => {
    if (enabled === autoRotate) return;
    autoRotate = enabled;
    previousFrameTime = undefined;
    if (enabled) autoRotateFrame = requestAnimationFrame(rotate);
    else if (autoRotateFrame !== undefined) {
      cancelAnimationFrame(autoRotateFrame);
      autoRotateFrame = undefined;
    }
    updateAutoRotateButton();
  };

  const setUIHidden = (hidden: boolean) => {
    app.classList.toggle("is-ui-hidden", hidden);
    uiVisibilityButton.setAttribute("aria-pressed", String(hidden));
    uiVisibilityButton.textContent = hidden ? "show all UI" : "hide all UI";
    uiVisibilityButton.title = `${hidden ? "Show" : "Hide"} all UI (Shift+H)`;
  };

  autoRotateButton.onclick = () => setAutoRotate(!autoRotate);
  uiVisibilityButton.onclick = () =>
    setUIHidden(!app.classList.contains("is-ui-hidden"));

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await app.requestFullscreen();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (
      event.repeat ||
      !event.shiftKey ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      isEditableTarget(event.target)
    )
      return;
    if (event.code === "KeyR") setAutoRotate(!autoRotate);
    else if (event.code === "KeyH")
      setUIHidden(!app.classList.contains("is-ui-hidden"));
    else if (event.code === "KeyF")
      void toggleFullscreen().catch((error: unknown) => {
        console.warn("[bad-map] Fullscreen request failed", error);
      });
    else return;
    event.preventDefault();
  };
  window.addEventListener("keydown", onKeyDown);

  updateAutoRotateButton();
  setUIHidden(false);

  return () => {
    window.removeEventListener("keydown", onKeyDown);
    setAutoRotate(false);
  };
}
