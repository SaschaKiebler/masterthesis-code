package com.digitaldemon.core.config;

import com.digitaldemon.core.common.config.N8nServiceAuthProperties;
import com.digitaldemon.core.common.config.N8nServiceTokenAuthenticationFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

class N8nServiceTokenAuthenticationFilterTest {

    private N8nServiceAuthProperties properties;
    private N8nServiceTokenAuthenticationFilter filter;

    @BeforeEach
    void setUp() {
        properties = new N8nServiceAuthProperties();
        properties.setEnabled(true);
        properties.setToken("n8n-secret-token");
        properties.setSubject("service:n8n");
        properties.setEmail("n8n@digitaldemon.local");
        properties.setDisplayName("n8n Service User");

        filter = new N8nServiceTokenAuthenticationFilter(properties);
        SecurityContextHolder.clearContext();
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void shouldAuthenticateAndStripAuthorizationHeaderWhenTokenMatches() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/object-types");
        request.addHeader(HttpHeaders.AUTHORIZATION, "Bearer n8n-secret-token");
        MockHttpServletResponse response = new MockHttpServletResponse();

        AtomicReference<Authentication> authenticationInChain = new AtomicReference<>();
        AtomicReference<String> authorizationHeaderInChain = new AtomicReference<>();

        FilterChain chain = (req, res) -> {
            authenticationInChain.set(SecurityContextHolder.getContext().getAuthentication());
            authorizationHeaderInChain.set(((HttpServletRequest) req).getHeader(HttpHeaders.AUTHORIZATION));
        };

        filter.doFilter(request, response, chain);

        assertThat(authenticationInChain.get()).isInstanceOf(JwtAuthenticationToken.class);
        Jwt principal = (Jwt) authenticationInChain.get().getPrincipal();
        assertThat(principal.getSubject()).isEqualTo("service:n8n");
        assertThat(principal.getClaimAsString("email")).isEqualTo("n8n@digitaldemon.local");
        assertThat(authorizationHeaderInChain.get()).isNull();
    }

    @Test
    void shouldNotAuthenticateWhenTokenDoesNotMatch() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/object-types");
        request.addHeader(HttpHeaders.AUTHORIZATION, "Bearer wrong-token");
        MockHttpServletResponse response = new MockHttpServletResponse();

        AtomicReference<Authentication> authenticationInChain = new AtomicReference<>();
        AtomicReference<String> authorizationHeaderInChain = new AtomicReference<>();

        FilterChain chain = (req, res) -> {
            authenticationInChain.set(SecurityContextHolder.getContext().getAuthentication());
            authorizationHeaderInChain.set(((HttpServletRequest) req).getHeader(HttpHeaders.AUTHORIZATION));
        };

        filter.doFilter(request, response, chain);

        assertThat(authenticationInChain.get()).isNull();
        assertThat(authorizationHeaderInChain.get()).isEqualTo("Bearer wrong-token");
    }

    @Test
    void shouldSkipFilterWhenDisabled() throws Exception {
        properties.setEnabled(false);

        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/object-types");
        request.addHeader(HttpHeaders.AUTHORIZATION, "Bearer n8n-secret-token");
        MockHttpServletResponse response = new MockHttpServletResponse();

        AtomicReference<Authentication> authenticationInChain = new AtomicReference<>();
        FilterChain chain = (req, res) -> authenticationInChain.set(SecurityContextHolder.getContext().getAuthentication());

        filter.doFilter(request, response, chain);

        assertThat(authenticationInChain.get()).isNull();
    }
}
