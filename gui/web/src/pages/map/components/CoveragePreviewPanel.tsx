import {Alert, Button, InputNumber, Segmented, Select, Slider, Switch} from "antd";
import {useTranslation} from "react-i18next";
import {useThemeMode} from "../../../theme/ThemeContext.tsx";
import {MOW_ANGLE_AUTO, RING_DIRECTION, type RingDirection} from "../coveragePreview.ts";
import type {useCoveragePreview} from "../hooks/useCoveragePreview.ts";

type Preview = ReturnType<typeof useCoveragePreview>;

interface CoveragePreviewPanelProps {
    preview: Preview;
    /** Label for an area (named or "Area N"). */
    areaLabel: (index: number, name: string) => string;
}

/// Controls for the "mowing lines" overlay: pick an area, try a mow angle and a
/// perimeter direction, watch the planner's lines move, then save. The lines are
/// the real planner's (preview_coverage); nothing here moves the robot.
export const CoveragePreviewPanel = ({preview, areaLabel}: CoveragePreviewPanelProps) => {
    const {colors} = useThemeMode();
    const {t} = useTranslation();
    const {
        areas, area, selectArea, angle, shownAngle, setAngle, direction, setDirection,
        dirty, reset, save, saving, loading, error, result,
    } = preview;

    const isAuto = angle < 0;
    const label = {
        fontSize: 12, fontWeight: 600, color: colors.muted, textTransform: 'uppercase' as const,
        letterSpacing: '0.05em', marginTop: 10, marginBottom: 6, display: 'block',
    };
    const stat = {fontSize: 12, color: colors.textSecondary};

    if (areas.length === 0) {
        return <div style={{padding: 12, fontSize: 13, color: colors.textSecondary}}>{t('coveragePreview.noAreas')}</div>;
    }

    const percent = Math.round((result?.planned_fraction ?? 0) * 100);

    return (
        <div style={{padding: 12}}>
            <div style={{fontSize: 14, fontWeight: 600, color: colors.text}}>{t('coveragePreview.title')}</div>
            <div style={{fontSize: 12, color: colors.textSecondary, marginTop: 2}}>{t('coveragePreview.hint')}</div>

            {areas.length > 1 && (
                <>
                    <span style={label}>{t('coveragePreview.area')}</span>
                    <Select
                        size="small"
                        style={{width: '100%'}}
                        value={area?.id}
                        onChange={selectArea}
                        options={areas.map((a, i) => ({value: a.id, label: areaLabel(i, a.getName())}))}
                    />
                </>
            )}

            <span style={label}>{t('coveragePreview.angle')}</span>
            <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4}}>
                <Switch
                    size="small"
                    checked={isAuto}
                    onChange={(auto) => setAngle(auto ? MOW_ANGLE_AUTO : Math.round(shownAngle))}
                />
                <span style={stat}>
                    {isAuto
                        ? t('coveragePreview.angleAutoNow', {deg: Math.round(shownAngle)})
                        : t('coveragePreview.angleAuto')}
                </span>
            </div>
            <div style={{display: 'flex', alignItems: 'center', gap: 8, opacity: isAuto ? 0.45 : 1}}>
                <Slider
                    style={{flex: 1, margin: '4px 6px'}}
                    min={0}
                    max={179}
                    step={1}
                    value={Math.round(shownAngle) % 180}
                    onChange={(v) => setAngle(v)}
                    tooltip={{formatter: (v) => t('coveragePreview.angleDeg', {deg: v})}}
                />
                <InputNumber
                    size="small"
                    style={{width: 64}}
                    min={0}
                    max={179}
                    step={1}
                    precision={0}
                    value={Math.round(shownAngle) % 180}
                    onChange={(v) => v !== null && setAngle(v)}
                />
            </div>

            <span style={label}>{t('coveragePreview.direction')}</span>
            <Segmented<RingDirection>
                size="small"
                block
                value={direction}
                onChange={setDirection}
                options={[
                    {value: RING_DIRECTION.planner, label: t('coveragePreview.directionDefault')},
                    {value: RING_DIRECTION.clockwise, label: t('coveragePreview.directionClockwise')},
                    {value: RING_DIRECTION.counterClockwise, label: t('coveragePreview.directionCounterClockwise')},
                ]}
            />

            <div style={{marginTop: 10, minHeight: 36}}>
                {loading && <div style={stat}>{t('coveragePreview.calculating')}</div>}
                {!loading && error && <Alert type="warning" showIcon message={error}/>}
                {!loading && !error && result?.success && (
                    <>
                        <div style={stat}>{t('coveragePreview.swaths', {count: result.swaths?.length ?? 0})}</div>
                        <div style={stat}>{t('coveragePreview.rings', {count: result.headland_passes ?? 0})}</div>
                        <div style={stat}>{t('coveragePreview.coverage', {percent})}</div>
                    </>
                )}
            </div>

            <div style={{...stat, marginTop: 8}}>
                {dirty ? t('coveragePreview.unsaved') : t('coveragePreview.globalNote')}
            </div>
            <div style={{display: 'flex', gap: 8, marginTop: 8}}>
                <Button size="small" type="primary" disabled={!dirty} loading={saving} onClick={() => void save()}>
                    {t('coveragePreview.apply')}
                </Button>
                <Button size="small" disabled={!dirty || saving} onClick={reset}>
                    {t('coveragePreview.reset')}
                </Button>
            </div>
        </div>
    );
};
