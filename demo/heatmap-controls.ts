import type { Map } from "maplibre-gl";
import type { LowResBasemap } from "../src";
import { loadPickupData, type PickupRow } from "./data-sources/pickups";
import { requiredElement } from "./dom";

const SOURCE_ID = "demo-uber-pickups";
const LAYER_ID = "demo-uber-native-heatmap";

export function setupHeatmapControls(map: Map, basemap: LowResBasemap): void {
  const mode = requiredElement<HTMLSelectElement>("#heatmap-mode");
  const radius = requiredElement<HTMLInputElement>("#heatmap-radius");
  const intensity = requiredElement<HTMLInputElement>("#heatmap-intensity");
  const opacity = requiredElement<HTMLInputElement>("#heatmap-opacity");
  const status = requiredElement<HTMLOutputElement>("#heatmap-status");
  const radiusValue = requiredElement<HTMLElement>("#heatmap-radius-value");
  const intensityValue = requiredElement<HTMLElement>(
    "#heatmap-intensity-value",
  );
  const opacityValue = requiredElement<HTMLElement>("#heatmap-opacity-value");
  let lowResLoaded = false;
  let pickupDataLoaded = false;

  const ensureNativeHeatmap = (rows: readonly PickupRow[]) => {
    if (!map.getSource(SOURCE_ID))
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: rows.map(([lng, lat, weight]) => ({
            type: "Feature" as const,
            properties: { weight },
            geometry: { type: "Point" as const, coordinates: [lng, lat] },
          })),
        },
      });
    if (!map.getLayer(LAYER_ID))
      map.addLayer(
        {
          id: LAYER_ID,
          type: "heatmap",
          source: SOURCE_ID,
          paint: {
            "heatmap-weight": ["/", ["get", "weight"], 15],
            "heatmap-radius": Number(radius.value),
            "heatmap-intensity": Number(intensity.value) * 0.2,
            "heatmap-opacity": Number(opacity.value),
            "heatmap-color": [
              "interpolate",
              ["linear"],
              ["heatmap-density"],
              0,
              "rgba(24, 54, 92, 0)",
              0.25,
              "#286d9b",
              0.5,
              "#57ad85",
              0.75,
              "#efb24b",
              1,
              "#e24c5b",
            ],
          },
        },
        basemap.layerIds.markers,
      );
  };

  const applyControls = () => {
    const nextRadius = Number(radius.value);
    const nextIntensity = Number(intensity.value);
    const nextOpacity = Number(opacity.value);
    radiusValue.textContent = String(nextRadius);
    intensityValue.textContent = nextIntensity.toFixed(2).replace(/0$/, "");
    opacityValue.textContent = nextOpacity.toFixed(2);
    if (mode.value === "native" && map.getLayer(LAYER_ID)) {
      map.setPaintProperty(LAYER_ID, "heatmap-radius", nextRadius);
      map.setPaintProperty(LAYER_ID, "heatmap-intensity", nextIntensity * 0.2);
      map.setPaintProperty(LAYER_ID, "heatmap-opacity", nextOpacity);
    }
    if (mode.value === "lowres")
      basemap.setHeatmap({
        radius: nextRadius,
        intensity: nextIntensity,
        opacity: nextOpacity,
      });
  };

  const applyMode = async () => {
    const renderer = mode.value;
    if (renderer === "off") {
      if (map.getLayer(LAYER_ID))
        map.setLayoutProperty(LAYER_ID, "visibility", "none");
      basemap.setHeatmapVisible(false);
      status.textContent = pickupDataLoaded
        ? "pickup data ready"
        : "loads 100,000 NYC pickups on selection";
      return;
    }
    mode.disabled = true;
    status.textContent = "loading pickup data…";
    try {
      const data = await loadPickupData();
      pickupDataLoaded = true;
      if (renderer === "native") {
        basemap.setHeatmapVisible(false);
        ensureNativeHeatmap(data.rows);
        map.setLayoutProperty(LAYER_ID, "visibility", "visible");
      } else {
        if (map.getLayer(LAYER_ID))
          map.setLayoutProperty(LAYER_ID, "visibility", "none");
        if (!lowResLoaded) {
          basemap.setHeatmap({
            data: data.compact,
            visible: true,
            radius: Number(radius.value),
            intensity: Number(intensity.value),
            maxDensity: 192,
            opacity: Number(opacity.value),
            palette: [
              [40, 109, 155],
              [87, 173, 133],
              [239, 178, 75],
              [226, 76, 91],
            ],
          });
          lowResLoaded = true;
        } else basemap.setHeatmapVisible(true);
      }
      status.textContent = `${data.rows.length.toLocaleString()} weighted pickups · ${renderer}`;
      applyControls();
    } catch (error) {
      mode.value = "off";
      status.textContent =
        error instanceof Error ? error.message : String(error);
    } finally {
      mode.disabled = false;
    }
  };

  mode.onchange = () => void applyMode();
  radius.oninput = applyControls;
  intensity.oninput = applyControls;
  opacity.oninput = applyControls;
}
