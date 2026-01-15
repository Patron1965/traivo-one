import { addDays, getDay, setDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isWithinInterval, format, getMonth } from 'date-fns';
import { sv } from 'date-fns/locale';
import { FlexibleFrequency, Season, WEEKDAY_LABELS } from '@shared/schema';

/**
 * Genererar datum för ordrar baserat på flexibel frekvenskonfiguration
 * Stödjer: specifika veckodagar, X gånger per vecka, säsongsfilter, etc.
 */
export function generateScheduleDates(
  frequency: FlexibleFrequency,
  startDate: Date,
  endDate: Date
): Date[] {
  const dates: Date[] = [];
  
  switch (frequency.type) {
    case 'specific_weekdays':
      return generateSpecificWeekdayDates(frequency, startDate, endDate);
    case 'interval_days':
      return generateIntervalDates(frequency, startDate, endDate);
    case 'times_per_week':
      return generateTimesPerWeekDates(frequency, startDate, endDate);
    case 'times_per_month':
      return generateTimesPerMonthDates(frequency, startDate, endDate);
    case 'times_per_year':
      return generateTimesPerYearDates(frequency, startDate, endDate);
    case 'on_demand':
      return []; // Inga schemalagda datum
    default:
      return dates;
  }
}

/**
 * Genererar datum för specifika veckodagar (t.ex. Mån, Ons, Fre)
 */
function generateSpecificWeekdayDates(
  frequency: FlexibleFrequency,
  startDate: Date,
  endDate: Date
): Date[] {
  const dates: Date[] = [];
  const weekdays = frequency.weekdays || [];
  const excludeWeekdays = frequency.excludeWeekdays || [];
  
  let current = new Date(startDate);
  
  while (current <= endDate) {
    const dayOfWeek = getDay(current);
    
    // Kolla om denna veckodag ska inkluderas
    if (weekdays.includes(dayOfWeek) && !excludeWeekdays.includes(dayOfWeek)) {
      // Kolla säsong
      if (isDateInSeason(current, frequency.season)) {
        dates.push(new Date(current));
      }
    }
    
    current = addDays(current, 1);
  }
  
  return dates;
}

/**
 * Genererar datum baserat på fast intervall i dagar
 */
function generateIntervalDates(
  frequency: FlexibleFrequency,
  startDate: Date,
  endDate: Date
): Date[] {
  const dates: Date[] = [];
  const interval = frequency.intervalDays || 1;
  
  let current = new Date(startDate);
  
  while (current <= endDate) {
    if (isDateInSeason(current, frequency.season)) {
      if (shouldIncludeDate(current, frequency)) {
        dates.push(new Date(current));
      }
    }
    current = addDays(current, interval);
  }
  
  return dates;
}

/**
 * Genererar datum för X gånger per vecka med flexibel placering
 * Försöker fördela besöken jämnt över veckan
 */
function generateTimesPerWeekDates(
  frequency: FlexibleFrequency,
  startDate: Date,
  endDate: Date
): Date[] {
  const dates: Date[] = [];
  const timesPerWeek = frequency.timesPerPeriod || 1;
  const minDaysBetween = frequency.minDaysBetween || 1;
  
  // Hämta tillåtna veckodagar
  const allowedDays = getEffectiveAllowedDays(frequency);
  
  if (allowedDays.length === 0) return dates;
  
  // Fördela besök jämnt över tillåtna dagar
  const selectedDays = distributeOverDays(allowedDays, timesPerWeek, minDaysBetween);
  
  let current = startOfWeek(startDate, { weekStartsOn: 1 }); // Börja på måndag
  
  while (current <= endDate) {
    for (const dayOffset of selectedDays) {
      const date = setDay(current, dayOffset, { weekStartsOn: 1 });
      
      if (date >= startDate && date <= endDate) {
        if (isDateInSeason(date, frequency.season)) {
          dates.push(new Date(date));
        }
      }
    }
    
    current = addDays(current, 7); // Nästa vecka
  }
  
  return dates;
}

/**
 * Genererar datum för X gånger per månad
 */
function generateTimesPerMonthDates(
  frequency: FlexibleFrequency,
  startDate: Date,
  endDate: Date
): Date[] {
  const dates: Date[] = [];
  const timesPerMonth = frequency.timesPerPeriod || 1;
  const allowedDays = getEffectiveAllowedDays(frequency);
  
  let currentMonth = startOfMonth(startDate);
  
  while (currentMonth <= endDate) {
    const monthEnd = endOfMonth(currentMonth);
    
    // Hitta alla tillåtna dagar denna månad
    const possibleDates: Date[] = [];
    let day = new Date(currentMonth);
    
    while (day <= monthEnd && day <= endDate) {
      if (day >= startDate && allowedDays.includes(getDay(day))) {
        if (isDateInSeason(day, frequency.season)) {
          possibleDates.push(new Date(day));
        }
      }
      day = addDays(day, 1);
    }
    
    // Välj ut X datum jämnt fördelade
    const selectedDates = distributeEvenly(possibleDates, timesPerMonth);
    dates.push(...selectedDates);
    
    currentMonth = addDays(monthEnd, 1);
    currentMonth = startOfMonth(currentMonth);
  }
  
  return dates;
}

/**
 * Genererar datum för X gånger per år (årsstädning, etc.)
 */
function generateTimesPerYearDates(
  frequency: FlexibleFrequency,
  startDate: Date,
  endDate: Date
): Date[] {
  const dates: Date[] = [];
  const timesPerYear = frequency.timesPerPeriod || 1;
  const preferredMonths = frequency.preferredMonths || [];
  const allowedDays = getEffectiveAllowedDays(frequency);
  
  let currentYear = startDate.getFullYear();
  const endYear = endDate.getFullYear();
  
  while (currentYear <= endYear) {
    // Om det finns önskade månader, använd dem
    const monthsToUse = preferredMonths.length > 0 
      ? preferredMonths 
      : distributeEvenly(Array.from({length: 12}, (_, i) => i + 1), timesPerYear);
    
    for (const month of monthsToUse.slice(0, timesPerYear)) {
      // Hitta första tillåtna dagen i månaden
      const monthStart = new Date(currentYear, month - 1, 1);
      const monthEnd = endOfMonth(monthStart);
      
      let day = monthStart;
      while (day <= monthEnd) {
        if (allowedDays.includes(getDay(day))) {
          if (day >= startDate && day <= endDate) {
            if (isDateInSeason(day, frequency.season)) {
              dates.push(new Date(day));
              break; // En dag per månad
            }
          }
        }
        day = addDays(day, 1);
      }
    }
    
    currentYear++;
  }
  
  return dates;
}

/**
 * Hämtar effektiva tillåtna veckodagar baserat på frekvenskonfiguration
 */
function getEffectiveAllowedDays(frequency: FlexibleFrequency): number[] {
  const excludeDays = frequency.excludeWeekdays || [];
  
  // Om specifika veckodagar är angivna, använd dem
  if (frequency.weekdays && frequency.weekdays.length > 0) {
    return frequency.weekdays.filter(d => !excludeDays.includes(d));
  }
  
  let allowedDays: number[] = [];
  
  // Alla dagar som standard
  allowedDays = [0, 1, 2, 3, 4, 5, 6];
  
  // Filtrera på vardagar/helger
  if (frequency.includeWeekdays === true && frequency.includeWeekends !== true) {
    allowedDays = [1, 2, 3, 4, 5]; // Endast vardagar
  } else if (frequency.includeWeekends === true && frequency.includeWeekdays !== true) {
    allowedDays = [0, 6]; // Endast helger
  } else if (frequency.includeWeekdays === false) {
    allowedDays = allowedDays.filter(d => ![1, 2, 3, 4, 5].includes(d));
  } else if (frequency.includeWeekends === false) {
    allowedDays = allowedDays.filter(d => ![0, 6].includes(d));
  }
  
  // Exkludera specifika dagar
  return allowedDays.filter(d => !excludeDays.includes(d));
}

/**
 * Kontrollerar om ett datum faller inom angiven säsong
 */
function isDateInSeason(date: Date, season?: Season): boolean {
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
 * Kontrollerar om ett datum ska inkluderas baserat på vardagar/helger
 */
function shouldIncludeDate(date: Date, frequency: FlexibleFrequency): boolean {
  const dayOfWeek = getDay(date);
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  
  if (frequency.includeWeekdays === false && !isWeekend) return false;
  if (frequency.includeWeekends === false && isWeekend) return false;
  if (frequency.excludeWeekdays?.includes(dayOfWeek)) return false;
  
  return true;
}

/**
 * Fördelar N besök jämnt över tillåtna dagar med minimum avstånd
 */
function distributeOverDays(
  allowedDays: number[], 
  count: number, 
  minDaysBetween: number
): number[] {
  if (count >= allowedDays.length) {
    return allowedDays;
  }
  
  // Sortera veckodagar
  const sorted = [...allowedDays].sort((a, b) => a - b);
  
  // Välj dagar med maximal spridning
  const result: number[] = [];
  const step = Math.floor(sorted.length / count);
  
  for (let i = 0; i < count; i++) {
    const index = Math.min(i * step, sorted.length - 1);
    result.push(sorted[index]);
  }
  
  return result;
}

/**
 * Fördelar N element jämnt från en lista
 */
function distributeEvenly<T>(items: T[], count: number): T[] {
  if (count >= items.length) return items;
  if (count <= 0) return [];
  
  const result: T[] = [];
  const step = items.length / count;
  
  for (let i = 0; i < count; i++) {
    const index = Math.floor(i * step);
    result.push(items[index]);
  }
  
  return result;
}

/**
 * Formaterar en frekvens till läsbar text
 */
export function formatFrequencyDescription(frequency: FlexibleFrequency): string {
  switch (frequency.type) {
    case 'specific_weekdays': {
      const days = (frequency.weekdays || [])
        .sort((a, b) => a - b)
        .map(d => WEEKDAY_LABELS[d])
        .join(', ');
      return `${days}`;
    }
    case 'interval_days': {
      const days = frequency.intervalDays || 1;
      if (days === 1) return 'Dagligen';
      if (days === 2) return 'Varannan dag';
      if (days === 7) return 'Veckovis';
      if (days === 14) return 'Varannan vecka';
      return `Var ${days}:e dag`;
    }
    case 'times_per_week': {
      const times = frequency.timesPerPeriod || 1;
      return `${times}x per vecka`;
    }
    case 'times_per_month': {
      const times = frequency.timesPerPeriod || 1;
      return `${times}x per månad`;
    }
    case 'times_per_year': {
      const times = frequency.timesPerPeriod || 1;
      if (times === 1) return 'Årligen';
      if (times === 2) return 'Halvårsvis';
      if (times === 4) return 'Kvartalsvis';
      return `${times}x per år`;
    }
    case 'on_demand':
      return 'Vid behov';
    default:
      return 'Okänd frekvens';
  }
}

/**
 * Skapar en FlexibleFrequency från enkla parametrar
 */
export function createFlexibleFrequency(params: {
  type: FlexibleFrequency['type'];
  weekdays?: number[];
  intervalDays?: number;
  timesPerPeriod?: number;
  includeWeekdays?: boolean;
  includeWeekends?: boolean;
  season?: Season;
}): FlexibleFrequency {
  return {
    type: params.type,
    weekdays: params.weekdays,
    intervalDays: params.intervalDays,
    timesPerPeriod: params.timesPerPeriod,
    includeWeekdays: params.includeWeekdays,
    includeWeekends: params.includeWeekends,
    season: params.season,
  };
}

/**
 * Konverterar legacy periodicity till FlexibleFrequency
 */
export function convertLegacyPeriodicity(
  periodicity: string,
  preferredWeekday?: number
): FlexibleFrequency {
  switch (periodicity) {
    case 'vecka':
      return {
        type: 'interval_days',
        intervalDays: 7,
        weekdays: preferredWeekday !== undefined ? [preferredWeekday] : undefined,
      };
    case 'varannan_vecka':
      return {
        type: 'interval_days',
        intervalDays: 14,
        weekdays: preferredWeekday !== undefined ? [preferredWeekday] : undefined,
      };
    case 'manad':
      return {
        type: 'times_per_month',
        timesPerPeriod: 1,
      };
    case 'kvartal':
      return {
        type: 'times_per_year',
        timesPerPeriod: 4,
      };
    case 'halvar':
      return {
        type: 'times_per_year',
        timesPerPeriod: 2,
      };
    case 'ar':
      return {
        type: 'times_per_year',
        timesPerPeriod: 1,
      };
    default:
      return {
        type: 'times_per_month',
        timesPerPeriod: 1,
      };
  }
}
