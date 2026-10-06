import {describe, expect, it} from "vitest";
import {
    MAX_SWATH_ARROWS,
    buildPreviewLayers,
    choicesFromArea,
    effectiveAngleDeg,
    overridesFromChoices,
    requestedValues,
    ringToRosPolygon,
    sameChoices,
    type AreaChoices,
    type CoveragePreviewResult,
} from "./coveragePreview.ts";
import {itranspose} from "../../utils/map.tsx";

const datum: [number, number, number] = [52.0, 5.0, 0];

const square = (size: number) => ({points: [{x: 0, y: 0}, {x: size, y: 0}, {x: size, y: size}, {x: 0, y: size}]});

describe("buildPreviewLayers", () => {
    it("returns nothing for a failed or missing answer", () => {
        expect(buildPreviewLayers(undefined, datum, 0, 0).lines.features).toHaveLength(0);
        expect(buildPreviewLayers({success: false, message: "too small"}, datum, 0, 0).arrows.features).toHaveLength(0);
    });

    it("draws a ring as a closed loop and starts it at the first vertex", () => {
        const res: CoveragePreviewResult = {success: true, rings: [square(10)], swaths: []};
        const {lines, arrows} = buildPreviewLayers(res, datum, 0, 0);
        const ring = lines.features.find((f) => f.properties?.kind === "ring")!;
        const coords = (ring.geometry as GeoJSON.LineString).coordinates;
        expect(coords).toHaveLength(5);
        expect(coords[0]).toEqual(coords[4]);
        const start = arrows.features.filter((f) => f.properties?.kind === "start");
        expect(start).toHaveLength(1);
        expect((start[0].geometry as GeoJSON.Point).coordinates).toEqual(coords[0]);
    });

    it("points ring arrows along the drive direction", () => {
        // The first edge runs east: bearing 90 degrees clockwise from north.
        const res: CoveragePreviewResult = {success: true, rings: [square(10)], swaths: []};
        const arrow = buildPreviewLayers(res, datum, 0, 0).arrows.features.find((f) => f.properties?.kind === "ring-arrow")!;
        expect(arrow.properties?.bearing).toBeCloseTo(90, 5);
    });

    it("reverses the arrows when the ring is driven the other way", () => {
        const cw = {points: [{x: 0, y: 0}, {x: 0, y: 10}, {x: 10, y: 10}, {x: 10, y: 0}]};
        const res: CoveragePreviewResult = {success: true, rings: [cw], swaths: []};
        const arrow = buildPreviewLayers(res, datum, 0, 0).arrows.features.find((f) => f.properties?.kind === "ring-arrow")!;
        expect(arrow.properties?.bearing).toBeCloseTo(0, 5); // north
    });

    it("keeps swaths in serpentine order with alternating arrows", () => {
        const res: CoveragePreviewResult = {
            success: true,
            rings: [],
            swaths: [
                {points: [{x: 0, y: 0}, {x: 10, y: 0}]},
                {points: [{x: 10, y: 1}, {x: 0, y: 1}]},
            ],
        };
        const {lines, arrows} = buildPreviewLayers(res, datum, 0, 0);
        const swaths = lines.features.filter((f) => f.properties?.kind === "swath");
        expect(swaths.map((f) => f.properties?.index)).toEqual([0, 1]);
        const bearings = arrows.features.filter((f) => f.properties?.kind === "swath-arrow").map((f) => f.properties?.bearing);
        expect(bearings[0]).toBeCloseTo(90, 5);
        expect(bearings[1]).toBeCloseTo(270, 5);
        // With no rings the first swath start is the start marker.
        expect(arrows.features.some((f) => f.properties?.kind === "start")).toBe(true);
    });

    it("draws each arrowhead as a closed triangle of a readable size", () => {
        const res: CoveragePreviewResult = {success: true, rings: [square(30)], swaths: []};
        const arrow = buildPreviewLayers(res, datum, 0, 0).arrows.features.find((f) => f.properties?.kind === "ring-arrow")!;
        expect(arrow.geometry.type).toBe("Polygon");
        const ring = (arrow.geometry as GeoJSON.Polygon).coordinates[0];
        expect(ring).toHaveLength(4);
        expect(ring[0]).toEqual(ring[3]);
        const [x0, y0] = itranspose(0, 0, datum, ring[0][1], ring[0][0]);
        const [x1, y1] = itranspose(0, 0, datum, ring[1][1], ring[1][0]);
        const size = Math.hypot(x0 - x1, y0 - y1);
        expect(size).toBeGreaterThan(0.3);
        expect(size).toBeLessThan(2.5);
    });

    it("thins swath arrows on a big lawn but never the swath lines", () => {
        const swaths = Array.from({length: 200}, (_, i) => ({points: [{x: 0, y: i * 0.2}, {x: 10, y: i * 0.2}]}));
        const {lines, arrows} = buildPreviewLayers({success: true, rings: [], swaths}, datum, 0, 0);
        expect(lines.features.filter((f) => f.properties?.kind === "swath")).toHaveLength(200);
        expect(arrows.features.filter((f) => f.properties?.kind === "swath-arrow").length).toBeLessThanOrEqual(MAX_SWATH_ARROWS);
    });

    it("staggers swath arrows along the swaths instead of lining them up", () => {
        const swaths = Array.from({length: 36}, (_, i) => ({points: [{x: 0, y: i * 0.2}, {x: 10, y: i * 0.2}]}));
        const {arrows} = buildPreviewLayers({success: true, rings: [], swaths}, datum, 0, 0);
        const xs = arrows.features.filter((f) => f.properties?.kind === "swath-arrow").map((f) => {
            const ring = (f.geometry as GeoJSON.Polygon).coordinates[0];
            const lon = ring.slice(0, 3).reduce((sum, c) => sum + c[0], 0) / 3;
            return Math.round(itranspose(0, 0, datum, 52.0, lon)[0]);
        });
        expect(new Set(xs).size).toBeGreaterThan(1);
    });

    it("gives a ring shorter than the spacing at least one arrow", () => {
        const res: CoveragePreviewResult = {success: true, rings: [square(1)], swaths: []};
        const arrows = buildPreviewLayers(res, datum, 0, 0).arrows.features.filter((f) => f.properties?.kind === "ring-arrow");
        expect(arrows.length).toBeGreaterThanOrEqual(1);
    });

    it("places geometry at the display offset", () => {
        const res: CoveragePreviewResult = {success: true, rings: [], swaths: [{points: [{x: 0, y: 0}, {x: 10, y: 0}]}]};
        const line = buildPreviewLayers(res, datum, 2, -3).lines.features[0];
        const [lon, lat] = (line.geometry as GeoJSON.LineString).coordinates[0];
        const [x, y] = itranspose(2, -3, datum, lat, lon);
        expect(x).toBeCloseTo(0, 6);
        expect(y).toBeCloseTo(0, 6);
    });
});

describe("ringToRosPolygon", () => {
    it("round-trips and drops the closing vertex", () => {
        const lonLat = square(10).points.map((p) => {
            const cos = Math.cos((datum[0] * Math.PI) / 180);
            return [datum[1] + p.x / (cos * 111319.49), datum[0] + p.y / 111319.49];
        });
        const closed = [...lonLat, lonLat[0]];
        const poly = ringToRosPolygon(closed, datum, 0, 0);
        expect(poly.points).toHaveLength(4);
        expect(poly.points[2].x).toBeCloseTo(10, 1);
        expect(poly.points[2].y).toBeCloseTo(10, 1);
    });

    it("leaves an unclosed ring alone", () => {
        const poly = ringToRosPolygon([[5.0, 52.0], [5.001, 52.0], [5.001, 52.001]], datum, 0, 0);
        expect(poly.points).toHaveLength(3);
    });
});

describe("effectiveAngleDeg", () => {
    it("uses the requested angle when set", () => {
        expect(effectiveAngleDeg(30, 99)).toBe(30);
        expect(effectiveAngleDeg(0, 99)).toBe(0);
    });
    it("falls back to what the planner resolved for auto", () => {
        expect(effectiveAngleDeg(-1, 72)).toBe(72);
        expect(effectiveAngleDeg(-1, undefined)).toBe(0);
    });
});

describe("per-area choices", () => {
    const follow: AreaChoices = {angleMode: "global", angleDeg: 0, direction: "global"};

    it("an area without overrides follows the robot-wide settings", () => {
        expect(choicesFromArea(undefined)).toEqual(follow);
        expect(choicesFromArea({})).toEqual(follow);
        // A stored number without its flag means nothing.
        expect(choicesFromArea({mow_angle_deg: 80, ring_direction: 2})).toEqual(follow);
    });

    it("reads a fixed angle, auto and a winding from the wire form", () => {
        expect(choicesFromArea({has_mow_angle: true, mow_angle_deg: 35, has_ring_direction: true, ring_direction: 2}))
            .toEqual({angleMode: "fixed", angleDeg: 35, direction: 2});
        expect(choicesFromArea({has_mow_angle: true, mow_angle_deg: -1}).angleMode).toBe("auto");
    });

    it("0 degrees and the planner-default winding are real choices", () => {
        expect(choicesFromArea({has_mow_angle: true, mow_angle_deg: 0, has_ring_direction: true, ring_direction: 0}))
            .toEqual({angleMode: "fixed", angleDeg: 0, direction: 0});
    });

    it("asks the planner for the robot-wide value unless the area overrides it", () => {
        expect(requestedValues(follow, 40, 1)).toEqual({mow_angle_deg: 40, ring_direction: 1});
        expect(requestedValues(follow, -1, 0)).toEqual({mow_angle_deg: -1, ring_direction: 0});
        expect(requestedValues({angleMode: "fixed", angleDeg: 75, direction: 2}, 40, 1))
            .toEqual({mow_angle_deg: 75, ring_direction: 2});
        // An area can pin itself to auto even when the robot-wide angle is fixed.
        expect(requestedValues({angleMode: "auto", angleDeg: 75, direction: "global"}, 40, 0).mow_angle_deg).toBe(-1);
    });

    it("an unknown robot-wide winding falls back to the planner default", () => {
        expect(requestedValues(follow, -1, 7).ring_direction).toBe(0);
    });

    it("writes a flag per value, so global clears an override", () => {
        expect(overridesFromChoices(follow)).toEqual({
            has_mow_angle: false, mow_angle_deg: 0, has_ring_direction: false, ring_direction: 0,
        });
        expect(overridesFromChoices({angleMode: "fixed", angleDeg: 35, direction: 2})).toEqual({
            has_mow_angle: true, mow_angle_deg: 35, has_ring_direction: true, ring_direction: 2,
        });
        expect(overridesFromChoices({angleMode: "auto", angleDeg: 35, direction: 0})).toEqual({
            has_mow_angle: true, mow_angle_deg: -1, has_ring_direction: true, ring_direction: 0,
        });
    });

    it("round-trips through the wire form", () => {
        for (const choices of [
            follow,
            {angleMode: "fixed", angleDeg: 120, direction: 1},
            {angleMode: "auto", angleDeg: 0, direction: 0},
            {angleMode: "fixed", angleDeg: 0, direction: "global"},
        ] as AreaChoices[]) {
            expect(sameChoices(choicesFromArea(overridesFromChoices(choices)), choices)).toBe(true);
        }
    });

    it("ignores a leftover fixed angle while the mode is not fixed", () => {
        expect(sameChoices(
            {angleMode: "global", angleDeg: 10, direction: "global"},
            {angleMode: "global", angleDeg: 99, direction: "global"},
        )).toBe(true);
        expect(sameChoices(
            {angleMode: "fixed", angleDeg: 10, direction: "global"},
            {angleMode: "fixed", angleDeg: 11, direction: "global"},
        )).toBe(false);
        expect(sameChoices(follow, {...follow, direction: 0})).toBe(false);
    });
});
