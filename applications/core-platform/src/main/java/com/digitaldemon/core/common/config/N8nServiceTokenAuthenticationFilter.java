package com.digitaldemon.core.common.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;

/**
 * Authenticates static n8n bearer tokens and injects a synthetic JWT principal.
 *
 * This allows machine-to-machine callers to access the Core API without Auth0 user login,
 * while still flowing through existing AuthService user-resolution logic by auth0_sub.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class N8nServiceTokenAuthenticationFilter extends OncePerRequestFilter {

    private static final String TOKEN_VALUE = "n8n-service-token";

    private final N8nServiceAuthProperties properties;

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !properties.isEnabled() || properties.getToken() == null || properties.getToken().isBlank();
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {

        String authorization = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            filterChain.doFilter(request, response);
            return;
        }

        String presentedToken = authorization.substring(7).trim();
        if (!isTokenMatch(presentedToken, properties.getToken())) {
            filterChain.doFilter(request, response);
            return;
        }

        if (SecurityContextHolder.getContext().getAuthentication() == null) {
            Jwt jwt = buildServiceJwt();
            AbstractAuthenticationToken authentication = new JwtAuthenticationToken(
                    jwt,
                    List.of(new SimpleGrantedAuthority("service:n8n"))
            );
            SecurityContextHolder.getContext().setAuthentication(authentication);
            log.debug("Authenticated request using n8n service bearer token for subject {}", properties.getAuth0Sub());
        }

        // Prevent OAuth2 BearerTokenAuthenticationFilter from trying to parse this non-JWT token.
        filterChain.doFilter(stripAuthorizationHeader(request), response);
    }

    private Jwt buildServiceJwt() {
        Instant now = Instant.now();

        Map<String, Object> headers = new HashMap<>();
        headers.put("alg", "none");
        headers.put("typ", "JWT");

        Map<String, Object> claims = new HashMap<>();
        claims.put("sub", properties.getAuth0Sub());
        if (properties.getEmail() != null && !properties.getEmail().isBlank()) {
            claims.put("email", properties.getEmail());
        }
        if (properties.getDisplayName() != null && !properties.getDisplayName().isBlank()) {
            claims.put("name", properties.getDisplayName());
        }
        claims.put("permissions", List.of("service:n8n"));

        return new Jwt(TOKEN_VALUE, now, now.plusSeconds(3600), headers, claims);
    }

    private boolean isTokenMatch(String presentedToken, String configuredToken) {
        byte[] left = presentedToken.getBytes(StandardCharsets.UTF_8);
        byte[] right = configuredToken.getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(left, right);
    }

    private HttpServletRequest stripAuthorizationHeader(HttpServletRequest request) {
        return new HttpServletRequestWrapper(request) {
            @Override
            public String getHeader(String name) {
                if (HttpHeaders.AUTHORIZATION.equalsIgnoreCase(name)) {
                    return null;
                }
                return super.getHeader(name);
            }

            @Override
            public Enumeration<String> getHeaders(String name) {
                if (HttpHeaders.AUTHORIZATION.equalsIgnoreCase(name)) {
                    return Collections.emptyEnumeration();
                }
                return super.getHeaders(name);
            }

            @Override
            public Enumeration<String> getHeaderNames() {
                Enumeration<String> headerNames = super.getHeaderNames();
                if (headerNames == null) {
                    return Collections.emptyEnumeration();
                }

                List<String> names = Collections.list(headerNames);
                names.removeIf(header -> HttpHeaders.AUTHORIZATION.equalsIgnoreCase(header));
                return Collections.enumeration(names);
            }
        };
    }
}
