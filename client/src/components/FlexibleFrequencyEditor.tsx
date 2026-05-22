import { useState, useCallback, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  FlexibleFrequency, 
  FrequencyType, 
  FREQUENCY_TYPES, 
  Season, 
  SEASONS, 
  WEEKDAY_LABELS 
} from '@shared/schema';
import { Calendar, Clock, Sun, Snowflake, Leaf } from 'lucide-react';

interface FlexibleFrequencyEditorProps {
  value?: FlexibleFrequency;
  onChange: (frequency: FlexibleFrequency) => void;
  showSeasonOptions?: boolean;
  showTimeWindow?: boolean;
}

const FREQUENCY_TYPE_LABELS: Record<FrequencyType, string> = {
  'specific_weekdays': 'Specifika veckodagar',
  'interval_days': 'Fast intervall',
  'times_per_week': 'X gånger per vecka',
  'times_per_month': 'X gånger per månad',
  'times_per_year': 'X gånger per år',
  'on_demand': 'Vid behov',
};

const SEASON_LABELS: Record<Season, string> = {
  'all_year': 'Hela året',
  'spring': 'Vår (mar-maj)',
  'summer': 'Sommar (jun-aug)',
  'autumn': 'Höst (sep-nov)',
  'winter': 'Vinter (dec-feb)',
  'not_winter': 'Ej vinter',
  'not_summer': 'Ej sommar',
};

const SEASON_ICONS: Record<Season, React.ReactNode> = {
  'all_year': <Calendar className="h-4 w-4" />,
  'spring': <Leaf className="h-4 w-4" />,
  'summer': <Sun className="h-4 w-4" />,
  'autumn': <Leaf className="h-4 w-4" />,
  'winter': <Snowflake className="h-4 w-4" />,
  'not_winter': <Sun className="h-4 w-4" />,
  'not_summer': <Snowflake className="h-4 w-4" />,
};

const WEEKDAYS = [
  { value: 1, label: 'Mån', fullLabel: 'Måndag' },
  { value: 2, label: 'Tis', fullLabel: 'Tisdag' },
  { value: 3, label: 'Ons', fullLabel: 'Onsdag' },
  { value: 4, label: 'Tor', fullLabel: 'Torsdag' },
  { value: 5, label: 'Fre', fullLabel: 'Fredag' },
  { value: 6, label: 'Lör', fullLabel: 'Lördag' },
  { value: 0, label: 'Sön', fullLabel: 'Söndag' },
];

export function FlexibleFrequencyEditor({
  value,
  onChange,
  showSeasonOptions = true,
  showTimeWindow = false,
}: FlexibleFrequencyEditorProps) {
  const [frequency, setFrequency] = useState<FlexibleFrequency>(
    value || { type: 'specific_weekdays', weekdays: [1, 3, 5] }
  );

  useEffect(() => {
    if (value) {
      setFrequency(value);
    }
  }, [value]);

  const updateFrequency = useCallback((updates: Partial<FlexibleFrequency>) => {
    const updated = { ...frequency, ...updates };
    setFrequency(updated);
    onChange(updated);
  }, [frequency, onChange]);

  const toggleWeekday = useCallback((day: number) => {
    const current = frequency.weekdays || [];
    const updated = current.includes(day)
      ? current.filter(d => d !== day)
      : [...current, day].sort((a, b) => a - b);
    updateFrequency({ weekdays: updated });
  }, [frequency.weekdays, updateFrequency]);

  const toggleExcludeWeekday = useCallback((day: number) => {
    const current = frequency.excludeWeekdays || [];
    const updated = current.includes(day)
      ? current.filter(d => d !== day)
      : [...current, day].sort((a, b) => a - b);
    updateFrequency({ excludeWeekdays: updated });
  }, [frequency.excludeWeekdays, updateFrequency]);

  const renderWeekdaySelector = () => (
    <div className="space-y-3">
      <Label>Välj veckodagar</Label>
      <div className="flex flex-wrap gap-2">
        {WEEKDAYS.map(day => {
          const isSelected = frequency.weekdays?.includes(day.value) || false;
          const isWeekend = day.value === 0 || day.value === 6;
          
          return (
            <Button
              key={day.value}
              type="button"
              size="sm"
              variant={isSelected ? "default" : "outline"}
              className={`min-w-[50px] ${isWeekend ? 'border-dashed' : ''}`}
              onClick={() => toggleWeekday(day.value)}
              data-testid={`weekday-${day.value}`}
            >
              {day.label}
            </Button>
          );
        })}
      </div>
      {frequency.weekdays && frequency.weekdays.length > 0 && (
        <div className="text-sm text-muted-foreground">
          Valt: {frequency.weekdays.map(d => WEEKDAY_LABELS[d]).join(', ')}
        </div>
      )}
    </div>
  );

  const renderIntervalDaysInput = () => (
    <div className="space-y-3">
      <Label>Intervall (dagar)</Label>
      <div className="flex gap-2 items-center">
        <Input
          type="number"
          min={1}
          max={365}
          value={frequency.intervalDays || 1}
          onChange={(e) => updateFrequency({ intervalDays: parseInt(e.target.value) || 1 })}
          className="w-24"
          data-testid="input-interval-days"
        />
        <span className="text-sm text-muted-foreground">dagar mellan besök</span>
      </div>
      <div className="flex gap-2 flex-wrap">
        {[1, 2, 7, 14, 30].map(days => (
          <Button
            key={days}
            type="button"
            size="sm"
            variant={frequency.intervalDays === days ? "default" : "outline"}
            onClick={() => updateFrequency({ intervalDays: days })}
          >
            {days === 1 ? 'Dagligen' : 
             days === 2 ? 'Varannan dag' : 
             days === 7 ? 'Veckovis' : 
             days === 14 ? 'Varannan vecka' : 
             'Månadsvis'}
          </Button>
        ))}
      </div>
    </div>
  );

  const renderTimesPerPeriodInput = (label: string, maxValue: number) => (
    <div className="space-y-3">
      <Label>{label}</Label>
      <div className="flex gap-2 items-center">
        <Input
          type="number"
          min={1}
          max={maxValue}
          value={frequency.timesPerPeriod || 1}
          onChange={(e) => updateFrequency({ timesPerPeriod: parseInt(e.target.value) || 1 })}
          className="w-24"
          data-testid="input-times-per-period"
        />
        <span className="text-sm text-muted-foreground">
          gånger per {frequency.type === 'times_per_week' ? 'vecka' : 
                      frequency.type === 'times_per_month' ? 'månad' : 'år'}
        </span>
      </div>
    </div>
  );

  const renderWeekdayExcluder = () => (
    <div className="space-y-3">
      <Label>Exkludera veckodagar</Label>
      <div className="flex flex-wrap gap-2">
        {WEEKDAYS.map(day => {
          const isExcluded = frequency.excludeWeekdays?.includes(day.value) || false;
          const isWeekend = day.value === 0 || day.value === 6;
          
          return (
            <Button
              key={day.value}
              type="button"
              size="sm"
              variant={isExcluded ? "destructive" : "outline"}
              className="min-w-[50px]"
              onClick={() => toggleExcludeWeekday(day.value)}
              data-testid={`exclude-weekday-${day.value}`}
            >
              {day.label}
            </Button>
          );
        })}
      </div>
      <div className="flex gap-4 items-center">
        <div className="flex items-center gap-2">
          <Switch
            checked={frequency.includeWeekdays !== false}
            onCheckedChange={(checked) => updateFrequency({ includeWeekdays: checked })}
            data-testid="switch-include-weekdays"
          />
          <Label className="text-sm">Vardagar</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={frequency.includeWeekends !== false}
            onCheckedChange={(checked) => updateFrequency({ includeWeekends: checked })}
            data-testid="switch-include-weekends"
          />
          <Label className="text-sm">Helger</Label>
        </div>
      </div>
    </div>
  );

  const renderMinMaxDays = () => (
    <div className="space-y-3">
      <Label>Avstånd mellan besök</Label>
      <div className="flex gap-4 items-center">
        <div className="flex gap-2 items-center">
          <span className="text-sm text-muted-foreground">Min:</span>
          <Input
            type="number"
            min={0}
            max={30}
            value={frequency.minDaysBetween || 0}
            onChange={(e) => updateFrequency({ minDaysBetween: parseInt(e.target.value) || 0 })}
            className="w-20"
            data-testid="input-min-days"
          />
        </div>
        <div className="flex gap-2 items-center">
          <span className="text-sm text-muted-foreground">Max:</span>
          <Input
            type="number"
            min={1}
            max={365}
            value={frequency.maxDaysBetween || 7}
            onChange={(e) => updateFrequency({ maxDaysBetween: parseInt(e.target.value) || 7 })}
            className="w-20"
            data-testid="input-max-days"
          />
        </div>
        <span className="text-sm text-muted-foreground">dagar</span>
      </div>
    </div>
  );

  const renderSeasonSelector = () => (
    <div className="space-y-3">
      <Label>Säsong</Label>
      <Select
        value={frequency.season || 'all_year'}
        onValueChange={(value) => updateFrequency({ season: value as Season })}
      >
        <SelectTrigger data-testid="select-season">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SEASONS.map(season => (
            <SelectItem key={season} value={season}>
              <div className="flex items-center gap-2">
                {SEASON_ICONS[season]}
                {SEASON_LABELS[season]}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const renderTimeWindow = () => (
    <div className="space-y-3">
      <Label>Föredraget tidsfönster</Label>
      <div className="flex gap-2 items-center">
        <Input
          type="time"
          value={frequency.preferredTimeWindow?.start || '06:00'}
          onChange={(e) => updateFrequency({ 
            preferredTimeWindow: { 
              start: e.target.value, 
              end: frequency.preferredTimeWindow?.end || '10:00' 
            } 
          })}
          className="w-28"
          data-testid="input-time-start"
        />
        <span className="text-sm text-muted-foreground">-</span>
        <Input
          type="time"
          value={frequency.preferredTimeWindow?.end || '10:00'}
          onChange={(e) => updateFrequency({ 
            preferredTimeWindow: { 
              start: frequency.preferredTimeWindow?.start || '06:00', 
              end: e.target.value 
            } 
          })}
          className="w-28"
          data-testid="input-time-end"
        />
      </div>
    </div>
  );

  const renderPreferredMonths = () => {
    const months = [
      { value: 1, label: 'Jan' },
      { value: 2, label: 'Feb' },
      { value: 3, label: 'Mar' },
      { value: 4, label: 'Apr' },
      { value: 5, label: 'Maj' },
      { value: 6, label: 'Jun' },
      { value: 7, label: 'Jul' },
      { value: 8, label: 'Aug' },
      { value: 9, label: 'Sep' },
      { value: 10, label: 'Okt' },
      { value: 11, label: 'Nov' },
      { value: 12, label: 'Dec' },
    ];

    const toggleMonth = (month: number) => {
      const current = frequency.preferredMonths || [];
      const updated = current.includes(month)
        ? current.filter(m => m !== month)
        : [...current, month].sort((a, b) => a - b);
      updateFrequency({ preferredMonths: updated });
    };

    return (
      <div className="space-y-3">
        <Label>Önskade månader</Label>
        <div className="grid grid-cols-6 gap-1">
          {months.map(month => {
            const isSelected = frequency.preferredMonths?.includes(month.value) || false;
            return (
              <Button
                key={month.value}
                type="button"
                size="sm"
                variant={isSelected ? "default" : "outline"}
                onClick={() => toggleMonth(month.value)}
                data-testid={`month-${month.value}`}
              >
                {month.label}
              </Button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderFrequencyOptions = () => {
    switch (frequency.type) {
      case 'specific_weekdays':
        return (
          <div className="space-y-4">
            {renderWeekdaySelector()}
          </div>
        );
      
      case 'interval_days':
        return (
          <div className="space-y-4">
            {renderIntervalDaysInput()}
            {renderWeekdayExcluder()}
          </div>
        );
      
      case 'times_per_week':
        return (
          <div className="space-y-4">
            {renderTimesPerPeriodInput('Antal besök per vecka', 7)}
            {renderWeekdayExcluder()}
            {renderMinMaxDays()}
          </div>
        );
      
      case 'times_per_month':
        return (
          <div className="space-y-4">
            {renderTimesPerPeriodInput('Antal besök per månad', 31)}
            {renderWeekdayExcluder()}
          </div>
        );
      
      case 'times_per_year':
        return (
          <div className="space-y-4">
            {renderTimesPerPeriodInput('Antal besök per år', 52)}
            {renderPreferredMonths()}
            {renderWeekdayExcluder()}
          </div>
        );
      
      case 'on_demand':
        return (
          <div className="text-sm text-muted-foreground p-4 bg-muted rounded-lg">
            Inga schemalagda besök - ordrar skapas manuellt vid behov.
          </div>
        );
      
      default:
        return null;
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          Schemaläggning
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Frekvenstyp</Label>
          <Select
            value={frequency.type}
            onValueChange={(value) => updateFrequency({ type: value as FrequencyType })}
          >
            <SelectTrigger data-testid="select-frequency-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FREQUENCY_TYPES.map(type => (
                <SelectItem key={type} value={type}>
                  {FREQUENCY_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {renderFrequencyOptions()}

        {showSeasonOptions && frequency.type !== 'on_demand' && (
          <>
            <div className="border-t pt-4">
              {renderSeasonSelector()}
            </div>
          </>
        )}

        {showTimeWindow && frequency.type !== 'on_demand' && (
          <div className="border-t pt-4">
            {renderTimeWindow()}
          </div>
        )}

        <div className="space-y-2">
          <Label>Flexibilitet vid planering</Label>
          <Select
            value={String(frequency.flexibility || 2)}
            onValueChange={(value) => updateFrequency({ flexibility: parseInt(value) as 1 | 2 | 3 })}
          >
            <SelectTrigger data-testid="select-flexibility">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Hög prioritet - måste göras exakt</SelectItem>
              <SelectItem value="2">Normal - viss flexibilitet tillåten</SelectItem>
              <SelectItem value="3">Låg prioritet - stor flexibilitet</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

export function FrequencySummaryBadge({ frequency }: { frequency?: FlexibleFrequency }) {
  if (!frequency) return null;

  const getLabel = () => {
    switch (frequency.type) {
      case 'specific_weekdays': {
        const days = (frequency.weekdays || [])
          .sort((a, b) => {
            const order = [1, 2, 3, 4, 5, 6, 0];
            return order.indexOf(a) - order.indexOf(b);
          })
          .map(d => WEEKDAY_LABELS[d]?.substring(0, 3))
          .join(', ');
        return days || 'Inga dagar';
      }
      case 'interval_days': {
        const days = frequency.intervalDays || 1;
        if (days === 1) return 'Dagligen';
        if (days === 2) return 'Varannan dag';
        if (days === 7) return 'Veckovis';
        return `Var ${days}:e dag`;
      }
      case 'times_per_week':
        return `${frequency.timesPerPeriod || 1}x/vecka`;
      case 'times_per_month':
        return `${frequency.timesPerPeriod || 1}x/månad`;
      case 'times_per_year': {
        const times = frequency.timesPerPeriod || 1;
        if (times === 1) return 'Årligen';
        if (times === 2) return 'Halvårsvis';
        return `${times}x/år`;
      }
      case 'on_demand':
        return 'Vid behov';
      default:
        return 'Okänd';
    }
  };

  const getSeasonLabel = () => {
    if (!frequency.season || frequency.season === 'all_year') return null;
    return SEASON_LABELS[frequency.season];
  };

  return (
    <div className="flex gap-1 flex-wrap">
      <Badge variant="secondary">{getLabel()}</Badge>
      {getSeasonLabel() && (
        <Badge variant="outline" className="gap-1">
          {SEASON_ICONS[frequency.season!]}
          {getSeasonLabel()}
        </Badge>
      )}
    </div>
  );
}
