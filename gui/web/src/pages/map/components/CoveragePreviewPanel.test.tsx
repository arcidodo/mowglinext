import {fireEvent, render, screen} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {CoveragePreviewPanel} from './CoveragePreviewPanel.tsx';
import {MowingAreaFeature} from '../../../types/map.ts';
import type {useCoveragePreview} from '../hooks/useCoveragePreview.ts';

vi.mock('../../../theme/ThemeContext.tsx', () => ({useThemeMode: () => ({colors: {}})}));

type Preview = ReturnType<typeof useCoveragePreview>;

const area = (id: string, name: string) => {
    const a = new MowingAreaFeature(id, 1);
    a.setName(name);
    return a;
};

const fns = {
    selectArea: vi.fn(), setAngle: vi.fn(), setDirection: vi.fn(), reset: vi.fn(), save: vi.fn(), setEnabled: vi.fn(),
};

const makePreview = (over: Partial<Preview> = {}): Preview => {
    const areas = [area('a', 'Front lawn')];
    return {
        enabled: true,
        areas,
        area: areas[0],
        angle: 30,
        shownAngle: 30,
        direction: 0,
        dirty: false,
        saving: false,
        loading: false,
        error: undefined,
        result: {success: true, swaths: [{}, {}, {}], headland_passes: 2, planned_fraction: 0.934, mow_angle_deg: 30},
        layers: {lines: {type: 'FeatureCollection', features: []}, arrows: {type: 'FeatureCollection', features: []}},
        ...fns,
        ...over,
    } as unknown as Preview;
};

const show = (preview: Preview) => render(<CoveragePreviewPanel preview={preview} areaLabel={(i, name) => name || `Area ${i + 1}`}/>);

describe('coverage preview panel', () => {
    beforeEach(() => vi.clearAllMocks());

    it('asks for an area when there is none to preview', () => {
        show(makePreview({areas: [], area: undefined}));
        expect(screen.getByText('Draw a mowing area first.')).toBeInTheDocument();
    });

    it('summarises what the planner drew', () => {
        show(makePreview());
        expect(screen.getByText('3 lines')).toBeInTheDocument();
        expect(screen.getByText('2 perimeter rounds')).toBeInTheDocument();
        expect(screen.getByText('93% of the area planned')).toBeInTheDocument();
    });

    it('shows the planner refusal instead of stale numbers', () => {
        show(makePreview({error: 'field too small after insets', result: undefined}));
        expect(screen.getByText('field too small after insets')).toBeInTheDocument();
        expect(screen.queryByText(/^\d+ perimeter rounds$/)).not.toBeInTheDocument();
    });

    it('only offers an area picker when there is a choice', () => {
        show(makePreview());
        expect(screen.queryByText('Area')).not.toBeInTheDocument();
    });

    it('keeps save and reset disabled until something changed', () => {
        show(makePreview());
        expect(screen.getByRole('button', {name: 'Save to settings'})).toBeDisabled();
        expect(screen.getByRole('button', {name: 'Reset'})).toBeDisabled();
        expect(screen.getByText('These values apply to all areas.')).toBeInTheDocument();
    });

    it('saves and resets once the preview differs from the robot settings', () => {
        show(makePreview({dirty: true}));
        expect(screen.getByText('Not saved yet. This only changes the preview.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: 'Save to settings'}));
        expect(fns.save).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByRole('button', {name: 'Reset'}));
        expect(fns.reset).toHaveBeenCalledOnce();
    });

    it('sends the chosen perimeter direction', () => {
        show(makePreview());
        fireEvent.click(screen.getByText('Counter-clockwise'));
        expect(fns.setDirection).toHaveBeenCalledWith(2);
        fireEvent.click(screen.getByText('Clockwise'));
        expect(fns.setDirection).toHaveBeenCalledWith(1);
    });

    it('turning auto off pins the angle the planner is using right now', () => {
        show(makePreview({angle: -1, shownAngle: 72.4}));
        expect(screen.getByText('Auto (now 72°)')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('switch'));
        expect(fns.setAngle).toHaveBeenCalledWith(72);
    });

    it('turning auto on asks the planner to choose', () => {
        show(makePreview({angle: 30, shownAngle: 30}));
        fireEvent.click(screen.getByRole('switch'));
        expect(fns.setAngle).toHaveBeenCalledWith(-1);
    });
});
