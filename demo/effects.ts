import type { Map } from "maplibre-gl";
import type { RGB } from "../src";
import {
  DEFAULT_SCREEN_FISHEYE,
  type ScreenFisheyeLayer,
  type ScreenFisheyeOptions,
} from "./fisheye";
import { requiredElement } from "./dom";
import {
  DEFAULT_SCREEN_VIGNETTE,
  drawScreenVignette,
  type ScreenVignetteBase,
  type ScreenVignetteFalloff,
  type ScreenVignetteOptions,
} from "./vignette";

export interface EffectsController {
  setThemeColor(color: RGB): void;
  disconnect(): void;
}

const rgbToHex = (color: RGB) =>
  `#${color.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;

const hexToRgb = (color: string): RGB => [
  Number.parseInt(color.slice(1, 3), 16),
  Number.parseInt(color.slice(3, 5), 16),
  Number.parseInt(color.slice(5, 7), 16),
];

export function setupEffects(
  map: Map,
  fisheye: ScreenFisheyeLayer,
): EffectsController {
  const canvas = requiredElement<HTMLCanvasElement>("#screen-vignette");
  const enabled = requiredElement<HTMLInputElement>("#vignette-enabled");
  const reach = requiredElement<HTMLInputElement>("#vignette-reach");
  const circularity = requiredElement<HTMLInputElement>(
    "#vignette-circularity",
  );
  const opacity = requiredElement<HTMLInputElement>("#vignette-opacity");
  const falloff = requiredElement<HTMLSelectElement>("#vignette-falloff");
  const base = requiredElement<HTMLSelectElement>("#vignette-base");
  const color = requiredElement<HTMLInputElement>("#vignette-color");
  const useThemeColor = requiredElement<HTMLInputElement>(
    "#vignette-theme-color",
  );
  const status = requiredElement<HTMLOutputElement>("#vignette-status");
  const reachValue = requiredElement<HTMLElement>("#vignette-reach-value");
  const circularityValue = requiredElement<HTMLElement>(
    "#vignette-circularity-value",
  );
  const opacityValue = requiredElement<HTMLElement>("#vignette-opacity-value");
  let themeColor: RGB = [...DEFAULT_SCREEN_VIGNETTE.color] as RGB;
  let frame = 0;

  enabled.checked = DEFAULT_SCREEN_VIGNETTE.enabled;
  reach.value = String(DEFAULT_SCREEN_VIGNETTE.reach);
  circularity.value = String(DEFAULT_SCREEN_VIGNETTE.circularity);
  opacity.value = String(DEFAULT_SCREEN_VIGNETTE.opacity);
  falloff.value = DEFAULT_SCREEN_VIGNETTE.falloff;
  base.value = DEFAULT_SCREEN_VIGNETTE.base;
  color.value = rgbToHex(themeColor);

  const vignetteOptions = (): ScreenVignetteOptions => ({
    enabled: enabled.checked,
    reach: Number(reach.value),
    base: base.value as ScreenVignetteBase,
    circularity: Number(circularity.value),
    opacity: Number(opacity.value),
    falloff: falloff.value as ScreenVignetteFalloff,
    color: useThemeColor.checked ? themeColor : hexToRgb(color.value),
  });
  const renderVignette = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const options = vignetteOptions();
      reachValue.textContent = `${Math.round(options.reach * 100)}%`;
      circularityValue.textContent = `${Math.round(options.circularity * 100)}%`;
      opacityValue.textContent = `${Math.round(options.opacity * 100)}%`;
      status.textContent = options.enabled
        ? `${falloff.selectedOptions[0]?.textContent ?? "linear"} · ${base.value} base · 8×8 CSS-pixel dither · ${useThemeColor.checked ? "theme color" : color.value}`
        : "overlay disabled";
      drawScreenVignette(canvas, options);
    });
  };

  enabled.onchange = renderVignette;
  reach.oninput = renderVignette;
  circularity.oninput = renderVignette;
  opacity.oninput = renderVignette;
  falloff.onchange = renderVignette;
  base.onchange = renderVignette;
  color.oninput = () => {
    useThemeColor.checked = false;
    renderVignette();
  };
  useThemeColor.onchange = () => {
    if (useThemeColor.checked) color.value = rgbToHex(themeColor);
    renderVignette();
  };

  const fisheyeEnabled = requiredElement<HTMLInputElement>("#fisheye-enabled");
  const fisheyeK1 = requiredElement<HTMLInputElement>("#fisheye-k1");
  const fisheyeK2 = requiredElement<HTMLInputElement>("#fisheye-k2");
  const fisheyeStrength =
    requiredElement<HTMLInputElement>("#fisheye-strength");
  const fisheyeRadius = requiredElement<HTMLInputElement>("#fisheye-radius");
  const fisheyeStatus = requiredElement<HTMLOutputElement>("#fisheye-status");
  const fisheyeK1Value = requiredElement<HTMLElement>("#fisheye-k1-value");
  const fisheyeK2Value = requiredElement<HTMLElement>("#fisheye-k2-value");
  const fisheyeStrengthValue = requiredElement<HTMLElement>(
    "#fisheye-strength-value",
  );
  const fisheyeRadiusValue = requiredElement<HTMLElement>(
    "#fisheye-radius-value",
  );
  fisheyeEnabled.checked = DEFAULT_SCREEN_FISHEYE.enabled;
  fisheyeK1.value = String(DEFAULT_SCREEN_FISHEYE.k1);
  fisheyeK2.value = String(DEFAULT_SCREEN_FISHEYE.k2);
  fisheyeStrength.value = String(DEFAULT_SCREEN_FISHEYE.strength);
  fisheyeRadius.value = String(DEFAULT_SCREEN_FISHEYE.radius);

  const fisheyeOptions = (): ScreenFisheyeOptions => ({
    enabled: fisheyeEnabled.checked,
    k1: Number(fisheyeK1.value),
    k2: Number(fisheyeK2.value),
    strength: Number(fisheyeStrength.value),
    radius: Number(fisheyeRadius.value),
  });
  const renderFisheye = () => {
    const options = fisheyeOptions();
    fisheyeK1Value.textContent = options.k1.toFixed(2);
    fisheyeK2Value.textContent = options.k2.toFixed(2);
    fisheyeStrengthValue.textContent = options.strength.toFixed(2);
    fisheyeRadiusValue.textContent = `${Math.round(options.radius * 100)}%`;
    fisheyeStatus.textContent = options.enabled
      ? `broad ${options.k1.toFixed(2)} · edge ${options.k2.toFixed(2)} · strength ${options.strength.toFixed(2)}`
      : "effect disabled";
    fisheye.setOptions(options);
  };
  fisheyeEnabled.onchange = renderFisheye;
  fisheyeK1.oninput = renderFisheye;
  fisheyeK2.oninput = renderFisheye;
  fisheyeStrength.oninput = renderFisheye;
  fisheyeRadius.oninput = renderFisheye;

  const resize = () => renderVignette();
  window.addEventListener("resize", resize);
  const observer = new ResizeObserver(() => {
    map.resize();
    renderVignette();
  });
  observer.observe(requiredElement<HTMLElement>("#app"));
  renderVignette();
  renderFisheye();

  return {
    setThemeColor(nextColor) {
      themeColor = nextColor;
      if (useThemeColor.checked) color.value = rgbToHex(themeColor);
      renderVignette();
    },
    disconnect() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", resize);
    },
  };
}
