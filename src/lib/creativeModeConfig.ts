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

export const CREATIVE_MODE_VERSION = '2.2.0';

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
  /**
   * Cross-section and topology descriptor — frozen during creative rendering.
   * Describes the OPEN/CLOSED status, cross-section profile, and exact bend/
   * flange counts so the generator cannot morph the fundamental 3D form.
   */
  topologyLock?: TopologyLock;
}

export interface TopologyLock {
  /**
   * Whether the part forms a closed loop/ring (true) or is open/channel/clip (false).
   * Example: a U-channel is open; a complete ring washer is closed.
   */
  isClosed: boolean;
  /**
   * Primary cross-section profile at the most representative cut-plane.
   * Use plain geometry terms: "flat plate", "U-channel", "L-bracket", "C-channel",
   * "I-beam", "hollow cylinder", "solid cylinder", "T-section", "Z-section", etc.
   */
  crossSectionProfile: string;
  /** Total number of discrete bends (90°-type sharp folds) visible in the part. */
  bendCount: number;
  /** Total number of distinct flanges (flat extending lips/tabs). */
  flangeCount: number;
  /**
   * Number of inward-facing return lips (lips that fold back toward the part centre).
   * 0 means none — critical for distinguishing U-channel from C-channel.
   */
  returnLipCount: number;
  /**
   * Number of raised or arched bridges (dome-shaped raised areas).
   * 0 means the part is flat/planar.
   */
  raisedBridgeCount: number;
  /**
   * Height of the tallest raised bridge as a percentage of the total part width.
   * Only meaningful when raisedBridgeCount > 0.
   * Example: 8 means the bridge is ~8% as tall as the part is wide (very shallow).
   * This quantitative constraint prevents exaggerating a shallow 2mm feature
   * into a tall semi-circular arch.
   */
  bridgeHeightRatioPercent: number;
  /** Free-text summary of the topology for model guidance. */
  topologySummary: string;
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

/**
 * Maximum dimensionalFidelityScore that may be assigned when a topology_change
 * or morphing failure is present. A part with the wrong fundamental 3D form
 * (e.g. U-channel → C-channel, flat → arch) has near-zero dimensional fidelity
 * regardless of how well other proportions match. Keeping this value low (0.15)
 * ensures the 0.75 fidelity threshold reliably gates these outputs.
 * Must be kept in sync with the ceiling stated in GENERATION_VERIFICATION_PROMPT.
 */
export const TOPOLOGY_FAILURE_MAX_FIDELITY_SCORE = 0.15;

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

  // Lower temperature reduces morphing/hallucination while still allowing
  // camera-angle and lighting variation (the intentional transformations).
  temperature: 0.45,
  topP: 0.92,
  topK: 40,

  maxAttempts: 6,
  baseDelayMs: 2000,
  maxDelayMs: 20000,
  backoffMultiplier: 2.5,
  // Extra targeted retry gives the corrective prompt one more chance to fix
  // topology/morphing failures before the best result is accepted.
  maxTargetedRetries: 3,

  // Tighter acceptance gates: topology hallucinations now need to score higher
  // to pass, which forces more targeted retries on bad outputs.
  // 0.90 inventory: at most ~1 small ambiguous part may be unaccounted for.
  // 0.75 fidelity:  allows mild perspective-induced drift (~10%) while still
  //                 rejecting cross-section violations (which score ≤0.15 after
  //                 the TOPOLOGY_FAILURE_MAX_FIDELITY_SCORE hard-cap).
  inventoryMatchThreshold: 0.90,
  dimensionalFidelityThreshold: 0.75,
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
