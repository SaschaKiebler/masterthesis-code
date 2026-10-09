package com.heatingplatform.core.device;

import com.heatingplatform.core.user.AuthService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Registry view of devices seen on the broker without configuration
 * (fed by the device.discovered consumer).
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/discovered-devices")
@RequiredArgsConstructor
public class DiscoveredDeviceController {

    private final DiscoveredDeviceRepository repository;
    private final AuthService authService;

    @GetMapping
    public ResponseEntity<Map<String, Object>> list() {
        if (!authService.isConsultantOrAdmin()) {
            return ResponseEntity.status(403).body(Map.of("message", "Consultant or admin role required"));
        }

        List<Map<String, Object>> devices = repository
                .findAll(Sort.by(Sort.Direction.DESC, "lastSeenAt"))
                .stream()
                .map(d -> {
                    Map<String, Object> map = new LinkedHashMap<String, Object>();
                    map.put("deviceId", d.getDeviceId());
                    map.put("protocol", d.getProtocol());
                    map.put("sampleTopic", d.getSampleTopic());
                    map.put("samplePayload", d.getSamplePayload());
                    map.put("firstSeenAt", d.getFirstSeenAt());
                    map.put("lastSeenAt", d.getLastSeenAt());
                    return map;
                })
                .toList();

        return ResponseEntity.ok(Map.of("devices", devices));
    }
}
