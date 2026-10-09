package com.heatingplatform.core.common;

import com.google.cloud.storage.BlobId;
import com.google.cloud.storage.BlobInfo;
import com.google.cloud.storage.Storage;
import com.google.cloud.storage.StorageOptions;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Google Cloud Storage service for file uploads (SVG icons, background images).
 * Uses Application Default Credentials (ADC) for authentication.
 */
@Slf4j
@Service
public class StorageService {

    private final Storage storage;
    private final String bucketName;

    public StorageService(
            @Value("${gcs.bucket-name:}") String bucketName,
            @Value("${gcs.project-id:}") String projectId) {
        this.bucketName = bucketName;

        if (projectId != null && !projectId.isBlank()) {
            this.storage = StorageOptions.newBuilder()
                .setProjectId(projectId)
                .build()
                .getService();
        } else {
            this.storage = StorageOptions.getDefaultInstance().getService();
        }
    }

    /**
     * Check if GCS is configured and available.
     */
    public boolean isConfigured() {
        return bucketName != null && !bucketName.isBlank();
    }

    /**
     * Upload a file to GCS and return the public URL.
     *
     * @param path        Object path within the bucket (e.g., "icons/BOILER.svg")
     * @param content     File content bytes
     * @param contentType MIME type (e.g., "image/svg+xml")
     * @return Public URL of the uploaded file
     */
    public String upload(String path, byte[] content, String contentType) {
        if (!isConfigured()) {
            throw new IllegalStateException("GCS is not configured (GCS_BUCKET_NAME is empty)");
        }

        BlobId blobId = BlobId.of(bucketName, path);
        BlobInfo blobInfo = BlobInfo.newBuilder(blobId)
            .setContentType(contentType)
            .setCacheControl("public, max-age=31536000") // 1 year cache for immutable assets
            .build();

        storage.create(blobInfo, content);
        String url = String.format("https://storage.googleapis.com/%s/%s", bucketName, path);
        log.info("Uploaded {} ({} bytes) to {}", path, content.length, url);
        return url;
    }

    /**
     * Delete a file from GCS.
     */
    public void delete(String path) {
        if (!isConfigured()) return;
        storage.delete(BlobId.of(bucketName, path));
        log.info("Deleted {} from GCS", path);
    }
}
