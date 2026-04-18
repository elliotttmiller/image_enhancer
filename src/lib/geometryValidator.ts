/**
 * geometryValidator.ts
 * 
 * ANTI-HALLUCINATION LAYER
 * 
 * This module provides strict geometric validation to catch AI hallucinations:
 * - Part inventory mismatches (missing/added parts)
 * - Dimension distortions (unexpected scaling)
 * - Structure integrity (topology preservation)
 * - Component detection confidence scores
 * 
 * Used by ImageRegenerator to enforce quality gates before accepting regenerated images.
 */

// ============================================================================
// CORE TYPES
// ============================================================================

export interface DetectedComponent {
  id: string;
  type: 'fastener' | 'structural' | 'mechanical' | 'electrical' | 'assembly' | 'other';
  count: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  confidence: number; // 0.0 - 1.0
}

export interface GeometryProfile {
  imageId: string;
  timestamp: number;
  imageDimensions: { width: number; height: number };
  components: DetectedComponent[];
  structuralMetrics: {
    averageComponentSize: number; // pixels
    componentDensity: number; // components per 1000px²
    symmetryScore: number; // 0.0 - 1.0
    alignmentConsistency: number; // 0.0 - 1.0
  };
  fingerprint: string; // hash of component layout
}

export interface ValidationResult {
  valid: boolean;
  score: number; // 0.0 - 1.0, how confident we are this is correct
  issues: ValidationIssue[];
  warnings: ValidationWarning[];
}

export interface ValidationIssue {
  severity: 'critical' | 'high' | 'medium';
  code: string;
  message: string;
  context?: Record<string, any>;
}

export interface ValidationWarning {
  code: string;
  message: string;
}

// ============================================================================
// VALIDATION ENGINE
// ============================================================================

class GeometryValidator {
  private tolerances = {
    /** Part count mismatch allowed within ±X% */
    partCountVariance: 0.15, // 15%
    
    /** Component size variance tolerance */
    componentSizeVariance: 0.25, // ±25%
    
    /** Density variance (parts per area) */
    densityVariance: 0.20, // ±20%
    
    /** Symmetry threshold — if original is symmetric, output must maintain it */
    symmetryThreshold: 0.75,
    
    /** Minimum confidence required for component detection */
    minComponentConfidence: 0.7,
    
    /** Alignment consistency must be maintained */
    alignmentVariance: 0.15,
    
    /** Fingerprint match — structure must be ~70% similar */
    fingerprintSimilarity: 0.70,
  };

  /**
   * Validates a regenerated image against the original using geometric analysis.
   * Returns a comprehensive validation report.
   */
  validate(
    original: GeometryProfile,
    regenerated: GeometryProfile
  ): ValidationResult {
    const issues: ValidationIssue[] = [];
    const warnings: ValidationWarning[] = [];
    let score = 1.0;

    // 1. PART INVENTORY CHECK
    const partInventoryCheck = this.validatePartInventory(original, regenerated);
    if (!partInventoryCheck.valid) {
      issues.push(...partInventoryCheck.issues);
      score -= partInventoryCheck.penalty;
    }
    if (partInventoryCheck.warnings) {
      warnings.push(...partInventoryCheck.warnings);
    }

    // 2. COMPONENT SIZE CONSISTENCY
    const sizeCheck = this.validateComponentSizes(original, regenerated);
    if (!sizeCheck.valid) {
      issues.push(...sizeCheck.issues);
      score -= sizeCheck.penalty;
    }

    // 3. SPATIAL DENSITY CHECK
    const densityCheck = this.validateComponentDensity(original, regenerated);
    if (!densityCheck.valid) {
      issues.push(...densityCheck.issues);
      score -= densityCheck.penalty;
    }
    if (densityCheck.warnings) {
      warnings.push(...densityCheck.warnings);
    }

    // 4. SYMMETRY PRESERVATION
    const symmetryCheck = this.validateSymmetry(original, regenerated);
    if (!symmetryCheck.valid) {
      issues.push(...symmetryCheck.issues);
      score -= symmetryCheck.penalty;
    }

    // 5. ALIGNMENT & TOPOLOGY
    const alignmentCheck = this.validateAlignment(original, regenerated);
    if (!alignmentCheck.valid) {
      issues.push(...alignmentCheck.issues);
      score -= alignmentCheck.penalty;
    }

    // 6. STRUCTURAL FINGERPRINT
    const fingerprintCheck = this.validateFingerprint(original, regenerated);
    if (!fingerprintCheck.valid) {
      issues.push(...fingerprintCheck.issues);
      score -= fingerprintCheck.penalty;
    }

    // Clamp score to 0-1
    score = Math.max(0, Math.min(1, score));

    const valid = issues.length === 0 || score >= 0.65;

    return {
      valid,
      score,
      issues,
      warnings,
    };
  }

  // ========================================================================
  // VALIDATION CHECKS
  // ========================================================================

  private validatePartInventory(
    original: GeometryProfile,
    regenerated: GeometryProfile
  ): { valid: boolean; penalty: number; issues: ValidationIssue[]; warnings: ValidationWarning[] } {
    const issues: ValidationIssue[] = [];
    const warnings: ValidationWarning[] = [];
    let penalty = 0;

    const origCount = original.components.length;
    const rGenCount = regenerated.components.length;

    const variance = Math.abs(rGenCount - origCount) / Math.max(origCount, 1);

    if (variance > this.tolerances.partCountVariance) {
      const severity = variance > 0.3 ? 'critical' : 'high';
      issues.push({
        severity,
        code: 'PART_COUNT_MISMATCH',
        message: `Part inventory mismatch: original ${origCount}, regenerated ${rGenCount} (variance: ${(variance * 100).toFixed(1)}%). Expected ±${(this.tolerances.partCountVariance * 100).toFixed(0)}%.`,
        context: { original: origCount, regenerated: rGenCount, variance, tolerance: this.tolerances.partCountVariance },
      });
      penalty += 0.3;
    }

    // Check for high-confidence components in original missing in regenerated
    const origHighConf = original.components.filter(c => c.confidence >= 0.8);
    const rGenHighConf = regenerated.components.filter(c => c.confidence >= 0.8);
    const missingHighConf = origHighConf.length - rGenHighConf.length;

    if (missingHighConf > 0) {
      issues.push({
        severity: 'critical',
        code: 'MISSING_HIGH_CONFIDENCE_PARTS',
        message: `${missingHighConf} high-confidence parts (≥0.8) from original are missing in regenerated output.`,
        context: { missing: missingHighConf, origHighConf: origHighConf.length, rGenHighConf: rGenHighConf.length },
      });
      penalty += 0.4;
    }

    const valid = variance <= this.tolerances.partCountVariance && missingHighConf === 0;

    return { valid, penalty, issues, warnings };
  }

  private validateComponentSizes(
    original: GeometryProfile,
    regenerated: GeometryProfile
  ): { valid: boolean; penalty: number; issues: ValidationIssue[] } {
    const issues: ValidationIssue[] = [];
    let penalty = 0;

    const origAvgSize = original.structuralMetrics.averageComponentSize;
    const rGenAvgSize = regenerated.structuralMetrics.averageComponentSize;

    if (origAvgSize === 0) return { valid: true, penalty: 0, issues: [] };

    const sizeVariance = Math.abs(rGenAvgSize - origAvgSize) / origAvgSize;

    if (sizeVariance > this.tolerances.componentSizeVariance) {
      issues.push({
        severity: 'high',
        code: 'COMPONENT_SIZE_DISTORTION',
        message: `Average component size changed by ${(sizeVariance * 100).toFixed(1)}%. Original avg: ${origAvgSize.toFixed(0)}px, Regenerated: ${rGenAvgSize.toFixed(0)}px. Tolerance: ±${(this.tolerances.componentSizeVariance * 100).toFixed(0)}%.`,
        context: { original: origAvgSize, regenerated: rGenAvgSize, variance: sizeVariance },
      });
      penalty += 0.25;
    }

    return {
      valid: sizeVariance <= this.tolerances.componentSizeVariance,
      penalty,
      issues,
    };
  }

  private validateComponentDensity(
    original: GeometryProfile,
    regenerated: GeometryProfile
  ): { valid: boolean; penalty: number; issues: ValidationIssue[]; warnings: ValidationWarning[] } {
    const issues: ValidationIssue[] = [];
    const warnings: ValidationWarning[] = [];
    let penalty = 0;

    const origDensity = original.structuralMetrics.componentDensity;
    const rGenDensity = regenerated.structuralMetrics.componentDensity;

    if (origDensity === 0) return { valid: true, penalty: 0, issues: [], warnings: [] };

    const densityVariance = Math.abs(rGenDensity - origDensity) / origDensity;

    if (densityVariance > this.tolerances.densityVariance) {
      const severity = densityVariance > 0.35 ? 'high' : 'medium';
      issues.push({
        severity,
        code: 'COMPONENT_DENSITY_SHIFT',
        message: `Component density variance: ${(densityVariance * 100).toFixed(1)}%. Original: ${origDensity.toFixed(2)}/1000px², Regenerated: ${rGenDensity.toFixed(2)}/1000px². This suggests parts may be added or removed.`,
        context: { original: origDensity, regenerated: rGenDensity, variance: densityVariance },
      });
      penalty += 0.2;
    }

    if (densityVariance > 0.15 && densityVariance <= this.tolerances.densityVariance) {
      warnings.push({
        code: 'DENSITY_SLIGHT_VARIANCE',
        message: `Slight component density variance (${(densityVariance * 100).toFixed(1)}%). This may be due to aspect ratio changes or minor layout shifts. Monitor during visual review.`,
      });
    }

    return {
      valid: densityVariance <= this.tolerances.densityVariance,
      penalty,
      issues,
      warnings,
    };
  }

  private validateSymmetry(
    original: GeometryProfile,
    regenerated: GeometryProfile
  ): { valid: boolean; penalty: number; issues: ValidationIssue[] } {
    const issues: ValidationIssue[] = [];
    let penalty = 0;

    const origSymmetry = original.structuralMetrics.symmetryScore;
    const rGenSymmetry = regenerated.structuralMetrics.symmetryScore;

    // If original is highly symmetric, regenerated must preserve that
    if (origSymmetry >= this.tolerances.symmetryThreshold) {
      const symmetryLoss = origSymmetry - rGenSymmetry;

      if (symmetryLoss > 0.15) {
        issues.push({
          severity: 'high',
          code: 'SYMMETRY_LOSS',
          message: `Original design is highly symmetric (${(origSymmetry * 100).toFixed(0)}%), but regenerated lost symmetry (${(rGenSymmetry * 100).toFixed(0)}%, loss: ${(symmetryLoss * 100).toFixed(0)}%). This indicates geometric distortion.`,
          context: { original: origSymmetry, regenerated: rGenSymmetry, loss: symmetryLoss },
        });
        penalty += 0.25;
      }
    }

    return {
      valid: penalty === 0,
      penalty,
      issues,
    };
  }

  private validateAlignment(
    original: GeometryProfile,
    regenerated: GeometryProfile
  ): { valid: boolean; penalty: number; issues: ValidationIssue[] } {
    const issues: ValidationIssue[] = [];
    let penalty = 0;

    const origAlign = original.structuralMetrics.alignmentConsistency;
    const rGenAlign = regenerated.structuralMetrics.alignmentConsistency;

    const alignmentVariance = Math.abs(rGenAlign - origAlign);

    if (alignmentVariance > this.tolerances.alignmentVariance) {
      issues.push({
        severity: 'medium',
        code: 'ALIGNMENT_INCONSISTENCY',
        message: `Component alignment consistency degraded by ${(alignmentVariance * 100).toFixed(1)}%. Original: ${(origAlign * 100).toFixed(0)}%, Regenerated: ${(rGenAlign * 100).toFixed(0)}%. This may indicate skew, rotation, or layout distortion.`,
        context: { original: origAlign, regenerated: rGenAlign, variance: alignmentVariance },
      });
      penalty += 0.15;
    }

    return {
      valid: penalty === 0,
      penalty,
      issues,
    };
  }

  private validateFingerprint(
    original: GeometryProfile,
    regenerated: GeometryProfile
  ): { valid: boolean; penalty: number; issues: ValidationIssue[] } {
    const issues: ValidationIssue[] = [];
    let penalty = 0;

    const similarity = this.computeFingerprintSimilarity(
      original.fingerprint,
      regenerated.fingerprint
    );

    if (similarity < this.tolerances.fingerprintSimilarity) {
      issues.push({
        severity: 'high',
        code: 'STRUCTURAL_LAYOUT_DEVIATION',
        message: `Structural layout changed significantly (similarity: ${(similarity * 100).toFixed(0)}%). Expected ≥${(this.tolerances.fingerprintSimilarity * 100).toFixed(0)}%. This indicates major compositional shift or component rearrangement.`,
        context: { similarity, threshold: this.tolerances.fingerprintSimilarity },
      });
      penalty += 0.3;
    }

    return {
      valid: similarity >= this.tolerances.fingerprintSimilarity,
      penalty,
      issues,
    };
  }

  // ========================================================================
  // HELPERS
  // ========================================================================

  private computeFingerprintSimilarity(fp1: string, fp2: string): number {
    if (!fp1 || !fp2) return 0.5;

    const bytes1 = Buffer.from(fp1, 'hex');
    const bytes2 = Buffer.from(fp2, 'hex');

    if (bytes1.length === 0 || bytes2.length === 0) return 0.5;

    let matchingBits = 0;
    const totalBits = Math.min(bytes1.length, bytes2.length) * 8;

    for (let i = 0; i < Math.min(bytes1.length, bytes2.length); i++) {
      const xor = bytes1[i] ^ bytes2[i];
      matchingBits += 8 - this.popcount(xor);
    }

    return totalBits > 0 ? matchingBits / totalBits : 0.5;
  }

  private popcount(n: number): number {
    let count = 0;
    while (n) {
      count += n & 1;
      n >>>= 1;
    }
    return count;
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const geometryValidator = new GeometryValidator();

// ============================================================================
// PROFILE BUILDER UTILITY
// ============================================================================

/**
 * Placeholder builder — in production, this would integrate with image analysis
 * (edge detection, component counting, clustering, etc.)
 */
export function buildGeometryProfile(
  imageId: string,
  dimensions: { width: number; height: number },
  detectedComponents: DetectedComponent[]
): GeometryProfile {
  const timestamp = Date.now();

  // Compute structural metrics
  const componentSizes = detectedComponents.map(c => c.boundingBox.width * c.boundingBox.height);
  const averageComponentSize = componentSizes.length > 0
    ? componentSizes.reduce((a, b) => a + b, 0) / componentSizes.length
    : 0;

  const imageArea = dimensions.width * dimensions.height;
  const componentDensity = (detectedComponents.length / imageArea) * 1000000; // per 1000px²

  const symmetryScore = estimateSymmetry(detectedComponents, dimensions);
  const alignmentConsistency = estimateAlignment(detectedComponents);

  const fingerprint = computeFingerprint(detectedComponents, dimensions);

  return {
    imageId,
    timestamp,
    imageDimensions: dimensions,
    components: detectedComponents,
    structuralMetrics: {
      averageComponentSize,
      componentDensity,
      symmetryScore,
      alignmentConsistency,
    },
    fingerprint,
  };
}

function estimateSymmetry(
  components: DetectedComponent[],
  dimensions: { width: number; height: number }
): number {
  if (components.length === 0) return 0.5;

  const centerX = dimensions.width / 2;
  const tolerance = dimensions.width * 0.05; // 5% tolerance

  let symmetricPairs = 0;
  for (let i = 0; i < components.length; i++) {
    const c1 = components[i];
    const mirrorX = centerX + (centerX - (c1.boundingBox.x + c1.boundingBox.width / 2));

    for (let j = i + 1; j < components.length; j++) {
      const c2 = components[j];
      const c2CenterX = c2.boundingBox.x + c2.boundingBox.width / 2;

      if (Math.abs(c2CenterX - mirrorX) < tolerance && c1.type === c2.type) {
        symmetricPairs++;
      }
    }
  }

  return Math.min(1, (symmetricPairs * 2) / components.length);
}

function estimateAlignment(components: DetectedComponent[]): number {
  if (components.length < 2) return 1.0;

  // Check how well components align to a grid
  const xCoords = components.map(c => c.boundingBox.x);
  const yCoords = components.map(c => c.boundingBox.y);

  const xVariance = variance(xCoords);
  const yVariance = variance(yCoords);

  // Normalize: lower variance = better alignment
  const maxVariance = 1000; // typical image coordinate range
  const alignmentScore = Math.max(0, 1 - (xVariance + yVariance) / (2 * maxVariance));

  return alignmentScore;
}

function variance(arr: number[]): number {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / arr.length;
}

function computeFingerprint(
  components: DetectedComponent[],
  dimensions: { width: number; height: number }
): string {
  // Simple deterministic fingerprint based on component positions and types
  const crypto = require('crypto');
  const data = JSON.stringify({
    count: components.length,
    types: components.map(c => c.type).sort(),
    positions: components.map(c => ({
      x: Math.round(c.boundingBox.x / 10) * 10, // 10px grid quantization
      y: Math.round(c.boundingBox.y / 10) * 10,
    })),
    dims: dimensions,
  });

  return crypto.createHash('sha256').update(data).digest('hex');
}
