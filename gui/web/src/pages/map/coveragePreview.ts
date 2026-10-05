import type {Feature, FeatureCollection, LineString, Point, Polygon} from "geojson";
import {itranspose, transpose} from "../../utils/map.tsx";

/// Pure helpers behind the Map page's "mowing lines" overlay. The geometry
/// itself always comes from coverage_server's preview_coverage service (the
/// real planner, never reimplemented here); this file only converts between the
/// map frame (x east, y north, metres) and the display frame, and decides where
/// the direction arrows go.

export type RosPoint = {x?: number; y?: number};
export type RosPolygon = {points?: RosPoint[]};

/** Perimeter winding, as coverage_server's ring_direction parameter. */
export const RING_DIRECTION = {planner: 0, clockwise: 1, counterClockwise: 2} as const;
export type RingDirection = typeof RING_DIRECTION[keyof typeof RING_DIRECTION];

/** mow_angle_deg < 0 means "auto" (the planner picks the heading). */
export const MOW_ANGLE_AUTO = -1;

export interface CoveragePreviewResult {
    success?: boolean;
    message?: string;
    rings?: RosPolygon[];
    swaths?: RosPolygon[];
    mow_angle_deg?: number;
    headland_passes?: number;
    ring_direction?: number;
    planned_fraction?: number;
    field_area_m2?: number;
    dropped_pieces?: number;
}

export interface CoveragePreviewLayers {
    /** Rings and swaths as LineStrings; `kind` is "ring" | "swath". */
    lines: FeatureCollection;
    /**
     * Direction arrowheads (small triangles, drawn to scale in metres so they
     * need no font or sprite) and one start marker (a Point). `bearing` is
     * degrees clockwise from north.
     */
    arrows: FeatureCollection;
}

const EMPTY: FeatureCollection = {type: "FeatureCollection", features: []};
export const emptyLayers = (): CoveragePreviewLayers => ({lines: EMPTY, arrows: EMPTY});

/** Keep roughly this many metres between arrows along a ring. */
export const RING_ARROW_SPACING_M = 8;
/** Never draw more than about this many swath arrows, however many swaths there are. */
export const MAX_SWATH_ARROWS = 40;
/** Arrowhead length as a fraction of the preview's extent, clamped to a readable size. */
const ARROW_EXTENT_FRACTION = 0.035;
const ARROW_MIN_M = 0.5;
const ARROW_MAX_M = 2.0;

const bearingDeg = (dx: number, dy: number): number => {
    const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
    return (deg + 360) % 360;
};

type XY = {x: number; y: number};

/** A triangle of length `size` metres centred on `mid`, pointing along `bearing`. */
const arrowhead = (mid: XY, bearing: number, size: number): XY[] => {
    const rad = (bearing * Math.PI) / 180;
    const dx = Math.sin(rad); // east
    const dy = Math.cos(rad); // north
    const px = -dy;
    const py = dx;
    const tip = {x: mid.x + dx * size * 0.6, y: mid.y + dy * size * 0.6};
    const baseX = mid.x - dx * size * 0.4;
    const baseY = mid.y - dy * size * 0.4;
    const half = size * 0.3;
    return [tip, {x: baseX + px * half, y: baseY + py * half}, {x: baseX - px * half, y: baseY - py * half}];
};

const usable = (poly: RosPolygon | undefined): {x: number; y: number}[] =>
    (poly?.points ?? []).map((p) => ({x: p.x ?? 0, y: p.y ?? 0}));

/**
 * Convert a drawn area (GeoJSON [lon, lat] ring, closed or not) into the map
 * frame polygon the service takes. The closing duplicate is dropped: ROS
 * polygons list each vertex once.
 */
export const ringToRosPolygon = (
    ring: readonly (readonly number[])[],
    datum: [number, number, number],
    offsetX: number,
    offsetY: number,
): {points: {x: number; y: number}[]} => {
    const pts = ring.map((coord) => {
        const [x, y] = itranspose(offsetX, offsetY, datum, coord[1], coord[0]);
        return {x, y};
    });
    if (pts.length > 1) {
        const first = pts[0];
        const last = pts[pts.length - 1];
        if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-6) pts.pop();
    }
    return {points: pts};
};

/**
 * Where a rotation of the swaths should be reported from the heading the user
 * chose. The service resolves "auto" to a concrete angle; this is the angle to
 * show and to seed the slider with.
 */
export const effectiveAngleDeg = (requested: number, resolved: number | undefined): number => {
    if (requested >= 0) return requested;
    return resolved ?? 0;
};

/**
 * Turn a preview answer into map layers. Arrows sit on every ring (one per
 * RING_ARROW_SPACING_M of path, at least one) and on a thinned selection of
 * swaths, so the serpentine and the perimeter winding both read at a glance
 * without 100 arrows on a big lawn. The first ring start and first swath start
 * get a "start" marker: that is where the robot begins.
 */
export const buildPreviewLayers = (
    res: CoveragePreviewResult | undefined,
    datum: [number, number, number],
    offsetX: number,
    offsetY: number,
): CoveragePreviewLayers => {
    if (!res?.success) return emptyLayers();
    const toLonLat = (p: {x: number; y: number}): [number, number] =>
        transpose(offsetX, offsetY, datum, p.y, p.x);

    const lines: Feature<LineString>[] = [];
    const arrows: Feature<Point | Polygon>[] = [];

    // Arrowhead size follows the extent of what is drawn: a fixed size is a speck
    // on a big lawn and a blob on a small one.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const poly of [...(res.rings ?? []), ...(res.swaths ?? [])]) {
        for (const p of usable(poly)) {
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
        }
    }
    const extent = Number.isFinite(minX) ? Math.max(maxX - minX, maxY - minY) : 0;
    const arrowSize = Math.min(ARROW_MAX_M, Math.max(ARROW_MIN_M, extent * ARROW_EXTENT_FRACTION));
    const arrow = (kind: string, mid: XY, bearing: number): Feature<Polygon> => {
        const ring = arrowhead(mid, bearing, arrowSize).map(toLonLat);
        return {
            type: "Feature",
            properties: {kind, bearing},
            geometry: {type: "Polygon", coordinates: [[...ring, ring[0]]]},
        };
    };

    (res.rings ?? []).forEach((poly, ringIndex) => {
        const pts = usable(poly);
        if (pts.length < 2) return;
        // A ring is a closed loop: draw the closing edge too.
        const loop = [...pts, pts[0]];
        lines.push({
            type: "Feature",
            properties: {kind: "ring", index: ringIndex},
            geometry: {type: "LineString", coordinates: loop.map(toLonLat)},
        });

        let sinceArrow = RING_ARROW_SPACING_M; // an arrow on the first long-enough edge
        let placed = 0;
        for (let i = 0; i + 1 < loop.length; i++) {
            const a = loop[i];
            const b = loop[i + 1];
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            if (len < 0.3) continue;
            sinceArrow += len;
            if (sinceArrow >= RING_ARROW_SPACING_M) {
                sinceArrow = 0;
                placed++;
                arrows.push(arrow("ring-arrow", {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2}, bearingDeg(b.x - a.x, b.y - a.y)));
            }
        }
        if (placed === 0 && loop.length >= 2) {
            const a = loop[0];
            const b = loop[1];
            arrows.push(arrow("ring-arrow", {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2}, bearingDeg(b.x - a.x, b.y - a.y)));
        }
        if (ringIndex === 0) {
            arrows.push({
                type: "Feature",
                properties: {kind: "start"},
                geometry: {type: "Point", coordinates: toLonLat(pts[0])},
            });
        }
    });

    const swaths = res.swaths ?? [];
    const step = Math.max(1, Math.ceil(swaths.length / MAX_SWATH_ARROWS));
    swaths.forEach((poly, swathIndex) => {
        const pts = usable(poly);
        if (pts.length < 2) return;
        const a = pts[0];
        const b = pts[pts.length - 1];
        lines.push({
            type: "Feature",
            properties: {kind: "swath", index: swathIndex},
            geometry: {type: "LineString", coordinates: [toLonLat(a), toLonLat(b)]},
        });
        if (swathIndex % step === 0) {
            arrows.push(arrow("swath-arrow", {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2}, bearingDeg(b.x - a.x, b.y - a.y)));
        }
        if (swathIndex === 0 && (res.rings ?? []).length === 0) {
            arrows.push({type: "Feature", properties: {kind: "start"}, geometry: {type: "Point", coordinates: toLonLat(a)}});
        }
    });

    return {
        lines: {type: "FeatureCollection", features: lines},
        arrows: {type: "FeatureCollection", features: arrows},
    };
};
