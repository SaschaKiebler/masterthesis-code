/**
 * SWR Hook — Graph-Native Measurements (ADR-013)
 * Fetches only time-bucketed measurements + statistics per building.
 * Entity/relationship data comes from the project graph — no getSite() or listSpaces() calls.
 */

import useSWR from "swr";
import { getSiteMeasurements, getSiteStatistics } from "../api/sites";
import type {
    Measurement,
    MeasurementStatistic,
    TimeRange,
} from "../api/types";

export function useGraphMeasurements(
    buildingIds: string[],
    timeRange: TimeRange | undefined,
    live = false
) {
    const idsKey = buildingIds.slice().sort().join(",");

    const key = idsKey.length > 0 && timeRange
        ? ["graph-measurements", idsKey, timeRange.from, timeRange.to]
        : null;

    const { data, isLoading, error } = useSWR<{
        measurements: Measurement[];
        statistics: MeasurementStatistic[];
        bucketMinutes: number;
    }>(
        key,
        async () => {
            const results = await Promise.all(
                buildingIds.map((id) =>
                    Promise.all([
                        getSiteMeasurements(id, timeRange),
                        getSiteStatistics(id, timeRange),
                    ])
                )
            );

            let allMeasurements: Measurement[] = [];
            let allStatistics: MeasurementStatistic[] = [];
            let bucketMinutes = 0;

            for (const [mResp, sResp] of results) {
                allMeasurements = allMeasurements.concat(mResp.measurements);
                allStatistics = allStatistics.concat(sResp.statistics);
                if (mResp.bucketMinutes) bucketMinutes = mResp.bucketMinutes;
            }

            return { measurements: allMeasurements, statistics: allStatistics, bucketMinutes };
        },
        {
            revalidateOnFocus: false,
            revalidateOnReconnect: true,
            refreshInterval: live ? 30000 : 0,
            keepPreviousData: true,
        }
    );

    return {
        allMeasurements: data?.measurements ?? [],
        allStatistics: data?.statistics ?? [],
        bucketMinutes: data?.bucketMinutes ?? 0,
        isLoading: isLoading && !data,
        isError: error,
    };
}
