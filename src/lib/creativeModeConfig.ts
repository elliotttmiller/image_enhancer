/**
 * creativeModeConfig.ts
 *
 * Single source of truth for creative-mode and clone-mode configuration.
 * Version-controlled so every threshold/policy change is auditable.
 *
 * Usage:
 *   import { CREATIVE_POLICY, CLONE_POLICY, CREATIVE_MODE_VERSION } from './creativeModeConfig';
 */

// ============================================================================
// VERSION — bump when changing policies/thresholds so changes are auditable
// ============================================================================

export const CREATIVE_MODE_VERSION = '2.0.0';

// ============================================================================
// TYPES
// ============================================================================

export interface ModePolicy {
  /** Display name used in logs and diagnostics */
  name: string;
  /** Semver of the policy — helps correlate logs to config changes */
  version: string;

  // --- Generation sampling ---
  temperature: number;
  topP: number;
  topK: number;

  // --- Retry strategy ---
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  maxTargetedRetries: number;

  // --- Acceptance thresholds (0–1) ---
  /**
   * Minimum proportion of original inventory items that must be present.
   * 1.0 = every part must be accounted for.
   */
  inventoryMatchThreshold: number;
  /**
   * Minimum score for dimensional/proportional fidelity.
   */
  dimensionalFidelityThreshold: number;
  /**
   * Minimum camera/lighting/material novelty score.
   * Set to 0 for clone mode (no transformation required).
   * Set to 0.30+ for creative mode to ensure the output is genuinely distinct.
   */
  noveltyThreshold: number;

  // --- Feature flags ---
  /** Run a Gemini vision analysis of the original before generation */
  enablePreAnalysis: boolean;
  /** Run a Gemini vision verification of the generated output before accepting */
  enablePostVerification: boolean;
  /** On verification failure, build a targeted retry prompt instead of generic retry */
  enableTargetedRetry: boolean;
  /** Enforce IP/compliance guardrails — reject outputs carrying logos/text/brand marks */
  enableComplianceGuardrails: boolean;
}

export interface PartDescriptor {
  /** Plain-language description of the overall assembly */
  assemblyDescription: string;
  /** Detected view perspective */
  viewType: 'orthographic' | 'isometric' | 'perspective' | 'unknown';
  /** Itemized component inventory */
  inventory: InventoryItem[];
  /** Key proportional relationships (feature → relative-size description) */
  keyDimensions: { feature: string; relativeSize: string }[];
  /** Material/finish per component */
  materials: { component: string; material: string; finish: string }[];
  /** Short list of the most distinctive physical features */
  distinctiveFeatures: string[];
  /** IP/copyright flags that must be neutralised in creative mode */
  complianceFlags: ComplianceFlag[];
}

export interface InventoryItem {
  name: string;
  count: number;
  category: 'fastener' | 'structural' | 'mechanical' | 'seal' | 'electrical' | 'other';
  shortDescription: string;
}

export interface ComplianceFlag {
  type: 'logo' | 'brand_name' | 'serial_number' | 'watermark' | 'text_overlay';
  description: string;
  /** If true this must be neutralised/removed in the output */
  mustNeutralise: boolean;
}

export interface VerificationResult {
  passed: boolean;
  /** Composite 0–1 score; below policy threshold triggers retry/rejection */
  overallScore: number;
  inventoryMatchScore: number;
  dimensionalFidelityScore: number;
  /** How distinct the output render is from the original (camera/lighting/material) */
  noveltyScore: number;
  compliancePassed: boolean;
  failureReasons: FailureReason[];
  warnings: string[];
}

export type FailureReason =
  | { type: 'inventory_mismatch'; missing: string[]; extra: string[] }
  | { type: 'insufficient_novelty'; currentScore: number; requiredScore: number }
  | { type: 'dimensional_drift'; affectedFeatures: string[] }
  | { type: 'compliance_violation'; violations: string[] }
  | { type: 'topology_change'; details: string }
  | { type: 'morphing'; details: string };

// ============================================================================
// POLICIES
// ============================================================================

/**
 * Creative mode:
 *   - Enforce geometric identity while MANDATING meaningful camera/lighting/material
 *     transformation so the output is a legally distinct, unique rendering.
 */
export const CREATIVE_POLICY: ModePolicy = {
  name: 'creative',
  version: CREATIVE_MODE_VERSION,

  temperature: 0.55,
  topP: 0.95,
  topK: 45,

  maxAttempts: 6,
  baseDelayMs: 2000,
  maxDelayMs: 20000,
  backoffMultiplier: 2.5,
  maxTargetedRetries: 2,

  inventoryMatchThreshold: 0.85,
  dimensionalFidelityThreshold: 0.70,
  noveltyThreshold: 0.30,

  enablePreAnalysis: true,
  enablePostVerification: true,
  enableTargetedRetry: true,
  enableComplianceGuardrails: true,
};

/**
 * Clone mode:
 *   - Exact reproduction: maximum fidelity, no transformation required.
 */
export const CLONE_POLICY: ModePolicy = {
  name: 'clone',
  version: CREATIVE_MODE_VERSION,

  temperature: 0.02,
  topP: 0.85,
  topK: 20,

  maxAttempts: 6,
  baseDelayMs: 2000,
  maxDelayMs: 20000,
  backoffMultiplier: 2.5,
  maxTargetedRetries: 2,

  inventoryMatchThreshold: 0.95,
  dimensionalFidelityThreshold: 0.85,
  noveltyThreshold: 0,           // clone must NOT transform

  enablePreAnalysis: true,
  enablePostVerification: true,
  enableTargetedRetry: true,
  enableComplianceGuardrails: false,
};

/** Convenience accessor */
export function getPolicyForMode(mode: 'creative' | 'clone'): ModePolicy {
  return mode === 'creative' ? CREATIVE_POLICY : CLONE_POLICY;
}
