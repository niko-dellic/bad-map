import type { Map } from "maplibre-gl";
import type { LowResBasemap } from "../src";
import { loadTrips } from "./data-sources/trips";
import { requiredElement } from "./dom";

const LAYER_ID = "demo-nyc-trips";
const STEP = 15;

export function setupTripsControls(
  map: Map,
  basemap: LowResBasemap,
): () => void {
  const mode = requiredElement<HTMLSelectElement>("#trips-mode");
  const play = requiredElement<HTMLButtonElement>("#trips-play");
  const playIcon = requiredElement<HTMLElement>("i", play);
  const stepBack = requiredElement<HTMLButtonElement>("#trips-step-back");
  const stepForward = requiredElement<HTMLButtonElement>("#trips-step-forward");
  const time = requiredElement<HTMLInputElement>("#trips-time");
  const timeValue = requiredElement<HTMLOutputElement>("#trips-time-value");
  const speed = requiredElement<HTMLInputElement>("#trips-speed");
  const trail = requiredElement<HTMLInputElement>("#trips-trail");
  const width = requiredElement<HTMLInputElement>("#trips-width");
  const opacity = requiredElement<HTMLInputElement>("#trips-opacity");
  const speedValue = requiredElement<HTMLElement>("#trips-speed-value");
  const trailValue = requiredElement<HTMLElement>("#trips-trail-value");
  const widthValue = requiredElement<HTMLElement>("#trips-width-value");
  const opacityValue = requiredElement<HTMLElement>("#trips-opacity-value");
  const status = requiredElement<HTMLOutputElement>("#trips-status");
  let focused = false;
  let loaded = false;
  let layerReady = false;
  let scrubbing = false;
  let resumeAfterScrub = false;
  let animationFrame = 0;

  const syncTime = (currentTime: number, loopLength = 1800) => {
    time.value = String(Math.round(currentTime));
    timeValue.textContent = `${Math.round(currentTime)} / ${Math.round(loopLength)}`;
  };
  const syncPlay = (playing: boolean) => {
    const action = playing ? "Pause" : "Play";
    play.setAttribute("aria-label", `${action} trips`);
    play.setAttribute("aria-pressed", String(playing));
    play.title = `${action} trips`;
    playIcon.className = `ph ph-${playing ? "pause" : "play"}`;
  };
  const setTransportEnabled = (enabled: boolean) => {
    play.disabled = !enabled;
    stepBack.disabled = !enabled;
    stepForward.disabled = !enabled;
    time.disabled = !enabled;
  };
  const syncOutputs = () => {
    speedValue.textContent = `${Number(speed.value)}×`;
    trailValue.textContent = trail.value;
    widthValue.textContent = width.value;
    opacityValue.textContent = Number(opacity.value).toFixed(2);
  };

  const applyMode = async ({ focus = true }: { focus?: boolean } = {}) => {
    if (mode.value === "off") {
      layerReady = false;
      basemap.removeDataLayer(LAYER_ID);
      setTransportEnabled(false);
      syncPlay(false);
      status.textContent = loaded
        ? "trip data ready"
        : "loads NYC trips on selection";
      return;
    }
    mode.disabled = true;
    status.textContent = "loading trip data…";
    try {
      const trips = await loadTrips();
      loaded = true;
      basemap.setDataLayer({
        id: LAYER_ID,
        type: "trips",
        data: trips,
        currentTime: Number(time.value),
        loopLength: 1800,
        trailLength: Number(trail.value),
        speed: Number(speed.value),
        width: Number(width.value),
        opacity: Number(opacity.value),
        playing: true,
        order: 40,
        pickable: true,
      });
      layerReady = true;
      setTransportEnabled(true);
      syncPlay(true);
      syncTime(Number(time.value), 1800);
      if (focus && !focused) {
        focused = true;
        map.easeTo({ center: [-74, 40.72], zoom: 13, duration: 700 });
      }
      status.textContent = `${trips.length.toLocaleString()} animated trips`;
      syncOutputs();
    } catch (error) {
      layerReady = false;
      mode.value = "off";
      status.textContent =
        error instanceof Error ? error.message : String(error);
    } finally {
      mode.disabled = false;
    }
  };

  const step = (delta: number) => {
    basemap.stepTripsPlayback(LAYER_ID, delta, { playing: false });
    const playback = basemap.getTripsPlayback(LAYER_ID);
    syncTime(playback.currentTime, playback.loopLength);
    syncPlay(false);
  };
  const finishScrub = () => {
    if (!scrubbing) return;
    scrubbing = false;
    if (resumeAfterScrub) basemap.setTripsPlayback(LAYER_ID, { playing: true });
    syncPlay(resumeAfterScrub);
    resumeAfterScrub = false;
  };

  mode.onchange = () => void applyMode();
  play.onclick = () => {
    const playback = basemap.getTripsPlayback(LAYER_ID);
    basemap.setTripsPlayback(LAYER_ID, { playing: !playback.playing });
    syncPlay(!playback.playing);
  };
  stepBack.onclick = () => step(-STEP);
  stepForward.onclick = () => step(STEP);
  time.onpointerdown = () => {
    if (mode.value === "off") return;
    const playback = basemap.getTripsPlayback(LAYER_ID);
    scrubbing = true;
    resumeAfterScrub = playback.playing;
    if (playback.playing)
      basemap.setTripsPlayback(LAYER_ID, { playing: false });
    syncPlay(false);
  };
  time.oninput = () => {
    if (mode.value === "off") return;
    const currentTime = Number(time.value);
    basemap.seekTripsPlayback(LAYER_ID, currentTime, { playing: false });
    syncTime(currentTime);
    syncPlay(false);
  };
  window.addEventListener("pointerup", finishScrub);
  window.addEventListener("pointercancel", finishScrub);
  time.onkeydown = (event) => {
    if (mode.value === "off") return;
    const multiplier = event.shiftKey ? 4 : 1;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      step(-STEP * multiplier);
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      step(STEP * multiplier);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const playback = basemap.getTripsPlayback(LAYER_ID);
      const currentTime = event.key === "Home" ? 0 : playback.loopLength;
      basemap.seekTripsPlayback(LAYER_ID, currentTime, { playing: false });
      syncTime(currentTime, playback.loopLength);
      syncPlay(false);
    } else if (event.key === " ") {
      event.preventDefault();
      play.click();
    }
  };
  speed.oninput = () => {
    syncOutputs();
    if (mode.value !== "off")
      basemap.setTripsPlayback(LAYER_ID, { speed: Number(speed.value) });
  };
  trail.oninput = () => {
    syncOutputs();
    if (mode.value !== "off")
      basemap.setTripsPlayback(LAYER_ID, {
        trailLength: Number(trail.value),
      });
  };
  const applyStyle = () => {
    syncOutputs();
    if (mode.value !== "off")
      basemap.updateDataLayer(LAYER_ID, {
        type: "trips",
        width: Number(width.value),
        opacity: Number(opacity.value),
      });
  };
  width.oninput = applyStyle;
  opacity.oninput = applyStyle;

  const updateClock = () => {
    if (layerReady && mode.value !== "off") {
      const playback = basemap.getTripsPlayback(LAYER_ID);
      if (playback.playing && !scrubbing)
        syncTime(playback.currentTime, playback.loopLength);
    }
    animationFrame = requestAnimationFrame(updateClock);
  };
  animationFrame = requestAnimationFrame(updateClock);

  // The trips example is the demo's initial data view.
  void applyMode({ focus: false });

  return () => {
    cancelAnimationFrame(animationFrame);
    window.removeEventListener("pointerup", finishScrub);
    window.removeEventListener("pointercancel", finishScrub);
  };
}
