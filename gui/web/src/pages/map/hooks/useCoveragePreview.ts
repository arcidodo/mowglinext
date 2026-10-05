import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {App} from "antd";
import {useTranslation} from "react-i18next";
import {useApi} from "../../../hooks/useApi.ts";
import type {MowingAreaFeature, ObstacleFeature} from "../../../types/map.ts";
import {
    MOW_ANGLE_AUTO,
    buildPreviewLayers,
    effectiveAngleDeg,
    emptyLayers,
    ringToRosPolygon,
    type CoveragePreviewResult,
    type RingDirection,
} from "../coveragePreview.ts";

/** Wait this long after the last change before asking the planner again. */
const DEBOUNCE_MS = 300;

interface Args {
    areas: MowingAreaFeature[];
    obstacles: ObstacleFeature[];
    datum: [number, number, number];
    offsetX: number;
    offsetY: number;
    /** Saved mow_angle_deg (< 0 = auto) and mow_direction (0/1/2) from the robot settings. */
    savedAngleDeg: number;
    savedDirection: number;
    /** Area to start on (e.g. the one selected in the editor). */
    preferredAreaId?: string;
}

const asDirection = (v: unknown): RingDirection => (v === 1 || v === 2 ? v : 0);

/// The Map page's "mowing lines" overlay. The lines come from coverage_server's
/// preview_coverage service — the real planner run with the live geometry
/// parameters — so what the operator sees is what the robot will drive. This hook
/// only decides WHAT to ask: one chosen area, with an angle and a perimeter
/// direction the operator can try before saving them to the robot settings.
export const useCoveragePreview = ({
    areas, obstacles, datum, offsetX, offsetY, savedAngleDeg, savedDirection, preferredAreaId,
}: Args) => {
    const api = useApi();
    const {notification} = App.useApp();
    const {t} = useTranslation();

    const [enabled, setEnabled] = useState(false);
    const [areaId, setAreaId] = useState<string | undefined>(preferredAreaId);
    const [draftAngle, setDraftAngle] = useState<number | null>(null);
    const [draftDirection, setDraftDirection] = useState<RingDirection | null>(null);
    // What the robot has after the last save from here; null = whatever the page loaded.
    const [savedOverride, setSavedOverride] = useState<{angle: number; direction: RingDirection} | null>(null);
    const [result, setResult] = useState<CoveragePreviewResult | undefined>();
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | undefined>();
    const requestSeq = useRef(0);

    const saved = savedOverride ?? {angle: savedAngleDeg, direction: asDirection(savedDirection)};
    const angle = draftAngle ?? saved.angle;
    const direction = draftDirection ?? saved.direction;
    const dirty = draftAngle !== null && draftAngle !== saved.angle
        || draftDirection !== null && draftDirection !== saved.direction;

    // Follow the editor's selection until the operator picks an area by hand.
    const pickedByHand = useRef(false);
    useEffect(() => {
        if (!pickedByHand.current && preferredAreaId && areas.some((a) => a.id === preferredAreaId)) {
            setAreaId(preferredAreaId);
        }
    }, [preferredAreaId, areas]);

    const area = useMemo(
        () => areas.find((a) => a.id === areaId) ?? areas[0],
        [areas, areaId],
    );

    // A content signature, not array identities: the caller rebuilds both lists
    // on every render, so keying the fetch on them would refetch constantly.
    const requestBody = useMemo(() => {
        const ring = area?.geometry.coordinates[0];
        if (!enabled || !ring || ring.length < 3 || datum[0] === 0) return undefined;
        const holes = obstacles
            .filter((o) => o.getMowingArea()?.id === area.id)
            .map((o) => ringToRosPolygon(o.geometry.coordinates[0] ?? [], datum, offsetX, offsetY))
            .filter((p) => p.points.length >= 3);
        return {
            outer_boundary: ringToRosPolygon(ring, datum, offsetX, offsetY),
            obstacles: holes,
            mow_angle_deg: angle,
            ring_direction: direction,
        };
    }, [enabled, area, obstacles, datum, offsetX, offsetY, angle, direction]);
    const signature = useMemo(() => (requestBody ? JSON.stringify(requestBody) : ""), [requestBody]);

    useEffect(() => {
        if (!requestBody) {
            setResult(undefined);
            setError(undefined);
            setLoading(false);
            return;
        }
        const seq = ++requestSeq.current;
        setLoading(true);
        const timer = setTimeout(async () => {
            try {
                const res = await api.mowglinext.callCreate("preview_coverage", requestBody);
                if (seq !== requestSeq.current) return; // a newer request superseded this one
                if (res.error) {
                    setResult(undefined);
                    setError((res.error as {error?: string}).error ?? t("coveragePreview.failed"));
                    return;
                }
                const data = res.data as unknown as CoveragePreviewResult;
                setResult(data);
                setError(data.success ? undefined : (data.message || t("coveragePreview.failed")));
            } catch (e) {
                if (seq !== requestSeq.current) return;
                // coverage_server may not be advertised yet; show the reason, keep the map clean.
                setResult(undefined);
                setError(e instanceof Error ? e.message : t("coveragePreview.failed"));
            } finally {
                if (seq === requestSeq.current) setLoading(false);
            }
        }, DEBOUNCE_MS);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signature, api]);

    const layers = useMemo(
        () => (enabled ? buildPreviewLayers(result, datum, offsetX, offsetY) : emptyLayers()),
        [enabled, result, datum, offsetX, offsetY],
    );

    /** The angle to show: the one asked for, or what the planner resolved "auto" to. */
    const shownAngle = effectiveAngleDeg(angle, result?.mow_angle_deg);

    const selectArea = useCallback((id: string) => {
        pickedByHand.current = true;
        setAreaId(id);
    }, []);

    const setAngle = useCallback((deg: number) => setDraftAngle(deg < 0 ? MOW_ANGLE_AUTO : deg), []);

    const reset = useCallback(() => {
        setDraftAngle(null);
        setDraftDirection(null);
    }, []);

    /** Persist the tried angle/direction to the robot settings (global, until per-area lands). */
    const save = useCallback(async () => {
        setSaving(true);
        try {
            const res = await api.settings.yamlCreate({mow_angle_deg: angle, mow_direction: direction});
            if (res.error) throw new Error((res.error as {error?: string}).error);
            setSavedOverride({angle, direction});
            setDraftAngle(null);
            setDraftDirection(null);
            notification.success({
                message: t("coveragePreview.saved"),
                description: t("coveragePreview.savedRestart"),
            });
        } catch (e) {
            notification.error({
                message: t("coveragePreview.saveFailed"),
                description: e instanceof Error ? e.message : undefined,
            });
        } finally {
            setSaving(false);
        }
    }, [api, angle, direction, notification, t]);

    return {
        enabled, setEnabled,
        areas, area, selectArea,
        angle, shownAngle, setAngle,
        direction, setDirection: setDraftDirection,
        dirty, reset, save, saving,
        loading, error, result, layers,
    };
};
