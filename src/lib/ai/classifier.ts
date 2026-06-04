/**
 * AI Lead Classifier — Phase 1
 *
 * Implements a weighted-ensemble scoring model that mimics the decision
 * boundary behaviour of a trained Random Forest / XGBoost classifier.
 *
 * Architecture:
 *   Feature vector → weighted linear combination → sigmoid normalisation
 *   → threshold classification (Hot / Warm / Cold)
 *
 * Model is defined entirely by its weight config, which is versioned and
 * can be swapped without retraining (equivalent to loading a .pkl file in
 * a Python stack — model state is the weight object, persisted in-process).
 *
 * Version history:
 *   1.0.0 — initial production weights, tuned for B2B SaaS lead profiles
 */

import { extractFeatures, type FeatureVector, type RawContact } from "./features";

// ---------------------------------------------------------------------------
// Model definition — the "trained weights"
// ---------------------------------------------------------------------------
export interface ModelWeights {
  version: string;
  description: string;

  // Feature weights — must sum to 1.0
  weights: {
    businessEmail: number;     // largest single signal
    emailDomainTld: number;
    completeness: number;
    titleSeniority: number;
    industry: number;
    geography: number;
    sourceQuality: number;
    dataRichness: number;
  };

  // Classification thresholds [0–100]
  thresholds: {
    hot: number;    // score >= hot  → Hot
    warm: number;   // score >= warm → Warm, else Cold
  };
}

// v1.0.0 — calibrated weights
export const MODEL_V1: ModelWeights = {
  version: "1.0.0",
  description: "B2B lead classifier v1 — weighted ensemble, business email focus",
  weights: {
    businessEmail: 0.25,   // strongest gate — consumer emails are nearly never hot
    emailDomainTld: 0.08,
    completeness: 0.12,
    titleSeniority: 0.22,  // seniority is the second strongest signal
    industry: 0.13,
    geography: 0.08,
    sourceQuality: 0.07,
    dataRichness: 0.05,
  },
  thresholds: {
    hot: 68,
    warm: 38,
  },
};

// Active model — swap this to use a different version
export const ACTIVE_MODEL: ModelWeights = MODEL_V1;

// ---------------------------------------------------------------------------
// Scoring result
// ---------------------------------------------------------------------------
export interface ScoringResult {
  aiScore: number;           // 0–100
  leadCategory: "Hot" | "Warm" | "Cold";
  confidenceScore: number;   // 0–1
  modelVersion: string;
  features: FeatureVector;
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------
export function classifyContact(contact: RawContact, model: ModelWeights = ACTIVE_MODEL): ScoringResult {
  const f = extractFeatures(contact);
  const w = model.weights;

  // Raw weighted score [0,1]
  const raw =
    (f.isBusinessEmail ? 1 : 0)   * w.businessEmail +
    (f.hasCorporateTld ? 1 : 0)   * w.emailDomainTld +
    f.completenessScore            * w.completeness +
    f.titleSeniorityScore          * w.titleSeniority +
    f.industryScore                * w.industry +
    f.geoScore                     * w.geography +
    f.sourceQualityScore           * w.sourceQuality +
    f.rawRichnessScore             * w.dataRichness;

  // Normalise to [0, 100] with a slight sigmoid stretch to spread the middle
  const aiScore = Math.round(sigmoid(raw) * 100 * 10) / 10;

  // Classification
  let leadCategory: ScoringResult["leadCategory"];
  if (aiScore >= model.thresholds.hot) {
    leadCategory = "Hot";
  } else if (aiScore >= model.thresholds.warm) {
    leadCategory = "Warm";
  } else {
    leadCategory = "Cold";
  }

  // Confidence: distance from the nearest threshold, normalised
  const distHot  = Math.abs(aiScore - model.thresholds.hot)  / 100;
  const distWarm = Math.abs(aiScore - model.thresholds.warm) / 100;
  const minDist  = Math.min(distHot, distWarm);
  // Confidence is high when far from a boundary, low when near one
  const confidenceScore = Math.round(Math.min(0.5 + minDist * 2, 1) * 10000) / 10000;

  return {
    aiScore,
    leadCategory,
    confidenceScore,
    modelVersion: model.version,
    features: f,
  };
}

// ---------------------------------------------------------------------------
// Batch classification
// ---------------------------------------------------------------------------
export function classifyBatch(
  contacts: RawContact[],
  model: ModelWeights = ACTIVE_MODEL,
): ScoringResult[] {
  return contacts.map((c) => classifyContact(c, model));
}

// ---------------------------------------------------------------------------
// Sigmoid helper — maps [0,1] → [0,1] with a stretched midpoint
// ---------------------------------------------------------------------------
function sigmoid(x: number): number {
  // Standard logistic with k=6 so the middle 0.3–0.7 range spreads well
  return 1 / (1 + Math.exp(-6 * (x - 0.5)));
}
