package com.digitaldemon.core.tenancy;

import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Registers the tenant interceptor for the whole API.
 *
 * <p>The two excluded paths are the ones that must work before a caller has an
 * identity at all. Shared reference data ({@code /object-types},
 * {@code /physical-quantities}, …) is deliberately NOT excluded by path: it is
 * handled by the GLOBAL rule instead, which lets everyone read it and stops a
 * viewer from writing it. An exclusion would have permitted both.
 */
@Configuration
@RequiredArgsConstructor
public class TenantScopeWebMvcConfig implements WebMvcConfigurer {

    private final TenantScopeInterceptor tenantScopeInterceptor;

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(tenantScopeInterceptor)
                .addPathPatterns("/api/v1/**")
                .excludePathPatterns(
                        "/api/v1/auth/**",
                        "/api/v1/invitations/by-token/**");
    }
}
