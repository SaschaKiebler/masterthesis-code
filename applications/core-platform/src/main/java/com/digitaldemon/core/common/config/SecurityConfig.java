package com.digitaldemon.core.common.config;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtDecoders;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.Arrays;

@Slf4j
@Configuration
@EnableWebSecurity
@org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    private final N8nServiceTokenAuthenticationFilter n8nServiceTokenAuthenticationFilter;

    @Value("${auth0.audience:https://api.digitaldemon.local}")
    private String audience;

    @Value("${spring.security.oauth2.resourceserver.jwt.issuer-uri:}")
    private String issuerUri;

    /**
     * Production security filter chain — requires valid Auth0 JWT on all API endpoints.
     * Health/actuator endpoints remain public.
     */
    @Bean
    @Profile("!dev")
    public SecurityFilterChain securedFilterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))
            .sessionManagement(session ->
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .addFilterBefore(n8nServiceTokenAuthenticationFilter, BearerTokenAuthenticationFilter.class)
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/**").permitAll()
                .requestMatchers("/api/v1/**").authenticated()
                .anyRequest().permitAll()
            )
            .oauth2ResourceServer(oauth2 -> oauth2
                .jwt(jwt -> jwt
                    .decoder(jwtDecoder())
                    .jwtAuthenticationConverter(jwtAuthenticationConverter())
                )
            );

        return http.build();
    }

    /**
     * Dev security filter chain — permits all requests without authentication.
     * When AUTH0_DOMAIN is configured, JWT parsing is enabled so that
     * user auto-provisioning works on login (ADR-009).
     * Activate with: spring.profiles.active=dev
     */
    @Bean
    @Profile("dev")
    public SecurityFilterChain devFilterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))
            .sessionManagement(session ->
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .addFilterBefore(n8nServiceTokenAuthenticationFilter, BearerTokenAuthenticationFilter.class)
            .authorizeHttpRequests(auth -> auth
                .anyRequest().permitAll()
            );

        if (isAuth0Configured()) {
            log.info("Auth0 is configured — enabling JWT parsing in dev mode");
            http.oauth2ResourceServer(oauth2 -> oauth2
                .jwt(jwt -> jwt
                    .decoder(jwtDecoder())
                    .jwtAuthenticationConverter(jwtAuthenticationConverter())
                )
            );
        } else {
            log.warn("Auth0 not configured — JWT parsing disabled. Set AUTH0_DOMAIN to enable user provisioning.");
        }

        return http.build();
    }

    /**
     * JWT decoder with audience validation against Auth0.
     * Available in all profiles. Returns a no-op decoder if Auth0 is not configured,
     * allowing the app to start without AUTH0_DOMAIN in dev mode.
     *
     * Uses lazy initialization — the actual Auth0 JWKS fetch is deferred to the first
     * token decode request. This prevents startup failures when Auth0 is temporarily
     * unreachable (network timeout, DNS delay, etc.). If the first decode fails due to
     * connectivity, subsequent requests will retry since the delegate stays uninitialized.
     */
    @Bean
    public JwtDecoder jwtDecoder() {
        if (!isAuth0Configured()) {
            return token -> {
                throw new JwtException("Auth0 is not configured. Set AUTH0_DOMAIN environment variable.");
            };
        }

        // Capture config values for the lazy initializer
        final String issuer = this.issuerUri;
        final String aud = this.audience;

        return new JwtDecoder() {
            private volatile JwtDecoder delegate;

            @Override
            public Jwt decode(String token) throws JwtException {
                if (delegate == null) {
                    synchronized (this) {
                        if (delegate == null) {
                            log.info("Initializing Auth0 JWT decoder (first token validation)...");
                            delegate = buildDecoder(issuer, aud);
                            log.info("Auth0 JWT decoder initialized successfully");
                        }
                    }
                }
                return delegate.decode(token);
            }
        };
    }

    private static NimbusJwtDecoder buildDecoder(String issuerUri, String audience) {
        NimbusJwtDecoder decoder = JwtDecoders.fromIssuerLocation(issuerUri);

        OAuth2TokenValidator<Jwt> withIssuer = JwtValidators.createDefaultWithIssuer(issuerUri);
        OAuth2TokenValidator<Jwt> withAudience = new AudienceValidator(audience);
        OAuth2TokenValidator<Jwt> combined = new DelegatingOAuth2TokenValidator<>(withIssuer, withAudience);

        decoder.setJwtValidator(combined);
        return decoder;
    }

    private boolean isAuth0Configured() {
        return issuerUri != null
            && !issuerUri.isBlank()
            && !issuerUri.contains("YOUR_AUTH0_DOMAIN")
            && !issuerUri.equals("https:///")
            && issuerUri.matches("https://[a-zA-Z0-9].*");
    }

    /**
     * Maps Auth0 permissions claim to Spring Security granted authorities.
     */
    @Bean
    public JwtAuthenticationConverter jwtAuthenticationConverter() {
        JwtGrantedAuthoritiesConverter converter = new JwtGrantedAuthoritiesConverter();
        converter.setAuthoritiesClaimName("permissions");
        converter.setAuthorityPrefix("");

        JwtAuthenticationConverter jwtConverter = new JwtAuthenticationConverter();
        jwtConverter.setJwtGrantedAuthoritiesConverter(converter);
        return jwtConverter;
    }

    @Value("${cors.allowed-origins:}")
    private String corsAllowedOrigins;

    @Bean
    public UrlBasedCorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();
        java.util.List<String> origins = new java.util.ArrayList<>(Arrays.asList(
            "http://localhost:3000",
            "http://localhost:3001"
        ));
        if (corsAllowedOrigins != null && !corsAllowedOrigins.isBlank()) {
            origins.addAll(Arrays.asList(corsAllowedOrigins.split(",")));
        }
        configuration.setAllowedOrigins(origins);
        configuration.setAllowedMethods(Arrays.asList("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(Arrays.asList("*"));
        configuration.setAllowCredentials(true);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }
}
