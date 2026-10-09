package com.heatingplatform.core.measurement;

import com.heatingplatform.core.proto.v1.IngestedMeasurement;
import com.heatingplatform.core.proto.v1.MeasurementBatch;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory "latest value per channel" projection fed from the
 * {@code measurement.ingested} stream core already consumes
 * (measurement-read-decoupling design §8, event-carried state).
 *
 * This is what remains of core's measurement access after the store split:
 * KPI evaluation ({@code findLatestValue}) and fleet health
 * ({@code lastSeen}) read this projection; core never queries the
 * measurement store. The projection is empty after a restart and refills
 * with the next incoming batches — devices without traffic since startup
 * report "no data", which matches the fleet view's offline semantics.
 */
@Component
public class LatestValueProjection {

    public record LatestValue(double value, Instant time) {
    }

    private final ConcurrentHashMap<String, LatestValue> byChannel = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Instant> lastSeenByDevice = new ConcurrentHashMap<>();

    /** Called by the measurement listener for every consumed batch. */
    public void apply(MeasurementBatch batch) {
        String deviceId = batch.getDeviceId();
        Instant batchTime = batch.hasIngestedAt()
                ? Instant.ofEpochSecond(batch.getIngestedAt().getSeconds(), batch.getIngestedAt().getNanos())
                : Instant.now();

        Instant newest = batchTime;
        for (IngestedMeasurement m : batch.getMeasurementsList()) {
            Instant time = m.hasTime()
                    ? Instant.ofEpochSecond(m.getTime().getSeconds(), m.getTime().getNanos())
                    : batchTime;
            byChannel.merge(key(deviceId, m.getMetricId()), new LatestValue(m.getValue(), time),
                    (old, candidate) -> candidate.time().isBefore(old.time()) ? old : candidate);
            if (time.isAfter(newest)) {
                newest = time;
            }
        }
        Instant finalNewest = newest;
        lastSeenByDevice.merge(deviceId, finalNewest,
                (old, candidate) -> candidate.isBefore(old) ? old : candidate);
    }

    public Optional<Double> findLatestValue(String deviceId, int metricId) {
        LatestValue latest = byChannel.get(key(deviceId, metricId));
        return latest == null ? Optional.empty() : Optional.of(latest.value());
    }

    public Optional<LatestValue> latest(String deviceId, int metricId) {
        return Optional.ofNullable(byChannel.get(key(deviceId, metricId)));
    }

    public Optional<Instant> lastSeen(String deviceId) {
        return Optional.ofNullable(lastSeenByDevice.get(deviceId));
    }

    public Map<String, Instant> lastSeenSnapshot() {
        return Map.copyOf(lastSeenByDevice);
    }

    private static String key(String deviceId, int metricId) {
        return deviceId + "|" + metricId;
    }
}
