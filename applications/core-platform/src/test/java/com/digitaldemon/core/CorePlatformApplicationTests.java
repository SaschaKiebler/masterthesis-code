package com.digitaldemon.core;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * Context smoke test, self-contained: the database comes from a Testcontainers
 * PostgreSQL (Flyway's TimescaleDB blocks are guarded and no-op on plain
 * Postgres), Kafka is switched off and the gRPC server binds a random free
 * port — so the test needs no running dev stack and no fixed ports.
 */
@SpringBootTest(properties = {
		"kafka.enabled=false",
		"grpc.server.port=0",
})
@Testcontainers
class CorePlatformApplicationTests {

	@Container
	@ServiceConnection
	static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

	@Test
	void contextLoads() {
	}

}
