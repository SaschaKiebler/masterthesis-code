package com.digitaldemon.core.user;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;

/**
 * Issues self-signed HS256 access tokens for local authentication.
 * The same key is used by the resource-server side (SecurityConfig) to verify them.
 */
@Service
public class LocalTokenService {

    private final LocalAuthProperties properties;
    private final SecretKey secretKey;

    public LocalTokenService(LocalAuthProperties properties) {
        this.properties = properties;
        this.secretKey = deriveKey(properties.getJwtSecret());
    }

    /** HMAC key derived via SHA-256 so any configured secret yields a valid 256-bit key. */
    private static SecretKey deriveKey(String secret) {
        try {
            byte[] keyBytes = MessageDigest.getInstance("SHA-256")
                    .digest(secret.getBytes(StandardCharsets.UTF_8));
            return new SecretKeySpec(keyBytes, "HmacSHA256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }

    public SecretKey getSecretKey() {
        return secretKey;
    }

    public String issueToken(User user) {
        Instant now = Instant.now();
        Instant expiry = now.plus(properties.getTokenTtlHours(), ChronoUnit.HOURS);

        JWTClaimsSet.Builder claims = new JWTClaimsSet.Builder()
                .subject(user.getSubject())
                .issuer(properties.getIssuer())
                .issueTime(Date.from(now))
                .expirationTime(Date.from(expiry));
        if (user.getEmail() != null) {
            claims.claim("email", user.getEmail());
        }
        if (user.getDisplayName() != null) {
            claims.claim("name", user.getDisplayName());
        }

        try {
            SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims.build());
            jwt.sign(new MACSigner(secretKey));
            return jwt.serialize();
        } catch (Exception e) {
            throw new IllegalStateException("Failed to sign access token", e);
        }
    }
}
