import { getMonth } from 'date-fns';
import { Season, StructuralArticle } from '@shared/schema';

/**
 * Beräknar dynamiskt värde för en strukturartikel-steg
 * baserat på säsong, objektmetadata och andra faktorer
 */

interface ObjectMetadataContext {
  containerCount?: number;
  objectCount?: number;
  [key: string]: any;
}

interface DynamicStepResult {
  quantity: number;
  durationMinutes: number;
  isApplicable: boolean;
  skipReason?: string;
}

/**
 * Kontrollerar om ett datum faller inom angiven säsong
 */
export function isDateInSeason(date: Date, season?: string | null): boolean {
  if (!season || season === 'all_year') return true;
  
  const month = getMonth(date); // 0-11
  
  switch (season) {
    case 'spring':
      return month >= 2 && month <= 4; // Mars-Maj
    case 'summer':
      return month >= 5 && month <= 7; // Juni-Augusti
    case 'autumn':
      return month >= 8 && month <= 10; // September-November
    case 'winter':
      return month === 11 || month <= 1; // December-Februari
    case 'not_winter':
      return month >= 2 && month <= 10; // Mars-November
    case 'not_summer':
      return !(month >= 5 && month <= 7);
    default:
      return true;
  }
}

/**
 * Beräknar dynamisk kvantitet och tid för ett strukturartikel-steg
 */
export function calculateDynamicStep(
  step: StructuralArticle,
  executionDate: Date,
  objectMetadata: ObjectMetadataContext
): DynamicStepResult {
  // Kolla om steget är tillämpligt baserat på säsong
  if (step.applicableSeason && !isDateInSeason(executionDate, step.applicableSeason)) {
    return {
      quantity: 0,
      durationMinutes: 0,
      isApplicable: false,
      skipReason: `Ej tillämpligt under denna säsong (kräver ${step.applicableSeason})`,
    };
  }
  
  // Beräkna baskvantitet
  let quantity = step.defaultQuantity || 1;
  
  // Multiplicera med objektantal om konfigurerat
  if (step.multiplyByObjectCount) {
    const objectCount = objectMetadata.objectCount || objectMetadata.containerCount || 1;
    quantity *= objectCount;
  }
  
  // Multiplicera med specifikt metadatafält om konfigurerat
  if (step.multiplyByMetadataField && objectMetadata[step.multiplyByMetadataField]) {
    const multiplier = Number(objectMetadata[step.multiplyByMetadataField]) || 1;
    quantity *= multiplier;
  }
  
  // Beräkna tid
  let durationMinutes = step.defaultDurationMinutes || 0;
  
  // Om tid multipliceras med kvantitet
  if (step.multiplyByObjectCount || step.multiplyByMetadataField) {
    // Tid per enhet multipliceras med antal
    durationMinutes = (step.defaultDurationMinutes || 0) * quantity;
  }
  
  // Kolla villkor
  if (step.conditionalLogic) {
    const shouldRun = evaluateConditionalLogic(step.conditionalLogic, objectMetadata);
    if (!shouldRun) {
      return {
        quantity: 0,
        durationMinutes: 0,
        isApplicable: false,
        skipReason: 'Villkor ej uppfyllt',
      };
    }
  }
  
  return {
    quantity,
    durationMinutes,
    isApplicable: quantity > 0 || step.allowZeroQuantity === true,
  };
}

/**
 * Utvärdera villkorslogik för ett steg
 * Stödjer enkla jämförelser och AND/OR
 */
function evaluateConditionalLogic(
  logic: any,
  context: ObjectMetadataContext
): boolean {
  if (!logic) return true;
  
  // Enkel jämförelse: { field: "objectType", operator: "equals", value: "container" }
  if (logic.field && logic.operator) {
    const fieldValue = context[logic.field];
    
    switch (logic.operator) {
      case 'equals':
        return fieldValue === logic.value;
      case 'not_equals':
        return fieldValue !== logic.value;
      case 'exists':
        return fieldValue !== undefined && fieldValue !== null;
      case 'not_exists':
        return fieldValue === undefined || fieldValue === null;
      case 'greater_than':
        return Number(fieldValue) > Number(logic.value);
      case 'less_than':
        return Number(fieldValue) < Number(logic.value);
      case 'contains':
        return String(fieldValue).includes(String(logic.value));
      case 'in_list':
        return Array.isArray(logic.value) && logic.value.includes(fieldValue);
      default:
        return true;
    }
  }
  
  // AND-logik: { and: [...conditions] }
  if (logic.and && Array.isArray(logic.and)) {
    return logic.and.every((condition: any) => evaluateConditionalLogic(condition, context));
  }
  
  // OR-logik: { or: [...conditions] }
  if (logic.or && Array.isArray(logic.or)) {
    return logic.or.some((condition: any) => evaluateConditionalLogic(condition, context));
  }
  
  return true;
}

/**
 * Expandera en strukturartikel till individuella steg baserat på objekt
 * Används när requiresIndividualHandling är true
 */
export interface IndividualStep {
  stepId: string;
  stepName: string;
  objectId: string;
  objectName: string;
  serialNumber?: string;
  durationMinutes: number;
}

export function expandToIndividualSteps(
  step: StructuralArticle,
  objects: Array<{ id: string; name: string; serialNumber?: string }>
): IndividualStep[] {
  if (!step.requiresIndividualHandling) {
    return [];
  }
  
  return objects.map((obj, index) => ({
    stepId: `${step.id}_${obj.id}`,
    stepName: step.stepName ? `${step.stepName} - ${obj.name}` : `Steg ${step.sequenceOrder} - ${obj.name}`,
    objectId: obj.id,
    objectName: obj.name,
    serialNumber: obj.serialNumber,
    durationMinutes: step.defaultDurationMinutes || 5,
  }));
}

/**
 * Generera alla uppgifter för en strukturartikel
 */
export interface GeneratedTask {
  stepId: string;
  stepName: string;
  articleId: string;
  quantity: number;
  durationMinutes: number;
  isApplicable: boolean;
  skipReason?: string;
  isIndividual: boolean;
  objectId?: string;
  objectName?: string;
  serialNumber?: string;
}

export function generateTasksFromStructuralArticle(
  steps: StructuralArticle[],
  executionDate: Date,
  objectMetadata: ObjectMetadataContext,
  individualObjects?: Array<{ id: string; name: string; serialNumber?: string }>
): GeneratedTask[] {
  const tasks: GeneratedTask[] = [];
  
  for (const step of steps) {
    // Kolla om steget kräver individuell hantering
    if (step.requiresIndividualHandling && individualObjects && individualObjects.length > 0) {
      // Generera individuella uppgifter
      const individualSteps = expandToIndividualSteps(step, individualObjects);
      
      for (const indStep of individualSteps) {
        tasks.push({
          stepId: indStep.stepId,
          stepName: indStep.stepName,
          articleId: step.childArticleId,
          quantity: 1,
          durationMinutes: indStep.durationMinutes,
          isApplicable: true,
          isIndividual: true,
          objectId: indStep.objectId,
          objectName: indStep.objectName,
          serialNumber: indStep.serialNumber,
        });
      }
    } else {
      // Beräkna dynamiskt värde för steget
      const result = calculateDynamicStep(step, executionDate, objectMetadata);
      
      tasks.push({
        stepId: step.id,
        stepName: step.stepName || `Steg ${step.sequenceOrder}`,
        articleId: step.childArticleId,
        quantity: result.quantity,
        durationMinutes: result.durationMinutes,
        isApplicable: result.isApplicable,
        skipReason: result.skipReason,
        isIndividual: false,
      });
    }
  }
  
  return tasks;
}

/**
 * Beräknar total tid för alla tillämpliga steg
 */
export function calculateTotalDuration(tasks: GeneratedTask[]): number {
  return tasks
    .filter(t => t.isApplicable)
    .reduce((sum, t) => sum + t.durationMinutes, 0);
}
