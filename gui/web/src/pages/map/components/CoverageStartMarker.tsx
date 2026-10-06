import {useEffect, useRef, useState} from "react";
import {Marker} from "react-map-gl/mapbox";
import {nearestOnPolyline} from "../coveragePreview.ts";

interface CoverageStartMarkerProps {
    /** Where the planner says the route starts. */
    longitude: number;
    latitude: number;
    /** The outermost headland ring as a closed [lon, lat] line; the marker slides along it. */
    ring: [number, number][] | null;
    /** Counts planner answers, so the marker knows when its dropped spot is superseded. */
    settledCount: number;
    /** The operator dropped the marker here (already on the ring). */
    onMove: (longitude: number, latitude: number) => void;
    /** Tooltip, which also tells the operator it can be dragged. */
    title: string;
}

type LngLat = [number, number];

/// Where the route starts, as a marker the operator can drag.
///
///  * While dragging it SLIDES ALONG the outermost ring (the route always starts there), so
///    the operator sees at once where it will end up instead of a dot floating over the lawn.
///  * On drop it STAYS where it was dropped until the planner answers. Without that it
///    jumped back to the old start for the length of the round trip, then to the new one.
///  * The planner has the last word: it keeps the start on a straight side, clear of the
///    corners, and answers with the real start, which the marker then moves to.
/// Move is reported on DROP only, so the planner is asked once per placement, not per pixel.
export const CoverageStartMarker = ({
    longitude, latitude, ring, settledCount, onMove, title,
}: CoverageStartMarkerProps) => {
    // Where the marker was dropped, until the planner's answer (or a new start) replaces it.
    const [dropped, setDropped] = useState<{at: LngLat; settledAtDrop: number; reported: LngLat} | null>(null);
    const ringRef = useRef(ring);
    ringRef.current = ring;

    useEffect(() => {
        if (!dropped) return;
        const answered = settledCount > dropped.settledAtDrop;
        const startMoved = dropped.reported[0] !== longitude || dropped.reported[1] !== latitude;
        if (answered || startMoved) setDropped(null);
    }, [dropped, settledCount, longitude, latitude]);

    const snap = (lngLat: LngLat): LngLat => (ringRef.current && ringRef.current.length > 1
        ? nearestOnPolyline(ringRef.current, lngLat)
        : lngLat);

    const shown = dropped?.at ?? [longitude, latitude];

    return (
        <Marker
            longitude={shown[0]}
            latitude={shown[1]}
            anchor="center"
            draggable
            onDrag={(event) => {
                // Keep the marker on the ring while it is being dragged. No state here: a
                // re-render mid-drag would fight the drag itself.
                const on = snap([event.lngLat.lng, event.lngLat.lat]);
                event.target.setLngLat(on);
            }}
            onDragEnd={(event) => {
                const on = snap([event.lngLat.lng, event.lngLat.lat]);
                setDropped({at: on, settledAtDrop: settledCount, reported: [longitude, latitude]});
                onMove(on[0], on[1]);
            }}
            style={{zIndex: 5, cursor: "grab"}}
        >
            {/* 28 px: a green dot with a generous, touch-sized hit area. */}
            <div
                title={title}
                aria-label={title}
                role="img"
                style={{
                    width: 28,
                    height: 28,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                <div
                    style={{
                        width: 16,
                        height: 16,
                        borderRadius: "50%",
                        background: "#34c759",
                        border: "3px solid #ffffff",
                        boxShadow: "0 0 0 1px rgba(0,0,0,0.45), 0 1px 4px rgba(0,0,0,0.5)",
                    }}
                />
            </div>
        </Marker>
    );
};
