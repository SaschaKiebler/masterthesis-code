plugins {
	java
	id("org.springframework.boot") version "4.0.2"
	id("io.spring.dependency-management") version "1.1.7"
	id("com.google.protobuf") version "0.9.4"
}

group = "com.heatingplatform"
version = "0.0.1-SNAPSHOT"
description = "Device Management"

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
	implementation("org.springframework.boot:spring-boot-starter-web")
	implementation("org.springframework.boot:spring-boot-starter-actuator")

	// JSON payload parsing in discovery sessions (not pulled in transitively by Boot 4)
	implementation("com.fasterxml.jackson.core:jackson-databind")

	// Kafka — publishes device.discovered and the compacted device.configured
	implementation("org.springframework.boot:spring-boot-starter-kafka")

	// Plain JDBC (no JPA) — reads the config projection from the shared database
	implementation("org.springframework.boot:spring-boot-starter-jdbc")
	runtimeOnly("org.postgresql:postgresql")

	// Eclipse Paho MQTT client — broker watcher and discovery sessions
	implementation("org.eclipse.paho:org.eclipse.paho.client.mqttv3:1.2.5")

	// Protobuf message classes for the event contracts
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
