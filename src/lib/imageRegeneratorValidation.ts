/**
 * imageRegeneratorValidation.ts
 * 
 * Production-grade batch processing with validation gates and fallback strategies.
 * Component detection uses real Gemini AI vision analysis (replaces previous mock).
 * Integrates geometric validation to prevent hallucinated outputs.
 */

import { GoogleGenAI, Type } from "@google/genai";
import { AppError, ErrorCode } from "../types";
import { geometryValidator, buildGeometryProfile, DetectedComponent, ValidationResult } from "./geometryValidator";

// ============================================================================
// VALIDATION RESULT TYPES
// ============================================================================

export interface ProcessingResult {
  itemId: string;
  originalDataUri: string;
  generatedDataUri?: string;
  validationResult?: ValidationResult;
  /** AI-based creative validation report (set when post-verification ran) */
  creativeValidationReport?: CreativeValidationReport;
  status: 'pending' | 'processing' | 'success' | 'validation_failed' | 'error';
  error?: string;
  warnings?: string[];
  retryCount: number;
  maxRetries: number;
}

/**
 * Rich validation report that combines geometric scoring with the AI verification
 * result from verifyRegeneration. Shown in the UI as a per-item quality card.
 */
export interface CreativeValidationReport {
  overallScore: number;            // 0–1 composite
  inventoryMatchScore: number;     // 0–1
  dimensionalFidelityScore: number;// 0–1
  noveltyScore: number;            // 0–1
  compliancePassed: boolean;
  passed: boolean;
  failureSummary: string[];
  warnings: string[];
}

export interface BatchProcessingConfig {
  strictMode: boolean; // If true, reject any validation failures; if false, warn but accept
  autoRetry: boolean; // Automatically retry failed validations
  maxRetriesPerItem: number;
  validationThresholdScore: number; // 0-1, minimum acceptable score
}

// ============================================================================
// BATCH PROCESSOR WITH VALIDATION
// ============================================================================

export class ValidatedImageProcessor {
  private config: BatchProcessingConfig;
  private results: Map<string, ProcessingResult> = new Map();

  constructor(config: Partial<BatchProcessingConfig> = {}) {
    this.config = {
      strictMode: true,
      autoRetry: true,
      maxRetriesPerItem: 2,
      validationThresholdScore: 0.65,
      ...config,
    };
  }

  /**
   * Track a processing result with built-in validation
   */
  trackResult(
    itemId: string,
    originalDataUri: string,
    generatedDataUri: string | undefined,
    status: ProcessingResult['status'],
    error?: string,
    warnings?: string[]
  ): ProcessingResult {
    const result: ProcessingResult = {
      itemId,
      originalDataUri,
      generatedDataUri,
      status,
      error,
      warnings,
      retryCount: this.results.get(itemId)?.retryCount ?? 0,
      maxRetries: this.config.maxRetriesPerItem,
    };

    this.results.set(itemId, result);
    return result;
  }

  /**
   * Validate generated image against original using geometric analysis.
   * Returns validation result and determines if retry is needed.
   */
  async validateGeneration(
    itemId: string,
    originalComponents: DetectedComponent[],
    regeneratedComponents: DetectedComponent[],
    originalDimensions: { width: number; height: number },
    regeneratedDimensions: { width: number; height: number }
  ): Promise<{
    valid: boolean;
    shouldRetry: boolean;
    validationResult: ValidationResult;
    recommendation: string;
  }> {
    // Build geometric profiles
    const origProfile = buildGeometryProfile(
      `${itemId}-original`,
      originalDimensions,
      originalComponents
    );

    const rGenProfile = buildGeometryProfile(
      `${itemId}-regenerated`,
      regeneratedDimensions,
      regeneratedComponents
    );

    // Run validation
    const validationResult = geometryValidator.validate(origProfile, rGenProfile);

    // Determine if we should retry
    const shouldRetry =
      this.config.autoRetry &&
      validationResult.score < this.config.validationThresholdScore &&
      (this.results.get(itemId)?.retryCount ?? 0) < this.config.maxRetriesPerItem;

    // Generate recommendation
    let recommendation = '';
    if (validationResult.valid) {
      recommendation = `✓ PASS: Validation score ${(validationResult.score * 100).toFixed(0)}%. Accept output.`;
    } else if (shouldRetry) {
      recommendation = `⚠ RETRY: Score ${(validationResult.score * 100).toFixed(0)}% below threshold (${(this.config.validationThresholdScore * 100).toFixed(0)}%). Retrying...`;
    } else if (this.config.strictMode) {
      recommendation = `✗ FAIL: Score ${(validationResult.score * 100).toFixed(0)}%. Max retries exhausted. Rejecting output.`;
    } else {
      recommendation = `⚠ WARN: Score ${(validationResult.score * 100).toFixed(0)}%. Accepting with warnings (strict mode disabled).`;
    }

    const valid = this.config.strictMode
      ? validationResult.valid || validationResult.score >= this.config.validationThresholdScore
      : true; // In non-strict mode, accept if we're not retrying

    return {
      valid,
      shouldRetry,
      validationResult,
      recommendation,
    };
  }

  /**
   * Get detailed diagnostics for a processed item
   */
  getDiagnostics(itemId: string) {
    const result = this.results.get(itemId);
    if (!result) return null;

    return {
      itemId,
      status: result.status,
      retries: `${result.retryCount}/${result.maxRetries}`,
      error: result.error,
      warnings: result.warnings,
      validationScore: result.validationResult?.score ?? null,
      issues: result.validationResult?.issues ?? [],
      creativeValidation: result.creativeValidationReport ?? null,
    };
  }

  /**
   * Get all results with filter
   */
  getResults(filter?: { status?: ProcessingResult['status'] }) {
    const results = Array.from(this.results.values());
    if (filter?.status) {
      return results.filter(r => r.status === filter.status);
    }
    return results;
  }

  /**
   * Get summary statistics
   */
  getSummary() {
    const results = Array.from(this.results.values());
    return {
      total: results.length,
      succeeded: results.filter(r => r.status === 'success').length,
      validationFailed: results.filter(r => r.status === 'validation_failed').length,
      errors: results.filter(r => r.status === 'error').length,
      pending: results.filter(r => r.status === 'pending').length,
      successRate: results.length > 0
        ? (results.filter(r => r.status === 'success').length / results.length * 100).toFixed(1)
        : '0',
    };
  }
}

// ============================================================================
// COMPONENT DETECTION — Gemini AI Vision Analysis
// Replaces the previous placeholder/mock implementation with a real call to
// Gemini that extracts component bounding boxes and classifications from the
// image. Used by ValidatedImageProcessor.validateGeneration for geometric
// fidelity scoring in the batch pipeline.
// ============================================================================

const COMPONENT_DETECTION_PROMPT = `
Analyse the attached product/parts image. Identify and locate every discrete physical
component visible in the image. For each component return a JSON object with:
- "id": a short unique identifier (e.g. "comp_1")
- "type": one of "fastener" | "structural" | "mechanical" | "seal" | "electrical" | "other"
- "count": how many instances of this component are visible
- "boundingBox": { "x": <px from left>, "y": <px from top>, "width": <px>, "height": <px> }
  Coordinates are in pixels assuming a 1000×1000 normalised image space.
- "confidence": 0.0–1.0

Return a JSON array of these objects only. No markdown, no commentary.
`;

export async function detectComponents(
  base64Image: string,
  imageDimensions: { width: number; height: number }
): Promise<DetectedComponent[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[detectComponents] No GEMINI_API_KEY — returning empty component list.');
    return [];
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: {
        parts: [
          { text: COMPONENT_DETECTION_PROMPT },
          { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
        ],
      },
      config: {
        temperature: 0.05,
        responseMimeType: 'application/json',
      },
    });

    const text = response.text?.trim();
    if (!text) {
      console.warn('[detectComponents] Empty response from Gemini — returning empty list.');
      return [];
    }

    const raw = JSON.parse(text);
    if (!Array.isArray(raw)) {
      console.warn('[detectComponents] Unexpected response shape:', text.substring(0, 200));
      return [];
    }

    // Normalise bounding boxes from 1000×1000 space to actual image pixels
    const scaleX = imageDimensions.width / 1000;
    const scaleY = imageDimensions.height / 1000;

    return raw.map((item: any, i: number): DetectedComponent => ({
      id: item.id ?? `comp_${i + 1}`,
      type: item.type ?? 'other',
      count: typeof item.count === 'number' ? item.count : 1,
      boundingBox: {
        x: Math.round((item.boundingBox?.x ?? 0) * scaleX),
        y: Math.round((item.boundingBox?.y ?? 0) * scaleY),
        width: Math.round((item.boundingBox?.width ?? 50) * scaleX),
        height: Math.round((item.boundingBox?.height ?? 50) * scaleY),
      },
      confidence: typeof item.confidence === 'number' ? item.confidence : 0.8,
    }));
  } catch (err) {
    console.error('[detectComponents] AI detection failed:', err);
    return [];
  }
}

// ============================================================================
// RETRY STRATEGY WITH QUALITY GATES
// ============================================================================

export async function processWithValidationRetry<T>(
  fn: (attempt: number) => Promise<T>,
  validator: (result: T) => Promise<{valid: boolean; shouldRetry: boolean}>,
  options: {
    maxRetries?: number;
    delayMs?: number;
    backoffMultiplier?: number;
  } = {}
): Promise<{
  result?: T;
  success: boolean;
  attempts: number;
  errors: string[];
}> {
  const {
    maxRetries = 3,
    delayMs = 1000,
    backoffMultiplier = 1.5,
  } = options;

  const errors: string[] = [];
  let delay = delayMs;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.info(`[Retry Strategy] Attempt ${attempt}/${maxRetries}`);
      const result = await fn(attempt);

      const { valid, shouldRetry } = await validator(result);

      if (valid) {
        return { result, success: true, attempts: attempt, errors };
      }

      if (!shouldRetry || attempt === maxRetries) {
        return { result, success: false, attempts: attempt, errors };
      }

      // Wait before retry
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(delay * backoffMultiplier, 30000); // Cap at 30s
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(msg);

      if (attempt === maxRetries) {
        return { success: false, attempts: attempt, errors };
      }

      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(delay * backoffMultiplier, 30000);
    }
  }

  return { success: false, attempts: maxRetries, errors };
}

// ============================================================================
// EXPORT SINGLETON
// ============================================================================

export const validatedImageProcessor = new ValidatedImageProcessor({
  strictMode: true,
  autoRetry: true,
  maxRetriesPerItem: 2,
  validationThresholdScore: 0.65,
});
