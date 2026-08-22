import { EbayListing } from "./schemas";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  rejectedFields: Record<string, string>;
  data?: EbayListing;
}

export interface BoundedRepairHooks {
  validateListing: (listing: unknown) => ValidationResult | Promise<ValidationResult>;
  repairWithGemini: (
    listing: unknown,
    errors: string[],
    attempt: number
  ) => Promise<EbayListing>;
}

export interface RepairMetadata {
  attemptNumber: number;
  originalListing: unknown;
  validationErrors: string[];
  repairedListing: EbayListing;
}

export interface BoundedRepairResult {
  finalListing: EbayListing;
  repaired: boolean;
  repairAttempts: number;
  repairMetadata: RepairMetadata | null;
}

export function getRejectedExactPaths(validation: ValidationResult): Set<string> {
  const set = new Set<string>();
  for (const fieldPath of Object.keys(validation.rejectedFields)) {
    if (fieldPath && fieldPath !== "root") {
      set.add(fieldPath);
    }
  }
  for (const err of validation.errors) {
    const fieldPath = err.split(":")[0]?.trim();
    if (fieldPath && fieldPath !== "root") {
      set.add(fieldPath);
    }
  }
  return set;
}

export function getMutatedPaths(original: unknown, proposed: unknown): Set<string> {
  const set = new Set<string>();
  const origObj = typeof original === "object" && original !== null ? (original as Record<string, unknown>) : {};
  const propObj = typeof proposed === "object" && proposed !== null ? (proposed as Record<string, unknown>) : {};

  const allKeys = new Set([...Object.keys(origObj), ...Object.keys(propObj)]);

  for (const key of allKeys) {
    if (key === "itemSpecifics") {
      const origSpec = typeof origObj.itemSpecifics === "object" && origObj.itemSpecifics !== null ? (origObj.itemSpecifics as Record<string, unknown>) : {};
      const propSpec = typeof propObj.itemSpecifics === "object" && propObj.itemSpecifics !== null ? (propObj.itemSpecifics as Record<string, unknown>) : {};
      const allSpecKeys = new Set([...Object.keys(origSpec), ...Object.keys(propSpec)]);
      for (const specKey of allSpecKeys) {
        if (JSON.stringify(origSpec[specKey]) !== JSON.stringify(propSpec[specKey])) {
          set.add(`itemSpecifics.${specKey}`);
        }
      }
    } else {
      if (JSON.stringify(origObj[key]) !== JSON.stringify(propObj[key])) {
        set.add(key);
      }
    }
  }

  return set;
}

export function isPathPermitted(mutatedPath: string, rejectedPaths: Set<string>): boolean {
  if (rejectedPaths.has(mutatedPath)) {
    return true;
  }
  const parts = mutatedPath.split(".");
  if (parts.length > 1 && rejectedPaths.has(parts[0])) {
    return true;
  }
  return false;
}

export async function runBoundedRepairController(
  initialListing: unknown,
  hooks: BoundedRepairHooks
): Promise<BoundedRepairResult> {
  let currentListing = initialListing;
  let validation = await hooks.validateListing(currentListing);

  if (validation.valid && validation.data) {
    return {
      finalListing: validation.data,
      repaired: false,
      repairAttempts: 0,
      repairMetadata: null,
    };
  }

  const initialValidationErrors = [...validation.errors];
  let repairAttempt = 1;

  while (repairAttempt <= 2) {
    const rejectedPaths = getRejectedExactPaths(validation);
    const proposedRepair = await hooks.repairWithGemini(
      currentListing,
      validation.errors,
      repairAttempt
    );

    const mutatedPaths = getMutatedPaths(currentListing, proposedRepair);
    for (const mutatedPath of mutatedPaths) {
      if (!isPathPermitted(mutatedPath, rejectedPaths)) {
        throw new Error(
          `Policy violation: Proposed repair mutated non-rejected path '${mutatedPath}'`
        );
      }
    }

    const baseObject = JSON.parse(JSON.stringify(currentListing)) as Record<string, unknown>;
    const propObj = typeof proposedRepair === "object" && proposedRepair !== null ? (proposedRepair as Record<string, unknown>) : {};

    for (const path of rejectedPaths) {
      if (path.includes(".")) {
        const [parentKey, childKey] = path.split(".");
        if (parentKey === "itemSpecifics") {
          const origSpec = (baseObject.itemSpecifics as Record<string, unknown>) || {};
          const propSpec = (propObj.itemSpecifics as Record<string, unknown>) || {};
          if (childKey in propSpec) {
            baseObject.itemSpecifics = {
              ...origSpec,
              [childKey]: propSpec[childKey],
            };
          }
        }
      } else {
        if (path in propObj) {
          baseObject[path] = propObj[path];
        }
      }
    }

    const revalidation = await hooks.validateListing(baseObject);

    if (revalidation.valid && revalidation.data) {
      const repairMetadata: RepairMetadata = {
        attemptNumber: repairAttempt,
        originalListing: initialListing,
        validationErrors: initialValidationErrors,
        repairedListing: revalidation.data,
      };

      return {
        finalListing: revalidation.data,
        repaired: true,
        repairAttempts: repairAttempt,
        repairMetadata,
      };
    }

    validation = revalidation;
    currentListing = baseObject;
    repairAttempt++;
  }

  throw new Error(
    `eBay validation repair failed after 2 attempts. Validation errors: ${validation.errors.join("; ")}`
  );
}
