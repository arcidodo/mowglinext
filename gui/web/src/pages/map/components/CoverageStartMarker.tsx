import {Marker} from "react-map-gl/mapbox";

interface CoverageStartMarkerProps {
    longitude: number;
    latitude: number;
    /** The operator dropped the marker here. */
    onMove: (longitude: number, latitude: number) => void;
    /** Tooltip, which also tells the operator it can be dragged. */
    title: string;
}

/// Where the route starts, as a marker the operator can drag. It is only ever a request: the
/// planner snaps the dropped point onto the outermost headland ring (on a straight side) and
/// answers with where the route really starts, and the marker then jumps to that spot, so what
/// is shown is always what the robot will do. Move is reported on DROP, not while dragging, so
/// the planner is asked once per placement rather than once per pixel.
export const CoverageStartMarker = ({longitude, latitude, onMove, title}: CoverageStartMarkerProps) => (
    <Marker
        longitude={longitude}
        latitude={latitude}
        anchor="center"
        draggable
        onDragEnd={(event) => onMove(event.lngLat.lng, event.lngLat.lat)}
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
