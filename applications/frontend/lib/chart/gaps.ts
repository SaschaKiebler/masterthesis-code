/**
 * Breaking a line chart where a channel sent nothing.
 *
 * A line chart draws a straight segment between two consecutive points no
 * matter how far apart they are in time. For measurement data that is a lie:
 * a sensor that was silent for three hours would appear as a smooth
 * interpolation across the outage, and a reader could not tell a measured
 * value from an invented one. The raw-data semantics of the platform say the
 * opposite, namely that a gap stays a gap and is never bridged (thesis
 * QS-INT-01).
 *
 * The fix is to insert a null point where the next sample was due. ECharts
 * does not connect across nulls unless `connectNulls` is set, so the line ends
 * at the last real value and starts again at the next one.
 */

/** One point of a chart series, `null` meaning "no value here". */
export type ChartPoint = [number, number | null];

/** A stretch of time in which a channel delivered nothing. */
export interface Gap {
    /** Timestamp of the last value before the gap, in ms. */
    from: number;
    /** Timestamp of the first value after the gap, in ms. */
    to: number;
}

/**
 * How much longer than the expected spacing a distance has to be before it
 * counts as a gap.
 *
 * 1.5 is deliberate. A single missed sample doubles the spacing, so anything
 * below 2 detects it, and QS-INT-01 asks for exactly that. At the same time
 * 1.5 tolerates up to 50 percent jitter in the send interval, which real
 * devices show. A larger factor would silently bridge single dropouts, a
 * smaller one would tear the line apart on ordinary jitter.
 */
export const DEFAULT_GAP_FACTOR = 1.5;

/**
 * The spacing the series appears to use, taken as the median distance between
 * consecutive points.
 *
 * The median rather than the mean, because the outages this function exists to
 * find would drag a mean upwards and then hide themselves behind it. Returns
 * null when there is too little data to judge.
 */
export function inferStepMs(points: ChartPoint[]): number | null {
    if (points.length < 3) return null;

    const deltas: number[] = [];
    for (let i = 1; i < points.length; i++) {
        const delta = points[i][0] - points[i - 1][0];
        if (delta > 0) deltas.push(delta);
    }
    if (deltas.length === 0) return null;

    deltas.sort((a, b) => a - b);
    return deltas[Math.floor(deltas.length / 2)];
}

/**
 * Insert a null wherever the series skips an interval, and report the gaps.
 *
 * @param points     the series, ascending in time. An unsorted input is sorted
 *                   first, because a single point out of order would otherwise
 *                   produce a gap that does not exist.
 * @param expectedMs the spacing the channel is supposed to keep, for instance
 *                   the metric point's sample interval or the width of a
 *                   resampling bucket. Pass null to infer it from the data.
 * @param factor     see {@link DEFAULT_GAP_FACTOR}
 */
export function splitOnGaps(
    points: ChartPoint[],
    expectedMs: number | null,
    factor: number = DEFAULT_GAP_FACTOR
): { data: ChartPoint[]; gaps: Gap[] } {
    if (points.length < 2) return { data: points, gaps: [] };

    let ordered = points;
    for (let i = 1; i < points.length; i++) {
        if (points[i][0] < points[i - 1][0]) {
            ordered = [...points].sort((a, b) => a[0] - b[0]);
            break;
        }
    }

    const step = expectedMs && expectedMs > 0 ? expectedMs : inferStepMs(ordered);
    if (!step || step <= 0) return { data: ordered, gaps: [] };

    const threshold = step * factor;
    const data: ChartPoint[] = [];
    const gaps: Gap[] = [];

    for (let i = 0; i < ordered.length; i++) {
        if (i > 0) {
            const previous = ordered[i - 1][0];
            const current = ordered[i][0];
            if (current - previous > threshold) {
                // Placed where the next sample was due, so the line stops at the
                // last measured value instead of reaching into the empty stretch.
                data.push([previous + step, null]);
                gaps.push({ from: previous, to: current });
            }
        }
        data.push(ordered[i]);
    }

    return { data, gaps };
}

/**
 * The expected spacing in ms, or null when it has to be inferred.
 *
 * A resampling bucket wins over the device's own interval, because after
 * resampling the series carries one point per bucket and the sample interval
 * of the device says nothing about it any more.
 */
export function expectedStepMs(
    bucketMinutes: number | null | undefined,
    sampleIntervalSeconds: number | null | undefined
): number | null {
    if (bucketMinutes && bucketMinutes > 0) return bucketMinutes * 60_000;
    if (sampleIntervalSeconds && sampleIntervalSeconds > 0) return sampleIntervalSeconds * 1000;
    return null;
}

/**
 * Shading for the stretches without data, as an ECharts `markArea`.
 *
 * Shading is a second, redundant signal. The broken line already tells the
 * truth, but a reader skimming the chart can mistake a break for a rendering
 * artefact, and a screenshot of it has to stand on its own in the thesis.
 *
 * Returns undefined when there is nothing to shade or when there are so many
 * gaps that shading would cover the chart rather than annotate it, which is
 * what an inferred spacing on genuinely irregular data would produce.
 */
export function gapMarkArea(gaps: Gap[], color: string, maxShaded = 50) {
    if (gaps.length === 0 || gaps.length > maxShaded) return undefined;
    return {
        silent: true,
        itemStyle: { color, opacity: 0.08 },
        data: gaps.map((gap) => [{ xAxis: gap.from }, { xAxis: gap.to }]),
    };
}
