/**
 * creativeModeConfig.ts
 *
 * Generation sampling parameters for creative mode and clone mode.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface ModePolicy {
  /** Display name used in logs */
  name: string;

  // --- Generation sampling ---
  temperature: number;
  topP: number;
  topK: number;
}

// ============================================================================
// POLICIES
// ============================================================================

/**
 * Creative mode — meaningful camera/lighting/material transformation while
 * preserving the physical part identity.
 */
export const CREATIVE_POLICY: ModePolicy = {
  name: 'creative',
  temperature: 0.45,
  topP: 0.92,
  topK: 40,
};

/**
 * Clone mode — exact reproduction at maximum fidelity.
 */
export const CLONE_POLICY: ModePolicy = {
  name: 'clone',
  temperature: 0.02,
  topP: 0.85,
  topK: 20,
};

/** Convenience accessor */
export function getPolicyForMode(mode: 'creative' | 'clone'): ModePolicy {
  return mode === 'creative' ? CREATIVE_POLICY : CLONE_POLICY;
}

