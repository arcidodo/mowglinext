import React from "react";
import {fireEvent, render, screen} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {CoverageStartMarker} from "./CoverageStartMarker.tsx";

const seen = vi.hoisted(() => ({
    props: null as null | {
        longitude: number;
        latitude: number;
        draggable?: boolean;
        anchor?: string;
        onDragEnd?: (event: {lngLat: {lng: number; lat: number}}) => void;
    },
}));

vi.mock("react-map-gl/mapbox", () => ({
    Marker: (props: {
        children: React.ReactNode;
        longitude: number;
        latitude: number;
        draggable?: boolean;
        anchor?: string;
        onDragEnd?: (event: {lngLat: {lng: number; lat: number}}) => void;
    }) => {
        seen.props = props;
        return <div data-testid="marker">{props.children}</div>;
    },
}));

describe("coverage start marker", () => {
    beforeEach(() => {
        seen.props = null;
    });

    it("is a draggable marker at the reported start", () => {
        render(<CoverageStartMarker longitude={5.1} latitude={52.2} onMove={vi.fn()} title="Drag to move the start"/>);
        expect(seen.props?.draggable).toBe(true);
        expect(seen.props?.longitude).toBe(5.1);
        expect(seen.props?.latitude).toBe(52.2);
        expect(seen.props?.anchor).toBe("center");
    });

    it("tells the operator it can be dragged", () => {
        render(<CoverageStartMarker longitude={5} latitude={52} onMove={vi.fn()} title="Drag to move the start"/>);
        expect(screen.getByRole("img", {name: "Drag to move the start"})).toBeInTheDocument();
    });

    it("reports where it was dropped, once, and not while dragging", () => {
        const onMove = vi.fn();
        render(<CoverageStartMarker longitude={5} latitude={52} onMove={onMove} title="t"/>);
        // Dragging alone reports nothing; only the drop does.
        fireEvent.mouseMove(screen.getByTestId("marker"));
        expect(onMove).not.toHaveBeenCalled();
        seen.props?.onDragEnd?.({lngLat: {lng: 5.0004, lat: 52.0002}});
        expect(onMove).toHaveBeenCalledExactlyOnceWith(5.0004, 52.0002);
    });
});
