package com.digitaldemon.core.service;

import com.digitaldemon.core.common.N8nServiceUserBootstrap;

import com.digitaldemon.core.common.config.N8nServiceAuthProperties;
import com.digitaldemon.core.user.User;
import com.digitaldemon.core.user.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.boot.ApplicationArguments;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class N8nServiceUserBootstrapTest {

    @Mock
    private UserRepository userRepository;

    @Mock
    private ApplicationArguments applicationArguments;

    private N8nServiceAuthProperties properties;
    private N8nServiceUserBootstrap bootstrap;

    @BeforeEach
    void setUp() {
        properties = new N8nServiceAuthProperties();
        properties.setEnabled(true);
        properties.setToken("n8n-secret-token");
        properties.setSubject("service:n8n");
        properties.setEmail("n8n@digitaldemon.local");
        properties.setDisplayName("n8n Service User");
        properties.setGlobalRole("system_admin");

        bootstrap = new N8nServiceUserBootstrap(userRepository, properties);
    }

    @Test
    void shouldCreateServiceUserWhenMissing() throws Exception {
        given(userRepository.findBySubject("service:n8n")).willReturn(Optional.empty());
        given(userRepository.save(any(User.class))).willAnswer(invocation -> invocation.getArgument(0));

        bootstrap.run(applicationArguments);

        ArgumentCaptor<User> savedUser = ArgumentCaptor.forClass(User.class);
        verify(userRepository).save(savedUser.capture());

        User user = savedUser.getValue();
        assertThat(user.getSubject()).isEqualTo("service:n8n");
        assertThat(user.getEmail()).isEqualTo("n8n@digitaldemon.local");
        assertThat(user.getDisplayName()).isEqualTo("n8n Service User");
        assertThat(user.getGlobalRole()).isEqualTo("system_admin");
        assertThat(user.getCreatedAt()).isNotNull();
        assertThat(user.getLastLoginAt()).isNotNull();
    }

    @Test
    void shouldUpdateExistingServiceUser() throws Exception {
        User existing = new User();
        existing.setSubject("service:n8n");
        existing.setGlobalRole("viewer");
        existing.setEmail("old@example.com");
        existing.setDisplayName("Old");

        given(userRepository.findBySubject("service:n8n")).willReturn(Optional.of(existing));
        given(userRepository.save(any(User.class))).willAnswer(invocation -> invocation.getArgument(0));

        bootstrap.run(applicationArguments);

        verify(userRepository).save(existing);
        assertThat(existing.getGlobalRole()).isEqualTo("system_admin");
        assertThat(existing.getEmail()).isEqualTo("n8n@digitaldemon.local");
        assertThat(existing.getDisplayName()).isEqualTo("n8n Service User");
        assertThat(existing.getLastLoginAt()).isNotNull();
    }

    @Test
    void shouldSkipWhenDisabled() throws Exception {
        properties.setEnabled(false);

        bootstrap.run(applicationArguments);

        verifyNoInteractions(userRepository);
    }

    @Test
    void shouldThrowWhenRoleIsInvalid() {
        properties.setGlobalRole("owner");

        assertThatThrownBy(() -> bootstrap.run(applicationArguments))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Invalid service-auth.n8n.global-role");

        verify(userRepository, never()).save(any(User.class));
    }
}
