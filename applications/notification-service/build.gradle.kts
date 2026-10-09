plugins {
	java
	id("org.springframework.boot") version "4.0.2"
	id("io.spring.dependency-management") version "1.1.7"
	id("com.google.protobuf") version "0.9.4"
}

group = "com.heatingplatform"
version = "0.0.1-SNAPSHOT"
description = "Notification Service"

java {
	toolchain {
		languageVersion = JavaLanguageVersion.of(21)
	}
}

configurations {
	compileOnly {
		extendsFrom(configurations.annotationProcessor.get())
	}
}

repositories {
	mavenCentral()
}

dependencies {
	// Web for actuator health, the RestClient webhook deliverer and the
	// notifications/rules REST API consumed by the web app
	implementation("org.springframework.boot:spring-boot-starter-web")
	implementation("org.springframework.boot:spring-boot-starter-actuator")
	implementation("org.springframework.boot:spring-boot-starter-validation")

	// Resource server: validates the platform's HS256 tokens (same shared
	// secret as core, coherence comes from the token contract, ch. 4.4.6)
	implementation("org.springframework.boot:spring-boot-starter-security")
	implementation("org.springframework.boot:spring-boot-starter-oauth2-resource-server")

	// Own table area in the shared master-data store (notification_rules,
	// notifications) — plain JDBC plus Flyway with a service-own history table
	implementation("org.springframework.boot:spring-boot-starter-jdbc")
	implementation("org.springframework.boot:spring-boot-starter-flyway")
	implementation("org.flywaydb:flyway-database-postgresql")
	runtimeOnly("org.postgresql:postgresql")

	// Kafka — consumes the detection-event topics (threshold.breached, ...)
	implementation("org.springframework.boot:spring-boot-starter-kafka")

	// Protobuf message classes for the detection-event envelope
	implementation("com.google.protobuf:protobuf-java:3.25.3")

	// Lombok
	compileOnly("org.projectlombok:lombok")
	annotationProcessor("org.projectlombok:lombok")

	// Testing
	testImplementation("org.springframework.boot:spring-boot-starter-test")
	testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

protobuf {
	protoc {
		artifact = "com.google.protobuf:protoc:3.25.3"
	}
}

sourceSets {
	main {
		proto {
			srcDir("../../apis/proto")
		}
	}
}

tasks.withType<Test> {
	useJUnitPlatform()
}
