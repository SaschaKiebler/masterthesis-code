package com.heatingplatform.core;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class CorePlatformApplication {

	public static void main(String[] args) {
		SpringApplication.run(CorePlatformApplication.class, args);
	}

}
