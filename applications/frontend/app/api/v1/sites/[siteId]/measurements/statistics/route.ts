import { NextRequest, NextResponse } from "next/server";
import {
  analyticsPost,
  ChannelDto,
  coreGet,
  parseEpoch,
  serviceUnavailable,
  toAnalyticsChannels,
} from "../../../../_compose/helpers";

/**
 * BFF composition for the former core endpoint
 * GET /api/v1/sites/{siteId}/measurements/statistics.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  const { siteId } = await params;
  const url = new URL(req.url);
  const to = parseEpoch(url.searchParams.get("to")) ?? Math.floor(Date.now() / 1000);
  const from = parseEpoch(url.searchParams.get("from")) ?? to - 24 * 3600;

  try {
    const channelsResponse = await coreGet(req, `/sites/${siteId}/channels`);
    if (!channelsResponse.ok) {
      return new NextResponse(channelsResponse.body, { status: channelsResponse.status });
    }
    const { channels } = (await channelsResponse.json()) as { channels: ChannelDto[] };
    if (!channels.length) {
      return NextResponse.json({ statistics: [] });
    }

    const statsResponse = await analyticsPost(req, "/stats/descriptive-by-channel", {
      channels: toAnalyticsChannels(channels),
      start: from,
      end: to,
    });
    if (!statsResponse.ok) {
      return serviceUnavailable("Analytics service");
    }
    const { statistics } = (await statsResponse.json()) as {
      statistics: Array<{
        deviceId: string;
        metricId: number;
        count: number;
        mean: number | null;
        std: number | null;
        min: number | null;
        max: number | null;
      }>;
    };
    const nameByChannel = new Map(
      channels.map((c) => [`${c.deviceId}|${c.metricId}`, c.metricName] as const)
    );
    return NextResponse.json({
      statistics: statistics.map((s) => ({
        deviceId: s.deviceId,
        metricId: s.metricId,
        metricName: nameByChannel.get(`${s.deviceId}|${s.metricId}`) ?? "unknown",
        min: s.min,
        max: s.max,
        avg: s.mean,
        stddev: s.std ?? 0,
        sampleCount: s.count,
      })),
    });
  } catch (error) {
    console.error(`Site statistics composition failed for ${siteId}`, error);
    return serviceUnavailable("Measurement composition");
  }
}
