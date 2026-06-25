-- V2: Add heating curve reference fields to sites table
-- Phase B: Consultant Analysis View — Option C (actual vs configured curve)
-- Date: 2026-02-10

ALTER TABLE sites
    ADD COLUMN IF NOT EXISTS heating_curve_slope DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS heating_curve_offset DOUBLE PRECISION;
