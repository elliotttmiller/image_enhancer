/**
 * imageRegeneratorValidation.ts
 * 
 * Enhanced batch processing with validation gates and fallback strategies
 * Integrates geometric validation to prevent hallucinated outputs
 */

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
  status: 'pending' | 'processing' | 'success' | 'validation_failed' | 'error';
  error?: string;
  warnings?: string[];
  retryCount: number;
  maxRetries: number;
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
   * Validate generated image against original
   * Returns validation result and determines if retry is needed
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
// COMPONENT DETECTION MOCK
// For production, integrate with actual image analysis (OpenCV, TensorFlow, etc.)
// ============================================================================

export async function detectComponents(
  base64Image: string,
  imageDimensions: { width: number; height: number }
): Promise<DetectedComponent[]> {
  // This is a placeholder implementation.
  // In production, this would:
  // 1. Decode the base64 image
  // 2. Run edge detection or ML-based component detection
  // 3. Cluster connected components
  // 4. Classify each component (fastener, structural, etc.)
  // 5. Return bounding boxes and confidence scores

  // For now, return a mock result
  console.warn('[MOCK] detectComponents: Returning mock data. Integrate real image analysis.');

  return [
    {
      id: 'comp_1',
      type: 'fastener',
      count: 1,
      boundingBox: {
        x: 100,
        y: 100,
        width: 50,
        height: 50,
      },
      confidence: 0.95,
    },
    {
      id: 'comp_2',
      type: 'structural',
      count: 1,
      boundingBox: {
        x: 200,
        y: 150,
        width: 300,
        height: 200,
      },
      confidence: 0.99,
    },
  ];
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
