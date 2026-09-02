import { NextRequest, NextResponse } from "next/server";
import {
  analyticsPost,
  ChannelDto,
  coreGet,
  serviceUnavailable,
  downstreamError,
  toAnalyticsChannels,
} from "../../../../_compose/helpers";

/**
 * BFF composition for the former core endpoint
 * GET /api/v1/assets/{id}/measurements/latest.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const metrics = url.searchParams.get("metrics");

  try {
    const channelsResponse = await coreGet(
      req,
      `/assets/${encodeURIComponent(id)}/channels${metrics ? `?metrics=${encodeURIComponent(metrics)}` : ""}`
    );
    if (!channelsResponse.ok) {
      return new NextResponse(channelsResponse.body, { status: channelsResponse.status });
    }
    const { channels } = (await channelsResponse.json()) as { channels: ChannelDto[] };
    if (!channels.length) {
      return NextResponse.json({ measurements: [] });
    }

    const latestResponse = await analyticsPost(req, "/stats/latest-by-channel", {
      channels: toAnalyticsChannels(channels),
    });
    if (!latestResponse.ok) {
      return downstreamError(latestResponse, "Analytics service");
    }
    const { values } = (await latestResponse.json()) as {
      values: Array<{ deviceId: string; metricId: number; value: number | null; time: number | null }>;
    };
    const nameByChannel = new Map(
      channels.map((c) => [`${c.deviceId}|${c.metricId}`, c.metricName] as const)
    );
    const measurements = values
      .filter((v) => v.value !== null && v.time !== null)
      .map((v) => ({
        time: v.time,
        deviceId: v.deviceId,
        metricId: v.metricId,
        metricName: nameByChannel.get(`${v.deviceId}|${v.metricId}`) ?? "unknown",
        value: v.value,
      }));
    return NextResponse.json({ measurements });
  } catch (error) {
    console.error(`Asset latest-measurements composition failed for ${id}`, error);
    return serviceUnavailable("Measurement composition");
  }
}
