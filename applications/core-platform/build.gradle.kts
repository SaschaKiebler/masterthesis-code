plugins {
	java
	id("org.springframework.boot") version "4.0.2"
	id("io.spring.dependency-management") version "1.1.7"
	id("com.google.protobuf") version "0.9.4"
}

group = "com.digitaldemon"
version = "0.0.1-SNAPSHOT"
description = "Digital Demon Core Platform"

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
	// Spring Boot
	implementation("org.springframework.boot:spring-boot-starter-actuator")
	implementation("org.springframework.boot:spring-boot-starter-data-jpa")
	implementation("org.springframework.boot:spring-boot-starter-security")
	implementation("org.springframework.boot:spring-boot-starter-oauth2-resource-server")
	implementation("org.springframework.boot:spring-boot-starter-web")
	
	// gRPC and Protobuf
	implementation("net.devh:grpc-spring-boot-starter:3.1.0.RELEASE")
	implementation("io.grpc:grpc-stub:1.63.0")
	implementation("io.grpc:grpc-protobuf:1.63.0")
	implementation("io.grpc:grpc-netty-shaded:1.63.0")
	implementation("com.google.protobuf:protobuf-java:3.25.3")
	implementation("com.google.api.grpc:proto-google-common-protos:2.37.1")
	implementation("javax.annotation:javax.annotation-api:1.3.2")
	
	// Dev tools (auto-restart on file changes)
	developmentOnly("org.springframework.boot:spring-boot-devtools")

	// Lombok
	compileOnly("org.projectlombok:lombok")
	annotationProcessor("org.projectlombok:lombok")
	
	// Database
	runtimeOnly("org.postgresql:postgresql")
	
	// Flyway (schema migrations)
	implementation("org.springframework.boot:spring-boot-starter-flyway")
	implementation("org.flywaydb:flyway-database-postgresql")
	
	// Eclipse Paho MQTT client — subscribes to heizung/measurements/processed for event evaluation
	implementation("org.eclipse.paho:org.eclipse.paho.client.mqttv3:1.2.5")

	// exp4j — safe math expression evaluator for KPI formula builder
	implementation("net.objecthunter:exp4j:0.4.8")

	// Google Cloud Storage — SVG icon storage for synoptic view
	implementation("com.google.cloud:google-cloud-storage:2.43.1")

	// Testing
	testImplementation("org.springframework.boot:spring-boot-starter-test")
	testImplementation("org.springframework.boot:spring-boot-test")
	testImplementation("org.springframework.boot:spring-boot-test-autoconfigure")
	testImplementation("org.springframework.boot:spring-boot-testcontainers")
	testImplementation("org.springframework.security:spring-security-test")
	testImplementation("org.testcontainers:junit-jupiter:1.19.7")
	testImplementation("org.testcontainers:postgresql:1.19.7")
	testImplementation("io.grpc:grpc-testing:1.62.2")
	testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

protobuf {
	protoc {
		artifact = "com.google.protobuf:protoc:3.25.3"
	}
	plugins {
		create("grpc") {
			artifact = "io.grpc:protoc-gen-grpc-java:1.62.2"
		}
	}
	generateProtoTasks {
		all().forEach { task ->
			task.plugins {
				create("grpc")
			}
		}
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

// Load .env file into bootRun environment variables
tasks.named<org.springframework.boot.gradle.tasks.run.BootRun>("bootRun") {
	val envFile = file(".env")
	if (envFile.exists()) {
		envFile.readLines()
			.filter { it.isNotBlank() && !it.startsWith("#") && it.contains("=") }
			.forEach { line ->
				val (key, value) = line.split("=", limit = 2)
				environment(key.trim(), value.trim())
			}
	}
}
